// Processamento de eventos recebidos do CashBarber (ou qualquer sistema/automação, ex.: n8n, Make, Zapier).
// O formato é flexível: aceita nomes de campos em português ou inglês e valores como "R$ 1.234,56".
const { db, getSetting, tx } = require('./db');
const { dashboard, round2 } = require('./metrics');

const ALIASES = {
  event: ['event', 'evento', 'type', 'tipo_evento', 'action'],
  id: ['id', 'event_id', 'venda_id', 'comanda_id', 'transaction_id', 'id_venda'],
  date: ['data', 'date', 'data_venda', 'created_at', 'data_atendimento', 'datetime'],
  profissional: ['profissional', 'professional', 'barbeiro', 'colaborador', 'funcionario', 'nome_profissional'],
  servicos: ['servicos', 'valor_servicos', 'services', 'services_total', 'total_servicos'],
  produtos: ['produtos', 'valor_produtos', 'products', 'products_total', 'total_produtos'],
  novas_assinaturas: ['novas_assinaturas', 'assinaturas', 'nova_assinatura', 'subscriptions', 'new_subscriptions', 'valor_assinatura'],
  sva: ['sva', 'servicos_adicionais', 'valor_sva', 'extras_total'],
  recorrencia: ['recorrencia', 'recorrência', 'recurring', 'renovacao', 'valor_recorrencia'],
  comissao: ['comissao', 'comissão', 'commission'],
  clientes: ['clientes', 'clientes_atendidos', 'customers', 'qtd_clientes'],
  novo_cliente: ['novo_cliente', 'new_customer', 'primeira_visita', 'cliente_novo'],
  geracao_demanda: ['geracao_demanda', 'demanda'],
  itens: ['itens', 'items', 'servicos_itens', 'produtos_itens', 'lines'],
};

function pick(obj, key) {
  for (const k of ALIASES[key]) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  return undefined;
}

function toNumber(v) {
  if (v === undefined || v === null || v === '') return 0;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function toDate(v) {
  if (!v) return new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('sv-SE');
  throw new Error(`Data inválida: ${s}`);
}

const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[.\-_]/g, ' ').replace(/\s+/g, ' ').trim();

function classifyItem(item) {
  const t = normalize(item.tipo || item.type || item.categoria || 'servico');
  if (/PRODUT|PRODUCT/.test(t)) return 'produtos';
  if (/RECORR|RENOV|RECURR/.test(t)) return 'recorrencia';
  if (/ASSINAT|SUBSCR|PLANO/.test(t)) return 'novas_assinaturas';
  if (/SVA|ADICIONAL|EXTRA/.test(t)) return 'sva';
  return 'servicos';
}

const EVENT_KIND = (e) => {
  const n = normalize(e);
  if (/CANCEL|ESTORN|REFUND|DEVOLU/.test(n)) return 'cancel';
  if (/FECHAMENTO|CLOSE|RESUMO DIA|DAILY/.test(n)) return 'daily_close';
  if (/MENSAL|MONTHLY|PROFISSIONAL RESUMO/.test(n)) return 'pro_monthly';
  if (/PING|TEST/.test(n)) return 'ping';
  return 'sale';
};

function findOrCreatePro(name, externalId) {
  const clean = String(name).trim();
  let pro = externalId ? db.prepare('SELECT * FROM professionals WHERE external_id = ?').get(String(externalId)) : null;
  if (!pro) pro = db.prepare('SELECT * FROM professionals WHERE name = ?').get(clean);
  if (!pro) {
    const r = db.prepare('INSERT INTO professionals(name, external_id) VALUES(?, ?)').run(clean, externalId ? String(externalId) : null);
    pro = db.prepare('SELECT * FROM professionals WHERE id = ?').get(r.lastInsertRowid);
  }
  return pro;
}

function ensureMonthly(proId, y, m) {
  db.prepare('INSERT OR IGNORE INTO professional_monthly(professional_id, year, month) VALUES(?, ?, ?)').run(proId, y, m);
  return db.prepare('SELECT * FROM professional_monthly WHERE professional_id = ? AND year = ? AND month = ?').get(proId, y, m);
}

// Interpreta o payload e devolve o "plano" de alterações (usado também no modo simulação)
function parseSale(p) {
  const values = { servicos: 0, produtos: 0, novas_assinaturas: 0, sva: 0, recorrencia: 0 };
  const extras = {};
  let qtdServicos = 0; let qtdProdutos = 0;
  const catalog = (getSetting('extras_catalog') || []).map((n) => [normalize(n), n]);
  const itens = pick(p, 'itens');
  const explicit = {};
  for (const f of Object.keys(values)) { const v = pick(p, f); if (v !== undefined && typeof v !== 'object') explicit[f] = toNumber(v); }

  if (Array.isArray(itens)) {
    for (const it of itens) {
      const qty = toNumber(it.quantidade ?? it.qtd ?? it.quantity ?? 1) || 1;
      const unit = it.valor_total !== undefined || it.total !== undefined
        ? toNumber(it.valor_total ?? it.total)
        : toNumber(it.valor ?? it.preco ?? it.price ?? it.value) * qty;
      const nome = it.nome || it.name || it.descricao || it.servico || '';
      const match = catalog.find(([key]) => key === normalize(nome));
      let kind = classifyItem(it);
      if (match && kind === 'servicos') kind = 'sva'; // serviço adicional do catálogo conta como SVA
      values[kind] += unit;
      if (kind === 'produtos') qtdProdutos += qty; else if (kind === 'servicos' || kind === 'sva') qtdServicos += qty;
      if (match) extras[match[1]] = (extras[match[1]] || 0) + qty;
    }
  }
  Object.assign(values, explicit); // valores explícitos no payload têm prioridade
  if (p.qtd_servicos !== undefined) qtdServicos = toNumber(p.qtd_servicos);
  if (p.qtd_produtos !== undefined) qtdProdutos = toNumber(p.qtd_produtos);
  if (p.extras && typeof p.extras === 'object' && !Array.isArray(p.extras)) {
    for (const [k, v] of Object.entries(p.extras)) {
      const match = catalog.find(([key]) => key === normalize(k));
      extras[match ? match[1] : k.toUpperCase()] = toNumber(v);
    }
  }
  const total = Object.values(values).reduce((s, v) => s + v, 0);
  const novo = pick(p, 'novo_cliente');
  return {
    date: toDate(pick(p, 'date')),
    profissional: pick(p, 'profissional'),
    profissional_id_externo: p.profissional_id || p.professional_id || p.barbeiro_id,
    values, total: round2(total), extras,
    comissao: toNumber(pick(p, 'comissao')),
    clientes: pick(p, 'clientes') !== undefined ? toNumber(pick(p, 'clientes')) : 1,
    geracao_demanda: pick(p, 'geracao_demanda') !== undefined ? toNumber(pick(p, 'geracao_demanda')) : (novo === true || novo === 'true' || novo === 1 || novo === 'sim' ? 1 : 0),
    qtd_servicos: qtdServicos, qtd_produtos: qtdProdutos,
  };
}

function applySale(plan, sign) {
  const [y, m] = plan.date.split('-').map(Number);
  const v = plan.values;
  db.prepare(`INSERT INTO daily_revenue(date, servicos, produtos, novas_assinaturas, sva, recorrencia, status, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, 'REALIZADO', CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET servicos = servicos + excluded.servicos, produtos = produtos + excluded.produtos,
      novas_assinaturas = novas_assinaturas + excluded.novas_assinaturas, sva = sva + excluded.sva,
      recorrencia = recorrencia + excluded.recorrencia, status = 'REALIZADO', updated_at = CURRENT_TIMESTAMP`)
    .run(plan.date, sign * v.servicos, sign * v.produtos, sign * v.novas_assinaturas, sign * v.sva, sign * v.recorrencia);

  if (!plan.profissional) return;
  const pro = findOrCreatePro(plan.profissional, plan.profissional_id_externo);
  const row = ensureMonthly(pro.id, y, m);
  const extras = JSON.parse(row.extras || '{}');
  for (const [k, q] of Object.entries(plan.extras)) extras[k] = Math.max(0, (extras[k] || 0) + sign * q);
  const fat = row.faturamento_total + sign * plan.total;
  const clientes = Math.max(0, row.clientes_atendidos + sign * plan.clientes);
  db.prepare(`UPDATE professional_monthly SET
      faturamento_total = ?, faturamento_assinatura = faturamento_assinatura + ?, comissao = comissao + ?,
      clientes_atendidos = ?, geracao_demanda = MAX(0, geracao_demanda + ?), servicos_realizados = MAX(0, servicos_realizados + ?),
      venda_produtos = venda_produtos + ?, qtd_produtos = MAX(0, qtd_produtos + ?), ticket_medio = ?, extras = ?, updated_at = CURRENT_TIMESTAMP
    WHERE professional_id = ? AND year = ? AND month = ?`)
    .run(round2(fat), sign * (v.novas_assinaturas + v.recorrencia), sign * plan.comissao, clientes, sign * plan.geracao_demanda,
      sign * plan.qtd_servicos, sign * v.produtos, sign * plan.qtd_produtos, clientes ? round2(fat / clientes) : 0,
      JSON.stringify(extras), pro.id, y, m);
}

function applyDailyClose(p) {
  const date = toDate(pick(p, 'date'));
  const vals = {};
  for (const f of ['servicos', 'produtos', 'novas_assinaturas', 'sva', 'recorrencia']) vals[f] = toNumber(pick(p, f));
  db.prepare(`INSERT INTO daily_revenue(date, servicos, produtos, novas_assinaturas, sva, recorrencia, status, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, 'REALIZADO', CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET servicos = excluded.servicos, produtos = excluded.produtos, novas_assinaturas = excluded.novas_assinaturas,
      sva = excluded.sva, recorrencia = excluded.recorrencia, status = 'REALIZADO', updated_at = CURRENT_TIMESTAMP`)
    .run(date, vals.servicos, vals.produtos, vals.novas_assinaturas, vals.sva, vals.recorrencia);
  return { date, ...vals };
}

function applyProMonthly(p) {
  const name = pick(p, 'profissional');
  if (!name) throw new Error('Campo "profissional" é obrigatório');
  const y = Number(p.ano || p.year); const m = Number(p.mes || p.month);
  if (!y || !m) throw new Error('Campos "ano" e "mes" são obrigatórios');
  const pro = findOrCreatePro(name, p.profissional_id);
  ensureMonthly(pro.id, y, m);
  const fields = ['faturamento_total', 'faturamento_assinatura', 'comissao', 'ticket_medio', 'clientes_atendidos', 'geracao_demanda', 'servicos_realizados', 'venda_produtos', 'qtd_produtos'];
  for (const f of fields) if (p[f] !== undefined) db.prepare(`UPDATE professional_monthly SET ${f} = ? WHERE professional_id = ? AND year = ? AND month = ?`).run(toNumber(p[f]), pro.id, y, m);
  if (p.extras) db.prepare('UPDATE professional_monthly SET extras = ? WHERE professional_id = ? AND year = ? AND month = ?').run(JSON.stringify(p.extras), pro.id, y, m);
  return { profissional: pro.name, ano: y, mes: m };
}

function processOne(p, { dryRun = false } = {}) {
  if (!p || typeof p !== 'object') throw new Error('Payload deve ser um objeto JSON');
  const body = p.data && typeof p.data === 'object' && !Array.isArray(p.data) ? { ...p.data, event: pick(p, 'event') || pick(p.data, 'event') } : p;
  const event = pick(body, 'event') || 'venda';
  const kind = EVENT_KIND(event);
  const externalId = pick(body, 'id');

  if (kind === 'ping') return { event, kind, message: 'pong' };
  if (externalId && !dryRun && kind !== 'cancel') {
    const dup = db.prepare("SELECT id FROM webhook_events WHERE external_id = ? AND status = 'processado' AND event NOT LIKE '%cancel%'").get(String(externalId));
    if (dup) return { event, kind, externalId, duplicate: true, message: `Evento ${externalId} já processado (ignorado)` };
  }
  if (kind === 'daily_close') return { event, kind, externalId, result: dryRun ? { date: toDate(pick(body, 'date')) } : tx(() => applyDailyClose(body)) };
  if (kind === 'pro_monthly') return { event, kind, externalId, result: dryRun ? { profissional: pick(body, 'profissional') } : tx(() => applyProMonthly(body)) };

  const plan = parseSale(body);
  if (!dryRun) tx(() => applySale(plan, kind === 'cancel' ? -1 : 1));
  return { event, kind, externalId, result: plan };
}

function logEvent({ externalId, event, status, message, payload, ip }) {
  db.prepare('INSERT INTO webhook_events(external_id, event, status, message, payload, ip) VALUES(?, ?, ?, ?, ?, ?)')
    .run(externalId ? String(externalId) : null, event || null, status, message || null, JSON.stringify(payload).slice(0, 20000), ip || null);
}

// Notifica uma URL externa (n8n, Make, Zapier, WhatsApp bot…) com o resumo atualizado
async function notifyOutgoing(trigger) {
  const url = getSetting('outgoing_webhook_url');
  if (!url) return;
  const now = new Date();
  const d = dashboard(now.getFullYear(), now.getMonth() + 1);
  const q = d.quinzenas[d.quinzena_atual - 1];
  const body = {
    evento: 'dashboard.atualizado', origem: trigger, enviado_em: now.toISOString(), unidade: d.unidade,
    mes: `${d.mes_nome}/${d.ano}`,
    faturamento_mes: d.mensal.realizado, meta_mensal: d.mensal.meta, percentual_meta_mensal: d.mensal.percentual,
    meta_mensal_atingida: d.mensal.realizado >= d.mensal.meta, restante_por_dia: d.mensal.restante_por_dia,
    quinzena: d.quinzena_atual, sva_assinaturas_quinzena: q.realizado, meta_quinzenal: q.meta,
    percentual_quinzena: q.percentual, meta_quinzenal_atingida: q.realizado >= q.meta,
  };
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  } catch (e) { console.warn('Falha ao notificar webhook de saída:', e.message); }
}

module.exports = { processOne, logEvent, notifyOutgoing, toNumber, toDate, normalize };
