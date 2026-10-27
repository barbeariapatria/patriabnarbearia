// Importação dos relatórios exportados do CashBarber (CSV). Reconhecidos pelo cabeçalho:
//   - Comandas:      "ID da comanda", "Profissional", "Cliente", "Tipo", "Valor comanda fechada / assinatura", "Data e hora"
//   - Agendamentos:  "Profissional", "Origem agendamento", "Acesso ao clube", "Status", "Status do cliente", "Data e hora"
//   - Serviços:      "Serviço", "Valor unitário", "Faturado", "Quantidade realizado"
//   - Assinantes:    "Cliente", "Plano", "Status", "Data de criação"
//   - Cancelamentos: "Plano", "Cliente", "Data assinatura", "Data de cancelamento", "Motivo"
//   - Equipe:        "ID", "Nome", "E-mail", "Status", "Tipo", "Criado em"
//   - Vendas:        "Item" (ou "Nome"), "Quantidade", "Valor" (produtos vendidos no mês — relatório Financeiro → Vendas)
// Os valores por dia vêm das comandas; a divisão entre serviços, SVA e produtos usa a proporção do relatório de serviços.
// Dados pessoais dos clientes (nome, telefone, e-mail) são lidos só para contar e nunca são gravados.
const { db, tx, getSetting, setSetting } = require('./db');
const { iso, round2, daysInMonth, todayIso, MONTHS } = require('./metrics');
const { normalize, matchProfessional, displayName, directory } = require('./team');

function parseCSV(text) {
  const rows = [];
  let row = []; let field = ''; let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  const [header = [], ...data] = rows;
  const keys = header.map((h) => normalize(h));
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const money = (v) => {
  const s = String(v || '').replace(/[R$\s ]/g, '');
  if (!s) return 0;
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0;
};
const brDate = (v) => { const m = String(v || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

function detect(rows) {
  const k = Object.keys(rows[0] || {});
  if (k.includes('ID DA COMANDA') || (k.includes('ID COMANDA') && k.includes('VALOR'))) return 'comandas';
  if (k.includes('ORIGEM AGENDAMENTO')) return 'agendamentos';
  if (k.includes('QUANTIDADE REALIZADO')) return 'servicos';
  if (k.includes('DATA DE CANCELAMENTO')) return 'cancelamentos';
  if (k.includes('DATA DE CRIACAO') && k.includes('PLANO')) return 'assinantes';
  if (k.includes('ID') && k.includes('NOME') && k.includes('TIPO') && k.includes('CRIADO EM')) return 'equipe';
  if ((k.includes('ITEM') || k.includes('NOME')) && k.includes('QUANTIDADE') && k.includes('VALOR') && k.length <= 4) return 'vendas';
  return null;
}

// Serviços principais (corte/barba); os demais contam como SVA (serviço de valor agregado)
const CORE_SERVICES = ['CABELO', 'BARBA', 'CABELO E BARBA', 'PEZINHO', 'BIGODE', 'CORTE'];
// "N/A" são cobranças de assinatura sem profissional; a Recepção entra como os profissionais
const NOT_PROFESSIONAL = ['N/A', ''];
const NEW_CLIENT = /NOV[OA] CADASTRO|CADASTRO NOV[OA]|CLIENTE NOV[OA]/;

// Nomes do CashBarber x catálogo do painel (ex.: "Depilação de nariz" = "DEP. NARIZ")
const serviceKey = (n) => normalize(n).replace(/\bDEPILACAO( DE)?\b/g, 'DEP').replace(/\bHIDRATACAO( DE)?\b/g, 'HID')
  .replace(/\bPIGMENTACAO( DE)?\b/g, 'PIG').replace(/\s+/g, '');

const monthsOf = (dates) => [...new Set(dates.map((d) => d.slice(0, 7)))].sort();

/** Analisa os arquivos e devolve o plano de importação (nada é gravado aqui). */
async function analyze(files, escolhido = {}) {
  const reports = {};
  const ignored = [];
  for (const f of files) {
    let rows;
    try { rows = parseCSV(f.text); } catch { ignored.push(f.name); continue; }
    const type = rows.length ? detect(rows) : null;
    if (!type) { ignored.push(f.name); continue; }
    reports[type] = rows;
  }
  if (!Object.keys(reports).length) throw new Error('Nenhum relatório do CashBarber reconhecido nos arquivos enviados.');

  // ---- mês do relatório (pelas comandas e/ou agendamentos)
  const comandas = (reports.comandas || []).map((r) => ({
    // o relatório antigo chama a coluna de "Valor comanda fechada / assinatura"; o de Faturamento, só de "Valor"
    pro: r.PROFISSIONAL, cliente: r.CLIENTE, tipo: normalize(r.TIPO),
    valor: money(r['VALOR COMANDA FECHADA / ASSINATURA'] ?? r['VALOR COMANDA FECHADA'] ?? r.VALOR ?? r['VALOR TOTAL']), date: brDate(r['DATA E HORA'] ?? r.DATA),
  })).filter((c) => c.date);
  const agendamentos = (reports.agendamentos || []).map((r) => ({
    pro: r.PROFISSIONAL, origem: normalize(r['ORIGEM AGENDAMENTO']), clube: normalize(r['ACESSO AO CLUBE']) === 'SIM',
    status: normalize(r.STATUS), cliente_status: normalize(r['STATUS DO CLIENTE']), date: brDate(r['DATA E HORA']),
  })).filter((a) => a.date);
  // Período dos arquivos: as datas de comandas/agendamentos definem o mês; sem elas, vale o mês escolhido na tela
  const fmt = (d) => d.split('-').reverse().join('/');
  const periodos = {};
  for (const [k, list] of [['comandas', comandas], ['agendamentos', agendamentos]]) {
    if (!list.length) continue;
    const ds = list.map((x) => x.date).sort();
    periodos[k] = { de: ds[0], ate: ds[ds.length - 1], texto: `${fmt(ds[0])} a ${fmt(ds[ds.length - 1])}` };
  }
  const months = monthsOf([...comandas, ...agendamentos].map((x) => x.date));
  if (months.length > 1) {
    throw new Error(`Os arquivos cobrem mais de um mês (${months.map((k) => `${MONTHS[Number(k.slice(5)) - 1]}/${k.slice(0, 4)}`).join(', ')}). No CashBarber, exporte um mês por vez (do dia 1 ao último dia do mês).`);
  }
  const ey = Number(escolhido.ano) || null; const em = Number(escolhido.mes) || null;
  if (months.length && ey && em && months[0] !== `${ey}-${String(em).padStart(2, '0')}`) {
    const [dy, dm] = months[0].split('-').map(Number);
    throw new Error(`Os arquivos são de ${MONTHS[dm - 1]}/${dy}, mas o mês escolhido é ${MONTHS[em - 1]}/${ey}. Escolha ${MONTHS[dm - 1]}/${dy} ou envie os arquivos do mês certo.`);
  }
  const needsMonth = ['servicos', 'assinantes', 'cancelamentos', 'vendas'].some((k) => reports[k]);
  if (!months.length && needsMonth && !(ey && em)) throw new Error('Escolha o mês dos relatórios: Serviços, Vendas, Assinantes e Cancelamentos não trazem datas.');
  const [y, m] = months.length ? months[0].split('-').map(Number) : (needsMonth || reports.equipe ? [ey, em] : [null, null]);
  if (y && m) periodos.mes = { de: iso(y, m, 1), ate: iso(y, m, daysInMonth(y, m)), texto: `${MONTHS[m - 1]}/${y}` };

  // ---- equipe: liga IDs e nomes completos do CashBarber aos profissionais do painel
  const existing = await db.all('SELECT * FROM professionals');
  let dir = await directory();
  const pros = existing.map((p) => ({ ...p })); // cópia que recebe as mudanças previstas (IDs, novos)
  let equipe = null;
  if (reports.equipe) {
    const entries = reports.equipe
      .map((r) => ({ id: r.ID, nome: r.NOME, tipo: normalize(r.TIPO), ativo: r.STATUS === '1', desde: brDate(r['CRIADO EM']) }))
      .filter((e) => e.id && e.nome);
    dir = entries.map(({ id, nome, tipo, ativo, desde }) => ({ id, nome, tipo, ativo, desde }));
    const team = entries.filter((e) => e.tipo === 'PROFISSIONAL' && !NOT_PROFESSIONAL.includes(normalize(e.nome)));
    const linked = [];
    const profissionais = team.map((e) => {
      const match = matchProfessional(e.nome, pros.filter((p) => !linked.includes(p)), dir, e.id);
      let target = match;
      if (!target) {
        target = { id: null, name: displayName(e.nome, pros), external_id: e.id, active: e.ativo ? 1 : 0, _novo: true };
        pros.push(target);
      } else {
        target.external_id = e.id; target.active = e.ativo ? 1 : 0;
      }
      linked.push(target);
      return { id_cashbarber: e.id, nome_completo: e.nome, nome: target.name, id: target.id, existente: !target._novo, ativo: e.ativo, desde: e.desde };
    });
    const fora = pros.filter((p) => !p._novo && !linked.includes(p) && p.active);
    for (const p of fora) p.active = 0;
    equipe = {
      profissionais,
      inativar: fora.map((p) => ({ id: p.id, nome: p.name })),
      outros_usuarios: entries.filter((e) => !team.includes(e)).map((e) => `${e.nome} (${e.tipo === 'ADMIN' ? 'admin' : e.tipo.toLowerCase()})`),
    };
  }
  const resolve = (fullName) => {
    const p = matchProfessional(fullName, pros, dir);
    if (p) return { id: p.id, nome: p.name, existente: !p._novo };
    const novo = { id: null, name: displayName(fullName, pros), external_id: null, active: 1, _novo: true };
    pros.push(novo);
    return { id: null, nome: novo.name, existente: false };
  };

  // ---- serviços do mês (SVA x principais)
  const extrasCatalog = (await getSetting('extras_catalog')) || [];
  const servicos = [];
  let svaTotal = 0; let servTotal = 0;
  for (const r of reports.servicos || []) {
    const nome = r.SERVICO; if (!nome || normalize(nome) === 'TOTAL') continue;
    const item = { nome, quantidade: money(r['QUANTIDADE REALIZADO']), faturado: money(r.FATURADO), sva: !CORE_SERVICES.includes(normalize(nome)) };
    const cat = extrasCatalog.find((n) => serviceKey(n) === serviceKey(nome));
    if (cat) item.catalogo = cat;
    servicos.push(item);
    servTotal += item.faturado;
    if (item.sva) svaTotal += item.faturado;
  }

  // ---- produtos vendidos no mês (relatório Vendas): valor real de produtos, que já está dentro das comandas
  let produtos = null;
  if (reports.vendas) {
    // o relatório Vendas pode trazer serviços junto: produto é só o que não é serviço (relatório de Serviços do
    // mês, serviços já gravados no painel, catálogo de SVA e serviços principais)
    const salvos = await db.get("SELECT data FROM monthly_reports WHERE year = ? AND month = ? AND kind = 'servicos'", y, m).catch(() => null);
    let listaSalva = []; try { listaSalva = salvos ? ((typeof salvos.data === 'string' ? JSON.parse(salvos.data) : salvos.data)?.lista || []) : []; } catch {}
    const nomesServico = new Set([...servicos.map((x) => x.nome), ...listaSalva.map((x) => x.nome), ...extrasCatalog, ...CORE_SERVICES].map(serviceKey));
    const ehServico = (n) => nomesServico.has(serviceKey(n)) || (/^(CORTE|CABELO|BARBA|SOBRANCELHA|PEZINHO|BIGODE|LUZES|PLATINAD|SELAGEM|ALISAMENTO|HID|PIG|DEP|SPA|BARBOTERAPIA|LAVAGEM|CONE|RELAXAMENTO|PROGRESSIVA|MANICURE|PEDICURE|PACOTE|COMBO|LIMPEZA|TERAPIA|ESCOVA|TINTURA|COLORACAO|NEVOU|BOTOX|ESFOLIACAO|MASSAGEM|DESIGN|UNHA)/.test(normalize(n))
      || /^(MAO|PE|PE E MAO|MAO E PE|SPA DOS PES)$/.test(normalize(n)));
    const itens = reports.vendas
      .map((r) => ({ nome: r.ITEM ?? r.NOME, quantidade: money(r.QUANTIDADE), valor: money(r.VALOR) }))
      .filter((i) => i.nome && normalize(i.nome) !== 'TOTAL' && (i.valor || i.quantidade) && !ehServico(i.nome));
    produtos = { total: round2(itens.reduce((s, i) => s + i.valor, 0)), quantidade: itens.reduce((s, i) => s + i.quantidade, 0), itens };
  }

  // ---- financeiro (comandas)
  let financeiro = null;
  if (comandas.length) {
    const comandaTotal = comandas.filter((c) => c.tipo !== 'ASSINATURA').reduce((s, c) => s + c.valor, 0);
    let svaShare = 0; let prodShare = 0;
    if (servicos.length && comandaTotal > 0) {
      svaShare = Math.min(1, svaTotal / comandaTotal);
      prodShare = Math.max(0, Math.min(1 - svaShare, (comandaTotal - servTotal) / comandaTotal));
    }
    // com o relatório Vendas, a parte de produtos é o valor real vendido (distribuído na proporção das comandas do dia)
    if (produtos && comandaTotal > 0) prodShare = Math.max(0, Math.min(1 - svaShare, produtos.total / comandaTotal));
    // Assinaturas: nova quando a cobrança é no dia em que a assinatura foi criada; demais são recorrência
    const created = new Map();
    for (const r of reports.assinantes || []) { const d = brDate(r['DATA DE CRIACAO']); if (d && r.CLIENTE) created.set(normalize(r.CLIENTE), d); }
    for (const r of reports.cancelamentos || []) { const d = brDate(r['DATA ASSINATURA']); if (d && r.CLIENTE && !created.has(normalize(r.CLIENTE))) created.set(normalize(r.CLIENTE), d); }

    const days = {};
    for (let d = 1; d <= daysInMonth(y, m); d++) days[iso(y, m, d)] = { comandas: 0, novas_assinaturas: 0, recorrencia: 0 };
    let novas = 0; let recorrentes = 0;
    for (const c of comandas) {
      const day = days[c.date];
      if (c.tipo === 'ASSINATURA') {
        if (created.get(normalize(c.cliente)) === c.date) { day.novas_assinaturas += c.valor; novas++; } else { day.recorrencia += c.valor; recorrentes++; }
      } else day.comandas += c.valor;
    }
    const diario = Object.entries(days)
      .filter(([, v]) => v.comandas || v.novas_assinaturas || v.recorrencia)
      .map(([date, v]) => {
        const sva = round2(v.comandas * svaShare);
        const produtos = round2(v.comandas * prodShare);
        return { date, servicos: round2(v.comandas - sva - produtos), produtos, sva, novas_assinaturas: round2(v.novas_assinaturas), recorrencia: round2(v.recorrencia) };
      });

    const byPro = new Map();
    for (const c of comandas) {
      if (c.tipo === 'ASSINATURA' || NOT_PROFESSIONAL.includes(normalize(c.pro))) continue;
      const p = byPro.get(c.pro) || { nome_cashbarber: c.pro, faturamento_total: 0, atendimentos: 0, pagas: 0, clientes: new Set(), novos: new Set() };
      p.faturamento_total += c.valor; p.atendimentos++;
      if (c.valor > 0) p.pagas++;
      p.clientes.add(normalize(c.cliente));
      if (NEW_CLIENT.test(normalize(c.cliente))) p.novos.add(normalize(c.cliente));
      byPro.set(c.pro, p);
    }
    const profissionais = [...byPro.values()].map((p) => ({
      nome_cashbarber: p.nome_cashbarber, ...resolve(p.nome_cashbarber),
      faturamento_total: round2(p.faturamento_total), clientes_atendidos: p.atendimentos, clientes_unicos: p.clientes.size,
      geracao_demanda: p.novos.size, ticket_medio: p.pagas ? round2(p.faturamento_total / p.pagas) : 0,
    })).sort((a, b) => b.faturamento_total - a.faturamento_total);

    const sum = (k) => round2(diario.reduce((s, d) => s + d[k], 0));
    financeiro = {
      resumo: {
        dias_com_movimento: diario.length,
        comandas: comandas.filter((c) => c.tipo !== 'ASSINATURA').length,
        cobrancas_assinatura: novas + recorrentes, novas_assinaturas_qtd: novas,
        faturamento_total: round2(comandas.reduce((s, c) => s + c.valor, 0)),
        servicos: sum('servicos'), produtos: sum('produtos'), sva: sum('sva'),
        novas_assinaturas: sum('novas_assinaturas'), recorrencia: sum('recorrencia'),
        sva_proporcional: servicos.length > 0,
      },
      diario,
      profissionais,
    };
  }

  // ---- agenda (agendamentos): só contagens, sem dados dos clientes
  let agenda = null;
  if (agendamentos.length) {
    const hoje = todayIso();
    const blank = () => ({ total: 0, finalizados: 0, cancelados: 0, agendados: 0, futuros: 0, faltas: 0, app: 0, clube: 0 });
    const add = (acc, a) => {
      acc.total++;
      if (a.status === 'FINALIZADO') acc.finalizados++;
      else if (a.status === 'CANCELADO') acc.cancelados++;
      else if (a.date >= hoje) acc.futuros++;
      else acc.agendados++; // ficou como "agendado" num dia que já passou
      if (a.cliente_status === 'FALTOU') acc.faltas++;
      if (a.origem === 'APP') acc.app++;
      if (a.clube) acc.clube++;
    };
    const totais = blank();
    const porPro = new Map();
    const porDia = new Map();
    for (const a of agendamentos) {
      add(totais, a);
      if (!NOT_PROFESSIONAL.includes(normalize(a.pro))) {
        if (!porPro.has(a.pro)) porPro.set(a.pro, { nome_cashbarber: a.pro, ...blank() });
        add(porPro.get(a.pro), a);
      }
      if (!porDia.has(a.date)) porDia.set(a.date, { date: a.date, ...blank() });
      add(porDia.get(a.date), a);
    }
    agenda = {
      totais,
      profissionais: [...porPro.values()].map((p) => ({ ...p, ...resolve(p.nome_cashbarber) })).sort((a, b) => b.total - a.total),
      por_dia: [...porDia.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  // ---- base de assinantes e cancelamentos do mês
  let assinaturas = null;
  if (reports.assinantes || reports.cancelamentos) {
    const mesIso = months[0];
    const planos = {};
    for (const r of reports.assinantes || []) if (r.CLIENTE && r.PLANO && normalize(r.STATUS) === 'EM DIA') planos[r.PLANO] = (planos[r.PLANO] || 0) + 1;
    const cancelMes = (reports.cancelamentos || []).filter((r) => brDate(r['DATA DE CANCELAMENTO'])?.startsWith(mesIso));
    assinaturas = {
      total: reports.assinantes ? reports.assinantes.filter((r) => r.CLIENTE && normalize(r.STATUS)).length : null,
      ativos: reports.assinantes ? reports.assinantes.filter((r) => normalize(r.STATUS) === 'EM DIA').length : null,
      inadimplentes: reports.assinantes ? reports.assinantes.filter((r) => r.CLIENTE && !['EM DIA', ''].includes(normalize(r.STATUS))).length : null,
      novas_no_mes: reports.assinantes ? reports.assinantes.filter((r) => brDate(r['DATA DE CRIACAO'])?.startsWith(mesIso)).length : null,
      planos: Object.entries(planos).sort((a, b) => b[1] - a[1]),
      cancelamentos: reports.cancelamentos ? cancelMes.length : null,
      motivos: reports.cancelamentos
        ? Object.entries(cancelMes.reduce((acc, r) => { const k = r.MOTIVO || 'Não informado'; acc[k] = (acc[k] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1])
        : null,
    };
  }

  // ---- indicadores da unidade (planilha "Análise de Unidade"): só contagens, sem nomes de clientes
  const unidade = {};
  if (comandas.length) {
    const visitas = new Set(comandas.filter((c) => c.tipo !== 'ASSINATURA' && c.cliente).map((c) => normalize(c.cliente)));
    const assinantesSet = new Set([
      ...(reports.assinantes || []).filter((r) => r.CLIENTE).map((r) => normalize(r.CLIENTE)),
      ...comandas.filter((c) => c.tipo === 'ASSINATURA' && c.cliente).map((c) => normalize(c.cliente)),
    ]);
    let assinantesAtendidos = 0; let novos = 0;
    for (const c of visitas) { if (assinantesSet.has(c)) assinantesAtendidos++; if (NEW_CLIENT.test(c)) novos++; }
    Object.assign(unidade, { clientes_atendidos: visitas.size, clientes_assinantes_atendidos: assinantesAtendidos, clientes_avulsos: visitas.size - assinantesAtendidos, clientes_novos: novos });
  }
  if (servicos.length) {
    unidade.servicos_realizados = servicos.reduce((t, x) => t + x.quantidade, 0);
    unidade.servicos_extras = servicos.filter((x) => x.sva).reduce((t, x) => t + x.quantidade, 0);
  }
  if (agendamentos.length) unidade.atendimentos_clube = agendamentos.filter((a) => a.clube && a.status === 'FINALIZADO').length;

  return {
    unidade: Object.keys(unidade).length ? unidade : null,
    ano: y, mes: m, mes_nome: m ? `${MONTHS[m - 1]}/${y}` : null,
    mes_detectado: months.length > 0, periodos,
    relatorios: Object.keys(reports), ignorados: ignored,
    equipe, financeiro, agenda, assinaturas, produtos,
    servicos: servicos.length ? { lista: servicos, sva_total: round2(svaTotal), total: round2(servTotal) } : null,
  };
}

async function saveReport(q, y, m, kind, data) {
  await q.run(`INSERT INTO monthly_reports(year, month, kind, data, updated_at) VALUES(?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(year, month, kind) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`, y, m, kind, JSON.stringify(data));
}

/** Grava o plano. Cada relatório substitui só a parte que ele cobre. */
async function apply(plan) {
  const { ano: y, mes: m } = plan;
  await tx(async (q) => {
    // garante o profissional (já existente ou novo) e devolve o id
    const ensurePro = async (p, externalId = null) => {
      if (p.id) return p.id;
      const found = await q.get('SELECT id FROM professionals WHERE lower(name) = lower(?)', p.nome);
      if (found) return found.id;
      await q.run('INSERT INTO professionals(name, external_id) VALUES(?, ?) ON CONFLICT DO NOTHING', p.nome, externalId);
      return (await q.get('SELECT id FROM professionals WHERE lower(name) = lower(?)', p.nome)).id;
    };

    if (plan.equipe) {
      for (const p of plan.equipe.profissionais) {
        const id = await ensurePro(p, p.id_cashbarber);
        await q.run('UPDATE professionals SET external_id = ?, active = ? WHERE id = ?', p.id_cashbarber, p.ativo ? 1 : 0, id);
      }
      for (const p of plan.equipe.inativar) await q.run('UPDATE professionals SET active = 0 WHERE id = ?', p.id);
    }

    if (plan.financeiro) {
      await q.run('DELETE FROM daily_revenue WHERE date >= ? AND date <= ?', iso(y, m, 1), iso(y, m, daysInMonth(y, m)));
      for (const d of plan.financeiro.diario) {
        await q.run(`INSERT INTO daily_revenue(date, servicos, produtos, novas_assinaturas, sva, recorrencia, status, updated_at)
          VALUES(?, ?, ?, ?, ?, ?, 'REALIZADO', CURRENT_TIMESTAMP)`, d.date, d.servicos, d.produtos, d.novas_assinaturas, d.sva, d.recorrencia);
      }
      // o relatório é a fonte da verdade do mês: quem não aparece nele sai daquele mês
      const keep = [];
      for (const p of plan.financeiro.profissionais) {
        const id = await ensurePro(p);
        await q.run('UPDATE professionals SET active = 1 WHERE id = ?', id);
        await q.run('INSERT INTO professional_monthly(professional_id, year, month) VALUES(?, ?, ?) ON CONFLICT DO NOTHING', id, y, m);
        await q.run(`UPDATE professional_monthly SET faturamento_total = ?, clientes_atendidos = ?, geracao_demanda = ?, ticket_medio = ?, updated_at = CURRENT_TIMESTAMP
          WHERE professional_id = ? AND year = ? AND month = ?`, p.faturamento_total, p.clientes_atendidos, p.geracao_demanda, p.ticket_medio, id, y, m);
        keep.push(id);
      }
      for (const o of await q.all('SELECT professional_id FROM professional_monthly WHERE year = ? AND month = ?', y, m)) {
        if (!keep.includes(o.professional_id)) await q.run('DELETE FROM professional_monthly WHERE professional_id = ? AND year = ? AND month = ?', o.professional_id, y, m);
      }
    }

    // Vendas sem comandas no mesmo envio: reparte o total de produtos nos dias já gravados do mês, tirando de serviços
    // (o total de cada dia não muda; produtos já estavam dentro das comandas)
    if (plan.produtos && !plan.financeiro && y && m) {
      const dias = await q.all('SELECT * FROM daily_revenue WHERE date >= ? AND date <= ?', iso(y, m, 1), iso(y, m, daysInMonth(y, m)));
      const base = (d) => (Number(d.servicos) || 0) + (Number(d.produtos) || 0);
      const soma = dias.reduce((s, d) => s + base(d), 0);
      if (soma > 0) {
        const share = Math.min(1, plan.produtos.total / soma);
        for (const d of dias) {
          const prod = round2(base(d) * share);
          await q.run('UPDATE daily_revenue SET servicos = ?, produtos = ?, updated_at = CURRENT_TIMESTAMP WHERE date = ?', round2(base(d) - prod), prod, d.date);
        }
      }
    }
    if (plan.produtos && y && m) await saveReport(q, y, m, 'produtos', plan.produtos);

    if (plan.agenda) {
      const profissionais = [];
      for (const p of plan.agenda.profissionais) {
        const { nome_cashbarber, existente, id, ...counts } = p;
        profissionais.push({ ...counts, professional_id: await ensurePro(p) });
      }
      await saveReport(q, y, m, 'agenda', { totais: plan.agenda.totais, profissionais, por_dia: plan.agenda.por_dia });
    }
    if (y && m) await saveReport(q, y, m, 'importacao', { em: new Date().toISOString(), relatorios: plan.relatorios, periodos: plan.periodos });
    if (plan.assinaturas) await saveReport(q, y, m, 'assinaturas', plan.assinaturas);
    if (plan.servicos) await saveReport(q, y, m, 'servicos', plan.servicos);
    // indicadores da unidade: junta com o que já existe (cada relatório traz uma parte)
    if (plan.unidade && y && m) {
      const atual = await q.get('SELECT data FROM monthly_reports WHERE year = ? AND month = ? AND kind = ?', y, m, 'unidade');
      let antigo = {}; try { antigo = atual ? (typeof atual.data === 'string' ? JSON.parse(atual.data) : atual.data) || {} : {}; } catch {}
      await saveReport(q, y, m, 'unidade', { ...antigo, ...plan.unidade });
    }
  });
  if (plan.equipe) {
    const dirRows = (await db.all('SELECT id, name, external_id FROM professionals')).filter((p) => p.external_id);
    await setSetting('cashbarber_equipe', plan.equipe.profissionais.map((p) => ({ id: p.id_cashbarber, nome: p.nome_completo, tipo: 'PROFISSIONAL', ativo: p.ativo, desde: p.desde, profissional: dirRows.find((d) => d.external_id === p.id_cashbarber)?.name })));
  }
  return {
    ok: true, ano: y, mes: m,
    dias: plan.financeiro?.diario.length || 0,
    profissionais: plan.financeiro?.profissionais.length || 0,
    agenda: !!plan.agenda, equipe: plan.equipe?.profissionais.length || 0, produtos: plan.produtos?.total ?? null,
  };
}

module.exports = { analyze, apply, parseCSV };
