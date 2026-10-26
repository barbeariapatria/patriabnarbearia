/* Painel de Resultados — Barbearia
   SPA em JavaScript puro + Chart.js. Rotas por hash (#/visao-geral, #/admin/integracao, …). */
(() => {
  'use strict';

  // ============================================================ Utilidades
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const NUM = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
  const INT = new Intl.NumberFormat('pt-BR');
  const brl = (v) => BRL.format(Number(v) || 0);
  const brlShort = (v) => {
    const n = Number(v) || 0;
    if (Math.abs(n) >= 1e6) return `R$ ${NUM.format(+(n / 1e6).toFixed(1))} mi`;
    if (Math.abs(n) >= 1e3) return `R$ ${NUM.format(+(n / 1e3).toFixed(1))} mil`;
    return `R$ ${NUM.format(Math.round(n))}`;
  };
  const int = (v) => INT.format(Math.round(Number(v) || 0));
  const pct = (v) => `${NUM.format(+(Number(v) || 0).toFixed(1))}%`;
  const num2 = (v) => (Number(v) ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) : '');
  const fmtDate = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}`; };
  const fmtDateTime = (s) => { if (!s) return '—'; const d = new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')); return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); };
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const WEEK_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const SERIES = [
    { key: 'servicos', label: 'Serviços', color: '--s1' },
    { key: 'produtos', label: 'Produtos', color: '--s2' },
    { key: 'novas_assinaturas', label: 'Novas assinaturas', short: 'Novas assin.', color: '--s3' },
    { key: 'sva', label: 'SVA', color: '--s4' },
    { key: 'recorrencia', label: 'Recorrência', color: '--s5' },
  ];

  const ICONS = {
    logo: '<path d="M6 3l12 18M18 3L6 21"/><circle cx="6" cy="4" r="2"/><circle cx="18" cy="4" r="2"/>',
    home: '<path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .6 3.2 2.5 3.5 5.5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    team: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21c.8-4 3.6-6.5 7-6.5s6.2 2.5 7 6.5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    plug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    up: '<path d="M7 14l5-5 5 5"/>',
    down: '<path d="M7 10l5 5 5-5"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v6M18 9v6"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    arrowDown: '<path d="M12 4v16M6 14l6 6 6-6"/>',
    ticket: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 6v12" stroke-dasharray="2 2"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1L20 20M8.1 15.9L20 4"/>',
    bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.01"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  };
  const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

  // ============================================================ Estado & API
  const today = new Date();
  const state = {
    user: null,
    y: today.getFullYear(),
    m: today.getMonth() + 1,
    theme: document.documentElement.dataset.theme || 'dark',
    charts: [],
    pros: [],
  };
  try {
    const saved = JSON.parse(sessionStorage.getItem('ym') || 'null');
    if (saved?.y && saved?.m) { state.y = saved.y; state.m = saved.m; }
    const per = JSON.parse(sessionStorage.getItem('periodo') || 'null');
    if (per?.mode === 'intervalo' && per.de && per.ate) state.period = per;
  } catch {}
  state.period ??= { mode: 'mes' };

  // ---------------------------------------------------------- Período (mês ou intervalo de datas)
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoDate(new Date(y, m - 1, d + n)); };
  const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3) + 1;
  const isRange = () => state.period.mode === 'intervalo';
  const fmtFull = (iso) => iso.split('-').reverse().join('/');
  const periodQS = () => (isRange() ? `de=${state.period.de}&ate=${state.period.ate}` : `ano=${state.y}&mes=${state.m}`);
  const periodYear = () => (isRange() ? Number(state.period.ate.slice(0, 4)) : state.y);
  const PRESETS = [
    { id: 'mes_atual', label: 'Este mês' },
    { id: 'mes_passado', label: 'Mês passado' },
    { id: 'ultimos_7', label: 'Últimos 7 dias' },
    { id: 'ultimos_30', label: 'Últimos 30 dias' },
    { id: 'ultimos_90', label: 'Últimos 90 dias' },
    { id: 'ano_atual', label: 'Este ano' },
    { id: 'ano_passado', label: 'Ano passado' },
  ];
  function presetPeriod(id) {
    const t = new Date(); const hoje = isoDate(t);
    if (id === 'mes_atual') return { mode: 'mes', y: t.getFullYear(), m: t.getMonth() + 1 };
    if (id === 'mes_passado') { const p = new Date(t.getFullYear(), t.getMonth() - 1, 1); return { mode: 'mes', y: p.getFullYear(), m: p.getMonth() + 1 }; }
    if (id.startsWith('ultimos_')) { const n = Number(id.split('_')[1]); return { mode: 'intervalo', de: addDays(hoje, -(n - 1)), ate: hoje }; }
    if (id === 'ano_atual') return { mode: 'intervalo', de: `${t.getFullYear()}-01-01`, ate: hoje };
    if (id === 'ano_passado') return { mode: 'intervalo', de: `${t.getFullYear() - 1}-01-01`, ate: `${t.getFullYear() - 1}-12-31` };
    return null;
  }
  function setPeriod(p, preset = null) {
    if (p.mode === 'mes') {
      state.period = { mode: 'mes' }; state.y = p.y; state.m = p.m;
      try { sessionStorage.setItem('ym', JSON.stringify({ y: p.y, m: p.m })); } catch {}
    } else {
      let { de, ate } = p; if (de > ate) [de, ate] = [ate, de];
      state.period = { mode: 'intervalo', de, ate, preset };
    }
    try { sessionStorage.setItem('periodo', JSON.stringify(state.period)); } catch {}
    route();
  }
  const periodLabel = () => (isRange()
    ? (PRESETS.find((p) => p.id === state.period.preset)?.label || 'Personalizado')
    : 'Mês');
  const rangeTitle = () => `${fmtFull(state.period.de)} a ${fmtFull(state.period.ate)}`;

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    const raw = await res.text();
    try { data = JSON.parse(raw); } catch {}
    if (res.status === 401 && !path.startsWith('/api/auth/login')) { state.user = null; renderLogin(); throw new Error('Sessão expirada'); }
    if (!res.ok) {
      // Resposta sem JSON (ex.: a hospedagem derrubou a função): mostra o código e um trecho do erro
      const detail = data?.error || raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      if (data?.error) throw new Error(data.error);
      throw new Error(`Erro ${res.status}${detail ? `: ${detail}` : ''}${res.status >= 500 ? ' · veja /api/health' : ''}`);
    }
    return data;
  }

  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${icon(type === 'ok' ? 'check' : 'alert')}<span>${esc(msg)}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3200);
  }

  function modal({ title, body, footer = '', wide = false, onMount }) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-h"><h3>${title}</h3><button class="btn btn-ghost btn-icon" data-close aria-label="Fechar">${icon('x')}</button></div>
      <div class="modal-b">${body}</div>${footer ? `<div class="modal-f">${footer}</div>` : ''}</div>`;
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); modalCharts.forEach((c) => c.destroy()); modalCharts.length = 0; };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    onMount?.(bg, close);
    return close;
  }
  const modalCharts = [];

  function confirmDialog(text, { ok = 'Confirmar', danger = true } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const close = modal({
        title: 'Confirmação',
        body: `<p style="margin:0;color:var(--text-2)">${text}</p>`,
        footer: `<button class="btn" data-close>Cancelar</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${ok}</button>`,
        onMount: (el) => {
          $('[data-ok]', el).onclick = () => { done = true; close(); resolve(true); };
          el.addEventListener('click', (e) => { if (!done && (e.target === el || e.target.closest('[data-close]'))) resolve(false); });
        },
      });
    });
  }

  function copy(text) {
    navigator.clipboard?.writeText(text).then(() => toast('Copiado!'), () => toast('Não foi possível copiar', 'err'));
  }

  // ============================================================ Chart.js tema
  function applyChartTheme() {
    if (!window.Chart) return;
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = cssVar('--muted');
    Chart.defaults.borderColor = cssVar('--grid');
    Chart.defaults.animation.duration = 700;
    Object.assign(Chart.defaults.plugins.tooltip, {
      backgroundColor: cssVar('--surface-3'), titleColor: cssVar('--text'), bodyColor: cssVar('--text-2'), footerColor: cssVar('--text'),
      borderColor: cssVar('--border-strong'), borderWidth: 1, padding: 12, cornerRadius: 10, boxPadding: 5, usePointStyle: true,
      titleFont: { weight: '600' }, footerFont: { weight: '700' },
    });
    Chart.defaults.plugins.legend.display = false;
  }
  function chart(el, cfg, store = state.charts) {
    const c = new Chart(el, cfg);
    store.push(c);
    return c;
  }
  function destroyCharts() { state.charts.forEach((c) => c.destroy()); state.charts = []; }
  const proColor = (id) => {
    const idx = state.pros.findIndex((p) => p.id === id);
    return idx >= 0 && idx < 8 ? cssVar(`--s${idx + 1}`) : cssVar('--muted');
  };
  const legendHtml = (items) => `<div class="legend">${items.map((i) => `<span><i style="background:${i.color}"></i>${esc(i.label)}</span>`).join('')}</div>`;
  const moneyAxis = { ticks: { callback: (v) => brlShort(v), maxTicksLimit: 6 }, grid: { color: cssVar('--grid') }, border: { display: false } };

  // ============================================================ Login
  function renderLogin() {
    destroyCharts();
    document.title = 'Entrar — Pátria Barbearia';
    $('#root').innerHTML = `
    <div class="login-wrap">
      <section class="login-art">
        <img class="login-logo" src="/img/patria-logo.png" alt="Pátria Barbearia">
        <div class="big">Metas, faturamento e equipe <span>em tempo real</span>, direto do seu CashBarber.</div>
        <div class="feat">
          <div><b>Metas</b>Mensal e quinzenal com ritmo diário</div>
          <div><b>Equipe</b>Ranking, ticket médio e SVA</div>
          <div><b>Webhook</b>Dados chegando automaticamente</div>
        </div>
      </section>
      <section class="login-panel">
        <form class="login-card fade-in" id="loginForm" autocomplete="on">
          <img class="login-logo-sm" src="/img/patria-logo-sm.png" alt="Pátria Barbearia">
          <h2>Bem-vindo de volta</h2>
          <p>Entre com o e-mail e a senha da barbearia para acessar o painel.</p>
          <div id="loginErr"></div>
          <div class="field"><label for="u">E-mail</label><input class="input" id="u" name="username" type="email" inputmode="email" autocomplete="username" placeholder="seu@email.com" required autofocus></div>
          <div class="field"><label for="p">Senha</label><input class="input" id="p" name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn btn-primary btn-block" type="submit">${icon('lock')} Entrar</button>
          <p class="muted" style="margin-top:20px;font-size:12px">Acesso restrito. Os dados são atualizados automaticamente via integração.</p>
        </form>
      </section>
    </div>`;
    $('#loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        const { user, single_user, password_managed } = await api('/api/auth/login', { method: 'POST', body: { username: $('#u').value, password: $('#p').value } });
        state.user = user; state.singleUser = single_user; state.passwordManaged = password_managed;
        if (!location.hash || location.hash === '#/') location.hash = '#/inicio';
        renderShell();
      } catch (err) {
        $('#loginErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
      } finally { btn.disabled = false; }
    };
  }

  // ============================================================ Shell
  const NAV = [
    { group: 'Painel' },
    { path: 'inicio', label: 'Início', icon: 'home', title: 'Início', month: true, period: true },
    { path: 'visao-geral', label: 'Painel de metas', icon: 'trend', title: 'Painel de metas', month: true, period: true },
    { path: 'faturamento', label: 'Faturamento diário', icon: 'calendar', title: 'Faturamento por dia', month: true, period: true },
    { path: 'profissionais', label: 'Profissionais', icon: 'users', title: 'Análise de profissionais', month: true, period: true },
    { group: 'Administração', admin: true },
    { path: 'admin/importar', label: 'Importar CashBarber', icon: 'download', title: 'Importar relatórios do CashBarber', admin: true },
    { path: 'admin/dados', label: 'Dados do mês', icon: 'db', title: 'Dados do mês', month: true, admin: true },
    { path: 'admin/lancamentos', label: 'Lançamentos', icon: 'edit', title: 'Lançamentos por profissional', month: true, admin: true },
    { path: 'admin/equipe', label: 'Equipe', icon: 'team', title: 'Equipe', admin: true },
    { path: 'admin/metas', label: 'Metas e configurações', icon: 'target', title: 'Metas e configurações', admin: true },
    { path: 'admin/usuarios', label: 'Usuários', icon: 'shield', title: 'Usuários e acessos', admin: true, multi: true },
    { path: 'admin/integracao', label: 'Integração & Webhook', icon: 'plug', title: 'Integração CashBarber', admin: true },
  ];
  const isAdmin = () => state.user?.role === 'admin';
  // Abaixo do logo: o nome da unidade só aparece quando não repete o próprio logo (ex.: filiais)
  const unitLabel = (u) => (/^p[áa]tria barbearia$/i.test(String(u).trim()) ? 'Painel de resultados' : u);

  function renderShell() {
    applyChartTheme();
    $('#root').innerHTML = `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <a class="side-logo" href="#/inicio"><img src="/img/patria-logo-sm.png" alt="Pátria Barbearia"><small><span id="unitName">Painel de Resultados</span></small></a>
        <nav class="nav">
          ${NAV.filter((n) => (!n.admin || isAdmin()) && (!n.multi || !state.singleUser)).map((n) => n.group
            ? `<div class="nav-label">${n.group}</div>`
            : `<a href="#/${n.path}" data-path="${n.path}">${icon(n.icon)}<span>${n.label}</span></a>`).join('')}
        </nav>
        <div class="spacer"></div>
        <div class="user-box">
          <div class="avatar">${esc(initials(state.user.name || state.user.username))}</div>
          <div class="meta"><b>${esc(state.user.name || state.user.username)}</b><span>${state.user.role === 'admin' ? 'Administrador' : 'Visualizador'}</span></div>
          ${state.passwordManaged ? '' : `<button class="btn btn-ghost btn-icon" id="pwdBtn" title="Alterar senha">${icon('key')}</button>`}
          <button class="btn btn-ghost btn-icon" id="logoutBtn" title="Sair">${icon('logout')}</button>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <button class="btn btn-ghost btn-icon menu-btn" id="menuBtn" aria-label="Menu">${icon('menu')}</button>
          <div class="titles"><h1 id="pageTitle"></h1><div class="sub" id="pageSub"></div></div>
          <div class="grow"></div>
          <div class="month-picker" id="monthPicker">
            <button class="btn btn-ghost btn-icon" id="prevM" aria-label="Mês anterior">${icon('left')}</button>
            <div class="label" id="monthLabel"></div>
            <button class="btn btn-ghost btn-icon" id="nextM" aria-label="Próximo mês">${icon('right')}</button>
          </div>
          <div class="period-wrap" id="periodWrap">
            <button class="btn" id="periodBtn" aria-haspopup="true" aria-expanded="false">${icon('calendar')}<span id="periodBtnLabel">Mês</span></button>
            <div class="period-pop hidden" id="periodPop" role="dialog" aria-label="Escolher período"></div>
          </div>
          <button class="btn btn-icon" id="themeBtn" title="Alternar tema">${icon(state.theme === 'light' ? 'moon' : 'sun')}</button>
        </header>
        <div class="content" id="view"></div>
      </main>
    </div>`;
    $('#logoutBtn').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); state.user = null; renderLogin(); };
    $('#pwdBtn')?.addEventListener('click', changePasswordModal);
    $('#themeBtn').onclick = () => {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = state.theme;
      try { localStorage.setItem('theme', state.theme); } catch {}
      $('#themeBtn').innerHTML = icon(state.theme === 'light' ? 'moon' : 'sun');
      applyChartTheme();
      route();
    };
    $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
    const shift = (d) => {
      const nav = NAV.find((n) => n.path === (location.hash.replace(/^#\/?/, '') || 'inicio'));
      if (isRange() && nav?.period) {
        const span = daysBetween(state.period.de, state.period.ate);
        setPeriod({ mode: 'intervalo', de: addDays(state.period.de, d * span), ate: addDays(state.period.ate, d * span) }, state.period.preset ? 'deslocado' : null);
        return;
      }
      let m = state.m + d; let y = state.y;
      if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
      state.m = m; state.y = y;
      try { sessionStorage.setItem('ym', JSON.stringify({ y, m })); } catch {}
      route();
    };
    $('#periodBtn').onclick = (e) => { e.stopPropagation(); togglePeriodPop(); };
    document.addEventListener('click', (e) => { if (!e.target.closest('#periodWrap')) closePeriodPop(); });
    $('#prevM').onclick = () => shift(-1);
    $('#nextM').onclick = () => shift(1);
    api('/api/config/publica').then((c) => { $('#unitName').textContent = unitLabel(c.unidade); }).catch(() => {});
    route();
  }

  function closePeriodPop() {
    const pop = $('#periodPop'); if (!pop || pop.classList.contains('hidden')) return;
    pop.classList.add('hidden'); $('#periodBtn').setAttribute('aria-expanded', 'false');
  }
  function togglePeriodPop() {
    const pop = $('#periodPop');
    if (!pop.classList.contains('hidden')) return closePeriodPop();
    const cur = isRange() ? state.period : { de: isoDate(new Date(state.y, state.m - 1, 1)), ate: isoDate(new Date(state.y, state.m, 0)) };
    const active = isRange() ? state.period.preset : (state.y === new Date().getFullYear() && state.m === new Date().getMonth() + 1 ? 'mes_atual' : 'mes');
    pop.innerHTML = `
      <div class="eyebrow" style="margin-bottom:8px">Atalhos</div>
      <div class="period-presets">
        <button class="chip ${active === 'mes' ? 'on' : ''}" data-mes>Mês (setas)</button>
        ${PRESETS.map((p) => `<button class="chip ${active === p.id ? 'on' : ''}" data-preset="${p.id}">${p.label}</button>`).join('')}
      </div>
      <div class="eyebrow" style="margin:16px 0 8px">Personalizado</div>
      <form id="periodForm" class="period-custom">
        <label class="field" style="margin:0"><span>De</span><input class="input input-sm" type="date" id="perDe" value="${cur.de}" required></label>
        <label class="field" style="margin:0"><span>Até</span><input class="input input-sm" type="date" id="perAte" value="${cur.ate}" required></label>
        <button class="btn btn-primary btn-sm" type="submit">Aplicar</button>
      </form>
      <p class="muted" style="font-size:11.5px;margin:12px 0 0">Metas e quinzenas são mensais: no modo intervalo o painel mostra o resumo do período.</p>`;
    pop.classList.remove('hidden'); $('#periodBtn').setAttribute('aria-expanded', 'true');
    $('[data-mes]', pop).onclick = () => setPeriod({ mode: 'mes', y: state.y, m: state.m });
    $$('[data-preset]', pop).forEach((b) => { b.onclick = () => setPeriod(presetPeriod(b.dataset.preset), b.dataset.preset); });
    $('#periodForm', pop).onsubmit = (e) => {
      e.preventDefault();
      const de = $('#perDe', pop).value; const ate = $('#perAte', pop).value;
      if (!de || !ate) return;
      if (daysBetween(de < ate ? de : ate, de < ate ? ate : de) > 731) { toast('O período pode ter no máximo 2 anos', 'err'); return; }
      setPeriod({ mode: 'intervalo', de, ate });
    };
  }

  async function loadPros() {
    state.pros = (await api('/api/profissionais')).sort((a, b) => a.id - b.id);
  }

  async function route() {
    if (!state.user) return renderLogin();
    const path = (location.hash.replace(/^#\/?/, '') || 'inicio');
    let nav = NAV.find((n) => n.path === path && (!n.admin || isAdmin()) && (!n.multi || !state.singleUser));
    if (!nav) { location.hash = '#/inicio'; return; }
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === path));
    $('#sidebar').classList.remove('open');
    $('#pageTitle').textContent = nav.title;
    $('#pageSub').textContent = '';
    $('#monthPicker').classList.toggle('hidden', !nav.month);
    $('#periodWrap').classList.toggle('hidden', !nav.period);
    closePeriodPop();
    const ranged = nav.period && isRange();
    $('#monthLabel').textContent = ranged ? rangeTitle() : `${MONTHS[state.m - 1]} ${state.y}`;
    $('#monthPicker').classList.toggle('range', ranged);
    $('#periodBtnLabel').textContent = nav.period ? periodLabel() : 'Mês';
    $('#prevM').setAttribute('aria-label', ranged ? 'Período anterior' : 'Mês anterior');
    $('#nextM').setAttribute('aria-label', ranged ? 'Próximo período' : 'Próximo mês');
    document.title = `${nav.title} — Pátria Barbearia`;
    destroyCharts();
    state.unmountBento?.(); state.unmountBento = null;
    const view = $('#view');
    view.innerHTML = `<div class="grid g-4">${'<div class="skeleton" style="height:120px"></div>'.repeat(4)}</div><div class="skeleton" style="height:340px"></div>`;
    try {
      await loadPros();
      await VIEWS[path](view);
    } catch (e) {
      if (state.user) view.innerHTML = `<div class="card empty">${icon('alert')}<b>Não foi possível carregar</b>${esc(e.message)}</div>`;
    }
  }

  function changePasswordModal() {
    modal({
      title: 'Alterar minha senha',
      body: `<form id="pwdForm"><div class="field"><label>Senha atual</label><input class="input" type="password" name="atual" required autocomplete="current-password"></div>
        <div class="field"><label>Nova senha (mín. 6 caracteres)</label><input class="input" type="password" name="nova" minlength="6" required autocomplete="new-password"></div></form>`,
      footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-save>Salvar</button>',
      onMount: (el, close) => {
        $('[data-save]', el).onclick = async () => {
          const f = $('#pwdForm', el);
          if (!f.reportValidity()) return;
          try {
            await api('/api/auth/password', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
            state.user.must_change = false; toast('Senha alterada'); close(); route();
          } catch (e) { toast(e.message, 'err'); }
        };
      },
    });
  }

  // ============================================================ Componentes
  function ring(percent, label = 'da meta', size = 148) {
    const r = size / 2 - 12; const c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(100, percent));
    return `<div class="ring" style="width:${size}px;height:${size}px" role="img" aria-label="${pct(percent)} ${label}">
      <svg width="${size}" height="${size}"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="12" fill="none"/>
      <circle class="bar" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${c * (1 - p / 100)}"/></svg>
      <div class="center"><div><b>${pct(percent)}</b><span>${label}</span></div></div></div>`;
  }
  const animateRings = (root) => requestAnimationFrame(() => $$('.ring .bar', root).forEach((b) => { b.style.strokeDashoffset = b.dataset.target; }));
  const animateBars = (root) => requestAnimationFrame(() => $$('[data-w]', root).forEach((b) => { b.style.width = `${b.dataset.w}%`; }));

  function kpi({ label, value, foot = '', ic = 'cash', tone }) {
    const toneStyle = tone ? `style="background:var(--${tone}-soft);color:var(--${tone})"` : '';
    return `<div class="card kpi fade-in"><div class="top"><div class="ico" ${toneStyle}>${icon(ic)}</div>${label}</div><div class="v num">${value}</div><div class="foot">${foot}</div></div>`;
  }
  function delta(v, suffix = 'vs mês anterior') {
    if (v === null || v === undefined) return `<span class="badge neutral">sem comparativo</span>`;
    const good = v >= 0;
    return `<span class="badge ${good ? 'good' : 'bad'}">${icon(good ? 'up' : 'down')}${pct(Math.abs(v))}</span> <span class="muted">${suffix}</span>`;
  }
  const emptyState = (title, text, action = '') => `<div class="empty">${icon('db')}<b>${title}</b><div>${text}</div>${action ? `<div style="margin-top:16px">${action}</div>` : ''}</div>`;

  // ============================================================ Visão geral
  async function viewOverview(view) {
    if (isRange()) return viewRangeDashboard(view);
    const [d, ps, rep] = await Promise.all([
      api(`/api/dashboard?ano=${state.y}&mes=${state.m}`),
      api(`/api/profissionais/stats?ano=${state.y}&mes=${state.m}`),
      api(`/api/relatorios?ano=${state.y}&mes=${state.m}`).catch(() => null),
    ]);
    $('#pageSub').textContent = `${d.unidade} · Apuração até dia ${d.dia_apuracao || '—'}`;
    const M = d.mensal;
    const Q = d.quinzenas[d.quinzena_atual - 1];
    const hasData = d.totais.total > 0;
    const mustChange = state.user.must_change ? `<div class="banner">${icon('alert')}<div class="grow"><b>Segurança:</b> você está usando a senha padrão. Altere agora para proteger o painel.</div><button class="btn btn-sm" id="chgPwd">Alterar senha</button></div>` : '';
    const demoBanner = d.dias.some((x) => x.status === 'DEMO') ? `<div class="banner" style="border-color:var(--s7);background:color-mix(in srgb,var(--s7) 12%,transparent)">${icon('spark')}<div class="grow">Este mês contém <b>dados de demonstração</b>. Eles serão substituídos pelos dados reais quando a integração estiver ativa.</div>${isAdmin() ? '<button class="btn btn-sm" id="clearDemo">Remover demo</button>' : ''}</div>` : '';

    view.innerHTML = `
      ${mustChange}${demoBanner}
      <div class="grid g-hero">
        <div class="card hero fade-in">
          ${ring(M.percentual, 'meta mensal')}
          <div style="flex:1;min-width:0">
            <div class="eyebrow">Faturamento de ${d.mes_nome}</div>
            <div class="val num">${brl(M.realizado)}</div>
            <div class="row"><span>Meta <b>${brl(M.meta)}</b></span><span>Projeção <b>${brl(M.projecao)}</b></span></div>
            <div style="margin-top:12px">${delta(d.mes_anterior.variacao)}</div>
            ${M.realizado >= M.meta && M.meta ? `<div style="margin-top:12px"><span class="badge good">${icon('star')} Meta mensal batida!</span></div>` : ''}
          </div>
        </div>
        <div class="card hero fade-in">
          ${ring(Q.percentual, `${d.quinzena_atual}ª quinzena`, 132)}
          <div style="flex:1;min-width:0">
            <div class="eyebrow">SVA + Assinaturas · ${d.quinzena_atual}ª quinzena</div>
            <div class="val num" style="font-size:32px">${brl(Q.realizado)}</div>
            <div class="row"><span>Meta <b>${brl(Q.meta)}</b></span><span>Faltam <b>${brl(Q.restante)}</b></span></div>
            <div class="row" style="margin-top:6px"><span>SVA <b>${brl(Q.sva)}</b></span><span>Assinaturas <b>${brl(Q.assinaturas)}</b></span></div>
          </div>
        </div>
      </div>

      ${subsHero(rep?.assinaturas)}
      <div class="grid g-6">
        ${kpi({ label: 'Faltam p/ meta', value: brl(M.restante), foot: M.restante ? `${pct(100 - Math.min(100, M.percentual))} restante` : 'Meta alcançada', ic: 'flag', tone: M.restante ? undefined : 'good' })}
        ${kpi({ label: 'Restante por dia', value: brl(M.restante_por_dia), foot: `${M.dias_uteis_restantes} dias úteis restantes`, ic: 'clock' })}
        ${kpi({ label: 'Média diária', value: brl(M.media_diaria), foot: 'dias com faturamento', ic: 'trend' })}
        ${kpi({ label: 'Maior dia', value: brl(M.maior_dia?.valor), foot: M.maior_dia ? `${fmtDate(M.maior_dia.date)} · ${dayName(M.maior_dia.date)}` : '—', ic: 'star' })}
        ${kpi({ label: 'Menor dia', value: brl(M.menor_dia?.valor), foot: M.menor_dia ? `${fmtDate(M.menor_dia.date)} · ${dayName(M.menor_dia.date)}` : '—', ic: 'arrowDown' })}
        ${kpi({ label: 'Média diária SVA', value: brl(d.sva_mensal.media_diaria), foot: d.sva_mensal.maior_dia ? `Pico ${brl(d.sva_mensal.maior_dia.valor)} em ${fmtDate(d.sva_mensal.maior_dia.date)}` : 'SVA + assinaturas', ic: 'spark' })}
      </div>

      <div class="grid g-2-1">
        <div class="card fade-in">
          <div class="card-h"><h3>Faturamento por dia</h3><div class="grow"></div>${legendHtml(SERIES.map((s) => ({ label: s.label, color: cssVar(s.color) })))}</div>
          ${hasData ? '<div class="chart-box lg"><canvas id="cDaily"></canvas></div>' : emptyState('Sem lançamentos neste mês', 'Os valores aparecem aqui automaticamente quando o CashBarber enviar eventos para o webhook.', isAdmin() ? `<button class="btn btn-primary" id="genDemo">${icon('spark')} Gerar dados de demonstração</button>` : '')}
        </div>
        <div class="card fade-in">
          <div class="card-h"><h3>Composição do mês</h3><div class="grow"></div><span class="hint">${brl(d.totais.total)}</span></div>
          <div class="comp-list">
            ${SERIES.map((s) => {
              const v = d.totais[s.key]; const p = d.totais.total ? (v / d.totais.total) * 100 : 0;
              return `<div class="comp-item"><div class="l"><span><i style="background:${cssVar(s.color)}"></i>${s.label}</span><b class="num">${brl(v)} <span class="muted" style="font-weight:500">· ${pct(p)}</span></b></div>
                <div class="bar"><i data-w="${p}" style="width:0;background:${cssVar(s.color)};transition:width .9s"></i></div></div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="grid g-2-1">
        <div class="card fade-in">
          <div class="card-h"><h3>Acumulado vs ritmo da meta</h3><div class="grow"></div>
            ${legendHtml([{ label: 'Realizado', color: cssVar('--s1') }, { label: 'Ritmo ideal da meta', color: cssVar('--muted') }])}</div>
          <div class="chart-box"><canvas id="cCum"></canvas></div>
        </div>
        <div class="card fade-in">
          <div class="card-h"><h3>Top profissionais</h3><div class="grow"></div><a href="#/profissionais" class="hint">ver todos →</a></div>
          ${topPros(ps)}
        </div>
      </div>

      <div class="grid g-2">${d.quinzenas.map((q, i) => quinzenaCard(q, i + 1, d.quinzena_atual === i + 1)).join('')}</div>
      ${reportsSection(rep)}`;

    animateRings(view); animateBars(view);
    $('#chgPwd', view)?.addEventListener('click', changePasswordModal);
    $('#genDemo', view)?.addEventListener('click', async () => { await api('/api/admin/demo', { method: 'POST', body: { ano: state.y, mes: state.m } }); toast('Dados de demonstração gerados'); route(); });
    $('#clearDemo', view)?.addEventListener('click', async () => { await api('/api/admin/demo', { method: 'DELETE' }); toast('Dados de demonstração removidos'); route(); });
    $$('.rank-item', view).forEach((el) => el.addEventListener('click', () => proDetail(Number(el.dataset.id))));

    const labels = d.dias.map((x) => `${String(x.dia).padStart(2, '0')}`);
    if (hasData) {
      chart($('#cDaily'), {
        type: 'bar',
        data: {
          labels,
          datasets: SERIES.map((s) => ({
            label: s.label, data: d.dias.map((x) => x[s.key]), backgroundColor: cssVar(s.color),
            borderColor: cssVar('--surface'), borderWidth: 1, borderRadius: 4, borderSkipped: false, maxBarThickness: 22, stack: 'a',
          })),
        },
        options: {
          maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          scales: { x: { stacked: true, grid: { display: false }, border: { display: false } }, y: { ...moneyAxis, stacked: true } },
          plugins: {
            tooltip: {
              filter: (i) => i.raw > 0,
              callbacks: {
                title: (it) => { const day = d.dias[it[0].dataIndex]; return `${fmtDate(day.date)} · ${day.dia_semana}`; },
                label: (c) => ` ${c.dataset.label}: ${brl(c.raw)}`,
                footer: (it) => `Total: ${brl(d.dias[it[0].dataIndex].total)}`,
              },
            },
          },
        },
      });
    }
    // Acumulado
    let acc = 0;
    const cum = d.dias.map((x) => { acc += x.total; return x.dia <= Math.max(d.dia_apuracao, 0) ? +acc.toFixed(2) : null; });
    const totalUteis = d.dias.filter((x) => x.util).length || 1;
    let u = 0;
    const pace = d.dias.map((x) => { if (x.util) u++; return +(M.meta * (u / totalUteis)).toFixed(2); });
    chart($('#cCum'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Realizado', data: cum, borderColor: cssVar('--s1'), backgroundColor: hexA(cssVar('--s1'), 0.14), fill: true, borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: cssVar('--surface') },
          { label: 'Ritmo ideal da meta', data: pace, borderColor: cssVar('--muted'), borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, fill: false },
        ],
      },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { ...moneyAxis, beginAtZero: true } },
        plugins: { tooltip: { callbacks: { title: (it) => `Dia ${it[0].label}`, label: (c) => (c.raw === null ? null : ` ${c.dataset.label}: ${brl(c.raw)}`) } } },
      },
    });
  }


  // ============================================================ Resumo de um período (modo intervalo)
  async function viewRangeDashboard(view) {
    const [r, ps, rep] = await Promise.all([api(`/api/periodo?${periodQS()}`), api(`/api/profissionais/stats?${periodQS()}`), api(`/api/relatorios?${periodQS()}`).catch(() => null)]);
    $('#pageSub').textContent = `${r.unidade} · ${rangeTitle()} · ${r.dias_no_periodo} dias`;
    const byMonth = r.dias.length > 62;
    const groups = byMonth ? r.por_mes : r.dias;
    const label = (g) => (byMonth ? `${g.nome.slice(0, 3)}/${String(g.ano).slice(2)}` : fmtDate(g.date));
    const v = r.periodo_anterior.variacao;
    const [ay, am] = r.ate.split('-').map(Number);
    const svaAss = r.totais.sva + r.totais.novas_assinaturas;

    view.innerHTML = `
      <div class="banner" style="border-color:var(--border-strong);background:var(--surface)">${icon('calendar')}<div class="grow">
        Resumo de <b>${rangeTitle()}</b>. Metas e quinzenas são mensais: para acompanhá-las, abra o mês.</div>
        <button class="btn btn-sm" id="goMonth">Ver ${MONTHS[am - 1]} ${ay}</button></div>

      <div class="grid g-hero">
        <div class="card hero fade-in">
          <div style="flex:1;min-width:0">
            <div class="eyebrow">Faturamento no período</div>
            <div class="val num">${brl(r.totais.total)}</div>
            <div class="row"><span>Média por dia <b>${brl(r.media_diaria)}</b></span><span>Dias com faturamento <b>${r.dias_com_faturamento} de ${r.dias_no_periodo}</b></span></div>
            <div style="margin-top:12px">${v === null ? '<span class="badge neutral">sem comparativo</span>' : `<span class="badge ${v >= 0 ? 'good' : 'bad'}">${icon(v >= 0 ? 'up' : 'down')}${pct(Math.abs(v))}</span> <span class="muted">vs ${fmtFull(r.periodo_anterior.de)} a ${fmtFull(r.periodo_anterior.ate)} (${brl(r.periodo_anterior.total)})</span>`}</div>
          </div>
        </div>
        <div class="card hero fade-in">
          <div style="flex:1;min-width:0">
            <div class="eyebrow">SVA + assinaturas no período</div>
            <div class="val num" style="font-size:32px">${brl(svaAss)}</div>
            <div class="row"><span>SVA <b>${brl(r.totais.sva)}</b></span><span>Novas assinaturas <b>${brl(r.totais.novas_assinaturas)}</b></span></div>
            <div class="row" style="margin-top:6px"><span>Recorrência <b>${brl(r.totais.recorrencia)}</b></span></div>
          </div>
        </div>
      </div>

      ${subsHero(rep?.assinaturas)}
      <div class="grid g-4">
        ${kpi({ label: 'Maior dia', value: brl(r.maior_dia?.valor), foot: r.maior_dia ? `${fmtFull(r.maior_dia.date)} · ${dayName(r.maior_dia.date)}` : '—', ic: 'star' })}
        ${kpi({ label: 'Menor dia', value: brl(r.menor_dia?.valor), foot: r.menor_dia ? `${fmtFull(r.menor_dia.date)} · ${dayName(r.menor_dia.date)}` : '—', ic: 'arrowDown' })}
        ${kpi({ label: 'Serviços', value: brl(r.totais.servicos), foot: r.totais.total ? `${pct((r.totais.servicos / r.totais.total) * 100)} do total` : '—', ic: 'scissors' })}
        ${kpi({ label: 'Produtos', value: brl(r.totais.produtos), foot: r.totais.total ? `${pct((r.totais.produtos / r.totais.total) * 100)} do total` : '—', ic: 'bag' })}
      </div>

      <div class="grid g-2-1">
        <div class="card fade-in">
          <div class="card-h"><h3>Faturamento ${byMonth ? 'por mês' : 'por dia'}</h3><div class="grow"></div>${legendHtml(SERIES.map((x) => ({ label: x.label, color: cssVar(x.color) })))}</div>
          ${r.totais.total ? '<div class="chart-box lg"><canvas id="cRange"></canvas></div>' : emptyState('Sem faturamento no período', 'Escolha outro período ou importe os relatórios do CashBarber.')}
        </div>
        <div class="card fade-in">
          <div class="card-h"><h3>Composição</h3><div class="grow"></div><span class="hint">${brl(r.totais.total)}</span></div>
          <div class="comp-list">
            ${SERIES.map((x) => {
              const val = r.totais[x.key]; const p = r.totais.total ? (val / r.totais.total) * 100 : 0;
              return `<div class="comp-item"><div class="l"><span><i style="background:${cssVar(x.color)}"></i>${x.label}</span><b class="num">${brl(val)} <span class="muted" style="font-weight:500">· ${pct(p)}</span></b></div>
                <div class="bar"><i data-w="${p}" style="width:0;background:${cssVar(x.color)};transition:width .9s"></i></div></div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="grid g-2-1">
        ${r.por_mes.length > 1 ? `<div class="card fade-in">
          <div class="card-h"><h3>Mês a mês</h3></div>
          <div class="table-wrap"><table class="t">
            <thead><tr><th>Mês</th><th class="r">Dias</th>${SERIES.map((x) => `<th class="r">${x.short || x.label}</th>`).join('')}<th class="r">Total</th></tr></thead>
            <tbody>${r.por_mes.map((mo) => `<tr><td><b>${mo.nome} ${mo.ano}</b></td><td class="r num">${mo.dias}</td>${SERIES.map((x) => `<td class="r num">${brl(mo[x.key])}</td>`).join('')}<td class="r num"><b>${brl(mo.total)}</b></td></tr>`).join('')}</tbody>
            <tfoot><tr><td>Total</td><td class="r num">${r.dias_no_periodo}</td>${SERIES.map((x) => `<td class="r num">${brl(r.totais[x.key])}</td>`).join('')}<td class="r num">${brl(r.totais.total)}</td></tr></tfoot>
          </table></div></div>` : '<div></div>'}
        <div class="card fade-in">
          <div class="card-h"><h3>Top profissionais</h3><div class="grow"></div><a href="#/profissionais" class="hint">ver todos →</a></div>
          ${topPros(ps)}
          ${ps.parcial ? '<p class="muted" style="font-size:12px;margin:12px 0 0">Os números da equipe são mensais e incluem os meses inteiros que o período toca.</p>' : ''}
        </div>
      </div>
      ${reportsSection(rep)}`;

    animateBars(view);
    $('#goMonth').onclick = () => setPeriod({ mode: 'mes', y: ay, m: am });
    $$('.rank-item', view).forEach((el) => el.addEventListener('click', () => proDetail(Number(el.dataset.id))));
    if (!r.totais.total) return;
    chart($('#cRange'), {
      type: 'bar',
      data: {
        labels: groups.map(label),
        datasets: SERIES.map((x) => ({
          label: x.label, data: groups.map((g) => g[x.key]), backgroundColor: cssVar(x.color),
          borderColor: cssVar('--surface'), borderWidth: 1, borderRadius: 4, borderSkipped: false, maxBarThickness: byMonth ? 44 : 22, stack: 'a',
        })),
      },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 16 } }, y: { ...moneyAxis, stacked: true } },
        plugins: {
          tooltip: {
            filter: (i) => i.raw > 0,
            callbacks: {
              title: (it) => { const g = groups[it[0].dataIndex]; return byMonth ? `${g.nome} ${g.ano}` : `${fmtFull(g.date)} · ${g.dia_semana}`; },
              label: (c) => ` ${c.dataset.label}: ${brl(c.raw)}`,
              footer: (it) => `Total: ${brl(groups[it[0].dataIndex].total)}`,
            },
          },
        },
      },
    });
  }


  // ============================================================ Agenda, clube e serviços (relatórios importados)
  const rate = (n, d) => (d ? pct((n / d) * 100) : '—');

  // Faixa de destaque do clube de assinatura (Painel de metas e resumo do período)
  function subsHero(as) {
    if (!as || as.total == null) return '';
    const saldo = as.novas_no_periodo != null && as.cancelamentos != null ? as.novas_no_periodo - as.cancelamentos : null;
    const emDia = as.total ? (as.ativos / as.total) * 100 : 0;
    return `<div class="card subs-hero fade-in">
      <div class="subs-main"><div class="eyebrow">Clube de assinatura · ${esc(as.referencia.nome)}</div>
        <div class="subs-num num">${int(as.total)} <span>assinaturas</span></div></div>
      <div class="subs-split">
        <div><span class="dot good"></span><b class="num">${int(as.ativos ?? 0)}</b> em dia</div>
        <div><span class="dot warn"></span><b class="num">${int(as.inadimplentes ?? 0)}</b> com pagamento pendente</div>
        <div class="progress good" style="height:8px;margin-top:4px" title="${pct(emDia)} em dia"><i data-w="${emDia}" style="width:0"></i></div>
      </div>
      <div class="subs-flow">
        ${as.novas_no_periodo != null ? `<div><b class="num" style="color:var(--good)">+${int(as.novas_no_periodo)}</b><span>novas</span></div>` : ''}
        ${as.cancelamentos != null ? `<div><b class="num" style="color:var(--bad)">−${int(as.cancelamentos)}</b><span>cancelamentos</span></div>` : ''}
        ${saldo != null ? `<div><b class="num">${saldo >= 0 ? '+' : '−'}${int(Math.abs(saldo))}</b><span>saldo</span></div>` : ''}
      </div>
    </div>`;
  }

  function reportsSection(rep) {
    if (!rep || (!rep.agenda && !rep.assinaturas && !rep.servicos)) return '';
    const ag = rep.agenda; const as = rep.assinaturas; const sv = rep.servicos;
    const tile = (l, v, foot = '') => `<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:12px 14px"><div class="muted" style="font-size:12px">${l}</div><div class="num" style="font-family:var(--font-display);font-size:19px;font-weight:700">${v}</div>${foot ? `<div class="muted" style="font-size:11.5px">${foot}</div>` : ''}</div>`;
    const atendidos = ag ? ag.totais.total - ag.totais.futuros : 0;
    const svaList = sv ? sv.lista.filter((x) => x.sva).slice(0, 8) : [];
    const maxSva = Math.max(1, ...svaList.map((x) => x.faturado));
    return `<div class="grid g-3">
      ${ag ? `<div class="card fade-in"><div class="card-h"><h3>${icon('calendar')} Agenda</h3><div class="grow"></div><span class="hint">CashBarber</span></div>
        <div class="grid g-2" style="gap:10px">
          ${tile('Agendamentos', int(ag.totais.total), ag.totais.futuros ? `${int(ag.totais.futuros)} ainda por vir` : '')}
          ${tile('Comparecimento', rate(ag.totais.finalizados, atendidos), `${int(ag.totais.finalizados)} finalizados`)}
          ${tile('Cancelados', int(ag.totais.cancelados), rate(ag.totais.cancelados, ag.totais.total))}
          ${tile('Faltas', int(ag.totais.faltas), rate(ag.totais.faltas, atendidos))}
          ${tile('Pelo app', rate(ag.totais.app, ag.totais.total), `${int(ag.totais.app)} agendamentos`)}
          ${tile('Assinantes (clube)', rate(ag.totais.clube, ag.totais.total), `${int(ag.totais.total - ag.totais.clube)} avulsos`)}
        </div></div>` : ''}
      ${as ? `<div class="card fade-in"><div class="card-h"><h3>${icon('ticket')} Clube de assinatura</h3><div class="grow"></div><span class="hint">base em ${as.referencia.nome}</span></div>
        <div class="grid g-2" style="gap:10px">
          ${tile('Assinaturas', as.total != null ? int(as.total) : '—', `${as.ativos != null ? int(as.ativos) : '—'} em dia · ${as.inadimplentes != null ? int(as.inadimplentes) : '—'} pendentes`)}
          ${tile('Novas · cancelamentos', `${as.novas_no_periodo ?? '—'} · ${as.cancelamentos ?? '—'}`, as.novas_no_periodo != null && as.cancelamentos != null ? `saldo ${as.novas_no_periodo - as.cancelamentos >= 0 ? '+' : ''}${as.novas_no_periodo - as.cancelamentos}` : '')}
        </div>
        ${as.motivos?.length ? `<div class="eyebrow" style="margin:14px 0 8px">Motivos de cancelamento</div><div class="comp-list">${as.motivos.slice(0, 5).map(([k, n]) => `<div class="comp-item"><div class="l"><span>${esc(k)}</span><b class="num">${n}</b></div><div class="bar"><i style="width:${(n / as.motivos[0][1]) * 100}%;background:var(--accent)"></i></div></div>`).join('')}</div>` : ''}
        ${as.planos?.length ? `<div class="eyebrow" style="margin:14px 0 8px">Planos em dia</div><div class="chips">${as.planos.slice(0, 6).map(([k, n]) => `<span class="chip">${esc(k)} · ${n}</span>`).join('')}</div>` : ''}
      </div>` : ''}
      ${svaList.length ? `<div class="card fade-in"><div class="card-h"><h3>${icon('spark')} Serviços adicionais (SVA)</h3><div class="grow"></div><span class="hint">${brl(sv.sva_total)}</span></div>
        <div class="comp-list">${svaList.map((x) => `<div class="comp-item"><div class="l"><span>${esc(x.nome)} <span class="muted">· ${int(x.quantidade)}x</span></span><b class="num">${brl(x.faturado)}</b></div><div class="bar"><i style="width:${(x.faturado / maxSva) * 100}%;background:var(--s4)"></i></div></div>`).join('')}</div>
      </div>` : ''}
    </div>`;
  }
  function agendaTable(ag) {
    if (!ag) return '';
    const atend = (p) => p.total - p.futuros;
    return `<div class="card fade-in">
      <div class="card-h"><h3>Agenda por profissional</h3><div class="grow"></div><span class="hint">agendamentos do CashBarber</span></div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Profissional</th><th class="r">Agendamentos</th><th class="r">Finalizados</th><th class="r">Comparecimento</th><th class="r">Cancelados</th><th class="r">Faltas</th><th class="r">Pelo app</th><th class="r">Assinantes</th><th class="r">Por vir</th></tr></thead>
        <tbody>${ag.profissionais.map((p) => `<tr><td><span style="display:inline-flex;align-items:center;gap:8px"><i style="width:8px;height:8px;border-radius:50%;background:${proColor(p.professional_id)}"></i><b>${esc(p.nome)}</b></span></td>
          <td class="r num">${int(p.total)}</td><td class="r num">${int(p.finalizados)}</td><td class="r num">${rate(p.finalizados, atend(p))}</td><td class="r num">${int(p.cancelados)}</td>
          <td class="r num">${int(p.faltas)} <span class="muted">(${rate(p.faltas, atend(p))})</span></td><td class="r num">${rate(p.app, p.total)}</td><td class="r num">${rate(p.clube, p.total)}</td><td class="r num">${int(p.futuros)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="r num">${int(ag.totais.total)}</td><td class="r num">${int(ag.totais.finalizados)}</td><td class="r num">${rate(ag.totais.finalizados, ag.totais.total - ag.totais.futuros)}</td><td class="r num">${int(ag.totais.cancelados)}</td>
          <td class="r num">${int(ag.totais.faltas)}</td><td class="r num">${rate(ag.totais.app, ag.totais.total)}</td><td class="r num">${rate(ag.totais.clube, ag.totais.total)}</td><td class="r num">${int(ag.totais.futuros)}</td></tr></tfoot>
      </table></div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">Comparecimento e faltas consideram só os agendamentos de dias que já passaram.</p>
    </div>`;
  }

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    if (h.length !== 6) return hex;
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const dayName = (iso) => { const [y, m, d] = iso.split('-').map(Number); return WEEK_SHORT[new Date(y, m - 1, d).getDay()]; };

  function quinzenaCard(q, n, current) {
    const done = q.realizado >= q.meta && q.meta > 0;
    return `<div class="card q-card fade-in ${current ? 'current' : ''}">
      <div class="q-top">
        <div><div class="eyebrow">${n}ª quinzena · dias ${q.inicio} a ${q.termino}</div><div class="q-val num">${brl(q.realizado)}</div>
          <div class="q-meta">SVA + assinaturas · meta ${brl(q.meta)}</div></div>
        ${current ? '<span class="badge accent">Em andamento</span>' : done ? `<span class="badge good">${icon('check')} Batida</span>` : `<span class="badge neutral">${q.dia_apuracao >= q.termino ? 'Encerrada' : 'A iniciar'}</span>`}
      </div>
      <div class="progress ${done ? 'good' : ''}"><i data-w="${Math.min(100, q.percentual)}" style="width:0"></i></div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12.5px"><span class="muted">${pct(q.percentual)} atingido</span><span class="muted">Faltam <b style="color:var(--text)">${brl(q.restante)}</b></span></div>
      <div class="stats">
        <div><span>Dia de apuração</span><b>${q.dia_apuracao || '—'}</b></div>
        <div><span>Dias úteis rest.</span><b>${q.dias_uteis_restantes}</b></div>
        <div><span>Dias não úteis</span><b>${q.dias_nao_uteis}</b></div>
        <div><span>Restante / dia</span><b>${brlShort(q.restante_por_dia)}</b></div>
        <div><span>SVA</span><b>${brlShort(q.sva)}</b></div>
        <div><span>Assinaturas</span><b>${brlShort(q.assinaturas)}</b></div>
      </div>
    </div>`;
  }

  function topPros(ps) {
    const list = ps.profissionais.filter((p) => p.has_data).sort((a, b) => b.faturamento_total - a.faturamento_total).slice(0, 6);
    if (!list.length) return emptyState('Sem dados da equipe', `Nenhum lançamento de profissional em ${ps.mes_nome}.`);
    const max = list[0].faturamento_total || 1;
    return `<div class="rank">${list.map((p, i) => `
      <div class="rank-item ${i === 0 ? 'p1' : ''}" data-id="${p.professional_id}">
        <div class="pos">${i + 1}</div>
        <div class="avatar" style="background:${proColor(p.professional_id)};color:#fff;border:none">${esc(initials(p.name))}</div>
        <div class="info"><b>${esc(p.name)}</b><div class="bar"><i data-w="${(p.faturamento_total / max) * 100}" style="width:0;transition:width .9s;background:${proColor(p.professional_id)}"></i></div></div>
        <div class="amt num">${brl(p.faturamento_total)}<small>${int(p.clientes_atendidos)} atendimentos</small></div>
      </div>`).join('')}</div>`;
  }

  // ============================================================ Faturamento diário
  async function viewDaily(view) {
    const ranged = isRange();
    const d = ranged ? await api(`/api/periodo?${periodQS()}`) : await api(`/api/dashboard?ano=${state.y}&mes=${state.m}`);
    const multiYear = ranged && d.de.slice(0, 4) !== d.ate.slice(0, 4);
    const dayLabel = (iso) => (multiYear ? fmtFull(iso).slice(0, 6) + iso.slice(2, 4) : fmtDate(iso));
    const monthBreaks = ranged && d.por_mes.length > 1;
    const subtotal = (mo) => `<tr class="subtotal"><td colspan="2">${mo.nome} ${mo.ano}</td>${SERIES.map((x) => `<td class="r num">${brl(mo[x.key])}</td>`).join('')}<td></td><td class="r num">${brl(mo.total)}</td></tr>`;
    const admin = isAdmin();
    const t = new Date();
    const todayIso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    $('#pageSub').textContent = admin ? 'Clique nos valores para editar manualmente · salva automaticamente' : 'Somente leitura';
    view.innerHTML = `
      <div class="grid g-6">
        ${SERIES.map((s) => `<div class="card kpi fade-in"><div class="top"><div class="ico" style="background:${hexA(cssVar(s.color), 0.16)};color:${cssVar(s.color)}">${icon(s.key === 'produtos' ? 'bag' : s.key === 'servicos' ? 'scissors' : s.key === 'sva' ? 'spark' : s.key === 'recorrencia' ? 'refresh' : 'ticket')}</div>${s.label}</div><div class="v num">${brl(d.totais[s.key])}</div><div class="foot">${d.totais.total ? pct((d.totais[s.key] / d.totais.total) * 100) : '0%'} do total</div></div>`).join('')}
        ${kpi({ label: 'Faturamento total', value: brl(d.totais.total), foot: ranged ? `${d.dias_no_periodo} dias · média ${brl(d.media_diaria)}/dia` : `Meta ${brl(d.mensal.meta)} · ${pct(d.mensal.percentual)}`, ic: 'cash', tone: 'accent' })}
      </div>
      <div class="card fade-in">
        <div class="card-h"><h3>${ranged ? rangeTitle() : `${d.mes_nome} ${d.ano}`}</h3><div class="grow"></div>
          <button class="btn btn-sm" id="exportCsv">${icon('download')} Exportar CSV</button></div>
        <div class="table-wrap">
          <table class="t" id="dailyTable">
            <thead><tr><th>Data</th><th>Dia</th>${SERIES.map((s) => `<th class="r">${s.short || s.label}</th>`).join('')}<th>Status</th><th class="r">Total</th></tr></thead>
            <tbody>${d.dias.map((x, i) => `${monthBreaks && i > 0 && x.dia === 1 ? subtotal(d.por_mes.find((mo) => mo.ano === d.dias[i - 1].ano && mo.mes === d.dias[i - 1].mes)) : ''}
              <tr class="${x.util ? '' : 'off'} ${x.date === todayIso ? 'today' : ''}" data-date="${x.date}">
                <td class="num"><b>${dayLabel(x.date)}</b></td><td>${x.dia_semana}${x.util ? '' : ' <span class="badge neutral" style="font-size:10.5px">não útil</span>'}</td>
                ${SERIES.map((s) => `<td class="r num">${admin ? `<input class="cell num" data-k="${s.key}" value="${num2(x[s.key])}" placeholder="0,00" inputmode="decimal" aria-label="${s.label} ${fmtDate(x.date)}">` : brl(x[s.key])}</td>`).join('')}
                <td>${admin ? `<select class="input input-sm" data-k="status" style="width:auto">${['PREVISTO', 'REALIZADO', ...(x.status === 'DEMO' ? ['DEMO'] : [])].map((st) => `<option ${st === x.status ? 'selected' : ''}>${st}</option>`).join('')}</select>` : `<span class="status ${x.status}">${x.status}</span>`}</td>
                <td class="r num"><b data-total>${brl(x.total)}</b></td>
              </tr>`).join('')}
            ${monthBreaks ? subtotal(d.por_mes[d.por_mes.length - 1]) : ''}</tbody>
            <tfoot><tr><td colspan="2">${ranged ? 'Total do período' : 'Total do mês'}</td>${SERIES.map((s) => `<td class="r num">${brl(d.totais[s.key])}</td>`).join('')}<td></td><td class="r num">${brl(d.totais.total)}</td></tr></tfoot>
          </table>
        </div>
      </div>`;

    $('#exportCsv').onclick = () => {
      const rows = [['Data', 'Dia da semana', ...SERIES.map((s) => s.label), 'Status', 'Faturamento total']];
      d.dias.forEach((x) => rows.push([fmtFull(x.date), x.dia_semana, ...SERIES.map((s) => num2(x[s.key]) || '0'), x.status, num2(x.total) || '0']));
      download(ranged ? `faturamento-${d.de}-a-${d.ate}.csv` : `faturamento-${d.ano}-${String(d.mes).padStart(2, '0')}.csv`, rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n'));
    };
    if (!admin) return;
    const save = async (tr) => {
      const body = {};
      $$('[data-k]', tr).forEach((i) => { body[i.dataset.k] = i.value; });
      if (body.status === 'DEMO') body.status = 'REALIZADO';
      try {
        await api(`/api/admin/diario/${tr.dataset.date}`, { method: 'PUT', body });
        const total = SERIES.reduce((s, x) => s + parseBR(body[x.key]), 0);
        $('[data-total]', tr).textContent = brl(total);
        toast(`Dia ${fmtDate(tr.dataset.date)} salvo`);
      } catch (e) { toast(e.message, 'err'); }
    };
    $$('#dailyTable tbody tr[data-date]').forEach((tr) => {
      $$('input.cell', tr).forEach((i) => {
        i.addEventListener('change', () => {
          const st = $('[data-k="status"]', tr);
          if (parseBR(i.value) > 0 && st.value === 'PREVISTO') st.value = 'REALIZADO';
          i.value = num2(parseBR(i.value));
          save(tr);
        });
        i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
      });
      $('[data-k="status"]', tr).addEventListener('change', () => save(tr));
    });
  }
  const parseBR = (v) => { let s = String(v || '').replace(/[R$\s]/g, ''); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return Number(s) || 0; };
  function download(name, text) {
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ============================================================ Profissionais
  const psTitle = (ps) => (ps.de ? ps.mes_nome : `${ps.mes_nome} ${ps.ano}`);

  async function viewPros(view) {
    const [ps, yr] = await Promise.all([
      api(`/api/profissionais/stats?${periodQS()}`),
      api(`/api/profissionais/ano?ano=${periodYear()}`),
    ]);
    const rep = await api(`/api/relatorios?${periodQS()}`).catch(() => null);
    const list = ps.profissionais.filter((p) => p.has_data).sort((a, b) => b.faturamento_total - a.faturamento_total);
    $('#pageSub').textContent = `${list.length} profissionais com dados em ${ps.mes_nome}${ps.parcial ? ' · dados mensais: o período inclui os meses inteiros que ele toca' : ''}`;
    if (!list.length) {
      const withData = yr.meses.filter((m) => m.faturamento_total > 0);
      const last = withData[withData.length - 1];
      view.innerHTML = `<div class="card">${emptyState(`Sem dados em ${psTitle(ps)}`, 'Os números dos profissionais chegam pelo webhook do CashBarber ou podem ser lançados no painel admin.',
        `${last ? `<button class="btn btn-primary" id="goLast">Ver ${last.nome}</button> ` : ''}${isAdmin() ? '<a class="btn" href="#/admin/lancamentos">Lançar dados</a>' : ''}`)}</div>`;
      $('#goLast', view)?.addEventListener('click', () => setPeriod({ mode: 'mes', y: periodYear(), m: last.mes }));
      return;
    }
    const T = ps.total; const A = ps.media;
    const leader = list[0];
    const catalog = Object.keys(T.extras).filter((k) => T.extras[k] > 0).sort((a, b) => T.extras[b] - T.extras[a]);
    const maxExtra = Math.max(1, ...list.flatMap((p) => catalog.map((k) => Number(p.extras[k] || 0))));
    const cols = [
      ['faturamento_total', 'Faturamento', brl], ['faturamento_assinatura', 'Fat. assinatura', brl], ['comissao', 'Comissão', brl], ['ticket_medio', 'Ticket médio', brl],
      ['clientes_atendidos', 'Atendimentos', int], ['geracao_demanda', 'Geração de demanda', int], ['servicos_realizados', 'Serviços', int], ['venda_produtos', 'Venda produtos', brl], ['qtd_produtos', 'Qtd. produtos', int],
    ];

    view.innerHTML = `
      <div class="grid g-4">
        ${kpi({ label: 'Faturamento da equipe', value: brl(T.faturamento_total), foot: `Média ${brl(A.faturamento_total)} por profissional`, ic: 'cash', tone: 'accent' })}
        ${kpi({ label: 'Atendimentos', value: int(T.clientes_atendidos), foot: `${int(T.geracao_demanda)} em geração de demanda`, ic: 'users' })}
        ${kpi({ label: 'Ticket médio (equipe)', value: brl(teamTicket(list)), foot: `Média simples dos tickets: ${brl(A.ticket_medio)}`, ic: 'ticket' })}
        ${kpi({ label: 'Comissões', value: brl(T.comissao), foot: `Assinaturas ${brl(T.faturamento_assinatura)}`, ic: 'star' })}
      </div>

      <div class="pro-cards">
        ${list.map((p, i) => {
          const share = T.faturamento_total ? (p.faturamento_total / T.faturamento_total) * 100 : 0;
          return `<div class="card pro-card fade-in" data-id="${p.professional_id}" style="animation-delay:${i * 40}ms">
            <div class="head"><div class="avatar" style="background:${proColor(p.professional_id)}">${esc(initials(p.name))}</div>
              <div><b>${esc(p.name)}</b><span class="muted" style="font-size:12px">${pct(share)} do faturamento</span></div>
              ${i === 0 ? `<span class="medal">${icon('star')} Líder</span>` : `<span class="muted" style="margin-left:auto;font-weight:700">#${i + 1}</span>`}</div>
            <div class="big num">${brl(p.faturamento_total)}</div>
            <div class="progress" style="height:6px;margin-top:10px"><i data-w="${share}" style="width:0;background:${proColor(p.professional_id)}"></i></div>
            <div class="mini">
              <div>Atendimentos<b>${int(p.clientes_atendidos)}</b></div>
              <div>Ticket<b>${brlShort(p.ticket_medio)}</b></div>
              <div>Comissão<b>${brlShort(p.comissao)}</b></div>
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="grid g-2">
        <div class="card fade-in"><div class="card-h"><h3>Faturamento por profissional</h3><div class="grow"></div><span class="hint">total vs assinaturas</span></div>
          ${legendHtml([{ label: 'Faturamento total', color: cssVar('--s1') }, { label: 'Faturamento de assinatura', color: cssVar('--s3') }])}
          <div class="chart-box" style="margin-top:10px"><canvas id="cProFat"></canvas></div></div>
        <div class="card fade-in"><div class="card-h"><h3>Ticket médio</h3><div class="grow"></div><span class="hint">linha = média da equipe</span></div>
          <div class="chart-box" style="margin-top:10px"><canvas id="cProTicket"></canvas></div></div>
      </div>

      <div class="card fade-in">
        <div class="card-h"><h3>Evolução mensal ${periodYear()}</h3><div class="grow"></div>${legendHtml(state.pros.filter((p) => yr.meses.some((m) => m.profissionais[p.name])).map((p) => ({ label: p.name, color: proColor(p.id) })))}</div>
        <div class="chart-box"><canvas id="cEvo"></canvas></div>
      </div>

      <div class="card fade-in">
        <div class="card-h"><h3>Comparativo completo · ${ps.mes_nome}</h3><div class="grow"></div><button class="btn btn-sm" id="exportPros">${icon('download')} CSV</button></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Profissional</th>${cols.map((c) => `<th class="r">${c[1]}</th>`).join('')}</tr></thead>
          <tbody>${list.map((p) => `<tr style="cursor:pointer" data-id="${p.professional_id}"><td><span style="display:inline-flex;align-items:center;gap:8px"><i style="width:8px;height:8px;border-radius:50%;background:${proColor(p.professional_id)}"></i><b>${esc(p.name)}</b></span></td>
            ${cols.map(([k, , f]) => { const best = Math.max(...list.map((x) => x[k])); return `<td class="r num" ${p[k] && p[k] === best && list.length > 1 ? 'style="color:var(--accent);font-weight:700"' : ''}>${p[k] ? f(p[k]) : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody>
          <tfoot><tr><td>Média</td>${cols.map(([k, , f]) => `<td class="r num">${f(A[k])}</td>`).join('')}</tr>
            <tr><td>Total</td>${cols.map(([k, , f]) => `<td class="r num">${k === 'ticket_medio' ? '—' : f(T[k])}</td>`).join('')}</tr></tfoot>
        </table></div>
        <p class="muted" style="font-size:12px;margin:10px 0 0">Valores em destaque indicam o melhor resultado da equipe no indicador.</p>
      </div>

      ${agendaTable(rep?.agenda)}

      <div class="card fade-in">
        <div class="card-h"><h3>Serviços adicionais (SVA) por profissional</h3><div class="grow"></div><span class="hint">quantidade · cor mais intensa = mais vendas</span></div>
        ${catalog.length ? `<div class="table-wrap"><table class="t heat">
          <thead><tr><th>Serviço</th>${list.map((p) => `<th class="r">${esc(p.name)}</th>`).join('')}<th class="r">Total</th></tr></thead>
          <tbody>${catalog.map((k) => `<tr><td><b>${esc(k)}</b></td>${list.map((p) => { const v = Number(p.extras[k] || 0); const a = v / maxExtra; return `<td class="h num" style="background:${hexA(cssVar('--s1'), 0.08 + a * 0.62)};${a > 0.55 ? 'color:#fff' : ''}" title="${esc(p.name)} · ${esc(k)}: ${v}">${v || '·'}</td>`; }).join('')}<td class="r num"><b>${int(T.extras[k])}</b></td></tr>`).join('')}</tbody>
        </table></div>` : emptyState('Sem serviços adicionais registrados', 'Quando o CashBarber enviar itens de SVA, eles aparecerão aqui.')}
      </div>`;

    animateBars(view);
    $$('[data-id]', view).forEach((el) => el.addEventListener('click', () => proDetail(Number(el.dataset.id))));
    $('#exportPros').onclick = () => {
      const rows = [['Profissional', ...cols.map((c) => c[1]), ...catalog]];
      list.forEach((p) => rows.push([p.name, ...cols.map(([k]) => NUM.format(p[k] || 0)), ...catalog.map((k) => p.extras[k] || 0)]));
      download(`profissionais-${ps.ano}-${String(ps.mes).padStart(2, '0')}.csv`, rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n'));
    };

    const names = list.map((p) => p.name);
    chart($('#cProFat'), {
      type: 'bar',
      data: { labels: names, datasets: [
        { label: 'Faturamento total', data: list.map((p) => p.faturamento_total), backgroundColor: cssVar('--s1'), borderRadius: 4, maxBarThickness: 26, borderColor: cssVar('--surface'), borderWidth: 1 },
        { label: 'Faturamento de assinatura', data: list.map((p) => p.faturamento_assinatura), backgroundColor: cssVar('--s3'), borderRadius: 4, maxBarThickness: 26, borderColor: cssVar('--surface'), borderWidth: 1 },
      ] },
      options: { maintainAspectRatio: false, indexAxis: 'y', interaction: { mode: 'index', intersect: false },
        scales: { x: { ...moneyAxis }, y: { grid: { display: false }, border: { display: false } } },
        plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${brl(c.raw)}` } } } },
    });
    const tAvg = A.ticket_medio;
    chart($('#cProTicket'), {
      type: 'bar',
      data: { labels: names, datasets: [{ label: 'Ticket médio', data: list.map((p) => p.ticket_medio), backgroundColor: list.map((p) => proColor(p.professional_id)), borderRadius: 4, maxBarThickness: 44 }] },
      options: { maintainAspectRatio: false,
        scales: { y: { ...moneyAxis, beginAtZero: true }, x: { grid: { display: false }, border: { display: false } } },
        plugins: { tooltip: { callbacks: { label: (c) => ` Ticket médio: ${brl(c.raw)}`, afterLabel: (c) => ` ${c.raw >= tAvg ? '▲ acima' : '▼ abaixo'} da média (${brl(tAvg)})` } } } },
      plugins: [avgLinePlugin(tAvg)],
    });
    const evoPros = state.pros.filter((p) => yr.meses.some((m) => m.profissionais[p.name]));
    chart($('#cEvo'), {
      type: 'line',
      data: { labels: MONTHS.map((m) => m.slice(0, 3)), datasets: evoPros.map((p) => ({
        label: p.name, data: yr.meses.map((m) => m.profissionais[p.name] ?? null), borderColor: proColor(p.id), backgroundColor: proColor(p.id),
        borderWidth: 2, tension: 0.3, spanGaps: false, pointRadius: 4, pointHoverRadius: 6, pointBorderColor: cssVar('--surface'), pointBorderWidth: 2,
      })) },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { ...moneyAxis, beginAtZero: true }, x: { grid: { display: false }, border: { display: false } } },
        plugins: { tooltip: { itemSort: (a, b) => b.raw - a.raw, callbacks: { label: (c) => (c.raw === null ? null : ` ${c.dataset.label}: ${brl(c.raw)}`) } } } },
    });
  }

  // Ticket da equipe na mesma base dos individuais (cada ticket pondera pelo nº de atendimentos pagos)
  function teamTicket(list) {
    const withTicket = list.filter((p) => p.ticket_medio > 0);
    const pagos = withTicket.reduce((s, p) => s + p.faturamento_total / p.ticket_medio, 0);
    return pagos ? withTicket.reduce((s, p) => s + p.faturamento_total, 0) / pagos : 0;
  }

  function avgLinePlugin(value) {
    return {
      id: 'avgLine',
      afterDatasetsDraw(c) {
        const y = c.scales.y.getPixelForValue(value);
        const { left, right } = c.chartArea;
        const ctx = c.ctx;
        ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = cssVar('--text-2'); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = cssVar('--text-2'); ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(`média ${brl(value)}`, right, y - 6); ctx.restore();
      },
    };
  }

  async function proDetail(id) {
    const pro = state.pros.find((p) => p.id === id);
    if (!pro) return;
    const [ps, yr] = await Promise.all([api(`/api/profissionais/stats?${periodQS()}`), api(`/api/profissionais/ano?ano=${periodYear()}`)]);
    const inPeriod = (mes) => (isRange() ? ps.meses.some((x) => x.ano === periodYear() && x.mes === mes) : mes === state.m);
    const p = ps.profissionais.find((x) => x.professional_id === id) || {};
    const extras = Object.entries(p.extras || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const maxE = Math.max(1, ...extras.map((e) => e[1]));
    const share = ps.total.faturamento_total ? (p.faturamento_total / ps.total.faturamento_total) * 100 : 0;
    const vsAvg = (k) => { const a = ps.media[k]; if (!a || !p[k]) return ''; const v = ((p[k] - a) / a) * 100; return `<span class="badge ${v >= 0 ? 'good' : 'bad'}" style="font-size:11px">${icon(v >= 0 ? 'up' : 'down')}${pct(Math.abs(v))}</span>`; };
    modal({
      wide: true,
      title: `<span style="display:inline-flex;align-items:center;gap:12px"><span class="avatar" style="background:${proColor(id)};color:#fff;border:none">${esc(initials(pro.name))}</span>${esc(pro.name)} <span class="muted" style="font-weight:500;font-size:13px">· ${psTitle(ps)}</span></span>`,
      body: !p.has_data ? emptyState('Sem dados neste mês', 'Selecione outro mês no topo da página.') : `
        <div class="grid g-4" style="gap:12px">
          ${[['Faturamento', brl(p.faturamento_total), 'faturamento_total'], ['Ticket médio', brl(p.ticket_medio), 'ticket_medio'], ['Atendimentos', int(p.clientes_atendidos), 'clientes_atendidos'], ['Comissão', brl(p.comissao), 'comissao'],
            ['Fat. assinatura', brl(p.faturamento_assinatura), 'faturamento_assinatura'], ['Geração de demanda', int(p.geracao_demanda), 'geracao_demanda'], ['Serviços realizados', int(p.servicos_realizados), 'servicos_realizados'], ['Venda de produtos', `${brl(p.venda_produtos)} <span class="muted" style="font-size:12px">(${int(p.qtd_produtos)} un.)</span>`, 'venda_produtos']]
            .map(([l, v, k]) => `<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:12px 14px"><div class="muted" style="font-size:12px">${l}</div><div style="font-family:var(--font-display);font-size:18px;font-weight:700" class="num">${v}</div><div style="margin-top:4px;font-size:11px">${vsAvg(k)} ${vsAvg(k) ? '<span class="muted">vs média</span>' : ''}</div></div>`).join('')}
        </div>
        <p class="muted" style="margin:14px 0 18px;font-size:13px">Responsável por <b style="color:var(--text)">${pct(share)}</b> do faturamento da equipe no mês.</p>
        <div class="grid g-2" style="gap:16px">
          <div><h4 style="font-size:14px;margin-bottom:12px">Serviços adicionais</h4>
            ${extras.length ? `<div class="comp-list">${extras.map(([k, v]) => `<div class="comp-item"><div class="l"><span>${esc(k)}</span><b class="num">${int(v)}</b></div><div class="bar"><i style="width:${(v / maxE) * 100}%;background:${proColor(id)}"></i></div></div>`).join('')}</div>` : '<p class="muted">Nenhum SVA registrado.</p>'}</div>
          <div><h4 style="font-size:14px;margin-bottom:12px">Faturamento mês a mês · ${periodYear()}</h4><div class="chart-box sm"><canvas id="cProEvo"></canvas></div></div>
        </div>`,
      onMount: (el) => {
        const cv = $('#cProEvo', el);
        if (!cv) return;
        chart(cv, {
          type: 'bar',
          data: { labels: MONTHS.map((m) => m.slice(0, 3)), datasets: [{ label: 'Faturamento', data: yr.meses.map((m) => m.profissionais[pro.name] || 0), backgroundColor: yr.meses.map((m) => (inPeriod(m.mes) ? proColor(id) : hexA(proColor(id), 0.35))), borderRadius: 4, maxBarThickness: 28 }] },
          options: { maintainAspectRatio: false, scales: { y: { ...moneyAxis, beginAtZero: true }, x: { grid: { display: false }, border: { display: false } } }, plugins: { tooltip: { callbacks: { label: (c) => ` ${brl(c.raw)}` } } } },
        }, modalCharts);
      },
    });
  }

  // ============================================================ Admin · Lançamentos
  async function viewAdminLanc(view) {
    const [ps, cfg] = await Promise.all([api(`/api/profissionais/stats?ano=${state.y}&mes=${state.m}`), api('/api/config/publica')]);
    $('#pageSub').textContent = 'Lançamento manual dos indicadores mensais (o webhook atualiza automaticamente)';
    const actives = state.pros.filter((p) => p.active || ps.profissionais.some((x) => x.professional_id === p.id && x.has_data));
    view.innerHTML = `
      <div class="card fade-in">
        <div class="card-h"><h3>${ps.mes_nome} ${ps.ano}</h3><div class="grow"></div><a class="btn btn-sm" href="#/admin/equipe">${icon('plus')} Novo profissional</a></div>
        ${actives.length ? `<div class="table-wrap"><table class="t">
          <thead><tr><th>Profissional</th><th class="r">Faturamento</th><th class="r">Assinatura</th><th class="r">Comissão</th><th class="r">Ticket</th><th class="r">Atendimentos</th><th>Status</th><th></th></tr></thead>
          <tbody>${actives.map((pro) => { const p = ps.profissionais.find((x) => x.professional_id === pro.id) || {}; return `<tr>
            <td><span style="display:inline-flex;align-items:center;gap:10px"><span class="avatar" style="width:30px;height:30px;font-size:11px;background:${proColor(pro.id)};color:#fff;border:none">${esc(initials(pro.name))}</span><b>${esc(pro.name)}</b></span></td>
            <td class="r num">${p.has_data ? brl(p.faturamento_total) : '—'}</td><td class="r num">${p.has_data ? brl(p.faturamento_assinatura) : '—'}</td>
            <td class="r num">${p.has_data ? brl(p.comissao) : '—'}</td><td class="r num">${p.has_data ? brl(p.ticket_medio) : '—'}</td><td class="r num">${p.has_data ? int(p.clientes_atendidos) : '—'}</td>
            <td>${p.has_data ? '<span class="status REALIZADO">LANÇADO</span>' : '<span class="status PREVISTO">PENDENTE</span>'}</td>
            <td class="r"><button class="btn btn-sm" data-edit="${pro.id}">${icon('edit')} ${p.has_data ? 'Editar' : 'Lançar'}</button></td></tr>`; }).join('')}</tbody>
        </table></div>` : emptyState('Nenhum profissional ativo', 'Cadastre a equipe primeiro.', '<a class="btn btn-primary" href="#/admin/equipe">Cadastrar equipe</a>')}
      </div>`;
    $$('[data-edit]', view).forEach((b) => b.addEventListener('click', () => {
      const pro = state.pros.find((x) => x.id === Number(b.dataset.edit));
      const p = ps.profissionais.find((x) => x.professional_id === pro.id) || { extras: {} };
      const extras = [...new Set([...(cfg.extras_catalog || []), ...Object.keys(p.extras || {})])];
      const f = (k, label, money = true) => `<div class="field"><label>${label}</label><input class="input num" name="${k}" value="${money ? num2(p[k]) : (p[k] || '')}" inputmode="decimal" placeholder="${money ? '0,00' : '0'}"></div>`;
      modal({
        wide: true,
        title: `${esc(pro.name)} · ${ps.mes_nome} ${ps.ano}`,
        body: `<form id="lancForm"><div class="form-grid g3">
          ${f('faturamento_total', 'Faturamento total (R$)')}${f('faturamento_assinatura', 'Faturamento de assinatura (R$)')}${f('comissao', 'Comissão (R$)')}
          ${f('ticket_medio', 'Ticket médio (R$) — vazio = automático')}${f('clientes_atendidos', 'Atendimentos', false)}${f('geracao_demanda', 'Geração de demanda (novos + SP)', false)}
          ${f('servicos_realizados', 'Serviços realizados', false)}${f('venda_produtos', 'Venda de produtos (R$)')}${f('qtd_produtos', 'Qtd. de produtos', false)}
        </div>
        <h4 style="font-size:14px;margin:8px 0 12px">Serviços adicionais (quantidade)</h4>
        <div class="form-grid g3">${extras.map((k) => `<div class="field"><label>${esc(k)}</label><input class="input input-sm num" data-extra="${esc(k)}" value="${p.extras?.[k] ?? ''}" inputmode="numeric" placeholder="0"></div>`).join('')}</div></form>`,
        footer: `${p.has_data ? `<button class="btn btn-danger" data-del style="margin-right:auto">${icon('trash')} Apagar mês</button>` : ''}<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-save>${icon('check')} Salvar</button>`,
        onMount: (el, close) => {
          $('[data-save]', el).onclick = async () => {
            const body = Object.fromEntries(new FormData($('#lancForm', el)));
            body.extras = {};
            $$('[data-extra]', el).forEach((i) => { if (i.value !== '') body.extras[i.dataset.extra] = parseBR(i.value); });
            body.ano = state.y; body.mes = state.m;
            try { await api(`/api/admin/profissionais/${pro.id}/mensal`, { method: 'PUT', body }); toast('Lançamento salvo'); close(); route(); } catch (e) { toast(e.message, 'err'); }
          };
          $('[data-del]', el)?.addEventListener('click', async () => {
            if (!(await confirmDialog(`Apagar os dados de ${esc(pro.name)} em ${ps.mes_nome}?`, { ok: 'Apagar' }))) return;
            await api(`/api/admin/profissionais/${pro.id}/mensal?ano=${state.y}&mes=${state.m}`, { method: 'DELETE' });
            toast('Dados apagados'); close(); route();
          });
        },
      });
    }));
  }

  // ============================================================ Admin · Equipe
  async function viewAdminTeam(view) {
    $('#pageSub').textContent = 'Profissionais criados automaticamente pelo webhook também aparecem aqui';
    view.innerHTML = `
      <div class="card fade-in">
        <div class="card-h"><h3>Profissionais</h3><div class="grow"></div><button class="btn btn-primary btn-sm" id="addPro">${icon('plus')} Adicionar</button></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Nome</th><th>ID no CashBarber</th><th>Status</th><th>Cadastro</th><th></th></tr></thead>
          <tbody>${state.pros.map((p) => `<tr>
            <td><span style="display:inline-flex;align-items:center;gap:10px"><span class="avatar" style="width:30px;height:30px;font-size:11px;background:${proColor(p.id)};color:#fff;border:none">${esc(initials(p.name))}</span><b>${esc(p.name)}</b></span></td>
            <td class="muted">${esc(p.external_id || '—')}</td>
            <td>${p.active ? '<span class="status REALIZADO">ATIVO</span>' : '<span class="status PREVISTO">INATIVO</span>'}</td>
            <td class="muted">${fmtDateTime(p.created_at)}</td>
            <td class="r"><button class="btn btn-sm" data-edit="${p.id}">${icon('edit')} Editar</button> <button class="btn btn-sm btn-danger" data-del="${p.id}">${icon('trash')}</button></td>
          </tr>`).join('') || `<tr><td colspan="5">${emptyState('Nenhum profissional', 'Adicione o primeiro membro da equipe.')}</td></tr>`}</tbody>
        </table></div>
      </div>`;
    const form = (p = {}) => modal({
      title: p.id ? 'Editar profissional' : 'Novo profissional',
      body: `<form id="proForm"><div class="field"><label>Nome (igual ao CashBarber)</label><input class="input" name="name" value="${esc(p.name || '')}" required></div>
        <div class="field"><label>ID do profissional no CashBarber (opcional)</label><input class="input" name="external_id" value="${esc(p.external_id || '')}" placeholder="ex.: 1234"></div>
        ${p.id ? `<label class="switch"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Ativo</label>` : ''}</form>`,
      footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-save>Salvar</button>',
      onMount: (el, close) => {
        $('[data-save]', el).onclick = async () => {
          const f = $('#proForm', el); if (!f.reportValidity()) return;
          const body = { name: f.name.value, external_id: f.external_id.value || null };
          if (p.id) body.active = f.active.checked;
          try {
            await api(p.id ? `/api/admin/profissionais/${p.id}` : '/api/admin/profissionais', { method: p.id ? 'PUT' : 'POST', body });
            toast('Profissional salvo'); close(); route();
          } catch (e) { toast(e.message.includes('UNIQUE') ? 'Já existe um profissional com esse nome' : e.message, 'err'); }
        };
      },
    });
    $('#addPro').onclick = () => form();
    $$('[data-edit]', view).forEach((b) => b.addEventListener('click', () => form(state.pros.find((p) => p.id === Number(b.dataset.edit)))));
    $$('[data-del]', view).forEach((b) => b.addEventListener('click', async () => {
      const p = state.pros.find((x) => x.id === Number(b.dataset.del));
      if (!(await confirmDialog(`Excluir <b>${esc(p.name)}</b> e todo o histórico mensal? Para manter o histórico, apenas inative.`, { ok: 'Excluir' }))) return;
      await api(`/api/admin/profissionais/${p.id}`, { method: 'DELETE' }); toast('Profissional excluído'); route();
    }));
  }

  // ============================================================ Admin · Metas
  async function viewAdminConfig(view) {
    const c = await api('/api/admin/config');
    const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    let closed = [...(c.dias_fechados || [])];
    let holidays = [...(c.feriados || [])].sort();
    let extras = [...(c.extras_catalog || [])];
    view.innerHTML = `
      <div class="grid g-2">
        <div class="card fade-in">
          <div class="card-h"><h3>${icon('target')} Meta padrão</h3></div>
          <div class="field"><label>Nome da unidade</label><input class="input" id="cfUnit" value="${esc(c.unidade)}"></div>
          <div class="form-grid">
            <div class="field"><label>Meta mensal de faturamento (R$)</label><input class="input num" id="cfMM" value="${num2(c.meta_mensal)}" inputmode="decimal"></div>
            <div class="field"><label>Meta quinzenal SVA + assinaturas (R$)</label><input class="input num" id="cfMQ" value="${num2(c.meta_quinzenal)}" inputmode="decimal"></div>
          </div>
          <div class="field"><label>Dias em que a barbearia não abre</label><div class="chips" id="cfDays"></div></div>
          <div class="field"><label>Feriados e folgas (dias não úteis)</label>
            <div style="display:flex;gap:8px"><input type="date" class="input" id="cfHol" style="max-width:200px"><button class="btn" id="cfHolAdd">${icon('plus')} Adicionar</button></div>
            <div class="chips" id="cfHols" style="margin-top:10px"></div></div>
          <button class="btn btn-primary" id="cfSave">${icon('check')} Salvar configurações</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:18px">
          <div class="card fade-in">
            <div class="card-h"><h3>${icon('scissors')} Catálogo de serviços adicionais (SVA)</h3></div>
            <p class="muted" style="margin:0 0 12px;font-size:13px">Itens com estes nomes enviados pelo webhook são contados como SVA e somados por profissional.</p>
            <div style="display:flex;gap:8px;margin-bottom:12px"><input class="input" id="cfExtra" placeholder="ex.: BARBOTERAPIA"><button class="btn" id="cfExtraAdd">${icon('plus')}</button></div>
            <div class="chips" id="cfExtras"></div>
          </div>
          <div class="card fade-in">
            <div class="card-h"><h3>${icon('spark')} Dados de demonstração</h3></div>
            <p class="muted" style="margin:0 0 14px;font-size:13px">Gera faturamento diário fictício para ${MONTHS[state.m - 1]} ${state.y} (marcado como DEMO) para apresentar o painel antes da integração.</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="demoGen">${icon('play')} Gerar para ${MONTHS[state.m - 1]}</button><button class="btn btn-danger" id="demoClr">${icon('trash')} Remover todos os dados demo</button></div>
          </div>
        </div>
      </div>
      <div class="card fade-in" id="metasMes"></div>`;
    // Metas por mês (vazio = usa a meta padrão)
    const metasMes = { ...(c.metas_mes || {}) };
    let metasAno = state.y;
    const drawMetas = () => {
      const key = (m) => `${metasAno}-${String(m).padStart(2, '0')}`;
      $('#metasMes').innerHTML = `
        <div class="card-h"><h3>${icon('calendar')} Metas por mês</h3><div class="grow"></div>
          <div class="month-picker"><button class="btn btn-ghost btn-icon" id="mAnoPrev" aria-label="Ano anterior">${icon('left')}</button><div class="label" style="min-width:70px">${metasAno}</div><button class="btn btn-ghost btn-icon" id="mAnoNext" aria-label="Próximo ano">${icon('right')}</button></div></div>
        <p class="muted" style="margin:0 0 12px;font-size:13px">Deixe em branco para usar a meta padrão (${brl(c.meta_mensal)} no mês · ${brl(c.meta_quinzenal)} na quinzena).</p>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Mês</th><th class="r">Meta mensal (faturamento)</th><th class="r">Meta quinzenal (SVA + assinaturas)</th></tr></thead>
          <tbody>${MONTHS.map((nome, i) => { const v = metasMes[key(i + 1)] || {}; return `<tr><td><b>${nome}</b></td>
            <td class="r"><input class="cell num" style="width:140px" data-meta="${key(i + 1)}" data-f="mensal" value="${v.mensal != null ? num2(v.mensal) : ''}" placeholder="${num2(c.meta_mensal)}" inputmode="decimal" aria-label="Meta mensal ${nome}"></td>
            <td class="r"><input class="cell num" style="width:140px" data-meta="${key(i + 1)}" data-f="quinzenal" value="${v.quinzenal != null ? num2(v.quinzenal) : ''}" placeholder="${num2(c.meta_quinzenal)}" inputmode="decimal" aria-label="Meta quinzenal ${nome}"></td></tr>`; }).join('')}</tbody>
        </table></div>
        <button class="btn btn-primary" id="saveMetasMes" style="margin-top:14px">${icon('check')} Salvar metas de ${metasAno}</button>`;
      $('#mAnoPrev').onclick = () => { collect(); metasAno--; drawMetas(); };
      $('#mAnoNext').onclick = () => { collect(); metasAno++; drawMetas(); };
      $('#saveMetasMes').onclick = async () => {
        collect();
        try { await api('/api/admin/config', { method: 'PUT', body: { metas_mes: metasMes } }); toast(`Metas de ${metasAno} salvas`); } catch (e) { toast(e.message, 'err'); }
      };
    };
    const collect = () => {
      $$('[data-meta]').forEach((i) => {
        const k = i.dataset.meta; const v = i.value.trim();
        metasMes[k] = { ...(metasMes[k] || {}) };
        if (v === '') delete metasMes[k][i.dataset.f]; else metasMes[k][i.dataset.f] = parseBR(v);
        if (!Object.keys(metasMes[k]).length) delete metasMes[k];
      });
    };
    const drawDays = () => { $('#cfDays').innerHTML = DAYS.map((d, i) => `<button class="chip ${closed.includes(i) ? 'on' : ''}" data-d="${i}">${d}</button>`).join(''); $$('#cfDays .chip').forEach((b) => b.onclick = () => { const i = Number(b.dataset.d); closed = closed.includes(i) ? closed.filter((x) => x !== i) : [...closed, i]; drawDays(); }); };
    const drawHols = () => { $('#cfHols').innerHTML = holidays.map((h) => `<span class="chip">${h.split('-').reverse().join('/')}<span class="x" data-h="${h}" role="button" aria-label="Remover">✕</span></span>`).join('') || '<span class="muted" style="font-size:12.5px">Nenhum feriado cadastrado</span>'; $$('#cfHols .x').forEach((x) => x.onclick = () => { holidays = holidays.filter((h) => h !== x.dataset.h); drawHols(); }); };
    const drawExtras = () => { $('#cfExtras').innerHTML = extras.map((h) => `<span class="chip">${esc(h)}<span class="x" data-e="${esc(h)}" role="button" aria-label="Remover">✕</span></span>`).join(''); $$('#cfExtras .x').forEach((x) => x.onclick = () => { extras = extras.filter((h) => h !== x.dataset.e); drawExtras(); saveExtras(); }); };
    const saveExtras = () => api('/api/admin/config', { method: 'PUT', body: { extras_catalog: extras } }).then(() => toast('Catálogo atualizado')).catch((e) => toast(e.message, 'err'));
    drawDays(); drawHols(); drawExtras(); drawMetas();
    $('#cfHolAdd').onclick = () => { const v = $('#cfHol').value; if (v && !holidays.includes(v)) { holidays.push(v); holidays.sort(); drawHols(); } };
    $('#cfExtraAdd').onclick = () => { const v = $('#cfExtra').value.trim().toUpperCase(); if (v && !extras.includes(v)) { extras.push(v); $('#cfExtra').value = ''; drawExtras(); saveExtras(); } };
    $('#cfSave').onclick = async () => {
      try {
        await api('/api/admin/config', { method: 'PUT', body: { unidade: $('#cfUnit').value, meta_mensal: $('#cfMM').value, meta_quinzenal: $('#cfMQ').value, dias_fechados: closed, feriados: holidays } });
        $('#unitName').textContent = unitLabel($('#cfUnit').value); toast('Configurações salvas');
      } catch (e) { toast(e.message, 'err'); }
    };
    $('#demoGen').onclick = async () => { await api('/api/admin/demo', { method: 'POST', body: { ano: state.y, mes: state.m } }); toast('Dados de demonstração gerados'); location.hash = '#/visao-geral'; };
    $('#demoClr').onclick = async () => { if (!(await confirmDialog('Remover todos os dias marcados como DEMO?', { ok: 'Remover' }))) return; await api('/api/admin/demo', { method: 'DELETE' }); toast('Dados demo removidos'); };
  }

  // ============================================================ Admin · Usuários
  async function viewAdminUsers(view) {
    const users = await api('/api/admin/usuarios');
    $('#pageSub').textContent = 'Administradores editam tudo · Visualizadores só acompanham o painel';
    view.innerHTML = `
      <div class="card fade-in">
        <div class="card-h"><h3>Usuários</h3><div class="grow"></div><button class="btn btn-primary btn-sm" id="addUser">${icon('plus')} Novo usuário</button></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Usuário</th><th>Nome</th><th>Perfil</th><th>Último acesso</th><th></th></tr></thead>
          <tbody>${users.map((u) => `<tr><td><b>${esc(u.username)}</b>${u.id === state.user.id ? ' <span class="badge accent" style="font-size:10.5px">você</span>' : ''}</td><td>${esc(u.name || '')}</td>
            <td>${u.role === 'admin' ? '<span class="badge accent">Administrador</span>' : '<span class="badge neutral">Visualizador</span>'}</td>
            <td class="muted">${fmtDateTime(u.last_login)}</td>
            <td class="r"><button class="btn btn-sm" data-edit="${u.id}">${icon('edit')} Editar</button> ${u.id !== state.user.id ? `<button class="btn btn-sm btn-danger" data-del="${u.id}">${icon('trash')}</button>` : ''}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>`;
    const form = (u) => modal({
      title: u ? `Editar ${esc(u.username)}` : 'Novo usuário',
      body: `<form id="uForm"><div class="form-grid">
        ${u ? '' : '<div class="field"><label>Usuário (login)</label><input class="input" name="username" required autocomplete="off"></div>'}
        <div class="field"><label>Nome</label><input class="input" name="name" value="${esc(u?.name || '')}"></div>
        <div class="field"><label>${u ? 'Nova senha (deixe vazio para manter)' : 'Senha (mín. 6)'}</label><input class="input" name="password" type="password" ${u ? '' : 'required minlength="6"'} autocomplete="new-password"></div>
        <div class="field"><label>Perfil</label><select class="input" name="role"><option value="viewer" ${u?.role === 'viewer' ? 'selected' : ''}>Visualizador</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Administrador</option></select></div>
      </div></form>`,
      footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-save>Salvar</button>',
      onMount: (el, close) => {
        $('[data-save]', el).onclick = async () => {
          const f = $('#uForm', el); if (!f.reportValidity()) return;
          const body = Object.fromEntries(new FormData(f)); if (!body.password) delete body.password;
          try { await api(u ? `/api/admin/usuarios/${u.id}` : '/api/admin/usuarios', { method: u ? 'PUT' : 'POST', body }); toast('Usuário salvo'); close(); route(); }
          catch (e) { toast(e.message.includes('UNIQUE') ? 'Esse login já existe' : e.message, 'err'); }
        };
      },
    });
    $('#addUser').onclick = () => form();
    $$('[data-edit]', view).forEach((b) => b.addEventListener('click', () => form(users.find((u) => u.id === Number(b.dataset.edit)))));
    $$('[data-del]', view).forEach((b) => b.addEventListener('click', async () => {
      const u = users.find((x) => x.id === Number(b.dataset.del));
      if (!(await confirmDialog(`Excluir o usuário <b>${esc(u.username)}</b>?`, { ok: 'Excluir' }))) return;
      await api(`/api/admin/usuarios/${u.id}`, { method: 'DELETE' }); toast('Usuário excluído'); route();
    }));
  }

  // ============================================================ Admin · Integração
  const EXAMPLES = {
    venda: {
      event: 'venda.finalizada', id: 'CB-000123', data: new Date().toISOString().slice(0, 10), profissional: 'Gabriel', novo_cliente: true, comissao: 45,
      itens: [
        { tipo: 'servico', nome: 'Corte + Barba', quantidade: 1, valor: 90 },
        { tipo: 'servico', nome: 'Sobrancelha', quantidade: 1, valor: 25 },
        { tipo: 'produto', nome: 'Pomada modeladora', quantidade: 1, valor: 59.9 },
      ],
    },
    assinatura: { event: 'assinatura.criada', id: 'CB-SUB-889', data: new Date().toISOString().slice(0, 10), profissional: 'Victor', novas_assinaturas: 129.9, clientes: 0 },
    cancelamento: { event: 'venda.cancelada', id: 'CB-000123', data: new Date().toISOString().slice(0, 10), profissional: 'Gabriel', servicos: 90, sva: 25, produtos: 59.9, comissao: 45, novo_cliente: true },
    fechamento: { event: 'fechamento.dia', data: new Date().toISOString().slice(0, 10), servicos: 1850, produtos: 320, novas_assinaturas: 259.8, sva: 640, recorrencia: 1200 },
    mensal: { event: 'profissional.mensal', profissional: 'Diogo', ano: new Date().getFullYear(), mes: new Date().getMonth() + 1, faturamento_total: 12500, faturamento_assinatura: 5000, comissao: 3750, clientes_atendidos: 179, geracao_demanda: 41, servicos_realizados: 770, venda_produtos: 643, qtd_produtos: 12, extras: { SOBRANCELHA: 22, SELAGEM: 4 } },
  };
  const EX_LABEL = { venda: 'Venda / comanda', assinatura: 'Nova assinatura', cancelamento: 'Cancelamento', fechamento: 'Fechamento do dia', mensal: 'Resumo mensal' };

  async function viewAdminWebhook(view) {
    const [w, logs] = await Promise.all([api('/api/admin/webhook'), api('/api/admin/webhook/logs?limit=50')]);
    const s = w.stats || {};
    $('#pageSub').textContent = 'Receba vendas do CashBarber automaticamente e envie alertas para outras automações';
    view.innerHTML = `
      <div class="grid g-4">
        ${kpi({ label: 'Eventos processados (30d)', value: int(s.processado), ic: 'check', tone: 'good' })}
        ${kpi({ label: 'Duplicados ignorados', value: int(s.duplicado), ic: 'copy', tone: 'warn' })}
        ${kpi({ label: 'Erros', value: int(s.erro), ic: 'alert', tone: s.erro ? 'bad' : undefined })}
        ${kpi({ label: 'Não autorizados', value: int(s.nao_autorizado), ic: 'lock', tone: s.nao_autorizado ? 'bad' : undefined })}
      </div>
      <div class="grid g-2">
        <div class="card fade-in">
          <div class="card-h"><h3>${icon('arrowDown')} Webhook de entrada (CashBarber → Painel)</h3></div>
          <div class="field"><label>URL do endpoint (POST, JSON)</label><div class="code"><span>${esc(w.url)}</span><button class="btn btn-sm" data-copy="${esc(w.url)}">${icon('copy')}</button></div></div>
          <div class="field"><label>Token secreto · header <code>X-Webhook-Token</code></label>
            <div class="code"><span id="tok">${'•'.repeat(24)}</span><button class="btn btn-sm" id="showTok">${icon('eye')}</button><button class="btn btn-sm" data-copy="${esc(w.token)}">${icon('copy')}</button></div></div>
          <div class="field"><label>URL com token (para sistemas que não permitem headers)</label><div class="code"><span>${esc(w.url)}?token=•••</span><button class="btn btn-sm" data-copy="${esc(w.url_com_token)}">${icon('copy')}</button></div></div>
          <button class="btn btn-danger btn-sm" id="rotate">${icon('refresh')} Gerar novo token</button>
          <h4 style="font-size:14px;margin:22px 0 12px">Como configurar</h4>
          <ol class="steps">
            <li><span>No CashBarber (ou na sua automação n8n/Make/Zapier), crie um webhook disparado em "venda finalizada / comanda fechada".</span></li>
            <li><span>Cole a URL acima e adicione o header <b>X-Webhook-Token</b> com o token (ou use a URL com token).</span></li>
            <li><span>Envie o JSON no formato dos exemplos ao lado. Campos em português ou inglês são reconhecidos.</span></li>
            <li><span>Use <b>Simular</b> para validar o formato sem gravar dados e confira o histórico abaixo.</span></li>
          </ol>
        </div>
        <div class="card fade-in">
          <div class="card-h"><h3>${icon('send')} Console de teste</h3></div>
          <div class="tabs" id="exTabs" style="margin-bottom:12px">${Object.keys(EXAMPLES).map((k, i) => `<button class="${i === 0 ? 'on' : ''}" data-ex="${k}">${EX_LABEL[k]}</button>`).join('')}</div>
          <textarea class="input" id="payload" spellcheck="false">${esc(JSON.stringify(EXAMPLES.venda, null, 2))}</textarea>
          <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
            <button class="btn" id="simulate">${icon('eye')} Simular (não grava)</button>
            <button class="btn btn-primary" id="sendReal">${icon('send')} Enviar de verdade</button>
            <button class="btn btn-ghost" id="curlBtn">${icon('copy')} Copiar cURL</button>
          </div>
          <pre class="code" id="testOut" style="margin-top:12px;display:none"></pre>
        </div>
      </div>
      <div class="card fade-in">
        <div class="card-h"><h3>${icon('send')} Webhook de saída (Painel → suas automações)</h3></div>
        <p class="muted" style="margin:0 0 12px;font-size:13px">A cada evento recebido, o painel envia um POST com o resumo atualizado (faturamento, % da meta, meta batida, restante por dia). Ideal para disparar mensagens no WhatsApp/Telegram via n8n, Make ou Zapier.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><input class="input" id="outUrl" placeholder="https://seu-n8n.com/webhook/metas" value="${esc(w.outgoing_webhook_url || '')}" style="flex:1;min-width:240px"><button class="btn btn-primary" id="saveOut">${icon('check')} Salvar</button></div>
      </div>
      <div class="card fade-in">
        <div class="card-h"><h3>Histórico de eventos</h3><div class="grow"></div><button class="btn btn-sm" id="reloadLogs">${icon('refresh')} Atualizar</button> <button class="btn btn-sm btn-danger" id="clearLogs">${icon('trash')} Limpar</button></div>
        ${logs.length ? `<div class="table-wrap" style="max-height:460px"><table class="t">
          <thead><tr><th>Quando</th><th>Evento</th><th>ID externo</th><th>Status</th><th>Mensagem</th><th></th></tr></thead>
          <tbody>${logs.map((l) => `<tr><td class="muted">${fmtDateTime(l.created_at)}</td><td><b>${esc(l.event || '—')}</b></td><td class="muted">${esc(l.external_id || '—')}</td>
            <td><span class="status ${l.status}">${l.status.replace('_', ' ').toUpperCase()}</span></td><td class="muted" style="white-space:normal;max-width:360px">${esc(l.message || '')}</td>
            <td class="r"><button class="btn btn-sm" data-log="${l.id}">${icon('eye')} Payload</button></td></tr>`).join('')}</tbody>
        </table></div>` : emptyState('Nenhum evento recebido ainda', 'Assim que o CashBarber enviar a primeira venda, ela aparecerá aqui.')}
      </div>`;

    $$('[data-copy]', view).forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy)));
    $('#showTok').onclick = () => { const t = $('#tok'); t.textContent = t.textContent.startsWith('•') ? w.token : '•'.repeat(24); };
    $('#rotate').onclick = async () => {
      if (!(await confirmDialog('Gerar um novo token? O token atual deixa de funcionar imediatamente e será preciso atualizar no CashBarber.', { ok: 'Gerar novo token' }))) return;
      await api('/api/admin/webhook/rotacionar', { method: 'POST' }); toast('Novo token gerado'); route();
    };
    $$('#exTabs button').forEach((b) => b.addEventListener('click', () => {
      $$('#exTabs button').forEach((x) => x.classList.toggle('on', x === b));
      $('#payload').value = JSON.stringify(EXAMPLES[b.dataset.ex], null, 2);
    }));
    const run = async (simular) => {
      let payload;
      try { payload = JSON.parse($('#payload').value); } catch (e) { toast('JSON inválido: ' + e.message, 'err'); return; }
      if (!simular && !(await confirmDialog('Enviar este evento de verdade? Os valores serão somados ao painel.', { ok: 'Enviar', danger: false }))) return;
      try {
        const r = await api('/api/admin/webhook/testar', { method: 'POST', body: { payload, simular } });
        const out = $('#testOut'); out.style.display = 'block'; out.textContent = JSON.stringify(r, null, 2);
        toast(simular ? 'Simulação concluída' : 'Evento processado');
        if (!simular) setTimeout(route, 800);
      } catch (e) { toast(e.message, 'err'); }
    };
    $('#simulate').onclick = () => run(true);
    $('#sendReal').onclick = () => run(false);
    $('#curlBtn').onclick = () => copy(`curl -X POST '${w.url}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'X-Webhook-Token: ${w.token}' \\\n  -d '${$('#payload').value.replace(/'/g, "'\\''")}'`);
    $('#saveOut').onclick = async () => { try { await api('/api/admin/config', { method: 'PUT', body: { outgoing_webhook_url: $('#outUrl').value } }); toast('Webhook de saída salvo'); } catch (e) { toast(e.message, 'err'); } };
    $('#reloadLogs').onclick = () => route();
    $('#clearLogs').onclick = async () => { if (!(await confirmDialog('Apagar todo o histórico de eventos? (os dados do painel não são afetados)', { ok: 'Apagar' }))) return; await api('/api/admin/webhook/logs', { method: 'DELETE' }); route(); };
    $$('[data-log]', view).forEach((b) => b.addEventListener('click', () => {
      const l = logs.find((x) => x.id === Number(b.dataset.log));
      let pretty = l.payload; try { pretty = JSON.stringify(JSON.parse(l.payload), null, 2); } catch {}
      modal({ title: `Evento #${l.id} · ${esc(l.event || '')}`, body: `<p class="muted" style="margin-top:0">${fmtDateTime(l.created_at)} · IP ${esc(l.ip || '—')} · ${esc(l.message || l.status)}</p><pre class="code">${esc(pretty)}</pre>`,
        footer: `<button class="btn" data-copy-p>${icon('copy')} Copiar</button><button class="btn btn-primary" data-close>Fechar</button>`,
        onMount: (el) => { $('[data-copy-p]', el).onclick = () => copy(pretty); } });
    }));
  }

  // ============================================================ Início (bento React preto e dourado)
  const relTime = (s) => {
    const d = new Date(s.replace(' ', 'T') + 'Z');
    const min = Math.round((Date.now() - d.getTime()) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `${min} min`;
    if (min < 1440) return `${Math.round(min / 60)} h`;
    return `${Math.round(min / 1440)} d`;
  };
  const ACT_KIND = { sale: 'venda', cancel: 'cancelamento', daily_close: 'fechamento', pro_monthly: 'mensal' };
  const ACT_TITLE = { venda: 'Venda', assinatura: 'Nova assinatura', cancelamento: 'Cancelamento', fechamento: 'Fechamento do dia', mensal: 'Resumo mensal', outro: 'Evento' };

  async function viewHome(view) {
    if (isRange()) return viewRangeDashboard(view);
    if (!window.BarberBento) { view.innerHTML = `<div class="card">${emptyState('Página inicial não compilada', 'Rode <code>npm run build</code> para gerar /public/bento.')}</div>`; return; }
    const [d, ps, act, rep] = await Promise.all([
      api(`/api/dashboard?ano=${state.y}&mes=${state.m}`),
      api(`/api/profissionais/stats?ano=${state.y}&mes=${state.m}`),
      api('/api/atividade?limit=6').catch(() => []),
      api(`/api/relatorios?ano=${state.y}&mes=${state.m}`).catch(() => null),
    ]);
    $('#pageSub').textContent = `${d.unidade} · ${d.mes_nome} ${d.ano}`;
    const atividade = act.map((a) => {
      let kind = ACT_KIND[a.kind] || 'outro';
      const v = a.values || {};
      if (kind === 'venda' && v.novas_assinaturas > 0 && !v.servicos && !v.produtos) kind = 'assinatura';
      const signal = kind === 'cancelamento' ? '−' : '+';
      return {
        id: a.id, kind, status: a.status,
        title: `${ACT_TITLE[kind]}${a.profissional ? ` · ${a.profissional}` : ''}`,
        detail: [a.event, a.date ? fmtDate(a.date) : null].filter(Boolean).join(' · '),
        amount: a.total != null ? `${signal}${brl(Math.abs(a.total))}` : '—',
        time: relTime(a.created_at),
      };
    });
    const props = {
      userName: state.user.name || state.user.username,
      unidade: d.unidade, mesNome: d.mes_nome, ano: d.ano, diaApuracao: d.dia_apuracao,
      dias: d.dias, mensal: d.mensal, quinzenas: d.quinzenas, quinzenaAtual: d.quinzena_atual,
      variacao: d.mes_anterior.variacao,
      composicao: SERIES.map((s) => ({ label: s.label, value: d.totais[s.key] })),
      profissionais: ps.profissionais.filter((p) => p.has_data).map((p) => ({
        id: p.professional_id, name: p.name, faturamento: p.faturamento_total, clientes: p.clientes_atendidos, ticket: p.ticket_medio, comissao: p.comissao,
      })),
      atividade,
      assinaturas: rep?.assinaturas?.total != null ? { total: rep.assinaturas.total, emDia: rep.assinaturas.ativos ?? 0, pendentes: rep.assinaturas.inadimplentes ?? 0, novas: rep.assinaturas.novas_no_periodo, cancelamentos: rep.assinaturas.cancelamentos } : null,
      onNavigate: (path) => { location.hash = `#/${path}`; },
    };
    const banner = state.user.must_change ? `<div class="banner">${icon('alert')}<div class="grow"><b>Segurança:</b> você está usando a senha padrão. Altere agora para proteger o painel.</div><button class="btn btn-sm" id="chgPwd">Alterar senha</button></div>` : '';
    view.innerHTML = `${banner}<div id="bentoMount"></div>`;
    $('#chgPwd', view)?.addEventListener('click', changePasswordModal);
    state.unmountBento = window.BarberBento.mount($('#bentoMount', view), props);
  }

  // ============================================================ Admin · Importar CashBarber
  const REPORT_LABEL = { comandas: 'Comandas', agendamentos: 'Agendamentos', servicos: 'Serviços realizados', assinantes: 'Assinantes', cancelamentos: 'Cancelamentos', equipe: 'Equipe' };

  async function viewAdminImport(view) {
    const { ultima } = await api('/api/admin/importar');
    $('#pageSub').textContent = 'Envie os CSVs exportados do CashBarber e o painel preenche o mês automaticamente';
    view.innerHTML = `
      <div class="grid g-2-1">
        <div class="card fade-in">
          <div class="card-h"><h3>${icon('download')} Arquivos do mês</h3></div>
          <label class="drop" id="drop" for="csvFiles">
            ${icon('db')}
            <b>Arraste os relatórios aqui ou clique para escolher</b>
            <span class="muted">Arquivos .csv exportados do CashBarber · pode enviar todos de uma vez</span>
            <input type="file" id="csvFiles" accept=".csv,text/csv" multiple hidden>
          </label>
          <div id="fileList" class="chips" style="margin-top:12px"></div>
          <div class="import-period">
            <div class="field" style="margin:0"><label for="impMes">Mês dos relatórios</label>
              <div style="display:flex;gap:8px">
                <select class="input" id="impMes">${MONTHS.map((n, i) => `<option value="${i + 1}" ${i + 1 === state.m ? 'selected' : ''}>${n}</option>`).join('')}</select>
                <select class="input" id="impAno" style="max-width:110px">${[-2, -1, 0, 1].map((d) => new Date().getFullYear() + d).map((y) => `<option ${y === state.y ? 'selected' : ''}>${y}</option>`).join('')}</select>
              </div></div>
            <p class="muted" style="margin:0;font-size:12px">Exporte do CashBarber o mês inteiro (dia 1 ao último dia). Comandas e agendamentos trazem as datas e confirmam o mês; Serviços, Assinantes e Cancelamentos usam o mês escolhido aqui.</p>
          </div>
          <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
            <button class="btn btn-primary" id="analyze" disabled>${icon('eye')} Analisar arquivos</button>
          </div>
        </div>
        <div class="card fade-in">
          <div class="card-h"><h3>Quais relatórios exportar</h3></div>
          <ol class="steps">
            <li><span><b>Comandas</b>: ID da comanda, profissional, cliente, tipo e valor. Dá o faturamento de cada dia, de cada profissional e das assinaturas.</span></li>
            <li><span><b>Serviços realizados</b>: separa SVA (sobrancelha, selagem, depilação…) e produtos dentro do valor das comandas.</span></li>
            <li><span><b>Assinantes</b>: identifica quais cobranças são assinaturas novas e quais são recorrência.</span></li>
            <li><span><b>Cancelamentos</b>: mostra quantos cancelaram no mês e por quê.</span></li>
            <li><span><b>Agendamentos</b>: agenda por profissional (finalizados, cancelados, faltas, app, assinantes).</span></li>
            <li><span><b>Usuários / equipe</b>: liga cada profissional ao ID do CashBarber.</span></li>
          </ol>
          ${ultima ? `<p class="muted" style="margin:16px 0 0;font-size:12.5px">Última importação: <b style="color:var(--text)">${MONTHS[ultima.mes - 1]}/${ultima.ano}</b> em ${new Date(ultima.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>` : ''}
        </div>
      </div>
      <div id="preview"></div>`;

    let files = [];
    const input = $('#csvFiles'); const drop = $('#drop');
    const chosen = () => ({ ano: Number($('#impAno').value), mes: Number($('#impMes').value) });
    ['#impMes', '#impAno'].forEach((sel) => $(sel).addEventListener('change', () => { $('#preview').innerHTML = ''; }));
    const readAll = async (list) => {
      files = await Promise.all([...list].filter((f) => /\.csv$/i.test(f.name) || f.type.includes('csv')).map((f) => f.text().then((text) => ({ name: f.name, text }))));
      $('#fileList').innerHTML = files.map((f) => `<span class="chip on">${esc(f.name)}</span>`).join('') || '<span class="muted">Nenhum CSV selecionado</span>';
      $('#analyze').disabled = !files.length;
      $('#preview').innerHTML = '';
    };
    input.onchange = () => readAll(input.files);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readAll(e.dataTransfer.files); });

    $('#analyze').onclick = async () => {
      const btn = $('#analyze'); btn.disabled = true;
      try {
        const { plan } = await api('/api/admin/importar', { method: 'POST', body: { files, ...chosen() } });
        renderPreview(plan);
      } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; }
    };

    function renderPreview(plan) {
      const f = plan.financeiro; const r = f?.resumo; const ag = plan.agenda; const as = plan.assinaturas; const eq = plan.equipe;
      const mes = plan.mes_nome || 'cadastro da equipe';
      if (plan.mes) { $('#impMes').value = plan.mes; if (![...$('#impAno').options].some((o) => Number(o.value) === plan.ano)) $('#impAno').add(new Option(plan.ano, plan.ano)); $('#impAno').value = plan.ano; }
      const per = plan.periodos || {};
      const box = (l, v) => `<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:12px 14px"><div class="muted" style="font-size:12px">${l}</div><div class="num" style="font-family:var(--font-display);font-size:17px;font-weight:700">${v}</div></div>`;
      $('#preview').innerHTML = `
        <div class="card fade-in" style="border-color:color-mix(in srgb,var(--accent) 50%,var(--border))">
          <div class="card-h"><h3>Prévia · ${mes}</h3><div class="grow"></div>
            ${plan.relatorios.map((t) => `<span class="badge good">${icon('check')}${REPORT_LABEL[t] || t}</span>`).join(' ')}
            ${plan.ignorados.map((n) => `<span class="badge warn" title="Formato não reconhecido">${esc(n)}</span>`).join(' ')}</div>
          <div class="chips" style="margin-bottom:14px">
            ${per.mes ? `<span class="chip on">${icon('calendar')} Mês: ${per.mes.texto}${plan.mes_detectado ? ' (pelas datas dos arquivos)' : ' (escolhido)'}</span>` : ''}
            ${per.comandas ? `<span class="chip">Comandas: ${per.comandas.texto}</span>` : ''}
            ${per.agendamentos ? `<span class="chip">Agendamentos: ${per.agendamentos.texto}</span>` : ''}
          </div>
          ${f ? `<div class="grid g-4" style="gap:12px">
            ${box('Faturamento total', brl(r.faturamento_total))}${box('Comandas', `${int(r.comandas)} · ${brl(r.servicos + r.produtos + r.sva)}`)}
            ${box('Assinaturas cobradas', `${int(r.cobrancas_assinatura)} · ${brl(r.novas_assinaturas + r.recorrencia)}`)}${box('Novas assinaturas', `${int(r.novas_assinaturas_qtd)} · ${brl(r.novas_assinaturas)}`)}
            ${box('SVA', brl(r.sva))}${box('Produtos', brl(r.produtos))}${box('Assinantes em dia', as?.ativos ?? '—')}${box('Cancelamentos no mês', as?.cancelamentos ?? '—')}
          </div>
          ${r.sva_proporcional ? `<p class="muted" style="font-size:12.5px;margin:14px 0 0">${icon('alert')} O CashBarber informa SVA e produtos só no total do mês. Por isso, a divisão de cada dia entre serviços, SVA e produtos segue a proporção do mês. O total de cada dia é exato.</p>` : ''}` : ''}
          ${ag ? `<h4 style="font-size:14px;margin:20px 0 10px">Agenda</h4><div class="grid g-4" style="gap:12px">
            ${box('Agendamentos', int(ag.totais.total))}${box('Finalizados', `${int(ag.totais.finalizados)} · ${pct((ag.totais.finalizados / ag.totais.total) * 100)}`)}
            ${box('Cancelados / faltas', `${int(ag.totais.cancelados)} / ${int(ag.totais.faltas)}`)}${box('Pelo app · assinantes', `${pct((ag.totais.app / ag.totais.total) * 100)} · ${pct((ag.totais.clube / ag.totais.total) * 100)}`)}
          </div>` : ''}
          ${eq ? `<h4 style="font-size:14px;margin:20px 0 10px">Equipe no CashBarber</h4>
            <div class="chips">${eq.profissionais.map((p) => `<span class="chip ${p.existente ? '' : 'on'}" title="${esc(p.nome_completo)} · ID ${esc(p.id_cashbarber)}">${esc(p.nome)}${p.existente ? '' : ' · novo'}</span>`).join('')}</div>
            ${eq.inativar.length ? `<p class="muted" style="font-size:12.5px;margin:10px 0 0">Não estão no cadastro do CashBarber e ficarão inativos: <b style="color:var(--text)">${eq.inativar.map((p) => esc(p.nome)).join(', ')}</b> (o histórico é mantido).</p>` : ''}
            ${eq.outros_usuarios.length ? `<p class="muted" style="font-size:12.5px;margin:6px 0 0">Não entram como profissionais: ${eq.outros_usuarios.map(esc).join(', ')}.</p>` : ''}` : ''}
          ${f ? `<h4 style="font-size:14px;margin:20px 0 10px">Profissionais</h4>
          <div class="table-wrap"><table class="t">
            <thead><tr><th>No painel</th><th>No CashBarber</th><th class="r">Faturamento</th><th class="r">Atendimentos</th><th class="r">Ticket (pagas)</th>${ag ? '<th class="r">Agendamentos</th><th class="r">Faltas</th>' : ''}</tr></thead>
            <tbody>${f.profissionais.map((p) => { const a = ag?.profissionais.find((x) => x.nome_cashbarber === p.nome_cashbarber); return `<tr><td><b>${esc(p.nome)}</b> ${p.existente ? '' : '<span class="badge accent" style="font-size:10.5px">novo</span>'}</td><td class="muted">${esc(p.nome_cashbarber)}</td>
              <td class="r num">${brl(p.faturamento_total)}</td><td class="r num">${int(p.clientes_atendidos)}</td><td class="r num">${brl(p.ticket_medio)}</td>${ag ? `<td class="r num">${a ? int(a.total) : '—'}</td><td class="r num">${a ? int(a.faltas) : '—'}</td>` : ''}</tr>`; }).join('')}</tbody>
          </table></div>` : ''}
          ${as?.motivos?.length ? `<h4 style="font-size:14px;margin:20px 0 10px">Motivos de cancelamento</h4><div class="chips">${as.motivos.map(([k, n]) => `<span class="chip">${esc(k)} · ${n}</span>`).join('')}</div>` : ''}
          <div class="banner" style="margin-top:20px"><div class="grow">${f ? `Importar substitui o faturamento diário de <b>${mes}</b> e atualiza os profissionais acima. ` : ''}${ag || as || plan.servicos ? 'Agenda, assinaturas e serviços do mês são atualizados. ' : ''}${eq ? 'A equipe é ligada aos IDs do CashBarber. ' : ''}Os demais meses não mudam. Dados pessoais dos clientes não são gravados.</div>
            <button class="btn btn-primary" id="confirmImport">${icon('check')} Importar</button></div>
        </div>`;
      $('#confirmImport').onclick = async () => {
        const b = $('#confirmImport'); b.disabled = true;
        try {
          await api('/api/admin/importar', { method: 'POST', body: { files, confirmar: true, ...chosen() } });
          toast(`${plan.mes_nome || 'Equipe'} importado`);
          if (plan.ano) setPeriod({ mode: 'mes', y: plan.ano, m: plan.mes });
          location.hash = plan.ano ? '#/inicio' : '#/admin/equipe';
        } catch (e) { toast(e.message, 'err'); b.disabled = false; }
      };
    }
  }


  // ============================================================ Admin · Dados do mês (edição manual)
  async function viewAdminData(view) {
    const q = `ano=${state.y}&mes=${state.m}`;
    const [ag, as, sv, imp] = await Promise.all(['agenda', 'assinaturas', 'servicos', 'importacao'].map((k) => api(`/api/admin/relatorios/${k}?${q}`)));
    const impInfo = imp.data ? `Importado em ${new Date(imp.data.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}: ${imp.data.relatorios.map((r) => REPORT_LABEL[r] || r).join(', ')}${imp.data.periodos?.comandas ? ` · comandas de ${imp.data.periodos.comandas.texto}` : ''}${imp.data.periodos?.agendamentos ? ` · agenda de ${imp.data.periodos.agendamentos.texto}` : ''}` : 'Nenhum relatório do CashBarber importado para este mês.';
    const mes = `${MONTHS[state.m - 1]} ${state.y}`;
    $('#pageSub').textContent = 'Edite à mão o que veio do CashBarber (ou preencha sem importar)';
    const AG = [['total', 'Agendamentos'], ['finalizados', 'Finalizados'], ['cancelados', 'Cancelados'], ['faltas', 'Faltas'], ['app', 'Pelo app'], ['clube', 'Assinantes'], ['futuros', 'Por vir']];
    const agRows = state.pros.filter((p) => p.active || ag.data?.profissionais?.some((x) => x.professional_id === p.id)).map((p) => ({ p, d: ag.data?.profissionais?.find((x) => x.professional_id === p.id) || {} }));
    const a = as.data || {};
    const lines = (arr) => (arr || []).map(([k, n]) => `${k}: ${n}`).join('\n');
    const svList = sv.data?.lista || [];
    const inp = (attrs, val, w = 90) => `<input class="cell num" style="width:${w}px" ${attrs} value="${val ?? ''}" inputmode="decimal">`;

    view.innerHTML = `
      <div class="banner" style="border-color:var(--border-strong);background:var(--surface)">${icon('download')}<div class="grow">${esc(impInfo)}</div><a class="btn btn-sm" href="#/admin/importar">Importar</a></div>
      <div class="card fade-in">
        <div class="card-h"><h3>${icon('calendar')} Agenda · ${mes}</h3><div class="grow"></div><span class="hint">${ag.atualizado_em ? `atualizado ${fmtDateTime(ag.atualizado_em)}` : 'sem dados'}</span></div>
        <div class="table-wrap"><table class="t" id="agTable">
          <thead><tr><th>Profissional</th>${AG.map(([, l]) => `<th class="r">${l}</th>`).join('')}</tr></thead>
          <tbody>${agRows.map(({ p, d }) => `<tr data-pro="${p.id}" data-nome="${esc(p.name)}"><td><b>${esc(p.name)}</b></td>${AG.map(([k, l]) => `<td class="r">${inp(`data-k="${k}" aria-label="${l} ${esc(p.name)}"`, d[k] ?? '', 80)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        <button class="btn btn-primary" id="saveAg" style="margin-top:14px">${icon('check')} Salvar agenda</button>
      </div>

      <div class="grid g-2">
        <div class="card fade-in">
          <div class="card-h"><h3>${icon('ticket')} Clube de assinatura · ${mes}</h3></div>
          <div class="form-grid">
            <div class="field"><label>Assinantes em dia</label><input class="input num" id="asAtivos" value="${a.ativos ?? ''}" inputmode="numeric"></div>
            <div class="field"><label>Com pagamento pendente</label><input class="input num" id="asInad" value="${a.inadimplentes ?? ''}" inputmode="numeric"></div>
            <p class="muted" style="grid-column:1/-1;margin:-4px 0 12px;font-size:12.5px">Total de assinaturas = em dia + pendentes: <b style="color:var(--text)" id="asTotal">${a.ativos != null || a.inadimplentes != null ? int((Number(a.ativos) || 0) + (Number(a.inadimplentes) || 0)) : '—'}</b></p>
            <div class="field"><label>Novas assinaturas no mês</label><input class="input num" id="asNovas" value="${a.novas_no_mes ?? ''}" inputmode="numeric"></div>
            <div class="field"><label>Cancelamentos no mês</label><input class="input num" id="asCanc" value="${a.cancelamentos ?? ''}" inputmode="numeric"></div>
          </div>
          <div class="field"><label>Motivos de cancelamento (um por linha: motivo: quantidade)</label><textarea class="input" id="asMotivos" style="min-height:110px" placeholder="Financeiro: 10">${esc(lines(a.motivos))}</textarea></div>
          <div class="field"><label>Planos em dia (um por linha: plano: quantidade)</label><textarea class="input" id="asPlanos" style="min-height:110px" placeholder="Corte ILIMITADO: 165">${esc(lines(a.planos))}</textarea></div>
          <button class="btn btn-primary" id="saveAs">${icon('check')} Salvar clube</button>
        </div>
        <div class="card fade-in">
          <div class="card-h"><h3>${icon('spark')} Serviços do mês · ${mes}</h3><div class="grow"></div><button class="btn btn-sm" id="addSv">${icon('plus')} Serviço</button></div>
          <div class="table-wrap"><table class="t" id="svTable">
            <thead><tr><th>Serviço</th><th class="r">Qtd.</th><th class="r">Faturado (R$)</th><th>SVA</th><th></th></tr></thead>
            <tbody></tbody>
          </table></div>
          <button class="btn btn-primary" id="saveSv" style="margin-top:14px">${icon('check')} Salvar serviços</button>
        </div>
      </div>

      <div class="card fade-in" style="border-color:color-mix(in srgb,var(--bad) 45%,var(--border))">
        <div class="card-h"><h3>${icon('trash')} Apagar dados de ${mes}</h3></div>
        <p class="muted" style="margin:0 0 14px;font-size:13px">Use para refazer um mês do zero (por exemplo, antes de importar de novo). Não afeta os outros meses.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-danger" data-del="diario">Faturamento diário</button>
          <button class="btn btn-danger" data-del="profissionais">Números dos profissionais</button>
          <button class="btn btn-danger" data-del="relatorios">Agenda, clube e serviços</button>
          <button class="btn btn-danger" data-del="diario,profissionais,relatorios">Tudo do mês</button>
        </div>
      </div>`;

    const svBody = $('#svTable tbody');
    const svRow = (x = {}) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><input class="input input-sm" data-k="nome" value="${esc(x.nome || '')}" placeholder="Nome do serviço" aria-label="Serviço"></td>
        <td class="r">${inp('data-k="quantidade" aria-label="Quantidade"', x.quantidade ?? '', 60)}</td>
        <td class="r">${inp('data-k="faturado" aria-label="Faturado"', x.faturado != null ? num2(x.faturado) : '', 100)}</td>
        <td><input type="checkbox" data-k="sva" ${x.sva !== false ? 'checked' : ''} aria-label="É SVA"></td>
        <td class="r"><button class="btn btn-sm btn-danger" data-rm aria-label="Remover">${icon('x')}</button></td>`;
      $('[data-rm]', tr).onclick = () => tr.remove();
      svBody.appendChild(tr);
    };
    svList.forEach(svRow);
    if (!svList.length) svRow({ sva: true });
    $('#addSv').onclick = () => svRow({ sva: true });

    const save = async (kind, data, label) => {
      try { await api(`/api/admin/relatorios/${kind}`, { method: 'PUT', body: { ano: state.y, mes: state.m, data } }); toast(`${label} salvo`); } catch (e) { toast(e.message, 'err'); }
    };
    $('#saveAg').onclick = () => {
      const profissionais = $$('#agTable tbody tr').map((tr) => {
        const o = { professional_id: Number(tr.dataset.pro), nome: tr.dataset.nome };
        $$('[data-k]', tr).forEach((i) => { o[i.dataset.k] = parseBR(i.value); });
        return o;
      }).filter((o) => AG.some(([k]) => o[k] > 0));
      save('agenda', { profissionais, por_dia: ag.data?.por_dia || [] }, 'Agenda');
    };
    const parseLines = (txt) => txt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.lastIndexOf(':'); return i > 0 ? [l.slice(0, i).trim(), parseBR(l.slice(i + 1))] : [l, 0]; });
    ['#asAtivos', '#asInad'].forEach((sel) => $(sel).addEventListener('input', () => { $('#asTotal').textContent = int(parseBR($('#asAtivos').value) + parseBR($('#asInad').value)); }));
    $('#saveAs').onclick = () => save('assinaturas', {
      ativos: $('#asAtivos').value, inadimplentes: $('#asInad').value, novas_no_mes: $('#asNovas').value, cancelamentos: $('#asCanc').value,
      motivos: parseLines($('#asMotivos').value), planos: parseLines($('#asPlanos').value),
    }, 'Clube');
    $('#saveSv').onclick = () => save('servicos', {
      lista: $$('#svTable tbody tr').map((tr) => ({ nome: $('[data-k="nome"]', tr).value, quantidade: parseBR($('[data-k="quantidade"]', tr).value), faturado: parseBR($('[data-k="faturado"]', tr).value), sva: $('[data-k="sva"]', tr).checked })).filter((x) => x.nome.trim()),
    }, 'Serviços');
    $$('[data-del]', view).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog(`Apagar <b>${esc(b.textContent)}</b> de ${mes}? Não dá para desfazer.`, { ok: 'Apagar' }))) return;
      try { await api(`/api/admin/mes?${q}&partes=${b.dataset.del}`, { method: 'DELETE' }); toast('Dados apagados'); route(); } catch (e) { toast(e.message, 'err'); }
    }));
  }

  const VIEWS = {
    inicio: viewHome,
    'admin/importar': viewAdminImport,
    'admin/dados': viewAdminData,
    'visao-geral': viewOverview,
    faturamento: viewDaily,
    profissionais: viewPros,
    'admin/lancamentos': viewAdminLanc,
    'admin/equipe': viewAdminTeam,
    'admin/metas': viewAdminConfig,
    'admin/usuarios': viewAdminUsers,
    'admin/integracao': viewAdminWebhook,
  };

  // ============================================================ Boot
  window.addEventListener('hashchange', () => state.user && route());
  api('/api/auth/me')
    .then(({ user, single_user, password_managed }) => { state.user = user; state.singleUser = single_user; state.passwordManaged = password_managed; renderShell(); })
    .catch(() => renderLogin());
})();
