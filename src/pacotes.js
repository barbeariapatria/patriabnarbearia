// Venda de pacotes/planos do clube (relatório "Vendas por origem" do CashBarber): o que foi vendido, por quanto e por quem
const { db } = require('./db');
const { round2, MONTHS, daysInMonth } = require('./metrics');

async function lista(y, m) {
  const row = await db.get("SELECT data FROM monthly_reports WHERE year = ? AND month = ? AND kind = 'vendas_planos'", y, m);
  try { return row ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data)?.lista || [] : null; } catch { return null; }
}

async function calcular(y, m, { professionalId = null } = {}) {
  const atual = await lista(y, m);
  const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1;
  const anterior = await lista(py, pm);
  const vendas = (atual || []).filter((v) => !professionalId || v.professional_id === professionalId);
  const soma = (l) => round2(l.reduce((t, v) => t + (Number(v.valor) || 0), 0));
  const agrupar = (f) => {
    const mp = new Map();
    for (const v of vendas) { const k = f(v) || 'Sem vendedor'; const x = mp.get(k) || { nome: k, vendas: 0, valor: 0 }; x.vendas++; x.valor = round2(x.valor + (Number(v.valor) || 0)); mp.set(k, x); }
    return [...mp.values()].sort((a, b) => b.vendas - a.vendas || b.valor - a.valor);
  };
  const porDia = Array.from({ length: daysInMonth(y, m) }, (_, i) => {
    const d = `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
    const l = vendas.filter((v) => v.data === d);
    return { date: d, vendas: l.length, valor: soma(l) };
  });
  const ant = (anterior || []).filter((v) => !professionalId || v.professional_id === professionalId);
  return {
    ano: y, mes: m, mes_nome: MONTHS[m - 1], tem_dados: atual !== null,
    total: { vendas: vendas.length, valor: soma(vendas), ticket: vendas.length ? round2(soma(vendas) / vendas.length) : 0 },
    anterior: anterior !== null ? { vendas: ant.length, valor: soma(ant) } : null,
    por_plano: agrupar((v) => v.plano), por_vendedor: agrupar((v) => v.vendedor), por_dia: porDia,
    vendas: [...vendas].sort((a, b) => String(b.data).localeCompare(String(a.data))).map(({ k, ...v }) => v),
  };
}

// planos vendidos por profissional no mês (para a meta individual)
async function porProfissional(y, m) {
  const l = (await lista(y, m)) || [];
  const out = {};
  for (const v of l) if (v.professional_id) out[v.professional_id] = (out[v.professional_id] || 0) + 1;
  return { tem_dados: (await lista(y, m)) !== null, por_pro: out };
}

module.exports = { calcular, porProfissional };
