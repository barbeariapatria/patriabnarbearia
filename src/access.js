// Permissões de cada login: quais telas vê e se enxerga a equipe toda ou só os próprios números.
// O dono e os administradores veem tudo; os barbeiros veem o que o dono liberar em Admin → Usuários.
const { db } = require('./db');

// Telas que podem ser liberadas (as de administração são só para administradores)
const PAGES = ['meu-painel', 'inicio', 'visao-geral', 'faturamento', 'profissionais'];
// Telas com números da barbearia inteira (faturamento, metas, assinaturas)
const SHOP_PAGES = ['inicio', 'visao-geral', 'faturamento'];
const DEFAULT_BARBER = { ativo: true, telas: ['meu-painel'], escopo: 'proprio', professional_id: null };

function normalizeAccess(data = {}) {
  return {
    ativo: data.ativo !== false,
    telas: [...new Set((Array.isArray(data.telas) ? data.telas : DEFAULT_BARBER.telas).filter((t) => PAGES.includes(t)))],
    escopo: data.escopo === 'todos' ? 'todos' : 'proprio',
    professional_id: data.professional_id ? Number(data.professional_id) : null,
  };
}

async function forUser(user) {
  const row = await db.get('SELECT data FROM user_access WHERE user_id = ?', user.id);
  let data = {};
  try { data = row ? JSON.parse(row.data) : {}; } catch {}
  if (user.role === 'admin') {
    return { admin: true, ativo: true, telas: [...PAGES], escopo: 'todos', professional_id: data.professional_id ? Number(data.professional_id) : null };
  }
  return { admin: false, ...normalizeAccess(row ? data : DEFAULT_BARBER) };
}

async function save(q, userId, data) {
  await q.run(`INSERT INTO user_access(user_id, data) VALUES(?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data`, userId, JSON.stringify(normalizeAccess(data)));
}

const canPage = (a, page) => !!a && (a.admin || a.telas.includes(page));
const canShop = (a) => !!a && (a.admin || SHOP_PAGES.some((p) => a.telas.includes(p)));
const canPros = (a) => !!a && (a.admin || a.telas.includes('profissionais') || a.telas.includes('meu-painel'));
const ownOnly = (a) => !!a && !a.admin && a.escopo === 'proprio';

module.exports = { PAGES, SHOP_PAGES, forUser, save, normalizeAccess, canPage, canShop, canPros, ownOnly };
