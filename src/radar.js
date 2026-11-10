// Radar de clientes: quem veio com cada barbeiro, se voltou, depois de quanto tempo, com quem e quantas vezes.
// Fonte: agendamentos finalizados do CashBarber (relatório "Histórico de agendamentos"), guardados por mês.
const { db } = require('./db');
const { todayIso, round2 } = require('./metrics');

// sem voltar há até 30 dias: ainda no prazo · 31 a 60: em risco · mais de 60: perdido
const RISCO = 30;
const PERDIDO = 60;
// nomes de cliente genérico (balcão, avulso…) não entram no radar
const GENERICO = /\b(CLIENTE|AVULSO|CONSUMIDOR|BALCAO|TESTE|ENCAIXE|SEM NOME|SEM CADASTRO)\b/;

const dias = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const menosMeses = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1 - n, d)); return dt.toISOString().slice(0, 10); };
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

async function calcular({ meses = 4, ate = todayIso(), professionalId = null } = {}) {
  const de = menosMeses(ate, meses);
  const [y1, m1] = de.split('-').map(Number); const [y2, m2] = ate.split('-').map(Number);
  const rows = await db.all("SELECT year, month, data FROM monthly_reports WHERE kind = 'visitas' AND year * 100 + month BETWEEN ? AND ? ORDER BY year, month", y1 * 100 + m1, y2 * 100 + m2);
  const pros = await db.all('SELECT id, name FROM professionals');
  const nomePro = (id) => pros.find((p) => p.id === id)?.name || '?';

  // visitas por cliente (no máximo uma por dia: dois serviços no mesmo dia são uma visita)
  const porCliente = new Map();
  const mesesComDados = [];
  for (const r of rows) {
    let lista = []; try { lista = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)?.lista || []; } catch {}
    if (lista.length) mesesComDados.push(`${r.year}-${String(r.month).padStart(2, '0')}`);
    for (const [k, n, pid, d, c] of lista) {
      if (d < de || d > ate || GENERICO.test(semAcento(n))) continue;
      const cl = porCliente.get(k) || { k, nome: n, clube: false, visitas: [] };
      if (!cl.visitas.some((v) => v.d === d && v.p === pid)) cl.visitas.push({ d, p: pid });
      cl.clube ||= !!c; cl.nome = n || cl.nome;
      porCliente.set(k, cl);
    }
  }
  const clientes = [...porCliente.values()];
  for (const c of clientes) c.visitas.sort((a, b) => a.d.localeCompare(b.d));

  // captação (todos os meses guardados): como conheceu, data de cadastro e quem indicou
  const capRows = await db.all("SELECT data FROM monthly_reports WHERE kind = 'captacao'");
  const capK = new Map(); const capN = new Map(); const novosNoPeriodo = [];
  for (const r of capRows) {
    let l = []; try { l = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)?.lista || []; } catch {}
    for (const c of l) {
      if (c.k) capK.set(c.k, c);
      if (c.nome) capN.set(semAcento(c.nome).replace(/\s+/g, ' ').trim(), c);
      if (c.cadastro >= de && c.cadastro <= ate) novosNoPeriodo.push(c);
    }
  }
  const temCaptacao = capRows.length > 0;
  for (const c of clientes) c.cap = capK.get(c.k) || capN.get(semAcento(c.nome).replace(/\s+/g, ' ').trim()) || null;

  const status = (diasSem) => (diasSem > PERDIDO ? 'perdido' : diasSem > RISCO ? 'risco' : 'ativo');
  const porPro = new Map();
  const pegar = (pid) => {
    if (!porPro.has(pid)) porPro.set(pid, { professional_id: pid, nome: nomePro(pid), clientes: 0, visitas: 0, voltaram: 0, nao_voltaram: 0, perdidos: 0, risco: 0, recentes: 0,
      retornos: 0, retornos_mesmo: 0, retornos_dias: 0, voltou_com: {}, vezes: { 0: 0, 1: 0, 2: 0, 3: 0, '4+': 0 } });
    return porPro.get(pid);
  };
  const geral = { clientes: clientes.length, visitas: 0, voltaram: 0, retornos: 0, retornos_dias: 0, perdidos: 0, risco: 0, ativos: 0 };
  const lista = [];
  for (const c of clientes) {
    const vs = c.visitas;
    geral.visitas += vs.length;
    const ultima = vs[vs.length - 1];
    const diasSem = dias(ultima.d, ate);
    const st = status(diasSem);
    geral[st === 'perdido' ? 'perdidos' : st === 'risco' ? 'risco' : 'ativos']++;
    if (vs.length > 1) geral.voltaram++;
    // cada visita seguida de outra é um retorno: com quem foi e depois de quantos dias
    for (let i = 0; i < vs.length - 1; i++) {
      const a = vs[i]; const b = vs[i + 1];
      const intervalo = dias(a.d, b.d);
      geral.retornos++; geral.retornos_dias += intervalo;
      const pa = pegar(a.p);
      pa.retornos++; pa.retornos_dias += intervalo;
      if (b.p === a.p) pa.retornos_mesmo++;
      pa.voltou_com[b.p] = (pa.voltou_com[b.p] || 0) + 1;
    }
    // por barbeiro: o cliente conta para cada barbeiro que o atendeu
    const comPro = [...new Set(vs.map((v) => v.p))];
    for (const pid of comPro) {
      const p = pegar(pid);
      const minhas = vs.filter((v) => v.p === pid);
      const ultimaComigo = minhas[minhas.length - 1];
      const depois = vs.filter((v) => v.d > ultimaComigo.d);
      p.clientes++; p.visitas += minhas.length;
      // voltou = teve outra visita (com qualquer barbeiro) depois da primeira com ele
      const voltas = vs.filter((v) => v.d > minhas[0].d).length;
      p.vezes[voltas >= 4 ? '4+' : voltas]++;
      if (voltas > 0) p.voltaram++;
      // não voltou mais = depois da última visita com ele, não veio de novo (com ninguém)
      if (!depois.length) {
        const sem = dias(ultimaComigo.d, ate);
        if (sem > PERDIDO) { p.perdidos++; p.nao_voltaram++; } else if (sem > RISCO) { p.risco++; p.nao_voltaram++; } else p.recentes++;
      }
    }
    if (professionalId && !comPro.includes(professionalId)) continue;
    const contagem = {}; for (const v of vs) contagem[v.p] = (contagem[v.p] || 0) + 1;
    const intervalos = vs.slice(1).map((v, i) => dias(vs[i].d, v.d));
    lista.push({
      nome: c.nome, clube: c.clube, visitas: vs.length, primeira: vs[0].d, ultima: ultima.d, dias_sem_vir: diasSem, status: st,
      ultimo_barbeiro: nomePro(ultima.p), ultimo_barbeiro_id: ultima.p,
      barbeiros: Object.entries(contagem).sort((a, b) => b[1] - a[1]).map(([pid, n]) => ({ professional_id: Number(pid), nome: nomePro(Number(pid)), visitas: n })),
      intervalo_medio: intervalos.length ? Math.round(intervalos.reduce((a, b) => a + b, 0) / intervalos.length) : null,
      origem: c.cap?.como || null, cadastro: c.cap?.cadastro || null, indicado_por: c.cap?.indicado || null,
      meses_de_casa: c.cap?.cadastro ? Math.max(0, Math.floor(dias(c.cap.cadastro, ate) / 30.4)) : null,
    });
  }
  const barbeiros = [...porPro.values()].filter((p) => p.nome !== '?' && (!professionalId || p.professional_id === professionalId)).map((p) => ({
    ...p,
    taxa_retorno: p.clientes ? round2((p.voltaram / p.clientes) * 100) : 0,
    tempo_medio_retorno: p.retornos ? Math.round(p.retornos_dias / p.retornos) : null,
    fidelidade: p.retornos ? round2((p.retornos_mesmo / p.retornos) * 100) : null,
    media_visitas: p.clientes ? round2(p.visitas / p.clientes) : 0,
    voltou_com: Object.entries(p.voltou_com).map(([pid, n]) => ({ professional_id: Number(pid), nome: nomePro(Number(pid)), retornos: n, pct: round2((n / p.retornos) * 100) })).sort((a, b) => b.retornos - a.retornos),
  })).sort((a, b) => b.clientes - a.clientes);
  lista.sort((a, b) => b.dias_sem_vir - a.dias_sem_vir);

  // de onde vêm: clientes novos (cadastrados no período) e clientes atendidos, por "como conheceu"
  const conta = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x) || 'Não informado'; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n); };
  const origem = temCaptacao ? {
    novos: conta(novosNoPeriodo, (c) => c.como), total_novos: novosNoPeriodo.length,
    atendidos: conta(lista, (c) => c.origem),
    indicacoes: conta(novosNoPeriodo.filter((c) => c.indicado), (c) => c.indicado).slice(0, 10),
  } : null;
  // tempo de casa dos clientes atendidos no período (pela data de cadastro no CashBarber)
  const faixas = [['Menos de 3 meses', 0, 2], ['3 a 6 meses', 3, 5], ['6 meses a 1 ano', 6, 11], ['1 a 2 anos', 12, 23], ['Mais de 2 anos', 24, 1e9]];
  const comCasa = lista.filter((c) => c.meses_de_casa != null);
  const tempoCasa = temCaptacao ? {
    faixas: faixas.map(([nome, a, b]) => {
      const cs = comCasa.filter((c) => c.meses_de_casa >= a && c.meses_de_casa <= b);
      return { nome, clientes: cs.length, perdidos: cs.filter((c) => c.status === 'perdido').length, media_visitas: cs.length ? round2(cs.reduce((t, c) => t + c.visitas, 0) / cs.length) : 0 };
    }),
    sem_cadastro: lista.length - comCasa.length,
    media_meses: comCasa.length ? Math.round(comCasa.reduce((t, c) => t + c.meses_de_casa, 0) / comCasa.length) : null,
  } : null;
  return {
    de, ate, meses, meses_com_dados: mesesComDados, limites: { risco: RISCO, perdido: PERDIDO },
    geral: {
      ...geral,
      taxa_retorno: geral.clientes ? round2((geral.voltaram / geral.clientes) * 100) : 0,
      tempo_medio_retorno: geral.retornos ? Math.round(geral.retornos_dias / geral.retornos) : null,
      media_visitas: geral.clientes ? round2(geral.visitas / geral.clientes) : 0,
    },
    barbeiros, clientes: lista, origem, tempo_casa: tempoCasa,
  };
}

module.exports = { calcular };
