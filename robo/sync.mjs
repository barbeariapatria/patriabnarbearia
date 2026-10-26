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
const CONF = JSON.parse(fs.readFileSync(path.join(DIR, 'relatorios.json'), 'utf8'));
const PAGINAS = CONF.paginas;
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
  const h = hojeBrasilia();
  const corrente = h.ano === ano && h.mes === mes;
  const anterior = (h.mes === 1 ? h.ano - 1 === ano && mes === 12 : h.ano === ano && h.mes - 1 === mes);
  const ultimo = corrente ? h.dia : new Date(Date.UTC(ano, mes, 0)).getUTCDate(); // o CashBarber não aceita data futura
  return {
    atalho: corrente ? 'Mês atual' : anterior ? 'Mês passado' : null,
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
const NOMES = [];
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
    if (MODO !== 'mapear') log(`  ${pagina.url} · ${[...item.nomes][0] || ''} · ${item.titulo}`);
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

// ---------------------------------------------------------------- filtro de datas
// preenche os campos de data visíveis (na tela ou na janela do filtro); devolve como fez ou null
async function preencherDatas(page, per) {
  return page.evaluate((per) => {
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const set = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      el.removeAttribute('readonly'); el.focus(); d.set.call(el, v);
      for (const ev of ['input', 'change', 'blur']) el.dispatchEvent(new Event(ev, { bubbles: true }));
      if (window.jQuery) { try { window.jQuery(el).trigger('change'); } catch {} }
    };
    const inputs = [...document.querySelectorAll('input')].filter(vis);
    const datas = inputs.filter((el) => el.type === 'date');
    if (datas.length >= 2) { set(datas[0], per.deIso); set(datas[1], per.ateIso); return 'campos de data (AAAA-MM-DD)'; }
    const desc = (el) => `${el.name} ${el.id} ${el.placeholder} ${el.className} ${el.getAttribute('data-mask') || ''}`.toLowerCase();
    const textos = inputs.filter((el) => ['text', 'search', 'tel', ''].includes(el.type)
      && (/data|date|inicio|início|fim|final|periodo|período|dd\/mm|range|calend/.test(desc(el)) || /^\d{2}\/\d{2}\/\d{4}/.test(el.value)));
    const range = textos.find((el) => /range|periodo|período/.test(desc(el)) || / - /.test(el.value) || / - /.test(el.placeholder));
    if (range) { set(range, `${per.deBr} - ${per.ateBr}`); return 'campo de período (DD/MM/AAAA - DD/MM/AAAA)'; }
    if (textos.length >= 2) { set(textos[0], per.deBr); set(textos[1], per.ateBr); return 'campos de data (DD/MM/AAAA)'; }
    if (textos.length === 1) { set(textos[0], `${per.deBr} - ${per.ateBr}`); return 'campo único de data (intervalo)'; }
    return null;
  }, per);
}

// No CashBarber: clicar no filtro de data, escolher o período e, na janela que abre, baixar o CSV.
async function definirPeriodo(page, per) {
  if (per.atalho) {
    const b = (await clicaveis(page)).find((c) => norm(c.texto) === norm(per.atalho));
    if (b) {
      await alvo(page, b.i).click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      return `atalho "${per.atalho}"`;
    }
  }
  let feito = await preencherDatas(page, per);
  if (!feito) {
    // abre o filtro de data (botão com "filtro", "data", "período" ou com uma data escrita)
    const alvos = page.locator('button, a, [role="button"], .btn').filter({ visible: true });
    const n = await alvos.count();
    for (let i = 0; i < n && !feito; i++) {
      const el = alvos.nth(i);
      const info = await el.evaluate((e) => ({
        t: `${e.innerText || ''} ${e.title || ''} ${e.getAttribute('aria-label') || ''}`.replace(/\s+/g, ' ').trim(),
        menu: !!e.closest('nav, aside, .aside, #kt_aside, .sidebar, .menu, header'),
      })).catch(() => null);
      if (!info || info.menu || info.t.length > 60) continue;
      if (!/filtr|\bdata\b|per[ií]odo|calend|\d{2}\/\d{2}\/\d{4}/i.test(info.t) || /excluir|apagar|remover|limpar/i.test(info.t)) continue;
      await el.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
      feito = await preencherDatas(page, per);
      if (feito) feito += ` após clicar em "${info.t}"`;
    }
  }
  if (!feito) feito = await abrirFiltro(page, per); // filtro aberto por um ícone (funil, calendário)
  await page.keyboard.press('Tab').catch(() => {}); // fecha o calendário sem fechar a janela do filtro
  await page.waitForTimeout(500);
  return feito;
}

// lê e fecha o aviso do CashBarber (SweetAlert), se houver; devolve o texto (e-mails mascarados)
async function lerAviso(page) {
  const pop = page.locator('.swal2-popup:visible').first();
  if (!(await pop.count())) return null;
  const texto = (await pop.locator('.swal2-title, .swal2-html-container, .swal2-content').allInnerTexts().catch(() => []))
    .join(' — ').replace(/\s+/g, ' ').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail]').trim().slice(0, 200);
  const ok = pop.locator('.swal2-confirm:visible').first();
  if (/csv|export|baixar|download|planilha/i.test(texto) && (await ok.count())) {
    const d = await tentarDownload(page, ok);
    if (d) return { texto, download: await salvarDownload(d) };
  }
  if ((await ok.count()) && /^\s*ok\s*$/i.test(await ok.innerText().catch(() => ''))) await ok.click().catch(() => {});
  else await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  return { texto };
}

// Escolhe a filial nos filtros do relatório. Vazio, o CashBarber entende "todas as filiais" e o usuário do robô
// recebe "Você não possui acesso a todas as filiais". Acha o campo pelo rótulo "Filial"/"Unidade" e escolhe a opção
// da Pátria (CASHBARBER_FILIAL muda o nome procurado) ou a única opção real. Nunca mexe em profissional, cliente etc.
const RE_PATRIA = new RegExp(process.env.CASHBARBER_FILIAL || 'village|rio das ostras|p[aá]tria', 'i');
const RE_OPCAO_GERAL = /^(todas?|todos|selecione|nenhum|--)/i;
async function escolherFilial(page) {
  const campos = await page.evaluate(() => {
    document.querySelectorAll('[data-robo-filial]').forEach((e) => e.removeAttribute('data-robo-filial'));
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    return [...document.querySelectorAll('label')].filter((l) => vis(l) && /^\s*(filial|filiais|unidade|unidades)\s*\*?\s*$/i.test(l.innerText))
      .map((l, i) => {
        let box = l.closest('.form-group, .MuiFormControl-root, .col, [class*="col-"]') || l.parentElement;
        if (box && !box.querySelector('select, input, [role="combobox"]')) box = box.parentElement;
        if (!box) return null;
        box.setAttribute('data-robo-filial', String(i));
        const sel = box.querySelector('select');
        return {
          i, select: sel ? { multiplo: sel.multiple, atual: [...sel.selectedOptions].map((o) => o.text.trim()).join(', '), opcoes: [...sel.options].map((o) => ({ v: o.value, t: o.text.trim() })) } : null,
          texto: (box.querySelector('input')?.value || box.querySelector('[class*="singleValue"], [class*="multiValue"], .select2-selection__rendered, .MuiChip-label')?.innerText || '').trim(),
        };
      }).filter(Boolean);
  });
  const feitos = [];
  for (const c of campos) {
    const box = page.locator(`[data-robo-filial="${c.i}"]`);
    const escolher = (lista) => {
      const reais = lista.filter((o) => o.t && !RE_OPCAO_GERAL.test(o.t));
      return reais.find((o) => RE_PATRIA.test(o.t)) || (reais.length === 1 ? reais[0] : null);
    };
    if (c.select) {
      // <select> comum, select2 ou bootstrap-select (o <select> fica escondido)
      const op = escolher(c.select.opcoes.filter((o) => o.v !== ''));
      if (!op) { log(`  (filial: ${c.select.opcoes.length} opções e nenhuma da filial Village Rio das Ostras/Pátria)`); continue; }
      if (c.select.atual === op.t) { feitos.push(`filial "${op.t}" (já marcada)`); continue; }
      await box.locator('select').first().evaluate((sel, v) => {
        for (const o of sel.options) o.selected = sel.multiple ? (o.selected || o.value === v) : o.value === v;
        sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true }));
        if (window.jQuery) { try { const $s = window.jQuery(sel); $s.trigger('change'); if ($s.selectpicker) $s.selectpicker('refresh'); } catch {} }
      }, op.v);
      feitos.push(`filial "${op.t}"`);
      continue;
    }
    if (RE_PATRIA.test(c.texto)) { feitos.push(`filial "${c.texto}" (já marcada)`); continue; }
    // lista com busca (MUI Autocomplete, react-select, select2 sem <select>): abre e escolhe pela lista que aparece
    const abrir = box.locator('.MuiAutocomplete-popupIndicator, button[aria-label="Open"], [class*="indicatorContainer"], [class*="-control"], [role="combobox"], .select2-selection, input').first();
    await abrir.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const opcoes = page.locator('[role="listbox"] [role="option"], .select2-results__option, [class*="-option"], .MuiAutocomplete-option, .dropdown-menu.show li').filter({ visible: true });
    const textos = (await opcoes.allInnerTexts().catch(() => [])).map((t, k) => ({ t: t.trim(), k }));
    const op = escolher(textos);
    if (op) {
      await opcoes.nth(op.k).click().catch(() => {});
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape').catch(() => {});
      feitos.push(`filial "${op.t}"`);
    } else {
      await page.keyboard.press('Escape').catch(() => {});
      log(`  (filial: lista com ${textos.length} opções e nenhuma da filial Village Rio das Ostras/Pátria)`);
    }
  }
  if (!campos.length) return feitos;
  return feitos.length ? feitos : ['filial não escolhida'];
}

// Depois de Filtrar: espera o resultado (até 25 s). O CSV pode vir como download direto, abrir em outra aba, ou
// aparecer como botão quando a tabela carrega.
const FILA = []; const NOVAS = [];
async function aguardarResultado(page, f0, n0) {
  for (let t = 0; t < 25; t++) {
    if (FILA.length > f0) return salvarDownload(FILA[FILA.length - 1]);
    if (NOVAS.length > n0) {
      const nova = NOVAS[NOVAS.length - 1];
      await nova.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
      if (FILA.length > f0) return salvarDownload(FILA[FILA.length - 1]);
      const ex = await exportar(nova).catch(() => null);
      if (ex) return { ...ex, origem: `${ex.origem} (outra aba)` };
      n0 = NOVAS.length;
    }
    if (await page.locator('.swal2-popup:visible').count()) return null;
    if ((await clicaveis(page)).some((c) => RE_EXPORT.test(c.desc) && !RE_PERIGO.test(c.desc))) return null;
    await page.waitForTimeout(1000);
  }
  return null;
}

// botão de aplicar o filtro, para quando o CSV só aparece depois de filtrar
async function aplicarFiltro(page) {
  const filtrar = page.locator('button:visible, input[type="submit"]:visible, a.btn:visible')
    .filter({ hasText: /^\s*(filtrar|buscar|pesquisar|gerar|aplicar|consultar|atualizar|ok|confirmar)\s*$/i }).first();
  if (!(await filtrar.count())) return false;
  await filtrar.click().catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return true;
}

// ---------------------------------------------------------------- exportação
// Botões e links da área do relatório (fora dos menus), com texto, dicas e classes dos ícones — muitos botões
// do CashBarber são só um ícone, sem texto. Cada um recebe data-robo-idx para o robô clicar depois.
async function clicaveis(page) {
  return page.evaluate(() => {
    document.querySelectorAll('[data-robo-idx]').forEach((e) => e.removeAttribute('data-robo-idx'));
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    const menu = 'nav, aside, header, #kt_header, #kt_header_menu, #kt_aside, .aside, .sidebar, .header-menu, .menu-nav, .topbar';
    const els = [...document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"], .btn, .dt-button, [onclick], [class*="download"], [class*="export"]')]
      .filter((e) => vis(e) && !e.closest(menu));
    const unicos = els.filter((e) => !els.some((o) => o !== e && o.contains(e) && o.matches('button, a, [role="button"]')));
    return unicos.map((e, i) => {
      e.setAttribute('data-robo-idx', String(i));
      const icones = [...e.querySelectorAll('i, svg, img, span[class*="icon"], span[class*="svg"]')]
        .map((x) => `${x.getAttribute('class') || ''} ${x.getAttribute('alt') || ''} ${(x.getAttribute('src') || '').split('/').pop()} ${x.getAttribute('data-icon') || ''}`).join(' ');
      const texto = (e.innerText || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      const desc = [texto, e.title, e.getAttribute('aria-label'), e.getAttribute('data-original-title'), e.getAttribute('data-bs-original-title'),
        e.getAttribute('data-tip'), `classe:${(e.getAttribute('class') || '').slice(0, 60)}`, icones.trim() && `ícone:${icones.trim().slice(0, 80)}`,
        e.getAttribute('href') && !/^(#|javascript)/.test(e.getAttribute('href')) ? `link:${e.getAttribute('href').slice(0, 60)}` : '',
        e.disabled ? '(desativado)' : ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      return { i, desc, texto };
    });
  });
}
const RE_EXPORT = /exportar|export|csv|excel|xlsx|\bxls\b|planilha|baixar|download|file-?(csv|excel|export|download|arrow)|sheet/i;
const RE_PERIGO = /sair|logout|importar|excluir|apagar|deletar|remover|cancelar|enviar|trash|delete|lixeira|editar|\bedit\b|salvar|novo|adicionar|\bplus\b/i;
const alvo = (page, i) => page.locator(`[data-robo-idx="${i}"]`).first();

async function tentarDownload(page, el, ms = 12000) {
  const espera = page.waitForEvent('download', { timeout: ms }).catch(() => null);
  // clique normal; se o Playwright não conseguir (ícone sem tamanho, sobreposto), clica pelo próprio elemento
  const clicou = await el.click({ timeout: 5000 }).then(() => true)
    .catch(() => el.evaluate((e) => { e.click(); return true; }).catch(() => false));
  return clicou ? espera : null;
}

async function salvarDownload(d) {
  const destino = path.join(SAIDA, `tmp-${Date.now()}-${d.suggestedFilename()}`);
  await d.saveAs(destino);
  const buf = fs.readFileSync(destino); fs.rmSync(destino);
  return { origem: 'download', arquivo: d.suggestedFilename(), csv: await paraCsv(buf, d.suggestedFilename()) };
}

async function exportar(page, { tabela = true } = {}) {
  let primeiro = null;
  const lista = (await clicaveis(page)).filter((c) => RE_EXPORT.test(c.desc) && !RE_PERIGO.test(c.desc))
    .map((c) => ({ ...c, peso: /csv/i.test(c.desc) ? 2 : /excel|xls|sheet/i.test(c.desc) ? 1 : 0 }))
    .sort((a, b) => b.peso - a.peso);
  for (const c of lista) {
    let d = await tentarDownload(page, alvo(page, c.i));
    if (!d) {
      // o botão pode ter aberto um menu ou uma janela com as opções (CSV primeiro)
      await page.waitForTimeout(800);
      const opcoes = (await clicaveis(page)).filter((o) => !RE_PERIGO.test(o.desc));
      for (const re of [/csv/i, /excel|xlsx|xls|sheet/i, /baixar|download|exportar/i]) {
        const o = opcoes.find((x) => re.test(x.desc));
        if (o) { d = await tentarDownload(page, alvo(page, o.i)); if (d) break; }
      }
    }
    if (d) {
      const ex = await salvarDownload(d);
      if (tipoDoCsv(ex.csv)) return ex;
      primeiro ||= ex; // baixou, mas não é um formato que o painel conhece: tenta os outros botões
    }
  }
  if (primeiro) return primeiro;
  // último recurso: ler a maior tabela da tela
  if (!tabela) return null;
  const csv = await tabelaDaTela(page);
  return csv && tipoDoCsv(csv) ? { origem: 'tabela da tela', arquivo: 'tabela.csv', csv } : null;
}

// abre o filtro pelo botão da área do relatório (muitas vezes só um ícone de funil) e preenche as datas na janela
async function abrirFiltro(page, per) {
  const lista = (await clicaveis(page)).filter((c) => /filtr|filter|funnel|calend|per[ií]odo/i.test(c.desc) && !RE_PERIGO.test(c.desc));
  for (const c of lista) {
    const b = alvo(page, c.i);
    await b.click({ timeout: 5000 }).catch(() => b.evaluate((e) => e.click()).catch(() => {}));
    await page.waitForTimeout(1500);
    const feito = await preencherDatas(page, per);
    if (feito) { await page.keyboard.press('Tab').catch(() => {}); return `${feito} na janela do filtro`; }
  }
  return null;
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

// tipo do relatório pelas colunas — mesma regra de detect() em src/importer.js
function tipoDoCsv(csv) {
  const linha = (String(csv).replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => l.trim()) || '');
  const k = linha.split(/[;,](?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((c) => c.replace(/"/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[.\-_]/g, ' ').replace(/\s+/g, ' ').trim());
  if (k.includes('ID DA COMANDA')) return 'comandas';
  if (k.includes('ORIGEM AGENDAMENTO')) return 'agendamentos';
  if (k.includes('QUANTIDADE REALIZADO')) return 'servicos';
  if (k.includes('DATA DE CANCELAMENTO')) return 'cancelamentos';
  if (k.includes('DATA DE CRIACAO') && k.includes('PLANO')) return 'assinantes';
  if (k.includes('ID') && k.includes('NOME') && k.includes('TIPO') && k.includes('CRIADO EM')) return 'equipe';
  return null;
}

// cabeçalho e nº de linhas, só para o log (sem dados)
function resumoCsv(csv) {
  const linhas = csv.split(/\r?\n/).filter((l) => l.trim());
  const cab = (linhas[0] || '').replace(/^﻿/, '').split(/[;,](?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/"/g, '').trim()).slice(0, 8);
  return `${linhas.length - 1} linhas · colunas: ${cab.join(', ')}${cab.length === 8 ? '…' : ''}`;
}

// ---------------------------------------------------------------- envio ao painel
// explica uma resposta de erro do painel (ou de quem respondeu no lugar dele, como a proteção da Vercel)
async function explicarErro(r) {
  const texto = await r.text().catch(() => '');
  let msg = '';
  try {
    const j = JSON.parse(texto);
    const e = j.error ?? j.message ?? j;
    msg = typeof e === 'string' ? e : [e.code, e.message].filter(Boolean).join(': ') || JSON.stringify(e).slice(0, 200);
  } catch { msg = /<html|<!doctype/i.test(texto) ? `página HTML (${(texto.match(/<title>([^<]*)/i) || [])[1] || 'sem título'})` : texto.slice(0, 200); }
  const quem = r.headers.get('x-vercel-id') ? 'Vercel' : (r.headers.get('server') || 'servidor');
  let dica = '';
  if (r.status === 401 && msg === 'Token do robô inválido') dica = ' → o IMPORT_TOKEN do GitHub é diferente do cadastrado na Vercel, ou a Vercel ainda não foi reimplantada (Redeploy) depois de cadastrar.';
  else if (r.status === 401 || r.status === 403) dica = ' → quem recusou não foi o painel: confira se PAINEL_URL é o endereço de produção (ex.: https://patriabnarbearia.vercel.app) e se a "Deployment Protection" da Vercel está desligada para ele.';
  else if (r.status === 404) dica = ' → o endereço em PAINEL_URL não tem o painel (confira o domínio) ou a versão no ar ainda não tem a entrada do robô.';
  return `Painel respondeu ${r.status} (${quem}): ${msg || 'sem mensagem'}${dica}`;
}

async function enviar(mes, files) {
  const url = (process.env.PAINEL_URL || '').replace(/\/+$/, '');
  if (!url || !process.env.IMPORT_TOKEN) throw new Error('Faltam PAINEL_URL e/ou IMPORT_TOKEN.');
  const corpo = JSON.stringify({ ano: mes.ano, mes: mes.mes, files });
  if (corpo.length > 4 * 1024 * 1024) throw new Error(`Os relatórios somam ${(corpo.length / 1048576).toFixed(1)} MB; o painel aceita até 4 MB por envio.`);
  const r = await fetch(`${url}/api/robo/importar`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-import-token': process.env.IMPORT_TOKEN.trim() }, body: corpo,
  });
  if (!r.ok) throw new Error(await explicarErro(r));
  return r.json();
}

// confere logo no começo se o painel aceita o robô (sem enviar dados), para não perder a execução inteira
async function verificarPainel() {
  const url = (process.env.PAINEL_URL || '').replace(/\/+$/, '');
  if (!url || !process.env.IMPORT_TOKEN) throw new Error('Faltam PAINEL_URL e/ou IMPORT_TOKEN.');
  if (!/^https?:\/\//.test(url)) throw new Error('PAINEL_URL precisa começar com https:// (ex.: https://patriabnarbearia.vercel.app).');
  const r = await fetch(`${url}/api/robo/importar`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-import-token': process.env.IMPORT_TOKEN.trim() }, body: '{"files":[]}',
  }).catch((e) => { throw new Error(`Não consegui falar com o painel em PAINEL_URL: ${e.message}`); });
  // com o token certo o painel responde "Nenhum arquivo recebido" (nada é gravado)
  if (r.status === 401 || r.status === 403 || r.status === 404) throw new Error(await explicarErro(r));
  log('Painel ok: aceitou o token do robô.');
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
  page.on('download', (d) => FILA.push(d));
  ctx.on('page', (p) => { p.on('download', (d) => FILA.push(d)); NOVAS.push(p); });
  page.setDefaultTimeout(20000);
  page.on('dialog', (d) => d.dismiss().catch(() => {})); // nunca confirma diálogos (exclusões etc.)
  const relatorioFinal = { quando: new Date().toISOString(), modo: MODO, meses: [], erros: [] };
  try {
    if (MODO === 'sincronizar') await verificarPainel();
    await entrar(page);
    if (MODO === 'mapear') {
      const paginas = await catalogo(page);
      fs.writeFileSync(path.join(SAIDA, 'mapa.json'), JSON.stringify({ base: BASE, paginas }, null, 2));
      log('Mapa salvo em mapa.json (só estrutura das páginas, sem dados).');
      return;
    }

    for (const mes of mesesParaImportar()) {
      const per = periodo(mes);
      log(`== ${pad(mes.mes)}/${mes.ano} (${per.deBr} a ${per.ateBr})`);
      const porTipo = {}; const resumo = { mes: `${mes.ano}-${pad(mes.mes)}`, relatorios: {} };
      for (const pg of PAGINAS) {
        const nome = pg.nome || pg.url;
        try {
          await page.goto(BASE + pg.url, { waitUntil: 'domcontentloaded' });
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          let ex = null;
          if (pg.periodo) {
            const como = await definirPeriodo(page, per);
            if (!como) throw new Error('não achei o filtro de datas');
            const filial = await escolherFilial(page);
            // no CashBarber o arquivo só sai depois de clicar em Filtrar
            const f0 = FILA.length; const n0 = NOVAS.length;
            const filtrou = await aplicarFiltro(page);
            ex = filtrou ? await aguardarResultado(page, f0, n0) : null;
            log(`  ${nome}: período por ${como}${filial.length ? ` + ${filial.join(', ')}` : ''}${filtrou ? ' + Filtrar' : ''}`);
            const aviso = await lerAviso(page);
            if (aviso) { log(`  ${nome}: aviso do CashBarber: "${aviso.texto || '(sem texto)'}"`); ex ||= aviso.download || null; }
          }
          ex ||= await exportar(page);
          if (!ex || !ex.csv?.trim()) {
            const aviso = await lerAviso(page);
            const lista = (await clicaveis(page)).map((x) => `[${x.desc}]`).slice(0, 25);
            const rotulos = await page.evaluate(() => [...document.querySelectorAll('label')].map((l) => l.innerText.trim()).filter((t) => t && t.length < 40).slice(0, 12));
            if (rotulos.length) lista.unshift(`campos: ${rotulos.join(' / ')} ·`);
            throw new Error(`não consegui exportar${aviso?.texto ? ` · aviso: "${aviso.texto}"` : ''} · botões do relatório: ${lista.join(' ') || '(nenhum)'}`);
          }
          const tipo = tipoDoCsv(ex.csv);
          log(`  ${nome}: ${ex.origem} (${ex.arquivo}) → ${tipo || 'formato não usado pelo painel'} · ${resumoCsv(ex.csv)}`);
          resumo.relatorios[nome] = tipo || 'não reconhecido';
          if (tipo && !porTipo[tipo]) porTipo[tipo] = { name: `${tipo}.csv`, text: ex.csv };
        } catch (e) {
          resumo.relatorios[nome] = `erro: ${e.message.slice(0, 300)}`;
          log(`  ${nome}: ERRO — ${e.message}`);
        }
        for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});
      }
      const tipos = Object.keys(porTipo);
      log(`  Arquivos para o painel: ${tipos.join(', ') || '(nenhum)'}`);
      // envia o que conseguiu; o que faltou fica relatado (cada relatório só substitui a sua parte no painel)
      const faltam = ['comandas', 'agendamentos', 'servicos', 'assinantes', 'cancelamentos', 'equipe'].filter((t) => !porTipo[t]);
      if (faltam.length) log(`  Não veio desta vez: ${faltam.join(', ')} — essas partes do painel ficam como estavam.`);
      resumo.faltaram = faltam;
      if (!tipos.length) {
        resumo.envio = 'nada para enviar';
        relatorioFinal.erros.push(`${resumo.mes}: nenhum relatório foi baixado`);
        log('  Nenhum relatório baixado: nada enviado ao painel.');
      } else if (MODO === 'testar') {
        resumo.envio = 'modo testar: nada enviado';
        log(`  Modo testar: enviaria ${tipos.join(', ')}.`);
      } else {
        try {
          const r = await enviar(mes, Object.values(porTipo));
          resumo.envio = { reconhecidos: r.relatorios, ignorados: r.ignorados };
          log(`  Painel atualizado com: ${(r.relatorios || []).join(', ')}${r.ignorados?.length ? ` · ignorados: ${r.ignorados.join(', ')}` : ''}`);
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
