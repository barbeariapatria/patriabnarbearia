const { db, getAllSettings } = require('./db');

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const FIELDS = ['servicos', 'produtos', 'novas_assinaturas', 'sva', 'recorrencia'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function todayParts() {
  // Data local do servidor (configure TZ=America/Sao_Paulo no deploy)
  const t = new Date();
  return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
}

function isWorkingDay(y, m, d, settings) {
  if ((settings.dias_fechados || []).includes(weekday(y, m, d))) return false;
  return !(settings.feriados || []).includes(iso(y, m, d));
}

function getMonthDays(y, m) {
  const rows = db.prepare('SELECT * FROM daily_revenue WHERE date >= ? AND date <= ?')
    .all(iso(y, m, 1), iso(y, m, daysInMonth(y, m)));
  const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));
  const settings = getAllSettings();
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

function dashboard(y, m) {
  const settings = getAllSettings();
  const days = getMonthDays(y, m);
  const last = daysInMonth(y, m);
  const ref = referenceDay(y, m);
  const sum = (f) => round2(days.reduce((s, d) => s + d[f], 0));
  const totals = Object.fromEntries(FIELDS.map((f) => [f, sum(f)]));
  totals.total = sum('total');

  const quinzenaAtual = ref > 15 ? 2 : 1;
  const q1 = periodSummary(days, 1, 15, ref, settings.meta_quinzenal, 'sva_assinaturas');
  const q2 = periodSummary(days, 16, last, ref, settings.meta_quinzenal, 'sva_assinaturas');
  const qTot = (q, f) => round2(days.filter((d) => d.dia >= q.inicio && d.dia <= q.termino).reduce((s, d) => s + d[f], 0));
  for (const q of [q1, q2]) { q.sva = qTot(q, 'sva'); q.assinaturas = qTot(q, 'novas_assinaturas'); q.faturamento = qTot(q, 'total'); }

  const mensal = periodSummary(days, 1, last, ref, settings.meta_mensal, 'total');
  const svaMensal = periodSummary(days, 1, last, ref, settings.meta_quinzenal * 2, 'sva_assinaturas');

  // Mês anterior para comparação
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const prevTotal = round2(getMonthDays(py, pm).reduce((s, d) => s + d.total, 0));

  return {
    ano: y, mes: m, mes_nome: MONTHS[m - 1], unidade: settings.unidade,
    dia_apuracao: ref, quinzena_atual: quinzenaAtual,
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

function proStats(y, m) {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.active, pm.* FROM professionals p
    LEFT JOIN professional_monthly pm ON pm.professional_id = p.id AND pm.year = ? AND pm.month = ?
    ORDER BY p.name`).all(y, m);
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

function proYear(y) {
  const rows = db.prepare(`
    SELECT p.name, pm.* FROM professional_monthly pm JOIN professionals p ON p.id = pm.professional_id
    WHERE pm.year = ? ORDER BY pm.month`).all(y);
  const months = MONTHS.map((nome, i) => ({ mes: i + 1, nome, faturamento_total: 0, clientes: 0, assinatura: 0, profissionais: {} }));
  for (const r of rows) {
    const mo = months[r.month - 1];
    mo.faturamento_total = round2(mo.faturamento_total + r.faturamento_total);
    mo.assinatura = round2(mo.assinatura + r.faturamento_assinatura);
    mo.clientes += r.clientes_atendidos;
    mo.profissionais[r.name] = r.faturamento_total;
  }
  const daily = db.prepare(`
    SELECT CAST(substr(date, 6, 2) AS INTEGER) AS mes, SUM(servicos + produtos + novas_assinaturas + sva + recorrencia) AS total
    FROM daily_revenue WHERE substr(date, 1, 4) = ? GROUP BY mes`).all(String(y));
  for (const d of daily) months[d.mes - 1].faturamento_unidade = round2(d.total);
  return { ano: y, meses: months };
}

module.exports = { dashboard, proStats, proYear, getMonthDays, FIELDS, MONTHS, WEEKDAYS, iso, round2, daysInMonth };
