// Robô do CashBarber → Painel Pátria
// Entra no CashBarber com o usuário do robô, exporta os relatórios do mês e envia para POST /api/robo/importar.
//
// Variáveis:
//   CASHBARBER_EMAIL, CASHBARBER_PASSWORD   login do usuário "Robô Painel" (só leitura de relatórios)
//   CASHBARBER_URL                          endereço do sistema (padrão: https://painel.cashbarber.com.br)
//   PAINEL_URL, IMPORT_TOKEN                painel na Vercel e o token cadastrado lá
//   MODO      sincronizar (padrão) | testar (exporta e confere, sem enviar) | mapear (só levanta as páginas)
//   MES       AAAA-MM para forçar um mês (padrão: mês corrente; no dia 1º também o mês anterior)
//
// O repositório é público: este script NUNCA imprime nem salva dados de clientes. Os logs mostram só nomes de
// relatórios, cabeçalhos de colunas e contagem de linhas; o mapa (modo mapear) guarda só a estrutura das páginas.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = process.env.SAIDA || path.join(DIR, 'saida');
const BASE = (process.env.CASHBARBER_URL || 'https://painel.cashbarber.com.br').replace(/\/+$/, '');
const MODO = (process.env.MODO || 'sincronizar').toLowerCase();
const CONFIG = JSON.parse(fs.readFileSync(path.join(DIR, 'relatorios.json'), 'utf8')).relatorios;
const TZ = 'America/Sao_Paulo';

fs.mkdirSync(SAIDA, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const pad = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------- período
function hojeBrasilia() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { ano: Number(p.year), mes: Number(p.month), dia: Number(p.day) };
}
function mesesParaImportar() {
  if (process.env.MES) {
    const [ano, mes] = process.env.MES.split('-').map(Number);
    if (!ano || !mes || mes > 12) throw new Error(`MES inválido: ${process.env.MES} (use AAAA-MM)`);
    return [{ ano, mes }];
  }
  const h = hojeBrasilia();
  const lista = [{ ano: h.ano, mes: h.mes }];
  if (h.dia === 1) lista.unshift(h.mes === 1 ? { ano: h.ano - 1, mes: 12 } : { ano: h.ano, mes: h.mes - 1 });
  return lista;
}
function periodo({ ano, mes }) {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return {
    deIso: `${ano}-${pad(mes)}-01`, ateIso: `${ano}-${pad(mes)}-${pad(ultimo)}`,
    deBr: `01/${pad(mes)}/${ano}`, ateBr: `${pad(ultimo)}/${pad(mes)}/${ano}`,
  };
}

// ---------------------------------------------------------------- login
async function entrar(page) {
  const email = process.env.CASHBARBER_EMAIL; const senha = process.env.CASHBARBER_PASSWORD;
  if (!email || !senha) throw new Error('Faltam CASHBARBER_EMAIL e/ou CASHBARBER_PASSWORD.');
  log(`Abrindo ${BASE}`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const campoSenha = page.locator('input[type="password"]:visible').first();
  await campoSenha.waitFor({ timeout: 30000 }).catch(() => { throw new Error('Não achei a tela de login do CashBarber.'); });
  // procura o campo de e-mail e o botão dentro do mesmo formulário da senha
  const form = page.locator('form').filter({ has: campoSenha }).first();
  const escopo = (await form.count()) ? form : page;
  const campoEmail = escopo.locator([
    'input[type="email"]:visible', 'input[name*="mail" i]:visible', 'input[id*="mail" i]:visible',
    'input[name*="login" i]:visible', 'input[name*="usuario" i]:visible', 'input[name*="user" i]:visible', 'input[type="text"]:visible',
  ].join(', ')).first();
  await campoEmail.click();
  await campoEmail.fill('');
  await campoEmail.pressSequentially(email.trim(), { delay: 20 });
  await campoSenha.click();
  await campoSenha.fill('');
  await campoSenha.pressSequentially(senha, { delay: 20 });
  const botao = escopo.locator('button[type="submit"]:visible, input[type="submit"]:visible')
    .or(escopo.getByRole('button', { name: /entrar|acessar|login|logar/i })).first();
  // alguns formulários só liberam o botão depois que o campo perde o foco
  await campoSenha.press('Tab').catch(() => {});
  await page.waitForTimeout(500);
  let enviado = false;
  if (await botao.count()) {
    enviado = await botao.click({ timeout: 10000 }).then(() => true).catch(() => false);
  }
  if (!enviado) {
    const desativado = await botao.isDisabled().catch(() => null);
    if (desativado) log('Botão de entrar continua desativado; tentando com Enter.');
    await campoSenha.press('Enter').catch(() => {});
  }
  // espera sair da tela de login (até 25 s)
  await page.waitForFunction(() => ![...document.querySelectorAll('input[type="password"]')]
    .some((e) => e.offsetWidth || e.offsetHeight), null, { timeout: 25000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const aindaNoLogin = await page.locator('input[type="password"]:visible').count();
  const texto = norm(await page.locator('body').innerText().catch(() => ''));
  if (aindaNoLogin) {
    // diagnóstico sem dados pessoais: endereço, campos do formulário e mensagens de aviso da tela
    const diag = await page.evaluate(() => {
      const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
      return {
        campos: [...document.querySelectorAll('input')].filter(vis).map((e) => `${e.type}:${e.name || e.id || '?'}`),
        botoes: [...document.querySelectorAll('button, input[type="submit"]')].filter(vis).map((e) => `${(e.innerText || e.value || '').trim()}${e.disabled ? ' (desativado)' : ''}`).filter((t) => t.trim() && t !== ' (desativado)'),
        avisos: [...document.querySelectorAll('.alert, .error, .erro, .invalid-feedback, .text-danger, .help-block, [role="alert"], .toast, .swal2-popup, .notification')]
          .filter(vis).map((e) => e.innerText.trim()).filter(Boolean).slice(0, 5),
        textoDoFormulario: (document.querySelector('input[type="password"]')?.closest('form, .card, .login, main, body')?.innerText || '')
          .split('\n').map((t) => t.trim()).filter((t) => t && t.length < 100).slice(0, 8),
      };
    });
    log(`Tela de login: ${new URL(page.url()).pathname} · campos ${diag.campos.join(', ')} · botões ${diag.botoes.join(', ')}`);
    if (!diag.avisos.length) diag.avisos = diag.textoDoFormulario;
    log(`Aviso do CashBarber: ${diag.avisos.join(' | ').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail]') || '(nenhuma mensagem visível)'}`);
  }
  if (/captcha|nao sou um robo|recaptcha/.test(texto) || await page.locator('iframe[src*="captcha"]').count()) {
    throw new Error('O CashBarber pediu captcha no login. O robô não resolve captcha; use a importação manual.');
  }
  if (/codigo de (verificacao|seguranca|acesso)|enviamos um codigo|autenticacao em dois/.test(texto)) {
    throw new Error('O CashBarber pediu código de verificação (SMS/e-mail). Desative a verificação para o usuário do robô.');
  }
  if (aindaNoLogin) throw new Error('Login recusado: confira CASHBARBER_EMAIL e CASHBARBER_PASSWORD.');
  log(`Login ok → ${new URL(page.url()).pathname}`);
}

// ---------------------------------------------------------------- descobrir páginas de relatório
async function tituloDaPagina(page) {
  return page.evaluate(() => {
    const fora = (el) => !el.closest('nav, aside, header, .sidebar, .menu, .navbar, [class*="sidebar"], [class*="menu"]');
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const els = [...document.querySelectorAll('h1, h2, h3, h4, .page-title, .card-title, .breadcrumb .active, .breadcrumb li:last-child')]
      .filter((el) => fora(el) && vis(el)).map((el) => el.innerText.trim()).filter((t) => t && t.length < 120);
    return [...new Set(els)].slice(0, 4).join(' | ') || document.title;
  });
}

// links de relatório: pelo endereço (relatorio…) ou pelo texto (nome de um dos relatórios da configuração)
const NOMES = [...new Set(CONFIG.flatMap((c) => c.nomes).map(norm))];
async function linksDeRelatorio(page) {
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
    .map((a) => ({ href: a.getAttribute('href'), texto: (a.innerText || a.textContent || a.title || '').replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.href && !/^(javascript|#|mailto|tel)/i.test(l.href)));
  return links.filter((l) => /relat|report/i.test(l.href) || NOMES.some((n) => norm(l.texto) === n || norm(l.texto).includes(n)));
}

async function catalogo(page) {
  const vistos = new Map(); // caminho → { url, nomes:Set, titulo }
  const add = (href, texto) => {
    let u; try { u = new URL(href, BASE); } catch { return; }
    if (u.origin !== new URL(BASE).origin) return;
    if (!/\/relatorio/i.test(u.pathname)) return; // só páginas de relatório (nada de telas de cadastro/alteração)
    const key = u.pathname + u.search;
    if (!vistos.has(key)) vistos.set(key, { url: key, nomes: new Set(), titulo: '' });
    if (texto) vistos.get(key).nomes.add(texto);
  };
  for (const l of await linksDeRelatorio(page)) add(l.href, l.texto);
  // páginas-índice de relatórios costumam listar todos
  for (const idx of ['/relatorio', '/relatorios']) {
    const r = await page.goto(BASE + idx, { waitUntil: 'domcontentloaded' }).catch(() => null);
    if (r && r.ok()) for (const l of await linksDeRelatorio(page)) add(l.href, l.texto);
  }
  // padrão conhecido do CashBarber: /relatorio/relatorioN
  if (!vistos.size) for (let n = 1; n <= 40; n++) add(`/relatorio/relatorio${pad(n)}`, '');
  const lista = [];
  for (const item of vistos.values()) {
    const r = await page.goto(BASE + item.url, { waitUntil: 'domcontentloaded' }).catch(() => null);
    if (!r || r.status() >= 400 || await page.locator('input[type="password"]:visible').count()) continue;
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    item.titulo = await tituloDaPagina(page);
    const pagina = { url: new URL(page.url()).pathname + new URL(page.url()).search, pedido: item.url, nomes: [...item.nomes], titulo: item.titulo };
    if (MODO === 'mapear') {
      Object.assign(pagina, await estrutura(page));
      const datas = pagina.campos.filter((c) => c.type === 'date' || /data|date|inicio|fim|periodo/i.test(`${c.name} ${c.id} ${c.placeholder}`)).length;
      log(`  ${pagina.url} · ${[...item.nomes][0] || ''} · ${item.titulo} · ${datas} campo(s) de data · botões: ${pagina.botoes.slice(0, 12).join(', ')}`);
    }
    lista.push(pagina);
  }
  log(`Páginas de relatório encontradas: ${lista.length}`);
  return lista;
}

// liga cada relatório da configuração a uma página (pela URL fixa ou pelo nome)
function casar(config, paginas) {
  const pares = [];
  for (const c of config) {
    if (c.url) { pares.push({ chave: c.chave, url: c.url, score: 1e9 }); continue; }
    for (const p of paginas) {
      const textos = [...p.nomes, ...p.titulo.split(' | ')].map(norm).filter(Boolean);
      let melhor = 0;
      for (const nome of c.nomes.map(norm)) {
        for (const t of textos) {
          if (t === nome || t === `relatorio de ${nome}`) melhor = Math.max(melhor, 1000 + nome.length);
          else if (new RegExp(`\\b${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)) melhor = Math.max(melhor, nome.length * 10 - t.length);
        }
      }
      if (melhor > 0) pares.push({ chave: c.chave, url: p.url, score: melhor });
    }
  }
  pares.sort((a, b) => b.score - a.score);
  const mapa = {}; const usadas = new Set();
  for (const p of pares) if (!mapa[p.chave] && !usadas.has(p.url)) { mapa[p.chave] = p.url; usadas.add(p.url); }
  return mapa;
}

// ---------------------------------------------------------------- filtro de datas
async function definirPeriodo(page, per) {
  const feito = await page.evaluate((per) => {
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const set = (el, v) => {
      const proto = Object.getPrototypeOf(el); const d = Object.getOwnPropertyDescriptor(proto, 'value');
      el.removeAttribute('readonly'); d.set.call(el, v);
      for (const ev of ['input', 'change', 'blur']) el.dispatchEvent(new Event(ev, { bubbles: true }));
      if (window.jQuery) { try { window.jQuery(el).trigger('change'); } catch {} }
    };
    const inputs = [...document.querySelectorAll('input')].filter((el) => vis(el) || el.type === 'date');
    const datas = inputs.filter((el) => el.type === 'date');
    if (datas.length >= 2) { set(datas[0], per.deIso); set(datas[1], per.ateIso); return 'campos de data (AAAA-MM-DD)'; }
    const desc = (el) => `${el.name} ${el.id} ${el.placeholder} ${el.className} ${el.getAttribute('data-mask') || ''}`.toLowerCase();
    const textos = inputs.filter((el) => ['text', 'search', ''].includes(el.type) && vis(el)
      && /data|date|inicio|início|fim|final|periodo|período|dd\/mm|range|calend/.test(desc(el)));
    const range = textos.find((el) => /range|periodo|período/.test(desc(el)) || / - /.test(el.value) || / - /.test(el.placeholder));
    if (range) { set(range, `${per.deBr} - ${per.ateBr}`); return 'campo de período (DD/MM/AAAA - DD/MM/AAAA)'; }
    if (textos.length >= 2) { set(textos[0], per.deBr); set(textos[1], per.ateBr); return 'campos de data (DD/MM/AAAA)'; }
    if (textos.length === 1) { set(textos[0], `${per.deBr} - ${per.ateBr}`); return 'campo único de data (intervalo)'; }
    return null;
  }, per);
  await page.keyboard.press('Escape').catch(() => {});
  if (feito) {
    const filtrar = page.locator('button:visible, input[type="submit"]:visible, a.btn:visible')
      .filter({ hasText: /^\s*(filtrar|buscar|pesquisar|gerar|aplicar|consultar|atualizar|ok)\s*$/i }).first();
    if (await filtrar.count()) {
      await filtrar.click().catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
  }
  return feito;
}

// ---------------------------------------------------------------- exportação
const RE_EXPORT = /exportar|export|csv|excel|xlsx|\bxls\b|planilha|baixar|download/i;

async function tentarDownload(page, alvo, ms = 15000) {
  const espera = page.waitForEvent('download', { timeout: ms }).catch(() => null);
  await alvo.click({ timeout: 5000 }).catch(() => {});
  return espera;
}

async function exportar(page) {
  const sel = 'button, a, [role="button"], input[type="button"], input[type="submit"], .dt-button, li a';
  const candidatos = page.locator(sel).filter({ visible: true });
  const n = await candidatos.count();
  const lista = [];
  for (let i = 0; i < n; i++) {
    const el = candidatos.nth(i);
    const t = `${await el.innerText().catch(() => '')} ${await el.getAttribute('title').catch(() => '')} ${await el.getAttribute('aria-label').catch(() => '')} ${await el.getAttribute('value').catch(() => '')}`;
    if (RE_EXPORT.test(t) && !/importar|excluir|apagar|deletar|remover|cancelar|enviar/i.test(t)) lista.push({ el, csv: /csv/i.test(t) ? 2 : /excel|xls/i.test(t) ? 1 : 0 });
  }
  lista.sort((a, b) => b.csv - a.csv);
  for (const { el } of lista) {
    let d = await tentarDownload(page, el);
    if (!d) {
      // o botão pode ter aberto um menu com as opções
      for (const re of [/csv/i, /excel|xlsx|xls/i]) {
        const opc = page.locator(sel).filter({ visible: true, hasText: re }).first();
        if (await opc.count()) { d = await tentarDownload(page, opc); if (d) break; }
      }
    }
    if (d) {
      const destino = path.join(SAIDA, `tmp-${Date.now()}-${d.suggestedFilename()}`);
      await d.saveAs(destino);
      const buf = fs.readFileSync(destino); fs.rmSync(destino);
      return { origem: 'download', arquivo: d.suggestedFilename(), csv: await paraCsv(buf, d.suggestedFilename()) };
    }
  }
  // último recurso: ler a maior tabela da tela
  const csv = await tabelaDaTela(page);
  return csv ? { origem: 'tabela da tela', arquivo: 'tabela.csv', csv } : null;
}

async function tabelaDaTela(page) {
  // DataTables: mostrar todas as linhas
  const tamanho = page.locator('select[name$="_length"]:visible').first();
  if (await tamanho.count()) {
    const valores = await tamanho.locator('option').evaluateAll((os) => os.map((o) => o.value));
    const maior = valores.includes('-1') ? '-1' : valores.sort((a, b) => Number(b) - Number(a))[0];
    if (maior) { await tamanho.selectOption(maior).catch(() => {}); await page.waitForTimeout(1500); }
  }
  return page.evaluate(() => {
    const tabs = [...document.querySelectorAll('table')].map((t) => ({ t, n: t.querySelectorAll('tbody tr').length })).sort((a, b) => b.n - a.n);
    if (!tabs.length) return null;
    const t = tabs[0].t;
    const cab = [...(t.querySelector('thead tr:last-child') || t.querySelector('tr')).querySelectorAll('th, td')].map((c) => c.innerText.trim());
    if (cab.length < 3) return null;
    const linhas = [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((c) => c.innerText.trim()))
      .filter((r) => r.length === cab.length);
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    return [cab, ...linhas].map((r) => r.map(q).join(';')).join('\n');
  });
}

async function paraCsv(buf, nome) {
  if (/\.(xlsx|xls|ods)$/i.test(nome) || (buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
    const sh = wb.Sheets[wb.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json(sh, { header: 1, raw: false, defval: '' });
    // pula linhas de título acima do cabeçalho
    const ini = Math.max(0, linhas.findIndex((r) => r.filter((v) => String(v).trim()).length >= 3));
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    return linhas.slice(ini).map((r) => r.map(q).join(';')).join('\n');
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}

// cabeçalho e nº de linhas, só para o log (sem dados)
function resumoCsv(csv) {
  const linhas = csv.split(/\r?\n/).filter((l) => l.trim());
  const cab = (linhas[0] || '').replace(/^﻿/, '').split(/[;,](?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/"/g, '').trim()).slice(0, 8);
  return `${linhas.length - 1} linhas · colunas: ${cab.join(', ')}${cab.length === 8 ? '…' : ''}`;
}

// ---------------------------------------------------------------- envio ao painel
async function enviar(mes, files) {
  const url = (process.env.PAINEL_URL || '').replace(/\/+$/, '');
  if (!url || !process.env.IMPORT_TOKEN) throw new Error('Faltam PAINEL_URL e/ou IMPORT_TOKEN.');
  const corpo = JSON.stringify({ ano: mes.ano, mes: mes.mes, files });
  if (corpo.length > 4 * 1024 * 1024) throw new Error(`Os relatórios somam ${(corpo.length / 1048576).toFixed(1)} MB; o painel aceita até 4 MB por envio.`);
  const r = await fetch(`${url}/api/robo/importar`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-import-token': process.env.IMPORT_TOKEN }, body: corpo,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Painel respondeu ${r.status}: ${json.error || 'erro sem mensagem'}`);
  return json;
}

// ---------------------------------------------------------------- mapa (modo mapear)
async function estrutura(page) {
  return page.evaluate(() => {
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return {
      campos: [...document.querySelectorAll('input, select')].filter(vis).filter((e) => e.type !== 'hidden' && e.type !== 'password')
        .map((e) => ({ tag: e.tagName.toLowerCase(), type: e.type, name: e.name, id: e.id, placeholder: e.placeholder, classe: e.className })),
      botoes: [...new Set([...document.querySelectorAll('button, a.btn, [role="button"], input[type="submit"], .dt-button')].filter(vis)
        .map((e) => (e.innerText || e.value || e.title || '').trim()).filter((t) => t && t.length < 60))],
      colunas: [...document.querySelectorAll('table thead th')].map((th) => th.innerText.trim()).filter(Boolean).slice(0, 30),
    };
  });
}

// ---------------------------------------------------------------- principal
async function main() {
  log(`Modo: ${MODO}`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'pt-BR', timezoneId: TZ, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('dialog', (d) => d.dismiss().catch(() => {})); // nunca confirma diálogos (exclusões etc.)
  const relatorioFinal = { quando: new Date().toISOString(), modo: MODO, meses: [], erros: [] };
  try {
    await entrar(page);
    const precisaDescobrir = MODO === 'mapear' || CONFIG.some((c) => !c.url);
    const paginas = precisaDescobrir ? await catalogo(page) : [];
    const mapa = casar(CONFIG, paginas);
    for (const c of CONFIG) log(`  ${c.chave.padEnd(14)} → ${mapa[c.chave] || 'NÃO ENCONTRADO'}`);

    if (MODO === 'mapear') {
      const detalhes = {};
      for (const [chave, url] of Object.entries(mapa)) {
        await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        detalhes[chave] = { url, titulo: await tituloDaPagina(page), ...(await estrutura(page)) };
      }
      fs.writeFileSync(path.join(SAIDA, 'mapa.json'), JSON.stringify({ base: BASE, paginas, escolhidos: mapa, detalhes }, null, 2));
      log('Mapa salvo em mapa.json (só estrutura das páginas, sem dados).');
      return;
    }

    for (const mes of mesesParaImportar()) {
      const per = periodo(mes);
      log(`== ${pad(mes.mes)}/${mes.ano} (${per.deBr} a ${per.ateBr})`);
      const files = []; const resumo = { mes: `${mes.ano}-${pad(mes.mes)}`, relatorios: {} };
      for (const c of CONFIG) {
        const url = mapa[c.chave];
        if (!url) { resumo.relatorios[c.chave] = 'página não encontrada'; continue; }
        try {
          await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          if (c.periodo) {
            const como = await definirPeriodo(page, per);
            if (!como) throw new Error('não achei o filtro de datas');
            log(`  ${c.chave}: período por ${como}`);
          }
          const ex = await exportar(page);
          if (!ex || !ex.csv?.trim()) {
            const { botoes } = await estrutura(page);
            throw new Error(`não consegui exportar · botões na tela: ${botoes.slice(0, 15).join(', ') || '(nenhum)'}`);
          }
          log(`  ${c.chave}: ${ex.origem} (${ex.arquivo}) · ${resumoCsv(ex.csv)}`);
          files.push({ name: `${c.chave}.csv`, text: ex.csv });
          resumo.relatorios[c.chave] = `ok · ${ex.origem}`;
        } catch (e) {
          resumo.relatorios[c.chave] = `erro: ${e.message}`;
          log(`  ${c.chave}: ERRO — ${e.message}`);
          if (c.obrigatorio) relatorioFinal.erros.push(`${resumo.mes} ${c.chave}: ${e.message}`);
        }
      }
      const faltaObrigatorio = CONFIG.some((c) => c.obrigatorio && !files.find((f) => f.name === `${c.chave}.csv`));
      if (MODO === 'testar') resumo.envio = 'modo testar: nada enviado';
      else if (faltaObrigatorio) resumo.envio = 'não enviado: faltou relatório obrigatório';
      else if (files.length) {
        try {
          const r = await enviar(mes, files);
          resumo.envio = { reconhecidos: r.relatorios, ignorados: r.ignorados };
          log(`  Painel importou: ${(r.relatorios || []).join(', ')}${r.ignorados?.length ? ` · ignorados: ${r.ignorados.join(', ')}` : ''}`);
        } catch (e) { resumo.envio = `erro: ${e.message}`; relatorioFinal.erros.push(`${resumo.mes} envio: ${e.message}`); log(`  ENVIO FALHOU — ${e.message}`); }
      }
      relatorioFinal.meses.push(resumo);
    }
  } catch (e) {
    relatorioFinal.erros.push(e.message);
    log(`FALHA — ${e.message}`);
  } finally {
    fs.writeFileSync(path.join(SAIDA, 'resultado.json'), JSON.stringify(relatorioFinal, null, 2));
    await browser.close();
  }
  if (relatorioFinal.erros.length) { console.error(`\n${relatorioFinal.erros.length} erro(s):\n- ${relatorioFinal.erros.join('\n- ')}`); process.exit(1); }
  log('Concluído.');
}

main();
