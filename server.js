const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// Carrega .env simples (sem dependências)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const express = require('express');
const { db, getAllSettings, setSetting, ensureSecret, tx } = require('./src/db');
const auth = require('./src/auth');
const metrics = require('./src/metrics');
const webhook = require('./src/webhook');
const seed = require('./src/seed');

auth.ensureDefaultAdmin();
seed.seedInitial();
ensureSecret('webhook_token', 24);

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(auth.attachUser);

const now = () => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() + 1 }; };
const ym = (q) => {
  const n = now();
  const y = Number(q.ano || q.year) || n.y;
  const m = Number(q.mes || q.month) || n.m;
  return { y, m: Math.min(12, Math.max(1, m)) };
};
const wrap = (fn) => (req, res) => {
  try { const r = fn(req, res); if (r !== undefined) res.json(r); } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
};

// ---------------------------------------------------------------- Autenticação
app.post('/api/auth/login', auth.loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  const user = username && db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!user || !auth.verifyPassword(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }
  auth.clearAttempts(req.ip);
  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  auth.setSessionCookie(res, user);
  res.json({ user: auth.publicUser(user), single_user: auth.SINGLE_USER });
});
app.post('/api/auth/logout', (_req, res) => { auth.clearSessionCookie(res); res.json({ ok: true }); });
app.get('/api/auth/me', auth.requireAuth, (req, res) => res.json({ user: auth.publicUser(req.user), single_user: auth.SINGLE_USER }));
app.post('/api/auth/password', auth.requireAuth, wrap((req) => {
  const { atual, nova } = req.body || {};
  if (!auth.verifyPassword(String(atual || ''), req.user.password_hash)) throw new Error('Senha atual incorreta');
  if (!nova || String(nova).length < 6) throw new Error('A nova senha deve ter pelo menos 6 caracteres');
  db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(auth.hashPassword(String(nova)), req.user.id);
  return { ok: true };
}));

// ---------------------------------------------------------------- Dashboard (leitura)
app.get('/api/dashboard', auth.requireAuth, wrap((req) => { const { y, m } = ym(req.query); return metrics.dashboard(y, m); }));
app.get('/api/profissionais/stats', auth.requireAuth, wrap((req) => { const { y, m } = ym(req.query); return metrics.proStats(y, m); }));
app.get('/api/profissionais/ano', auth.requireAuth, wrap((req) => metrics.proYear(ym(req.query).y)));
app.get('/api/profissionais', auth.requireAuth, wrap(() => db.prepare('SELECT * FROM professionals ORDER BY active DESC, name').all()));
// Últimos eventos do webhook, resumidos para a página inicial (qualquer usuário logado)
app.get('/api/atividade', auth.requireAuth, wrap((req) => {
  const limit = Math.min(20, Number(req.query.limit) || 6);
  const rows = db.prepare("SELECT * FROM webhook_events WHERE status IN ('processado', 'duplicado', 'erro') ORDER BY id DESC LIMIT ?").all(limit);
  return rows.map((r) => {
    let payload = {};
    try { payload = JSON.parse(r.payload || '{}'); } catch {}
    let summary = null;
    try { summary = webhook.processOne(payload, { dryRun: true }); } catch {}
    return {
      id: String(r.id), event: r.event, status: r.status, message: r.message, created_at: r.created_at,
      kind: summary?.kind || null,
      profissional: summary?.result?.profissional || payload.profissional || null,
      date: summary?.result?.date || null,
      total: summary?.result?.total ?? null,
      values: summary?.result?.values || null,
    };
  });
}));
app.get('/api/config/publica', auth.requireAuth, wrap(() => {
  const s = getAllSettings();
  return { unidade: s.unidade, meta_mensal: s.meta_mensal, meta_quinzenal: s.meta_quinzenal, extras_catalog: s.extras_catalog, dias_fechados: s.dias_fechados };
}));

// ---------------------------------------------------------------- Admin: faturamento diário
app.put('/api/admin/diario/:date', auth.requireAdmin, wrap((req) => {
  const date = webhook.toDate(req.params.date);
  const b = req.body || {};
  const v = (k) => webhook.toNumber(b[k]);
  const status = ['PREVISTO', 'REALIZADO'].includes(b.status) ? b.status : 'REALIZADO';
  db.prepare(`INSERT INTO daily_revenue(date, servicos, produtos, novas_assinaturas, sva, recorrencia, status, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(date) DO UPDATE SET servicos = excluded.servicos, produtos = excluded.produtos,
    novas_assinaturas = excluded.novas_assinaturas, sva = excluded.sva, recorrencia = excluded.recorrencia, status = excluded.status, updated_at = CURRENT_TIMESTAMP`)
    .run(date, v('servicos'), v('produtos'), v('novas_assinaturas'), v('sva'), v('recorrencia'), status);
  webhook.notifyOutgoing('lancamento_manual');
  return { ok: true };
}));

// ---------------------------------------------------------------- Admin: profissionais
app.post('/api/admin/profissionais', auth.requireAdmin, wrap((req) => {
  const name = String(req.body?.name || '').trim();
  if (!name) throw new Error('Informe o nome');
  const r = db.prepare('INSERT INTO professionals(name, external_id) VALUES(?, ?)').run(name, req.body.external_id || null);
  return { id: Number(r.lastInsertRowid) };
}));
app.put('/api/admin/profissionais/:id', auth.requireAdmin, wrap((req) => {
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM professionals WHERE id = ?').get(req.params.id);
  if (!cur) throw new Error('Profissional não encontrado');
  db.prepare('UPDATE professionals SET name = ?, external_id = ?, active = ? WHERE id = ?')
    .run(String(b.name ?? cur.name).trim(), b.external_id ?? cur.external_id, b.active === undefined ? cur.active : (b.active ? 1 : 0), cur.id);
  return { ok: true };
}));
app.delete('/api/admin/profissionais/:id', auth.requireAdmin, wrap((req) => {
  db.prepare('DELETE FROM professionals WHERE id = ?').run(req.params.id);
  return { ok: true };
}));
app.put('/api/admin/profissionais/:id/mensal', auth.requireAdmin, wrap((req) => {
  const { y, m } = ym(req.body || {});
  const b = req.body || {};
  const n = (k) => webhook.toNumber(b[k]);
  db.prepare(`INSERT INTO professional_monthly(professional_id, year, month, faturamento_total, faturamento_assinatura, comissao, ticket_medio,
      clientes_atendidos, geracao_demanda, servicos_realizados, venda_produtos, qtd_produtos, extras, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(professional_id, year, month) DO UPDATE SET faturamento_total = excluded.faturamento_total, faturamento_assinatura = excluded.faturamento_assinatura,
      comissao = excluded.comissao, ticket_medio = excluded.ticket_medio, clientes_atendidos = excluded.clientes_atendidos, geracao_demanda = excluded.geracao_demanda,
      servicos_realizados = excluded.servicos_realizados, venda_produtos = excluded.venda_produtos, qtd_produtos = excluded.qtd_produtos, extras = excluded.extras,
      updated_at = CURRENT_TIMESTAMP`)
    .run(Number(req.params.id), y, m, n('faturamento_total'), n('faturamento_assinatura'), n('comissao'), b.ticket_medio ? n('ticket_medio') : null,
      n('clientes_atendidos'), n('geracao_demanda'), n('servicos_realizados'), n('venda_produtos'), n('qtd_produtos'), JSON.stringify(b.extras || {}));
  return { ok: true };
}));
app.delete('/api/admin/profissionais/:id/mensal', auth.requireAdmin, wrap((req) => {
  const { y, m } = ym(req.query);
  db.prepare('DELETE FROM professional_monthly WHERE professional_id = ? AND year = ? AND month = ?').run(req.params.id, y, m);
  return { ok: true };
}));

// ---------------------------------------------------------------- Admin: configurações
app.get('/api/admin/config', auth.requireAdmin, wrap(() => {
  const s = getAllSettings();
  delete s.session_secret; delete s.seeded;
  return s;
}));
app.put('/api/admin/config', auth.requireAdmin, wrap((req) => {
  const b = req.body || {};
  if (b.unidade !== undefined) setSetting('unidade', String(b.unidade).trim() || 'Pátria Barbearia');
  if (b.meta_mensal !== undefined) setSetting('meta_mensal', webhook.toNumber(b.meta_mensal));
  if (b.meta_quinzenal !== undefined) setSetting('meta_quinzenal', webhook.toNumber(b.meta_quinzenal));
  if (Array.isArray(b.dias_fechados)) setSetting('dias_fechados', b.dias_fechados.map(Number).filter((n) => n >= 0 && n <= 6));
  if (Array.isArray(b.feriados)) setSetting('feriados', b.feriados.map((d) => webhook.toDate(d)));
  if (Array.isArray(b.extras_catalog)) setSetting('extras_catalog', b.extras_catalog.map((s) => String(s).trim().toUpperCase()).filter(Boolean));
  if (b.outgoing_webhook_url !== undefined) {
    const u = String(b.outgoing_webhook_url).trim();
    if (u && !/^https?:\/\//i.test(u)) throw new Error('URL de saída deve começar com http:// ou https://');
    setSetting('outgoing_webhook_url', u);
  }
  return { ok: true };
}));

// ---------------------------------------------------------------- Admin: usuários
app.get('/api/admin/usuarios', auth.requireAdmin, wrap(() => db.prepare('SELECT id, username, name, role, created_at, last_login FROM users ORDER BY id').all()));
app.post('/api/admin/usuarios', auth.requireAdmin, wrap((req) => {
  if (auth.SINGLE_USER) throw new Error('Este painel tem acesso por um único login. Defina MULTI_USER=true para cadastrar outros usuários.');
  const { username, name, password, role } = req.body || {};
  if (!username || !password || String(password).length < 6) throw new Error('Informe usuário e senha (mínimo 6 caracteres)');
  db.prepare('INSERT INTO users(username, name, password_hash, role) VALUES(?, ?, ?, ?)')
    .run(String(username).trim(), name || username, auth.hashPassword(String(password)), role === 'admin' ? 'admin' : 'viewer');
  return { ok: true };
}));
app.put('/api/admin/usuarios/:id', auth.requireAdmin, wrap((req) => {
  const { name, password, role } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new Error('Usuário não encontrado');
  if (u.id === req.user.id && role && role !== 'admin') throw new Error('Você não pode remover seu próprio acesso de admin');
  db.prepare('UPDATE users SET name = ?, role = ? WHERE id = ?').run(name ?? u.name, role ? (role === 'admin' ? 'admin' : 'viewer') : u.role, u.id);
  if (password) {
    if (String(password).length < 6) throw new Error('Senha deve ter pelo menos 6 caracteres');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(String(password)), u.id);
  }
  return { ok: true };
}));
app.delete('/api/admin/usuarios/:id', auth.requireAdmin, wrap((req) => {
  if (Number(req.params.id) === req.user.id) throw new Error('Você não pode excluir o próprio usuário');
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  return { ok: true };
}));

// ---------------------------------------------------------------- Admin: webhook e dados de demonstração
app.get('/api/admin/webhook', auth.requireAdmin, wrap((req) => {
  const s = getAllSettings();
  const base = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  const stats = db.prepare(`SELECT status, COUNT(*) AS n FROM webhook_events WHERE created_at >= datetime('now', '-30 days') GROUP BY status`).all();
  return {
    token: s.webhook_token,
    url: `${base}/api/webhooks/cashbarber`,
    url_com_token: `${base}/api/webhooks/cashbarber?token=${s.webhook_token}`,
    outgoing_webhook_url: s.outgoing_webhook_url,
    stats: Object.fromEntries(stats.map((r) => [r.status, r.n])),
  };
}));
app.post('/api/admin/webhook/rotacionar', auth.requireAdmin, wrap(() => {
  setSetting('webhook_token', crypto.randomBytes(24).toString('hex'));
  return { ok: true };
}));
app.get('/api/admin/webhook/logs', auth.requireAdmin, wrap((req) => {
  const limit = Math.min(200, Number(req.query.limit) || 50);
  return db.prepare('SELECT * FROM webhook_events ORDER BY id DESC LIMIT ?').all(limit);
}));
app.delete('/api/admin/webhook/logs', auth.requireAdmin, wrap(() => { db.prepare('DELETE FROM webhook_events').run(); return { ok: true }; }));
app.post('/api/admin/webhook/testar', auth.requireAdmin, wrap((req) => {
  const { payload, simular } = req.body || {};
  const list = Array.isArray(payload) ? payload : [payload];
  const results = list.map((p) => {
    try {
      const r = webhook.processOne(p, { dryRun: simular !== false });
      if (simular === false) webhook.logEvent({ externalId: r.externalId, event: r.event, status: r.duplicate ? 'duplicado' : 'processado', message: 'Enviado pelo painel admin', payload: p, ip: req.ip });
      return { ok: true, ...r };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  if (simular === false) webhook.notifyOutgoing('teste_admin');
  return { simulado: simular !== false, results };
}));
app.post('/api/admin/demo', auth.requireAdmin, wrap((req) => {
  const { y, m } = ym(req.body || {});
  seed.seedDemo(y, m);
  return { ok: true };
}));
app.delete('/api/admin/demo', auth.requireAdmin, wrap(() => { seed.clearDemo(); return { ok: true }; }));

// ---------------------------------------------------------------- Webhook público (CashBarber → Dashboard)
function webhookAuth(req, res, next) {
  const token = getAllSettings().webhook_token;
  const given = req.get('x-webhook-token') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.query.token || '';
  const a = Buffer.from(String(given)); const b = Buffer.from(String(token));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    webhook.logEvent({ status: 'nao_autorizado', message: 'Token inválido', payload: req.body, ip: req.ip });
    return res.status(401).json({ error: 'Token inválido' });
  }
  next();
}
app.post(['/api/webhooks/cashbarber', '/api/webhook'], webhookAuth, (req, res) => {
  const body = req.body;
  const list = Array.isArray(body) ? body : Array.isArray(body?.eventos) ? body.eventos : Array.isArray(body?.events) ? body.events : [body];
  const results = [];
  for (const p of list) {
    try {
      const r = webhook.processOne(p);
      webhook.logEvent({ externalId: r.externalId, event: r.event, status: r.duplicate ? 'duplicado' : 'processado', message: r.message, payload: p, ip: req.ip });
      results.push({ ok: true, event: r.event, duplicate: !!r.duplicate });
    } catch (e) {
      webhook.logEvent({ event: p?.event || p?.evento, status: 'erro', message: e.message, payload: p, ip: req.ip });
      results.push({ ok: false, error: e.message });
    }
  }
  webhook.notifyOutgoing('webhook');
  const failed = results.filter((r) => !r.ok).length;
  res.status(failed === results.length ? 422 : 200).json({ recebidos: results.length, erros: failed, results });
});
app.get('/api/webhooks/cashbarber', (_req, res) => res.json({ ok: true, info: 'Envie eventos via POST com o token no header X-Webhook-Token' }));

// ---------------------------------------------------------------- Front-end
app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules/chart.js/dist'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/api/*', (_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`🚀 Dashboard rodando em http://localhost:${PORT}`));

module.exports = { app, tx };
