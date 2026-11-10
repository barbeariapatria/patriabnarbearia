// Prévia do mês e plano da semana: como vamos fechar, o que falta para a meta, onde cada barbeiro está bem
// e onde precisa melhorar (contra a média da equipe), e quais clientes devem voltar nesta semana com o que oferecer.
const { db } = require('./db');
const { dashboard, todayIso, round2, MONTHS } = require('./metrics');
const metas = require('./metas');
const radar = require('./radar');
const { porProfissional: planosPorPro, calcular: pacotesDoMes } = require('./pacotes');

async function report(y, m, kind) {
  const row = await db.get('SELECT data FROM monthly_reports WHERE year = ? AND month = ? AND kind = ?', y, m, kind);
  try { return row ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) : null; } catch { return null; }
}
const addDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

async function calcular(y, m, { professionalId = null } = {}) {
  const hoje = todayIso();
  const [dash, mi, rad, bruto, servicos, planos, pm] = await Promise.all([
    dashboard(y, m), metas.calcular(y, m), radar.calcular({ meses: 4 }), report(y, m, 'bruto_pro'), report(y, m, 'servicos'), planosPorPro(y, m),
    db.all('SELECT professional_id, clientes_atendidos, faturamento_total FROM professional_monthly WHERE year = ? AND month = ?', y, m),
  ]);
  const M = dash.mensal;

  // ---- como vamos fechar
  const falta = Math.max(0, round2(M.meta - M.projecao));
  const fechamento = {
    meta: M.meta, realizado: M.realizado, projecao: M.projecao, falta_na_projecao: falta, restante: M.restante,
    restante_por_dia: M.restante_por_dia, dias_uteis_restantes: M.dias_uteis_restantes,
    status: M.realizado >= M.meta ? 'batida' : M.projecao >= M.meta ? 'no_ritmo' : 'abaixo',
  };

  // ---- o que precisamos fazer (um caminho possível: metade em assinaturas, 30% em SVA, 20% em produtos)
  const atendTotal = pm.reduce((t, r) => t + (Number(r.clientes_atendidos) || 0), 0);
  const diasPassados = Math.max(1, (M.dia_apuracao ? dash.dias.filter((d) => d.util && d.dia <= M.dia_apuracao).length : 1));
  const atendRestantes = Math.round((atendTotal / diasPassados) * M.dias_uteis_restantes);
  // valor médio de um pacote: o das vendas do mês; sem vendas, o do mês anterior; sem nada, R$ 128 (média de outubro/2026)
  const pk = await pacotesDoMes(y, m);
  const ticketPlano = pk.total.ticket > 0 ? pk.total.ticket : pk.anterior?.vendas ? pk.anterior.valor / pk.anterior.vendas : 128;
  const gap = falta || 0;
  const acoes = gap > 0 ? [
    { frente: 'Assinaturas novas', quanto: round2(gap * 0.5), como: `vender mais ${Math.ceil((gap * 0.5) / ticketPlano)} planos até o fim do mês (≈ ${brl(ticketPlano)} cada)` },
    { frente: 'Serviços extras (SVA)', quanto: round2(gap * 0.3), como: atendRestantes ? `mais ${brl((gap * 0.3) / atendRestantes)} de SVA em cada atendimento (≈ ${atendRestantes} atendimentos pela frente)` : 'oferecer um extra em cada atendimento' },
    { frente: 'Produtos', quanto: round2(gap * 0.2), como: atendRestantes ? `vender ${Math.ceil((gap * 0.2) / 60)} produtos a mais (≈ 1 a cada ${Math.max(1, Math.round(atendRestantes / Math.ceil((gap * 0.2) / 60)))} atendimentos)` : 'indicar um produto para cada cliente' },
  ] : [];

  // ---- serviços extras: o que a equipe mais vende (base da oferta da semana)
  const sva = (servicos?.lista || []).filter((x) => x.sva).sort((a, b) => b.quantidade - a.quantidade);
  const topSva = sva[0]?.nome || null;

  // ---- barbeiros: indicadores x média da equipe
  const brutoDe = (pid) => (bruto?.por_profissional || []).find((x) => x.professional_id === pid) || {};
  const atendDe = (pid) => Number(pm.find((r) => r.professional_id === pid)?.clientes_atendidos) || 0;
  const base = mi.lista.filter((x) => x.meta > 0);
  const ind = base.map((x) => {
    const b = brutoDe(x.professional_id); const at = atendDe(x.professional_id);
    const rb = rad.barbeiros.find((r) => r.professional_id === x.professional_id) || {};
    return {
      pid: x.professional_id, at,
      extras_atend: at ? (Number(b.extras) || 0) / at : null,
      produtos_atend: at ? (Number(b.produtos) || 0) / at : null,
      assinaturas: x.assinaturas?.realizado ?? null,
      retorno: rb.taxa_retorno ?? null, fidelidade: rb.fidelidade ?? null,
      servicos: b.servicos || [],
    };
  });
  // a média da equipe é só dos barbeiros (quem faz cabelo/barba); estética e manicure ficam fora da comparação
  for (const i of ind) { const b = brutoDe(i.pid); i.barbeiro = (Number(b.barbearia) || 0) > 0 || !(b.servicos || []).length; }
  const barbeirosInd = ind.filter((i) => i.barbeiro);
  const media = (k) => { const v = barbeirosInd.map((i) => i[k]).filter((n) => n != null && Number.isFinite(n)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const medias = { extras_atend: media('extras_atend'), produtos_atend: media('produtos_atend'), assinaturas: media('assinaturas'), retorno: media('retorno'), fidelidade: media('fidelidade') };
  // taxa de cada serviço extra na equipe (vezes por atendimento)
  const atendEquipe = barbeirosInd.reduce((t, i) => t + i.at, 0);
  const taxaEquipe = {};
  for (const i of barbeirosInd) for (const s of i.servicos) if (!s.barbearia) taxaEquipe[s.nome] = (taxaEquipe[s.nome] || 0) + (Number(s.quantidade) || 0);
  for (const k of Object.keys(taxaEquipe)) taxaEquipe[k] = atendEquipe ? taxaEquipe[k] / atendEquipe : 0;

  const fim = addDias(hoje, 6);
  const barbeiros = base.filter((x) => !professionalId || x.professional_id === professionalId).map((x) => {
    const i = ind.find((z) => z.pid === x.professional_id);
    const fortes = []; const melhorar = [];
    const comp = (k, nome, fmt, alto = 1.1, baixo = 0.9, dica = '') => {
      if (!i.barbeiro || i[k] == null || medias[k] == null || !medias[k]) return;
      if (k === 'assinaturas' && medias[k] < 1) return; // a equipe quase não vende: comparar não diz nada
      const r = i[k] / medias[k];
      const txt = `${nome}: ${fmt(i[k])} (equipe ${fmt(medias[k])})`;
      if (r >= alto) fortes.push(txt); else if (r <= baixo) melhorar.push(dica ? `${txt} — ${dica}` : txt);
    };
    comp('extras_atend', 'Extras por atendimento', (v) => `R$ ${v.toFixed(2).replace('.', ',')}`, 1.1, 0.9, 'ofereça um extra em todo atendimento');
    comp('produtos_atend', 'Produtos por atendimento', (v) => `R$ ${v.toFixed(2).replace('.', ',')}`, 1.1, 0.9, 'indique o produto que você usou no cliente');
    comp('assinaturas', 'Assinaturas vendidas', (v) => String(Math.round(v * 10) / 10).replace('.', ','), 1.15, 0.85, 'ofereça o clube a quem vem 2 vezes ou mais por mês');
    comp('retorno', 'Clientes que voltam', (v) => `${Math.round(v)}%`, 1.05, 0.95, 'agende o próximo horário antes do cliente sair');
    comp('fidelidade', 'Voltam com você', (v) => `${Math.round(v)}%`, 1.05, 0.95, 'crie vínculo: lembre do corte e marque o retorno');
    // o extra com maior oportunidade: onde ele está mais abaixo da equipe
    let oportunidade = null;
    if (i.at && i.barbeiro) {
      for (const [nome, taxa] of Object.entries(taxaEquipe)) {
        const meu = (i.servicos.find((s) => s.nome === nome)?.quantidade || 0) / i.at;
        const ganho = (taxa - meu) * i.at;
        if (taxa > 0 && ganho >= 3 && (!oportunidade || ganho > oportunidade.a_mais)) oportunidade = { servico: nome, equipe_pct: round2(taxa * 100), seu_pct: round2(meu * 100), a_mais: Math.round(ganho) };
      }
    }
    // clientes que devem voltar nesta semana (pelo intervalo de cada um) e o que oferecer
    const previstos = rad.clientes.filter((c) => c.ultimo_barbeiro_id === x.professional_id && c.status !== 'perdido').map((c) => {
      const intervalo = c.intervalo_medio || (c.clube ? 15 : 30);
      return { ...c, previsto: addDias(c.ultima, intervalo) };
    }).filter((c) => c.previsto >= addDias(hoje, -3) && c.previsto <= fim).sort((a, b) => a.previsto.localeCompare(b.previsto));
    const oferta = (c) => (!c.clube && c.visitas >= 2 ? 'Oferecer o clube: já vem com frequência'
      : c.clube ? `Oferecer ${oportunidade?.servico || topSva || 'um serviço extra'}`
        : `Oferecer ${topSva || 'um serviço extra'} e agendar o retorno`);
    const candidatosClube = rad.clientes.filter((c) => c.ultimo_barbeiro_id === x.professional_id && !c.clube && c.visitas >= 2 && c.status !== 'perdido').length;
    return {
      professional_id: x.professional_id, nome: x.nome,
      meta: x.meta, realizado: x.realizado, projecao: x.projecao, falta: x.falta, por_dia: x.por_dia, no_ritmo: x.no_ritmo, percentual: x.percentual,
      assinaturas: x.assinaturas, fortes, melhorar, oportunidade, candidatos_clube: candidatosClube,
      semana: previstos.slice(0, 40).map((c) => ({ nome: c.nome, previsto: c.previsto, clube: c.clube, visitas: c.visitas, ultima: c.ultima, oferta: oferta(c) })),
      semana_total: previstos.length,
    };
  });

  return {
    ano: y, mes: m, mes_nome: MONTHS[m - 1], hoje, semana: { de: hoje, ate: fim },
    fechamento: professionalId ? null : fechamento, acoes: professionalId ? [] : acoes,
    oferta_da_semana: topSva ? { servico: topSva, quantidade_no_mes: sva[0].quantidade } : null,
    medias, barbeiros,
  };
}

module.exports = { calcular };
