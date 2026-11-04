// Metas individuais: cada barbeiro tem a própria meta no mês, sobre o que ele RECEBE (comissão) ou sobre o faturamento.
// Automática = melhor resultado dele nos 2 meses anteriores + 20% (arredondada para cima em R$ 50);
// o dono pode ajustar a meta de qualquer um em Admin → Metas e configurações.
const { db, getSetting, setSetting } = require('./db');
const { getMonthDays, todayParts, daysInMonth, round2, MONTHS } = require('./metrics');
const { normalize } = require('./team');

const DEFAULTS = { percentual: 20, meses_base: 2, base: 'comissao', ajustes: {} };
const CAMPO = { comissao: 'comissao', faturamento: 'faturamento_total' };
const chave = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const anterior = (y, m, n) => { let yy = y; let mm = m; for (let i = 0; i < n; i++) { mm--; if (!mm) { mm = 12; yy--; } } return { y: yy, m: mm }; };

async function regras() {
  return { ...DEFAULTS, ...((await getSetting('metas_individuais')) || {}) };
}

// Dia de apuração: hoje no mês corrente (os números chegam às 20h, com o dia de hoje), fim do mês nos passados
function apuracao(y, m) {
  const t = todayParts();
  if (y === t.y && m === t.m) return t.d;
  if (y < t.y || (y === t.y && m < t.m)) return daysInMonth(y, m);
  return 0;
}

async function calcular(y, m) {
  const r = await regras();
  const pct = Number(r.percentual) || 0;
  const nBase = Math.max(1, Number(r.meses_base) || 2);
  const bases = Array.from({ length: nBase }, (_, i) => anterior(y, m, i + 1));
  const ajustes = r.ajustes?.[chave(y, m)] || {};
  const consumo = ((await getSetting('bar_profissionais')) || []).map(normalize);

  const pros = (await db.all('SELECT id, name, active FROM professionals'))
    .filter((p) => !/^RECEP/.test(normalize(p.name)) && !consumo.includes(normalize(p.name)));
  const base = CAMPO[r.base] ? r.base : 'comissao';
  const linhas = await db.all(`SELECT professional_id, year, month, faturamento_total, comissao FROM professional_monthly
    WHERE year * 100 + month IN (${[...bases, { y, m }].map(() => '?').join(', ')})`, ...[...bases, { y, m }].map((b) => b.y * 100 + b.m));
  const fat = (pid, b) => Number(linhas.find((l) => l.professional_id === pid && l.year === b.y && l.month === b.m)?.[CAMPO[base]]) || 0;

  // dias de trabalho do mês (domingos e feriados de Metas e configurações ficam de fora)
  const dias = await getMonthDays(y, m);
  const ref = apuracao(y, m);
  const uteis = dias.filter((d) => d.util);
  const uteisPassados = uteis.filter((d) => d.dia <= ref).length;
  const uteisRestantes = uteis.filter((d) => d.dia > ref).length;

  // evolução diária (o robô guarda o acumulado de cada um a cada importação)
  const evoRow = await db.get("SELECT data FROM monthly_reports WHERE year = ? AND month = ? AND kind = 'evolucao'", y, m);
  let evo = {}; try { evo = evoRow ? (typeof evoRow.data === 'string' ? JSON.parse(evoRow.data) : evoRow.data)?.dias || {} : {}; } catch {}

  const lista = [];
  for (const p of pros) {
    const historico = bases.map((b) => ({ ano: b.y, mes: b.m, nome: MONTHS[b.m - 1], valor: fat(p.id, b) }));
    const melhor = historico.reduce((a, h) => (h.valor > a.valor ? h : a), { valor: 0 });
    const realizado = fat(p.id, { y, m });
    if (!melhor.valor && !realizado && ajustes[p.id] == null) continue;
    if (!p.active && !realizado) continue;
    const automatica = melhor.valor ? Math.ceil((melhor.valor * (1 + pct / 100)) / 50) * 50 : 0;
    const meta = ajustes[p.id] != null ? Number(ajustes[p.id]) : automatica;
    const falta = Math.max(0, round2(meta - realizado));
    // ritmo: quanto já deveria ter feito até hoje para chegar na meta no último dia
    const esperado = uteis.length ? round2((meta * uteisPassados) / uteis.length) : 0;
    const projecao = uteisPassados ? round2((realizado / uteisPassados) * uteis.length) : 0;
    lista.push({
      professional_id: p.id, nome: p.name,
      historico, melhor_mes: melhor.valor ? `${melhor.nome}/${melhor.ano}` : null, melhor_valor: round2(melhor.valor),
      automatica, meta, ajustada: ajustes[p.id] != null,
      realizado: round2(realizado), falta,
      percentual: meta ? round2((realizado / meta) * 100) : 0,
      por_dia: falta ? round2(falta / Math.max(1, uteisRestantes)) : 0,
      esperado_ate_hoje: esperado, no_ritmo: realizado >= esperado, projecao,
      // cada ponto guarda { f: faturamento, c: comissão } (pontos antigos: só o faturamento)
      evolucao: Object.entries(evo).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => { const x = v?.[p.id]; const o = typeof x === 'object' && x ? x : { f: Number(x) || 0 }; return { date, valor: Number(base === 'comissao' ? o.c : o.f) || 0 }; })
        .filter((e) => base !== 'comissao' || Object.values(evo[e.date] || {}).some((x) => typeof x === 'object')),
    });
  }
  lista.sort((a, b) => b.percentual - a.percentual);
  return {
    ano: y, mes: m, mes_nome: MONTHS[m - 1], percentual: pct, base, meses_base: bases.map((b) => `${MONTHS[b.m - 1]}/${b.y}`),
    dia_apuracao: ref, dias_uteis: uteis.length, dias_uteis_passados: uteisPassados, dias_uteis_restantes: uteisRestantes,
    dias_uteis_lista: uteis.map((d) => d.date), lista,
  };
}

// guarda o acumulado do mês de cada profissional no dia da importação (para o gráfico de evolução)
async function registrarEvolucao(q, y, m) {
  const t = todayParts();
  const corrente = y === t.y && m === t.m;
  const passado = y < t.y || (y === t.y && m < t.m);
  if (!corrente && !passado) return;
  const dia = corrente ? `${y}-${String(m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}` : `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
  const rows = await q.all('SELECT professional_id, faturamento_total, comissao FROM professional_monthly WHERE year = ? AND month = ?', y, m);
  const atual = await q.get("SELECT data FROM monthly_reports WHERE year = ? AND month = ? AND kind = 'evolucao'", y, m);
  let dias = {}; try { dias = atual ? (typeof atual.data === 'string' ? JSON.parse(atual.data) : atual.data)?.dias || {} : {}; } catch {}
  dias[dia] = Object.fromEntries(rows.map((r) => [r.professional_id, { f: round2(r.faturamento_total || 0), c: round2(r.comissao || 0) }]));
  await q.run(`INSERT INTO monthly_reports(year, month, kind, data, updated_at) VALUES(?, ?, 'evolucao', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(year, month, kind) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`, y, m, JSON.stringify({ dias }));
}

async function salvar({ y, m, percentual, metas, base }) {
  const r = await regras();
  if (base) { if (!CAMPO[base]) throw new Error('Base inválida'); r.base = base; }
  if (percentual != null && percentual !== '') {
    const p = Number(percentual);
    if (!(p >= 0 && p <= 300)) throw new Error('Percentual inválido');
    r.percentual = p;
  }
  if (metas && typeof metas === 'object') {
    const mes = { ...(r.ajustes?.[chave(y, m)] || {}) };
    for (const [pid, v] of Object.entries(metas)) {
      if (v === '' || v == null) delete mes[Number(pid)];
      else { const n = Number(v); if (!(n >= 0)) throw new Error('Meta inválida'); mes[Number(pid)] = round2(n); }
    }
    r.ajustes = { ...(r.ajustes || {}), [chave(y, m)]: mes };
  }
  await setSetting('metas_individuais', r);
}

module.exports = { calcular, registrarEvolucao, salvar };
