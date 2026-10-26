const { db, getAllSettings } = require('./db');

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const FIELDS = ['servicos', 'produtos', 'novas_assinaturas', 'sva', 'recorrencia'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// "Hoje" no fuso da barbearia; servidores na nuvem (Vercel) rodam em UTC
const TIME_ZONE = process.env.APP_TZ || 'America/Sao_Paulo';
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
function todayIso(date = new Date()) {
  return dateFmt.format(date); // AAAA-MM-DD
}
function todayParts() {
  const [y, m, d] = todayIso().split('-').map(Number);
  return { y, m, d };
}

function isWorkingDay(y, m, d, settings) {
  if ((settings.dias_fechados || []).includes(weekday(y, m, d))) return false;
  return !(settings.feriados || []).includes(iso(y, m, d));
}

async function getMonthDays(y, m, settings) {
  settings = settings || (await getAllSettings());
  const rows = await db.all('SELECT * FROM daily_revenue WHERE date >= ? AND date <= ?', iso(y, m, 1), iso(y, m, daysInMonth(y, m)));
  const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));
  const out = [];
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const date = iso(y, m, d);
    const r = byDate[date] || {};
    const day = { date, dia: d, dia_semana: WEEKDAYS[weekday(y, m, d)], util: isWorkingDay(y, m, d, settings), status: r.status || 'PREVISTO' };
    for (const f of FIELDS) day[f] = r[f] || 0;
    day.total = round2(FIELDS.reduce((s, f) => s + day[f], 0));
    out.push(day);
  }
  return out;
}

// Dia de apuração: hoje para o mês corrente, último dia para meses passados, 0 para meses futuros
function referenceDay(y, m) {
  const t = todayParts();
  if (y === t.y && m === t.m) return t.d;
  if (y < t.y || (y === t.y && m < t.m)) return daysInMonth(y, m);
  return 0;
}

function periodSummary(days, from, to, refDay, meta, metric) {
  const slice = days.filter((d) => d.dia >= from && d.dia <= to);
  const value = (d) => (metric === 'sva_assinaturas' ? d.sva + d.novas_assinaturas : d.total);
  const realizado = round2(slice.reduce((s, d) => s + value(d), 0));
  const withValue = slice.filter((d) => value(d) > 0);
  const apuracao = Math.min(Math.max(refDay, from - 1), to);
  const restantes = slice.filter((d) => d.dia > apuracao);
  const diasUteisRestantes = restantes.filter((d) => d.util).length;
  const diasNaoUteis = restantes.filter((d) => !d.util).length;
  const restante = Math.max(0, round2(meta - realizado));
  const passadosUteis = slice.filter((d) => d.dia <= apuracao && d.util).length;
  const totalUteis = slice.filter((d) => d.util).length;
  const mediaDiaria = withValue.length ? round2(realizado / withValue.length) : 0;
  const maior = withValue.reduce((a, d) => (!a || value(d) > value(a) ? d : a), null);
  const menor = withValue.reduce((a, d) => (!a || value(d) < value(a) ? d : a), null);
  return {
    inicio: from, termino: to, dia_apuracao: apuracao,
    meta, realizado, restante,
    percentual: meta ? round2((realizado / meta) * 100) : 0,
    dias_uteis_restantes: diasUteisRestantes,
    dias_nao_uteis: diasNaoUteis,
    restante_por_dia: restante ? round2(restante / Math.max(1, diasUteisRestantes)) : 0,
    media_diaria: mediaDiaria,
    projecao: passadosUteis ? round2((realizado / passadosUteis) * totalUteis) : 0,
    maior_dia: maior ? { date: maior.date, valor: value(maior) } : null,
    menor_dia: menor ? { date: menor.date, valor: value(menor) } : null,
  };
}

async function dashboard(y, m) {
  const settings = await getAllSettings();
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const [days, prevDays] = await Promise.all([getMonthDays(y, m, settings), getMonthDays(py, pm, settings)]);
  const last = daysInMonth(y, m);
  const ref = referenceDay(y, m);
  const sum = (f) => round2(days.reduce((s, d) => s + d[f], 0));
  const totals = Object.fromEntries(FIELDS.map((f) => [f, sum(f)]));
  totals.total = sum('total');

  // meta do mês: a definida para este mês no admin, ou a padrão
  const custom = (settings.metas_mes || {})[`${y}-${pad(m)}`] || {};
  const metaMensal = Number.isFinite(custom.mensal) ? custom.mensal : settings.meta_mensal;
  const metaQuinzenal = Number.isFinite(custom.quinzenal) ? custom.quinzenal : settings.meta_quinzenal;

  const quinzenaAtual = ref > 15 ? 2 : 1;
  const q1 = periodSummary(days, 1, 15, ref, metaQuinzenal, 'sva_assinaturas');
  const q2 = periodSummary(days, 16, last, ref, metaQuinzenal, 'sva_assinaturas');
  const qTot = (q, f) => round2(days.filter((d) => d.dia >= q.inicio && d.dia <= q.termino).reduce((s, d) => s + d[f], 0));
  for (const q of [q1, q2]) { q.sva = qTot(q, 'sva'); q.assinaturas = qTot(q, 'novas_assinaturas'); q.faturamento = qTot(q, 'total'); }

  const mensal = periodSummary(days, 1, last, ref, metaMensal, 'total');
  const svaMensal = periodSummary(days, 1, last, ref, metaQuinzenal * 2, 'sva_assinaturas');
  const prevTotal = round2(prevDays.reduce((s, d) => s + d.total, 0));

  return {
    ano: y, mes: m, mes_nome: MONTHS[m - 1], unidade: settings.unidade,
    dia_apuracao: ref, quinzena_atual: quinzenaAtual,
    metas: { mensal: metaMensal, quinzenal: metaQuinzenal, personalizada: Number.isFinite(custom.mensal) || Number.isFinite(custom.quinzenal) },
    totais: totals,
    mes_anterior: { total: prevTotal, variacao: prevTotal ? round2(((totals.total - prevTotal) / prevTotal) * 100) : null },
    mensal, sva_mensal: { media_diaria: svaMensal.media_diaria, maior_dia: svaMensal.maior_dia, menor_dia: svaMensal.menor_dia },
    quinzenas: [q1, q2],
    dias: days,
  };
}

function extrasOf(row) {
  try { return JSON.parse(row.extras || '{}'); } catch { return {}; }
}

async function proStats(y, m) {
  const rows = await db.all(`
    SELECT p.id, p.name, p.active, pm.* FROM professionals p
    LEFT JOIN professional_monthly pm ON pm.professional_id = p.id AND pm.year = ? AND pm.month = ?
    ORDER BY p.name`, y, m);
  const list = rows
    .filter((r) => r.active || r.year)
    .map((r) => ({
      professional_id: r.id, name: r.name, active: !!r.active, has_data: !!r.year,
      faturamento_total: r.faturamento_total || 0,
      faturamento_assinatura: r.faturamento_assinatura || 0,
      comissao: r.comissao || 0,
      ticket_medio: r.ticket_medio || (r.clientes_atendidos ? round2(r.faturamento_total / r.clientes_atendidos) : 0),
      clientes_atendidos: r.clientes_atendidos || 0,
      geracao_demanda: r.geracao_demanda || 0,
      servicos_realizados: r.servicos_realizados || 0,
      venda_produtos: r.venda_produtos || 0,
      qtd_produtos: r.qtd_produtos || 0,
      extras: extrasOf(r),
    }));
  const withData = list.filter((r) => r.has_data);
  const numeric = ['faturamento_total', 'faturamento_assinatura', 'comissao', 'ticket_medio', 'clientes_atendidos', 'geracao_demanda', 'servicos_realizados', 'venda_produtos', 'qtd_produtos'];
  const total = {}; const media = {};
  for (const k of numeric) {
    total[k] = round2(withData.reduce((s, r) => s + r[k], 0));
    const nonZero = withData.filter((r) => r[k]);
    media[k] = nonZero.length ? round2(total[k] / nonZero.length) : 0;
  }
  const extrasTotal = {};
  for (const r of withData) for (const [k, v] of Object.entries(r.extras)) extrasTotal[k] = (extrasTotal[k] || 0) + Number(v || 0);
  total.extras = extrasTotal;
  return { ano: y, mes: m, mes_nome: MONTHS[m - 1], profissionais: list, total, media };
}

async function proYear(y) {
  const rows = await db.all(`
    SELECT p.name, pm.* FROM professional_monthly pm JOIN professionals p ON p.id = pm.professional_id
    WHERE pm.year = ? ORDER BY pm.month, p.id`, y);
  const months = MONTHS.map((nome, i) => ({ mes: i + 1, nome, faturamento_total: 0, clientes: 0, assinatura: 0, profissionais: {} }));
  for (const r of rows) {
    const mo = months[r.month - 1];
    mo.faturamento_total = round2(mo.faturamento_total + r.faturamento_total);
    mo.assinatura = round2(mo.assinatura + r.faturamento_assinatura);
    mo.clientes += r.clientes_atendidos;
    mo.profissionais[r.name] = r.faturamento_total;
  }
  const daily = await db.all(`
    SELECT CAST(substr(date, 6, 2) AS INTEGER) AS mes, SUM(servicos + produtos + novas_assinaturas + sva + recorrencia) AS total
    FROM daily_revenue WHERE substr(date, 1, 4) = ? GROUP BY mes`, String(y));
  for (const d of daily) months[d.mes - 1].faturamento_unidade = round2(d.total);
  return { ano: y, meses: months };
}


// ---------------------------------------------------------------- Relatórios por período (de/até)
const MAX_RANGE_DAYS = 731;

function parseRange(de, ate) {
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  if (!ok(de) || !ok(ate)) throw new Error('Período inválido: informe as datas no formato AAAA-MM-DD.');
  if (de > ate) [de, ate] = [ate, de];
  const span = (Date.parse(ate) - Date.parse(de)) / 86400e3 + 1;
  if (span > MAX_RANGE_DAYS) throw new Error('O período pode ter no máximo 2 anos.');
  return { de, ate, dias: span };
}

function eachDay(de, ate, fn) {
  for (let t = Date.parse(`${de}T00:00:00Z`); t <= Date.parse(`${ate}T00:00:00Z`); t += 86400e3) {
    const d = new Date(t);
    fn(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
}

async function sumRange(de, ate) {
  const r = await db.get(`SELECT COALESCE(SUM(servicos + produtos + novas_assinaturas + sva + recorrencia), 0) AS total
    FROM daily_revenue WHERE date >= ? AND date <= ?`, de, ate);
  return round2(Number(r?.total || 0));
}

async function rangeReport(deIn, ateIn) {
  const { de, ate, dias: span } = parseRange(deIn, ateIn);
  const settings = await getAllSettings();
  const rows = await db.all('SELECT * FROM daily_revenue WHERE date >= ? AND date <= ? ORDER BY date', de, ate);
  const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));
  const hoje = todayIso();
  const days = [];
  eachDay(de, ate, (y, m, d) => {
    const date = iso(y, m, d);
    const r = byDate[date] || {};
    const day = { date, dia: d, mes: m, ano: y, dia_semana: WEEKDAYS[weekday(y, m, d)], util: isWorkingDay(y, m, d, settings), status: r.status || 'PREVISTO', futuro: date > hoje };
    for (const f of FIELDS) day[f] = r[f] || 0;
    day.total = round2(FIELDS.reduce((acc, f) => acc + day[f], 0));
    days.push(day);
  });
  const totals = Object.fromEntries(FIELDS.map((f) => [f, round2(days.reduce((a, d) => a + d[f], 0))]));
  totals.total = round2(days.reduce((a, d) => a + d.total, 0));

  const withValue = days.filter((d) => d.total > 0);
  const maior = withValue.reduce((a, d) => (!a || d.total > a.total ? d : a), null);
  const menor = withValue.reduce((a, d) => (!a || d.total < a.total ? d : a), null);

  // Subtotais por mês (para períodos longos e para a tabela)
  const porMes = [];
  for (const d of days) {
    const key = `${d.ano}-${pad(d.mes)}`;
    let mo = porMes[porMes.length - 1];
    if (!mo || mo.chave !== key) { mo = { chave: key, ano: d.ano, mes: d.mes, nome: MONTHS[d.mes - 1], dias: 0, total: 0 }; for (const f of FIELDS) mo[f] = 0; porMes.push(mo); }
    mo.dias++;
    for (const f of FIELDS) mo[f] = round2(mo[f] + d[f]);
    mo.total = round2(mo.total + d.total);
  }

  // Comparação com o período anterior de mesmo tamanho
  const prevAte = new Date(Date.parse(`${de}T00:00:00Z`) - 86400e3).toISOString().slice(0, 10);
  const prevDe = new Date(Date.parse(`${de}T00:00:00Z`) - span * 86400e3).toISOString().slice(0, 10);
  const prevTotal = await sumRange(prevDe, prevAte);

  return {
    de, ate, dias_no_periodo: span, unidade: settings.unidade,
    totais: totals,
    dias_com_faturamento: withValue.length,
    dias_uteis: days.filter((d) => d.util).length,
    media_diaria: withValue.length ? round2(totals.total / withValue.length) : 0,
    maior_dia: maior ? { date: maior.date, valor: maior.total } : null,
    menor_dia: menor ? { date: menor.date, valor: menor.total } : null,
    periodo_anterior: { de: prevDe, ate: prevAte, total: prevTotal, variacao: prevTotal ? round2(((totals.total - prevTotal) / prevTotal) * 100) : null },
    por_mes: porMes,
    dias: days,
  };
}

// Indicadores dos profissionais somados nos meses que o período cobre (os dados são mensais)
async function proStatsRange(deIn, ateIn) {
  const { de, ate } = parseRange(deIn, ateIn);
  const [y1, m1] = de.split('-').map(Number);
  const [y2, m2] = ate.split('-').map(Number);
  const rows = await db.all(`
    SELECT p.id, p.name, p.active, pm.* FROM professional_monthly pm JOIN professionals p ON p.id = pm.professional_id
    WHERE pm.year * 100 + pm.month BETWEEN ? AND ? ORDER BY p.name, pm.year, pm.month`, y1 * 100 + m1, y2 * 100 + m2);
  const meses = [];
  for (let y = y1, m = m1; y * 100 + m <= y2 * 100 + m2; m === 12 ? (y++, m = 1) : m++) meses.push({ ano: y, mes: m, nome: MONTHS[m - 1] });
  const parcial = !de.endsWith('-01') || ate !== iso(y2, m2, daysInMonth(y2, m2));

  const byPro = new Map();
  for (const r of rows) {
    const p = byPro.get(r.id) || {
      professional_id: r.id, name: r.name, active: !!r.active, has_data: true, meses: 0,
      faturamento_total: 0, faturamento_assinatura: 0, comissao: 0, clientes_atendidos: 0, geracao_demanda: 0,
      servicos_realizados: 0, venda_produtos: 0, qtd_produtos: 0, extras: {}, _pagos: 0,
    };
    p.meses++;
    for (const k of ['faturamento_total', 'faturamento_assinatura', 'comissao', 'clientes_atendidos', 'geracao_demanda', 'servicos_realizados', 'venda_produtos', 'qtd_produtos']) p[k] = round2(p[k] + (r[k] || 0));
    // atendimentos pagos no mês = faturamento ÷ ticket; sem ticket, usa os clientes
    p._pagos += r.ticket_medio ? r.faturamento_total / r.ticket_medio : (r.clientes_atendidos || 0);
    for (const [k, v] of Object.entries(extrasOf(r))) p.extras[k] = (p.extras[k] || 0) + Number(v || 0);
    byPro.set(r.id, p);
  }
  const list = [...byPro.values()].map(({ _pagos, ...p }) => ({ ...p, ticket_medio: _pagos ? round2(p.faturamento_total / _pagos) : 0 }));
  const numeric = ['faturamento_total', 'faturamento_assinatura', 'comissao', 'ticket_medio', 'clientes_atendidos', 'geracao_demanda', 'servicos_realizados', 'venda_produtos', 'qtd_produtos'];
  const total = {}; const media = {};
  for (const k of numeric) {
    total[k] = round2(list.reduce((a, r) => a + r[k], 0));
    const nonZero = list.filter((r) => r[k]);
    media[k] = nonZero.length ? round2(total[k] / nonZero.length) : 0;
  }
  const extrasTotal = {};
  for (const r of list) for (const [k, v] of Object.entries(r.extras)) extrasTotal[k] = (extrasTotal[k] || 0) + v;
  total.extras = extrasTotal;
  const label = meses.length === 1 ? `${meses[0].nome} ${meses[0].ano}` : `${meses[0].nome.slice(0, 3)}/${meses[0].ano} a ${meses[meses.length - 1].nome.slice(0, 3)}/${meses[meses.length - 1].ano}`;
  return { de, ate, meses, parcial, mes_nome: label, ano: y2, mes: m2, profissionais: list, total, media };
}

// Resumos importados do CashBarber (agenda, assinaturas, serviços) nos meses do período
async function monthlyReports({ y, m, de, ate }) {
  let from; let to;
  if (de && ate) {
    const r = parseRange(de, ate);
    const [y1, m1] = r.de.split('-').map(Number); const [y2, m2] = r.ate.split('-').map(Number);
    from = y1 * 100 + m1; to = y2 * 100 + m2;
  } else { from = to = y * 100 + m; }
  const rows = await db.all('SELECT year, month, kind, data FROM monthly_reports WHERE year * 100 + month BETWEEN ? AND ? ORDER BY year, month', from, to);
  const parse = (r) => { try { return JSON.parse(r.data); } catch { return null; } };
  const of = (kind) => rows.filter((r) => r.kind === kind).map((r) => ({ ano: r.year, mes: r.month, data: parse(r) })).filter((r) => r.data);

  // Agenda: soma as contagens de todos os meses
  const agendaRows = of('agenda');
  let agenda = null;
  if (agendaRows.length) {
    const keys = ['total', 'finalizados', 'cancelados', 'agendados', 'futuros', 'faltas', 'app', 'clube'];
    const sumInto = (acc, x) => { for (const k of keys) acc[k] = (acc[k] || 0) + (x[k] || 0); return acc; };
    const totais = agendaRows.reduce((acc, r) => sumInto(acc, r.data.totais), {});
    const byPro = new Map();
    for (const r of agendaRows) for (const p of r.data.profissionais) {
      const cur = byPro.get(p.professional_id) || { professional_id: p.professional_id, nome: p.nome };
      byPro.set(p.professional_id, sumInto(cur, p));
    }
    const names = Object.fromEntries((await db.all('SELECT id, name FROM professionals')).map((p) => [p.id, p.name]));
    agenda = {
      meses: agendaRows.map((r) => ({ ano: r.ano, mes: r.mes })),
      totais,
      profissionais: [...byPro.values()].map((p) => ({ ...p, nome: names[p.professional_id] || p.nome })).sort((a, b) => b.total - a.total),
      por_dia: agendaRows.flatMap((r) => r.data.por_dia || []),
    };
  }

  // Assinaturas: a base é uma foto do mês mais recente; cancelamentos e novas somam no período
  const assRows = of('assinaturas');
  let assinaturas = null;
  if (assRows.length) {
    const last = assRows[assRows.length - 1];
    const motivos = {};
    for (const r of assRows) for (const [k, n] of r.data.motivos || []) motivos[k] = (motivos[k] || 0) + n;
    const sumField = (k) => (assRows.some((r) => r.data[k] != null) ? assRows.reduce((acc, r) => acc + (r.data[k] || 0), 0) : null);
    assinaturas = {
      referencia: { ano: last.ano, mes: last.mes, nome: `${MONTHS[last.mes - 1]}/${last.ano}` },
      total: last.data.total ?? (last.data.ativos != null ? (last.data.ativos || 0) + (last.data.inadimplentes || 0) : null),
      ativos: last.data.ativos, inadimplentes: last.data.inadimplentes, planos: last.data.planos || [],
      novas_no_periodo: sumField('novas_no_mes'),
      cancelamentos: sumField('cancelamentos'),
      motivos: Object.entries(motivos).sort((a, b) => b[1] - a[1]),
    };
  }

  // Serviços: soma quantidades e faturamento por serviço
  const servRows = of('servicos');
  let servicos = null;
  if (servRows.length) {
    const map = new Map();
    for (const r of servRows) for (const s of r.data.lista || []) {
      const key = s.catalogo || s.nome;
      const cur = map.get(key) || { nome: key, quantidade: 0, faturado: 0, sva: s.sva };
      cur.quantidade += s.quantidade; cur.faturado = round2(cur.faturado + s.faturado);
      map.set(key, cur);
    }
    const lista = [...map.values()].sort((a, b) => b.faturado - a.faturado);
    servicos = { lista, sva_total: round2(lista.filter((s) => s.sva).reduce((a, s) => a + s.faturado, 0)), total: round2(lista.reduce((a, s) => a + s.faturado, 0)) };
  }
  return { agenda, assinaturas, servicos };
}

module.exports = { dashboard, proStats, proYear, rangeReport, proStatsRange, monthlyReports, getMonthDays, todayIso, todayParts, FIELDS, MONTHS, WEEKDAYS, iso, round2, daysInMonth };
