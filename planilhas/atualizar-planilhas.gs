/**
 * Pátria Barbearia — atualiza as planilhas Google com os números do painel (que o robô do CashBarber preenche).
 *
 * Planilhas:
 *   - Análise de Unidade ........ abas "Indic. Barbearia" e "Indic. Assinatura" (linha do mês)
 *   - Análise de Profissionais .. aba "Geral" (bloco do mês)
 *   - Gráfico de resultados SVA . aba do mês, bloco "Faturamento por dia"
 *
 * Regras de segurança:
 *   - nunca escreve em célula com fórmula;
 *   - só mexe em meses a partir de INICIO e que já têm dados no painel;
 *   - escreve só os números que o painel tem; o resto fica como está.
 *
 * Configuração (uma vez): veja planilhas/LEIA-ME.md
 */
const CONFIG = {
  PAINEL_URL: 'https://patriabnarbearia.vercel.app',
  INICIO: '2026-09', // meses antes disso não são tocados (já estavam preenchidos à mão)
  UNIDADE_ID: '1AwTbmjb51VPgUbEO5qSnFN09RW9trSqb9RTfy4tytIM',
  PROFISSIONAIS_ID: '1syjpxzt8dDZcPSfoaoPc8dIAO3-NDlpOyhuGL6BDDn4',
  GRAFICO_ID: '1YVBvzJud6MkV_-5I_eQnPK9sQZwewgsoyuFJGMXFbmo',
};
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// ---------------------------------------------------------------- menu e agendamento
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Painel Pátria')
    .addItem('Atualizar agora (mês atual)', 'atualizarPlanilhas')
    .addItem('Atualizar desde setembro', 'atualizarDesdeInicio')
    .addItem('Ligar atualização diária (21h)', 'instalarAgendamento')
    .addToUi();
}

/** Cria (uma vez) a atualização automática todo dia entre 21h e 22h (depois do robô das 20h). */
function instalarAgendamento() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'atualizarPlanilhas').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('atualizarPlanilhas').timeBased().everyDays(1).atHour(21).inTimezone('America/Sao_Paulo').create();
  aviso_('Atualização diária ligada: todo dia entre 21h e 22h.');
}

// ---------------------------------------------------------------- principal
/** Mês atual (e, nos 3 primeiros dias do mês, também o anterior, para fechar o último dia). */
function atualizarPlanilhas() {
  const hoje = new Date();
  const lista = [[hoje.getFullYear(), hoje.getMonth() + 1]];
  if (hoje.getDate() <= 3) { const a = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1); lista.unshift([a.getFullYear(), a.getMonth() + 1]); }
  return atualizarMeses_(lista);
}

/** Todos os meses de INICIO até hoje (para preencher de uma vez o que faltar). */
function atualizarDesdeInicio() {
  const [ai, mi] = CONFIG.INICIO.split('-').map(Number);
  const hoje = new Date(); const lista = [];
  for (let d = new Date(ai, mi - 1, 1); d <= hoje; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) lista.push([d.getFullYear(), d.getMonth() + 1]);
  return atualizarMeses_(lista);
}

function atualizarMeses_(lista) {
  const log = [];
  for (const [ano, mes] of lista) {
    if (`${ano}-${String(mes).padStart(2, '0')}` < CONFIG.INICIO) continue;
    const d = buscar_(ano, mes);
    if (!d.tem_dados) { log.push(`${MESES[mes - 1]}/${ano}: sem dados no painel`); continue; }
    const partes = [];
    try { partes.push(escreverUnidade_(d)); } catch (e) { partes.push(`Unidade: erro ${e.message}`); }
    try { partes.push(escreverProfissionais_(d)); } catch (e) { partes.push(`Profissionais: erro ${e.message}`); }
    try { partes.push(escreverGrafico_(d)); } catch (e) { partes.push(`Gráfico: erro ${e.message}`); }
    log.push(`${MESES[mes - 1]}/${ano}: ${partes.join(' · ')}`);
  }
  console.log(log.join('\n'));
  aviso_(log.join('\n') || 'Nada para atualizar.');
  return log;
}

function buscar_(ano, mes) {
  const token = PropertiesService.getScriptProperties().getProperty('IMPORT_TOKEN');
  if (!token) throw new Error('Falta a propriedade IMPORT_TOKEN (Configurações do projeto → Propriedades do script).');
  const r = UrlFetchApp.fetch(`${CONFIG.PAINEL_URL}/api/robo/planilha?ano=${ano}&mes=${mes}`, { headers: { 'X-Import-Token': token }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error(`Painel respondeu ${r.getResponseCode()}: ${r.getContentText().slice(0, 200)}`);
  return JSON.parse(r.getContentText());
}

// ---------------------------------------------------------------- ajudantes
const norm_ = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
const num_ = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
function aviso_(t) { try { SpreadsheetApp.getActive().toast(t.slice(0, 250), 'Painel Pátria', 8); } catch (e) { /* rodando pelo agendamento */ } }

/** Escreve só se o valor existir e a célula não tiver fórmula. */
function por_(sheet, linha, coluna, valor) {
  if (valor === null || valor === undefined) return false;
  const c = sheet.getRange(linha, coluna);
  if (c.getFormula()) return false;
  c.setValue(valor);
  return true;
}
function linhaDoMes_(sheet, mes, coluna) {
  const vals = sheet.getRange(1, coluna, sheet.getLastRow(), 1).getValues();
  const alvo = norm_(MESES[mes - 1]);
  for (let i = 0; i < vals.length; i++) if (norm_(vals[i][0]) === alvo) return i + 1;
  return null;
}

// ---------------------------------------------------------------- Análise de Unidade
function escreverUnidade_(d) {
  const ss = SpreadsheetApp.openById(CONFIG.UNIDADE_ID);
  const u = d.unidade; let n = 0;
  const bar = ss.getSheetByName('Indic. Barbearia');
  const lb = bar && linhaDoMes_(bar, d.mes, 2);
  if (lb) {
    const ticket = u.clientes_atendidos ? Math.round((u.faturamento_total / u.clientes_atendidos) * 100) / 100 : null;
    // C total · D assinatura · E avulso · F produtos · G ticket · H assinantes · I avulsos · J atendidos · K serviços · M extras · N novos
    const cols = { 3: u.faturamento_total, 4: u.faturamento_assinatura, 5: u.faturamento_avulso, 6: u.faturamento_produtos, 7: ticket,
      8: num_(u.assinantes), 9: num_(u.clientes_avulsos), 10: num_(u.clientes_atendidos), 11: num_(u.servicos_realizados), 13: num_(u.servicos_extras), 14: num_(u.clientes_novos) };
    for (const [c, v] of Object.entries(cols)) if (por_(bar, lb, Number(c), v)) n++;
  }
  const ass = ss.getSheetByName('Indic. Assinatura');
  const la = ass && linhaDoMes_(ass, d.mes, 2);
  if (la) {
    const base = num_(u.assinantes);
    // C faturamento · D assinantes · E novos · F cancelamentos · H frequência · I ticket
    const cols = { 3: u.faturamento_assinatura, 4: base, 5: num_(u.novos_assinantes), 6: num_(u.cancelamentos),
      8: base && num_(u.atendimentos_clube) != null ? Math.round((u.atendimentos_clube / base) * 100) / 100 : null,
      9: base ? Math.round((u.faturamento_assinatura / base) * 100) / 100 : null };
    for (const [c, v] of Object.entries(cols)) if (por_(ass, la, Number(c), v)) n++;
  }
  return `Unidade: ${n} células`;
}

// ---------------------------------------------------------------- Análise de Profissionais (aba Geral)
function escreverProfissionais_(d) {
  const ss = SpreadsheetApp.openById(CONFIG.PROFISSIONAIS_ID);
  const g = ss.getSheetByName('Geral');
  const titulo = linhaDoMes_(g, d.mes, 4); // coluna D: "SETEMBRO"
  if (!titulo) return 'Profissionais: bloco do mês não encontrado';
  const primeira = titulo + 3; // 8 linhas de profissionais
  // ordem fixa = nomes das abas Prof. 1..8 (célula D2), para as abas individuais continuarem certas
  const ordem = [];
  for (let i = 1; i <= 8; i++) { const sh = ss.getSheetByName(`Prof. ${i}`); ordem.push(sh ? norm_(sh.getRange('D2').getValue()).split(' ')[0] : ''); }
  const pros = (d.profissionais || []).filter((p) => num_(p.faturamento_total));
  const usados = new Set(); const linhas = {};
  ordem.forEach((nome, i) => { const p = pros.find((x) => nome && norm_(x.nome).split(' ')[0] === nome); if (p) { linhas[i] = p; usados.add(p); } });
  for (const p of pros) if (!usados.has(p)) { const livre = [...Array(8).keys()].find((i) => !linhas[i] && !ordem[i]); if (livre !== undefined) { linhas[livre] = p; usados.add(p); } }
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const p = linhas[i]; if (!p) continue;
    const r = primeira + i;
    const nomeAtual = String(g.getRange(r, 2).getValue());
    if (/^prof\.?\s*\d+$/i.test(nomeAtual.trim())) {
      // linha ainda com valores de modelo: limpa C:W (sem fórmulas) antes de escrever
      for (let c = 3; c <= 23; c++) { const cel = g.getRange(r, c); if (!cel.getFormula()) cel.clearContent(); }
      por_(g, r, 2, p.nome);
    }
    // C faturamento · F ticket · G clientes atendidos · H geração de demanda
    for (const [c, v] of Object.entries({ 3: num_(p.faturamento_total), 6: num_(p.ticket_medio), 7: num_(p.clientes_atendidos), 8: num_(p.geracao_demanda) })) if (por_(g, r, Number(c), v)) n++;
  }
  return `Profissionais: ${n} células`;
}

// ---------------------------------------------------------------- Gráfico de resultados SVA (aba do mês)
function escreverGrafico_(d) {
  const ss = SpreadsheetApp.openById(CONFIG.GRAFICO_ID);
  const sh = ss.getSheets().find((s) => norm_(s.getName()) === norm_(MESES[d.mes - 1]));
  if (!sh) return 'Gráfico: aba do mês não encontrada';
  const porDia = {}; for (const x of d.diario) porDia[Number(x.date.slice(8, 10))] = x;
  const datas = sh.getRange('T4:T34').getValues();
  let n = 0;
  datas.forEach(([v], i) => {
    const r = 4 + i;
    let dia = null;
    if (v instanceof Date) { if (v.getMonth() + 1 === d.mes) dia = v.getDate(); }
    else { const m = String(v).match(/^(\d{1,2})\/(\d{1,2})/); if (m && Number(m[2]) === d.mes) dia = Number(m[1]); }
    if (!dia) return;
    const x = porDia[dia];
    // V serviços (avulsos + extras) · W produtos · X novas assinaturas · Z recorrência · AA status — Y (SVA) e AB (total) são fórmulas
    const vals = x
      ? { 22: (num_(x.servicos) || 0) + (num_(x.sva) || 0), 23: num_(x.produtos) || 0, 24: num_(x.novas_assinaturas) || 0, 26: num_(x.recorrencia) || 0, 27: 'REALIZADO' }
      : (dia < new Date().getDate() || d.mes !== new Date().getMonth() + 1 ? { 22: 0, 23: 0, 24: 0, 26: 0 } : null); // dia sem movimento já passado: zera o modelo
    if (!vals) return;
    for (const [c, val] of Object.entries(vals)) if (por_(sh, r, Number(c), val)) n++;
  });
  return `Gráfico: ${n} células`;
}
