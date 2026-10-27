// Aplicação Express (API). Usada pelo servidor local (server.js) e pela função da Vercel (api/index.js).
const crypto = require('node:crypto');
const express = require('express');
const { db, tx, getSetting, getAllSettings, setSetting, ensureSecret, migrate, databaseInfo } = require('./db');
const auth = require('./auth');
const metrics = require('./metrics');
const webhook = require('./webhook');
const seed = require('./seed');
const importer = require('./importer');
const access = require('./access');

// Prepara o banco uma vez por instância (em serverless, a cada "cold start")
let ready;
function init() {
  ready ??= (async () => {
    await migrate();
    await auth.loadSecret();
    await auth.ensureDefaultAdmin();
    await seed.seedInitial();
    await ensureSecret('webhook_token', 24);
  })().catch((e) => { ready = undefined; throw e; });
  return ready;
}

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
// Diagnóstico da hospedagem (não exige login e não mostra segredos): abra /api/health no navegador
app.get('/api/health', async (_req, res) => {
  const out = {
    ok: false,
    ambiente: process.env.VERCEL ? 'vercel' : 'servidor',
    node: process.version,
    banco: null,
    login: null,
    session_secret: process.env.SESSION_SECRET ? 'definida' : 'opcional (gerada no banco)',
  };
  try {
    out.banco = databaseInfo();
    await init();
    await db.get('SELECT 1 AS ok');
    out.banco.conexao = 'ok';
    out.login = await auth.adminStatus();
    out.ok = out.login.senha_do_banco_confere;
    if (!out.ok) out.erro = 'O login do banco não confere com ADMIN_USER/ADMIN_PASSWORD desta implantação. Confira as variáveis em Production e faça Redeploy.';
  } catch (e) {
    out.erro = e.message;
  }
  res.status(out.ok ? 200 : 500).json(out);
});

app.use(async (_req, res, next) => {
  try { await init(); next(); } catch (e) { console.error(e); res.status(500).json({ error: `Falha ao iniciar o banco de dados: ${e.message}` }); }
});
app.use(express.json({ limit: '4mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(auth.attachUser);
app.use(async (req, _res, next) => {
  try {
    if (req.user) {
      req.access = await access.forUser(req.user);
      if (!req.access.ativo) { req.user = null; req.access = null; }
    }
    next();
  } catch (e) { next(e); }
});
const deny = (res) => res.status(403).json({ error: 'Você não tem acesso a esta tela' });
const needShop = (req, res, next) => (access.canShop(req.access) ? next() : deny(res));
const needPros = (req, res, next) => (access.canPros(req.access) ? next() : deny(res));

// Barbeiro que só vê os próprios números: filtra os profissionais e refaz totais/médias com o que sobrou
const PRO_NUM = ['faturamento_total', 'faturamento_assinatura', 'comissao', 'ticket_medio', 'clientes_atendidos', 'geracao_demanda', 'servicos_realizados', 'venda_produtos', 'qtd_produtos'];
function restrictStats(req, st) {
  if (!access.ownOnly(req.access)) return st;
  const own = st.profissionais.filter((p) => p.professional_id === req.access.professional_id);
  const total = Object.fromEntries(PRO_NUM.map((k) => [k, own.reduce((a, p) => a + (p[k] || 0), 0)]));
  total.extras = own[0]?.extras || {};
  return { ...st, profissionais: own, total, media: { ...total }, restrito: true };
}
async function restrictYear(req, yr) {
  if (!access.ownOnly(req.access)) return yr;
  const pro = await db.get('SELECT name FROM professionals WHERE id = ?', req.access.professional_id || 0);
  return {
    ...yr,
    restrito: true,
    meses: yr.meses.map((m) => {
      const v = pro ? m.profissionais[pro.name] : undefined;
      return { mes: m.mes, nome: m.nome, faturamento_total: v || 0, profissionais: v != null ? { [pro.name]: v } : {} };
    }),
  };
}
async function sessionInfo(user, acc) {
  const pro = acc.professional_id ? await db.get('SELECT id, name FROM professionals WHERE id = ?', acc.professional_id) : null;
  return {
    user: auth.publicUser(user),
    single_user: false,
    password_managed: auth.passwordManaged(user),
    principal: auth.isPrincipal(user),
    access: { admin: acc.admin, telas: acc.telas, escopo: acc.escopo, professional_id: acc.professional_id, profissional: pro?.name || null },
  };
}

const ym = (q) => {
  const n = metrics.todayParts();
  const y = Number(q.ano || q.year) || n.y;
  const m = Number(q.mes || q.month) || n.m;
  return { y, m: Math.min(12, Math.max(1, m)) };
};
const wrap = (fn) => async (req, res) => {
  try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
};

// ---------------------------------------------------------------- Autenticação
app.post('/api/auth/login', auth.loginRateLimit, wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const user = username && (await db.get('SELECT * FROM users WHERE lower(username) = lower(?)', String(username).trim()));
  const senha = String(password || '');
  // aceita a senha com espaços acidentais nas pontas (teclado do celular, copiar e colar)
  const ok = user && (auth.verifyPassword(senha, user.password_hash) || (senha.trim() !== senha && auth.verifyPassword(senha.trim(), user.password_hash)));
  const acc = ok ? await access.forUser(user) : null;
  if (!ok || !acc.ativo) {
    console.warn(`Login recusado para "${String(username || '').slice(0, 80)}": ${!user ? 'usuário não cadastrado' : !ok ? 'senha incorreta' : 'login bloqueado'}`);
    res.status(401).json({ error: 'Você não tem acesso' });
    return;
  }
  auth.clearAttempts(req.ip);
  await db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', user.id);
  auth.setSessionCookie(res, user);
  return sessionInfo(user, acc);
}));
app.post('/api/auth/logout', (_req, res) => { auth.clearSessionCookie(res); res.json({ ok: true }); });
app.get('/api/auth/me', auth.requireAuth, wrap((req) => sessionInfo(req.user, req.access)));
app.post('/api/auth/password', auth.requireAuth, wrap(async (req) => {
  if (auth.passwordManaged(req.user)) throw new Error('A senha deste login é definida na hospedagem (variável ADMIN_PASSWORD).');
  const { atual, nova } = req.body || {};
  if (!auth.verifyPassword(String(atual || ''), req.user.password_hash)) throw new Error('Senha atual incorreta');
  if (!nova || String(nova).length < 6) throw new Error('A nova senha deve ter pelo menos 6 caracteres');
  await db.run('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?', auth.hashPassword(String(nova)), req.user.id);
  return { ok: true };
}));

// ---------------------------------------------------------------- Dashboard (leitura)
app.get('/api/dashboard', auth.requireAuth, needShop, wrap((req) => { const { y, m } = ym(req.query); return metrics.dashboard(y, m); }));
app.get('/api/relatorios', auth.requireAuth, needPros, wrap(async (req) => {
  const rep = req.query.de && req.query.ate
    ? await metrics.monthlyReports({ de: req.query.de, ate: req.query.ate })
    : await metrics.monthlyReports(ym(req.query));
  // sem telas da barbearia: nada de clube/serviços da loja; só a própria agenda
  if (!access.canShop(req.access)) { rep.assinaturas = null; rep.servicos = null; }
  if (access.ownOnly(req.access) && rep.agenda) {
    const own = rep.agenda.profissionais.filter((p) => p.professional_id === req.access.professional_id);
    const keys = ['total', 'finalizados', 'cancelados', 'agendados', 'futuros', 'faltas', 'app', 'clube'];
    rep.agenda = { ...rep.agenda, profissionais: own, por_dia: [], totais: Object.fromEntries(keys.map((k) => [k, own.reduce((a, p) => a + (p[k] || 0), 0)])) };
  }
  return rep;
}));
app.get('/api/periodo', auth.requireAuth, needShop, wrap((req) => metrics.rangeReport(req.query.de, req.query.ate)));
app.get('/api/profissionais/stats', auth.requireAuth, needPros, wrap(async (req) => {
  if (req.query.de && req.query.ate) return restrictStats(req, await metrics.proStatsRange(req.query.de, req.query.ate));
  const { y, m } = ym(req.query);
  return restrictStats(req, await metrics.proStats(y, m));
}));
app.get('/api/profissionais/ano', auth.requireAuth, needPros, wrap(async (req) => restrictYear(req, await metrics.proYear(ym(req.query).y))));
app.get('/api/profissionais', auth.requireAuth, wrap(async (req) => {
  const all = await db.all('SELECT * FROM professionals ORDER BY active DESC, name');
  return access.ownOnly(req.access) ? all.filter((p) => p.id === req.access.professional_id) : all;
}));
// Últimos eventos do webhook, resumidos para a página inicial (qualquer usuário logado)
app.get('/api/atividade', auth.requireAuth, needShop, wrap(async (req) => {
  const limit = Math.min(20, Number(req.query.limit) || 6);
  const rows = await db.all("SELECT * FROM webhook_events WHERE status IN ('processado', 'duplicado', 'erro') ORDER BY id DESC LIMIT ?", limit);
  const catalog = (await getAllSettings()).extras_catalog;
  return Promise.all(rows.map(async (r) => {
    let payload = {};
    try { payload = JSON.parse(r.payload || '{}'); } catch {}
    let summary = null;
    try { summary = await webhook.processOne(payload, { dryRun: true, catalog }); } catch {}
    return {
      id: String(r.id), event: r.event, status: r.status, message: r.message, created_at: r.created_at,
      kind: summary?.kind || null,
      profissional: summary?.result?.profissional || payload?.profissional || null,
      date: summary?.result?.date || null,
      total: summary?.result?.total ?? null,
      values: summary?.result?.values || null,
    };
  }));
}));
app.get('/api/config/publica', auth.requireAuth, wrap(async () => {
  const s = await getAllSettings();
  return { unidade: s.unidade, meta_mensal: s.meta_mensal, meta_quinzenal: s.meta_quinzenal, extras_catalog: s.extras_catalog, dias_fechados: s.dias_fechados };
}));

// ---------------------------------------------------------------- Admin: faturamento diário
app.put('/api/admin/diario/:date', auth.requireAdmin, wrap(async (req) => {
  const date = webhook.toDate(req.params.date);
  const b = req.body || {};
  const v = (k) => webhook.toNumber(b[k]);
  const status = ['PREVISTO', 'REALIZADO'].includes(b.status) ? b.status : 'REALIZADO';
  await db.run(`INSERT INTO daily_revenue(date, servicos, produtos, novas_assinaturas, sva, recorrencia, status, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(date) DO UPDATE SET servicos = excluded.servicos, produtos = excluded.produtos,
    novas_assinaturas = excluded.novas_assinaturas, sva = excluded.sva, recorrencia = excluded.recorrencia, status = excluded.status, updated_at = CURRENT_TIMESTAMP`,
  date, v('servicos'), v('produtos'), v('novas_assinaturas'), v('sva'), v('recorrencia'), status);
  await webhook.notifyOutgoing('lancamento_manual');
  return { ok: true };
}));

// ---------------------------------------------------------------- Admin: profissionais
app.post('/api/admin/profissionais', auth.requireAdmin, wrap(async (req) => {
  const name = String(req.body?.name || '').trim();
  if (!name) throw new Error('Informe o nome');
  await db.run('INSERT INTO professionals(name, external_id) VALUES(?, ?)', name, req.body.external_id || null);
  return { ok: true };
}));
app.put('/api/admin/profissionais/:id', auth.requireAdmin, wrap(async (req) => {
  const b = req.body || {};
  const cur = await db.get('SELECT * FROM professionals WHERE id = ?', Number(req.params.id));
  if (!cur) throw new Error('Profissional não encontrado');
  await db.run('UPDATE professionals SET name = ?, external_id = ?, active = ? WHERE id = ?',
    String(b.name ?? cur.name).trim(), b.external_id ?? cur.external_id, b.active === undefined ? cur.active : (b.active ? 1 : 0), cur.id);
  return { ok: true };
}));
app.delete('/api/admin/profissionais/:id', auth.requireAdmin, wrap(async (req) => {
  const id = Number(req.params.id);
  await tx(async (q) => {
    await q.run('DELETE FROM professional_monthly WHERE professional_id = ?', id);
    await q.run('DELETE FROM professionals WHERE id = ?', id);
  });
  return { ok: true };
}));
app.put('/api/admin/profissionais/:id/mensal', auth.requireAdmin, wrap(async (req) => {
  const { y, m } = ym(req.body || {});
  const b = req.body || {};
  const n = (k) => webhook.toNumber(b[k]);
  await db.run(`INSERT INTO professional_monthly(professional_id, year, month, faturamento_total, faturamento_assinatura, comissao, ticket_medio,
      clientes_atendidos, geracao_demanda, servicos_realizados, venda_produtos, qtd_produtos, extras, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(professional_id, year, month) DO UPDATE SET faturamento_total = excluded.faturamento_total, faturamento_assinatura = excluded.faturamento_assinatura,
      comissao = excluded.comissao, ticket_medio = excluded.ticket_medio, clientes_atendidos = excluded.clientes_atendidos, geracao_demanda = excluded.geracao_demanda,
      servicos_realizados = excluded.servicos_realizados, venda_produtos = excluded.venda_produtos, qtd_produtos = excluded.qtd_produtos, extras = excluded.extras,
      updated_at = CURRENT_TIMESTAMP`,
  Number(req.params.id), y, m, n('faturamento_total'), n('faturamento_assinatura'), n('comissao'), b.ticket_medio ? n('ticket_medio') : null,
  n('clientes_atendidos'), n('geracao_demanda'), n('servicos_realizados'), n('venda_produtos'), n('qtd_produtos'), JSON.stringify(b.extras || {}));
  return { ok: true };
}));
app.delete('/api/admin/profissionais/:id/mensal', auth.requireAdmin, wrap(async (req) => {
  const { y, m } = ym(req.query);
  await db.run('DELETE FROM professional_monthly WHERE professional_id = ? AND year = ? AND month = ?', Number(req.params.id), y, m);
  return { ok: true };
}));

// ---------------------------------------------------------------- Admin: configurações
app.get('/api/admin/config', auth.requireAdmin, wrap(async () => {
  const s = await getAllSettings();
  delete s.session_secret; delete s.seeded; delete s.ultima_importacao; delete s.cashbarber_equipe;
  return s;
}));
app.put('/api/admin/config', auth.requireAdmin, wrap(async (req) => {
  const b = req.body || {};
  if (b.unidade !== undefined) await setSetting('unidade', String(b.unidade).trim() || 'Pátria Barbearia');
  if (b.meta_mensal !== undefined) await setSetting('meta_mensal', webhook.toNumber(b.meta_mensal));
  if (b.meta_quinzenal !== undefined) await setSetting('meta_quinzenal', webhook.toNumber(b.meta_quinzenal));
  if (Array.isArray(b.dias_fechados)) await setSetting('dias_fechados', b.dias_fechados.map(Number).filter((n) => n >= 0 && n <= 6));
  if (Array.isArray(b.feriados)) await setSetting('feriados', b.feriados.map((d) => webhook.toDate(d)));
  if (Array.isArray(b.extras_catalog)) await setSetting('extras_catalog', b.extras_catalog.map((s) => String(s).trim().toUpperCase()).filter(Boolean));
  if (b.metas_mes && typeof b.metas_mes === 'object') {
    // { "2026-10": { mensal: 30000, quinzenal: 15000 } } — vazio volta para a meta padrão
    const clean = {};
    for (const [k, v] of Object.entries(b.metas_mes)) {
      if (!/^\d{4}-\d{2}$/.test(k) || !v) continue;
      const item = {};
      if (v.mensal !== '' && v.mensal != null) item.mensal = webhook.toNumber(v.mensal);
      if (v.quinzenal !== '' && v.quinzenal != null) item.quinzenal = webhook.toNumber(v.quinzenal);
      if (Object.keys(item).length) clean[k] = item;
    }
    await setSetting('metas_mes', clean);
  }
  if (b.outgoing_webhook_url !== undefined) {
    const u = String(b.outgoing_webhook_url).trim();
    if (u && !/^https?:\/\//i.test(u)) throw new Error('URL de saída deve começar com http:// ou https://');
    await setSetting('outgoing_webhook_url', u);
  }
  return { ok: true };
}));

// ---------------------------------------------------------------- Admin: usuários
app.get('/api/admin/usuarios', auth.requireAdmin, wrap(async () => {
  const users = await db.all('SELECT id, username, name, role, created_at, last_login FROM users ORDER BY id');
  return Promise.all(users.map(async (u) => ({ ...u, principal: auth.isPrincipal(u), access: await access.forUser(u) })));
}));
const userPayload = (b) => ({
  username: String(b.username || '').trim(),
  name: String(b.name || '').trim(),
  role: b.role === 'admin' ? 'admin' : 'viewer',
  access: { ativo: b.ativo !== false, telas: b.telas, escopo: b.escopo, professional_id: b.professional_id || null },
});
app.post('/api/admin/usuarios', auth.requireAdmin, wrap(async (req) => {
  const b = userPayload(req.body || {});
  const password = String(req.body?.password || '');
  if (!/^\S+@\S+\.\S+$/.test(b.username)) throw new Error('Informe um e-mail válido para o login');
  if (password.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres');
  if (await db.get('SELECT id FROM users WHERE lower(username) = lower(?)', b.username)) throw new Error('Já existe um login com esse e-mail');
  if (b.role !== 'admin' && !b.access.professional_id && b.access.telas?.includes('meu-painel')) throw new Error('Escolha qual profissional é este barbeiro (para a tela Meu desempenho)');
  await tx(async (q) => {
    await q.run('INSERT INTO users(username, name, password_hash, role) VALUES(?, ?, ?, ?)', b.username, b.name || b.username, auth.hashPassword(password), b.role);
    const u = await q.get('SELECT id FROM users WHERE lower(username) = lower(?)', b.username);
    await access.save(q, u.id, b.access);
  });
  return { ok: true };
}));
app.put('/api/admin/usuarios/:id', auth.requireAdmin, wrap(async (req) => {
  const u = await db.get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!u) throw new Error('Usuário não encontrado');
  if (auth.isPrincipal(u)) throw new Error('O login principal (dono) é definido na hospedagem e tem acesso total');
  const b = userPayload({ ...req.body, username: req.body?.username || u.username });
  if (u.id === req.user.id && b.role !== 'admin') throw new Error('Você não pode remover seu próprio acesso de administrador');
  if (b.username.toLowerCase() !== u.username.toLowerCase()) {
    if (!/^\S+@\S+\.\S+$/.test(b.username)) throw new Error('Informe um e-mail válido para o login');
    if (await db.get('SELECT id FROM users WHERE lower(username) = lower(?) AND id <> ?', b.username, u.id)) throw new Error('Já existe um login com esse e-mail');
  }
  const password = String(req.body?.password || '');
  if (password && password.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres');
  await tx(async (q) => {
    await q.run('UPDATE users SET username = ?, name = ?, role = ? WHERE id = ?', b.username, b.name || u.name, b.role, u.id);
    if (password) await q.run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(password), u.id);
    await access.save(q, u.id, b.access);
  });
  return { ok: true };
}));
app.delete('/api/admin/usuarios/:id', auth.requireAdmin, wrap(async (req) => {
  const u = await db.get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!u) throw new Error('Usuário não encontrado');
  if (u.id === req.user.id || auth.isPrincipal(u)) throw new Error('Este login não pode ser excluído');
  await tx(async (q) => {
    await q.run('DELETE FROM user_access WHERE user_id = ?', u.id);
    await q.run('DELETE FROM users WHERE id = ?', u.id);
  });
  return { ok: true };
}));

// ---------------------------------------------------------------- Admin: webhook e dados de demonstração
const publicBase = (req) => process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
  || `${req.protocol}://${req.get('host')}`;

app.get('/api/admin/webhook', auth.requireAdmin, wrap(async (req) => {
  const s = await getAllSettings();
  const base = publicBase(req);
  const desde = new Date(Date.now() - 30 * 86400e3).toISOString().replace('T', ' ').slice(0, 19);
  const stats = await db.all('SELECT status, COUNT(*) AS n FROM webhook_events WHERE created_at >= ? GROUP BY status', desde);
  return {
    token: s.webhook_token,
    url: `${base}/api/webhooks/cashbarber`,
    url_com_token: `${base}/api/webhooks/cashbarber?token=${s.webhook_token}`,
    outgoing_webhook_url: s.outgoing_webhook_url,
    stats: Object.fromEntries(stats.map((r) => [r.status, r.n])),
  };
}));
app.post('/api/admin/webhook/rotacionar', auth.requireAdmin, wrap(async () => {
  await setSetting('webhook_token', crypto.randomBytes(24).toString('hex'));
  return { ok: true };
}));
app.get('/api/admin/webhook/logs', auth.requireAdmin, wrap((req) => {
  const limit = Math.min(200, Number(req.query.limit) || 50);
  return db.all('SELECT * FROM webhook_events ORDER BY id DESC LIMIT ?', limit);
}));
app.delete('/api/admin/webhook/logs', auth.requireAdmin, wrap(async () => { await db.run('DELETE FROM webhook_events'); return { ok: true }; }));
app.post('/api/admin/webhook/testar', auth.requireAdmin, wrap(async (req) => {
  const { payload, simular } = req.body || {};
  const list = Array.isArray(payload) ? payload : [payload];
  const results = [];
  for (const p of list) {
    try {
      const r = await webhook.processOne(p, { dryRun: simular !== false });
      if (simular === false) await webhook.logEvent({ externalId: r.externalId, event: r.event, status: r.duplicate ? 'duplicado' : 'processado', message: 'Enviado pelo painel admin', payload: p, ip: req.ip });
      results.push({ ok: true, ...r });
    } catch (e) { results.push({ ok: false, error: e.message }); }
  }
  if (simular === false) await webhook.notifyOutgoing('teste_admin');
  return { simulado: simular !== false, results };
}));
// ---------------------------------------------------------------- Admin: dados mensais editáveis (agenda, clube, serviços)
const REPORT_KINDS = ['agenda', 'assinaturas', 'servicos', 'importacao'];
app.get('/api/admin/relatorios/:kind', auth.requireAdmin, wrap(async (req) => {
  if (!REPORT_KINDS.includes(req.params.kind)) throw new Error('Tipo de relatório inválido');
  const { y, m } = ym(req.query);
  const row = await db.get('SELECT data, updated_at FROM monthly_reports WHERE year = ? AND month = ? AND kind = ?', y, m, req.params.kind);
  return { ano: y, mes: m, data: row ? JSON.parse(row.data) : null, atualizado_em: row?.updated_at || null };
}));
app.put('/api/admin/relatorios/:kind', auth.requireAdmin, wrap(async (req) => {
  const kind = req.params.kind;
  if (!['agenda', 'assinaturas', 'servicos'].includes(kind)) throw new Error('Tipo de relatório inválido');
  const { y, m } = ym(req.body || {});
  const data = req.body?.data;
  if (!data || typeof data !== 'object') throw new Error('Dados inválidos');
  const n = (v) => Math.max(0, webhook.toNumber(v));
  if (kind === 'agenda') {
    const keys = ['total', 'finalizados', 'cancelados', 'agendados', 'futuros', 'faltas', 'app', 'clube'];
    data.profissionais = (data.profissionais || []).filter((p) => p.professional_id).map((p) => ({ professional_id: Number(p.professional_id), nome: p.nome, ...Object.fromEntries(keys.map((k) => [k, n(p[k])])) }));
    data.totais = Object.fromEntries(keys.map((k) => [k, data.profissionais.reduce((a, p) => a + p[k], 0)]));
    data.por_dia = Array.isArray(data.por_dia) ? data.por_dia : [];
  } else if (kind === 'assinaturas') {
    for (const k of ['ativos', 'inadimplentes', 'novas_no_mes', 'cancelamentos']) data[k] = data[k] === '' || data[k] == null ? null : n(data[k]);
    data.total = data.ativos == null && data.inadimplentes == null ? null : (data.ativos || 0) + (data.inadimplentes || 0);
    data.motivos = (data.motivos || []).filter((x) => x[0]).map(([k, v]) => [String(k).trim(), n(v)]);
    data.planos = (data.planos || []).filter((x) => x[0]).map(([k, v]) => [String(k).trim(), n(v)]);
  } else {
    data.lista = (data.lista || []).filter((x) => x.nome).map((x) => ({ nome: String(x.nome).trim(), quantidade: n(x.quantidade), faturado: n(x.faturado), sva: !!x.sva }));
    data.sva_total = data.lista.filter((x) => x.sva).reduce((a, x) => a + x.faturado, 0);
    data.total = data.lista.reduce((a, x) => a + x.faturado, 0);
  }
  await db.run(`INSERT INTO monthly_reports(year, month, kind, data, updated_at) VALUES(?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(year, month, kind) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`, y, m, kind, JSON.stringify(data));
  return { ok: true };
}));
// Apaga dados de um mês: partes = diario, profissionais, relatorios (separadas por vírgula)
app.delete('/api/admin/mes', auth.requireAdmin, wrap(async (req) => {
  const { y, m } = ym(req.query);
  const partes = String(req.query.partes || '').split(',');
  const last = metrics.daysInMonth(y, m);
  await tx(async (q) => {
    if (partes.includes('diario')) await q.run('DELETE FROM daily_revenue WHERE date >= ? AND date <= ?', metrics.iso(y, m, 1), metrics.iso(y, m, last));
    if (partes.includes('profissionais')) await q.run('DELETE FROM professional_monthly WHERE year = ? AND month = ?', y, m);
    if (partes.includes('relatorios')) await q.run('DELETE FROM monthly_reports WHERE year = ? AND month = ?', y, m);
  });
  return { ok: true };
}));

// Importação dos relatórios CSV do CashBarber: sem "confirmar" só analisa; com "confirmar" grava
app.post('/api/admin/importar', auth.requireAdmin, wrap(async (req) => {
  const files = Array.isArray(req.body?.files) ? req.body.files.filter((f) => f && typeof f.text === 'string') : [];
  if (!files.length) throw new Error('Selecione os arquivos CSV exportados do CashBarber.');
  const plan = await importer.analyze(files, { ano: req.body.ano, mes: req.body.mes });
  if (!req.body.confirmar) return { plan };
  const result = await importer.apply(plan);
  await setSetting('ultima_importacao', { em: new Date().toISOString(), ano: plan.ano, mes: plan.mes, relatorios: plan.relatorios });
  return { result, plan };
}));
// Entrada do robô de sincronização (GitHub Actions): mesma importação, autenticada pelo token IMPORT_TOKEN
function robotAuth(req, res, next) {
  const token = String(process.env.IMPORT_TOKEN || '').trim();
  const given = String(req.get('x-import-token') || '').trim();
  const a = Buffer.from(given); const b = Buffer.from(token);
  if (!token || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Token do robô inválido' });
  next();
}
app.post('/api/robo/importar', robotAuth, wrap(async (req) => {
  const files = Array.isArray(req.body?.files) ? req.body.files.filter((f) => f && typeof f.text === 'string') : [];
  if (!files.length) throw new Error('Nenhum arquivo recebido');
  const plan = await importer.analyze(files, { ano: req.body.ano, mes: req.body.mes });
  const y = plan.ano; const m = plan.mes;
  const ignoradosPorSeguranca = [];
  if (y && m) {
    const de = metrics.iso(y, m, 1); const ate = metrics.iso(y, m, metrics.daysInMonth(y, m));
    // Trava: o robô nunca troca o faturamento do mês por um total zerado ou muito menor do que o que já está gravado
    if (plan.financeiro) {
      const atual = await db.get('SELECT COALESCE(SUM(servicos + produtos + novas_assinaturas + sva + recorrencia), 0) AS t FROM daily_revenue WHERE date >= ? AND date <= ?', de, ate);
      const novo = plan.financeiro.resumo.faturamento_total;
      const atualT = Number(atual?.t) || 0;
      // "forcar" (execução manual com substituir) libera a comparação com o atual; total zerado nunca passa
      if (!(novo > 0) || (!req.body.forcar && atualT > 0 && novo < atualT * 0.5)) {
        ignoradosPorSeguranca.push(`comandas (total recebido ${novo > 0 ? `${Math.round((novo / atualT) * 100)}% do que já está no painel` : 'zerado'}; nada foi alterado)`);
        plan.financeiro = null;
      }
    }
    if (plan.agenda && !(plan.agenda.totais?.total > 0)) { ignoradosPorSeguranca.push('agendamentos (vazio)'); plan.agenda = null; }
    if (plan.servicos && !(plan.servicos.total > 0)) { ignoradosPorSeguranca.push('serviços (zerado)'); plan.servicos = null; }
    if (plan.produtos && !(plan.produtos.total > 0)) { ignoradosPorSeguranca.push('vendas (zerado)'); plan.produtos = null; }
    // "manter_assinantes": os assinantes servem só para separar novas assinaturas de recorrência; a base de assinantes
    // gravada no mês não muda (só os cancelamentos do mês são atualizados)
    if (req.body.manter_assinantes && plan.assinaturas) {
      const atualRep = await db.get('SELECT data FROM monthly_reports WHERE year = ? AND month = ? AND kind = ?', y, m, 'assinaturas');
      let antigo = null; try { antigo = atualRep ? (typeof atualRep.data === 'string' ? JSON.parse(atualRep.data) : atualRep.data) : null; } catch {}
      plan.assinaturas = antigo
        ? { ...antigo, cancelamentos: plan.assinaturas.cancelamentos ?? antigo.cancelamentos, motivos: plan.assinaturas.motivos ?? antigo.motivos }
        : (plan.assinaturas.cancelamentos != null ? { total: null, ativos: null, inadimplentes: null, novas_no_mes: null, planos: [], cancelamentos: plan.assinaturas.cancelamentos, motivos: plan.assinaturas.motivos } : null);
    }
    // Cópia de segurança do mês antes de gravar (POST /api/admin/robo/desfazer volta para ela)
    if (plan.financeiro || plan.produtos) {
      await setSetting('robo_backup', {
        em: new Date().toISOString(), ano: y, mes: m,
        daily_revenue: await db.all('SELECT * FROM daily_revenue WHERE date >= ? AND date <= ?', de, ate),
        professional_monthly: await db.all('SELECT * FROM professional_monthly WHERE year = ? AND month = ?', y, m),
      });
    }
  }
  const result = await importer.apply(plan);
  await setSetting('ultima_importacao', { em: new Date().toISOString(), ano: plan.ano, mes: plan.mes, relatorios: plan.relatorios, origem: 'robô', ignorados_por_seguranca: ignoradosPorSeguranca });
  return {
    result, relatorios: plan.relatorios, ignorados: plan.ignorados, ignorados_por_seguranca: ignoradosPorSeguranca,
    conferencia: { dias_com_movimento: result.dias, profissionais: result.profissionais, comandas: plan.financeiro?.resumo.comandas ?? null, cobrancas_assinatura: plan.financeiro?.resumo.cobrancas_assinatura ?? null },
  };
}));
// Desfaz a última atualização do robô no faturamento do mês (volta para a cópia feita antes de gravar)
app.post('/api/admin/robo/desfazer', auth.requireAdmin, wrap(async () => {
  const b = await getSetting('robo_backup');
  if (!b) throw new Error('Não há cópia de segurança do robô para restaurar.');
  const de = metrics.iso(b.ano, b.mes, 1); const ate = metrics.iso(b.ano, b.mes, metrics.daysInMonth(b.ano, b.mes));
  await tx(async (q) => {
    await q.run('DELETE FROM daily_revenue WHERE date >= ? AND date <= ?', de, ate);
    for (const d of b.daily_revenue) await q.run('INSERT INTO daily_revenue(date, servicos, produtos, novas_assinaturas, sva, recorrencia, status, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)', d.date, d.servicos, d.produtos, d.novas_assinaturas, d.sva, d.recorrencia, d.status || 'REALIZADO');
    await q.run('DELETE FROM professional_monthly WHERE year = ? AND month = ?', b.ano, b.mes);
    for (const r of b.professional_monthly) {
      const cols = Object.keys(r).filter((k) => k !== 'id');
      await q.run(`INSERT INTO professional_monthly(${cols.join(', ')}) VALUES(${cols.map(() => '?').join(', ')})`, ...cols.map((k) => r[k]));
    }
  });
  return { ok: true, restaurado: { ano: b.ano, mes: b.mes, de: b.em, dias: b.daily_revenue.length } };
}));
app.get('/api/admin/importar', auth.requireAdmin, wrap(async () => ({ ultima: (await getAllSettings()).ultima_importacao || null })));
app.post('/api/admin/demo', auth.requireAdmin, wrap(async (req) => {
  const { y, m } = ym(req.body || {});
  await seed.seedDemo(y, m);
  return { ok: true };
}));
app.delete('/api/admin/demo', auth.requireAdmin, wrap(async () => { await seed.clearDemo(); return { ok: true }; }));

// ---------------------------------------------------------------- Webhook público (CashBarber → Dashboard)
async function webhookAuth(req, res, next) {
  try {
    const token = (await getAllSettings()).webhook_token;
    const given = req.get('x-webhook-token') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.query.token || '';
    const a = Buffer.from(String(given)); const b = Buffer.from(String(token));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      await webhook.logEvent({ status: 'nao_autorizado', message: 'Token inválido', payload: req.body, ip: req.ip });
      return res.status(401).json({ error: 'Token inválido' });
    }
    next();
  } catch (e) { next(e); }
}
app.post(['/api/webhooks/cashbarber', '/api/webhook'], webhookAuth, wrap(async (req, res) => {
  const body = req.body;
  const list = Array.isArray(body) ? body : Array.isArray(body?.eventos) ? body.eventos : Array.isArray(body?.events) ? body.events : [body];
  const catalog = (await getAllSettings()).extras_catalog;
  const results = [];
  for (const p of list) {
    try {
      const r = await webhook.processOne(p, { catalog });
      await webhook.logEvent({ externalId: r.externalId, event: r.event, status: r.duplicate ? 'duplicado' : 'processado', message: r.message, payload: p, ip: req.ip });
      results.push({ ok: true, event: r.event, duplicate: !!r.duplicate });
    } catch (e) {
      await webhook.logEvent({ event: p?.event || p?.evento, status: 'erro', message: e.message, payload: p, ip: req.ip });
      results.push({ ok: false, error: e.message });
    }
  }
  await webhook.notifyOutgoing('webhook');
  const failed = results.filter((r) => !r.ok).length;
  res.status(failed === results.length ? 422 : 200).json({ recebidos: results.length, erros: failed, results });
}));
app.get('/api/webhooks/cashbarber', (_req, res) => res.json({ ok: true, info: 'Envie eventos via POST com o token no header X-Webhook-Token' }));

app.all('/api/*', (_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: `Erro no servidor: ${err.message}` }); });

module.exports = { app, init };
