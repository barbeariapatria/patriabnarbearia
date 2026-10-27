const crypto = require('node:crypto');
const { db, ensureSecret } = require('./db');

const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const COOKIE = 'sid';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

// O segredo da sessão vem do ambiente ou é gerado e guardado no banco (carregado em init())
let sessionSecret = process.env.SESSION_SECRET || null;
async function loadSecret() {
  if (!sessionSecret) sessionSecret = await ensureSecret('session_secret');
}
function sign(data) {
  return crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');
}
function createToken(user) {
  const payload = Buffer.from(JSON.stringify({ uid: user.id, exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Na Vercel o site é sempre HTTPS, então o cookie já sai como Secure
const secureCookie = () => (process.env.COOKIE_SECURE === 'true' || !!process.env.VERCEL ? '; Secure' : '');
function setSessionCookie(res, user) {
  res.setHeader('Set-Cookie', `${COOKIE}=${createToken(user)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secureCookie()}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureCookie()}`);
}

function publicUser(u) {
  return u && { id: u.id, username: u.username, name: u.name, role: u.role, must_change: !!u.must_change, last_login: u.last_login };
}

async function attachUser(req, _res, next) {
  try {
    const data = readToken(parseCookies(req.headers.cookie)[COOKIE]);
    if (data) req.user = (await db.get('SELECT * FROM users WHERE id = ?', data.uid)) || null;
    next();
  } catch (e) { next(e); }
}
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao administrador' });
  next();
}

// Limite simples de tentativas de login por IP (10 tentativas / 15 min, por instância do servidor)
const attempts = new Map();
function loginRateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, reset: now + 15 * 60e3 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 15 * 60e3; }
  if (entry.count >= 10) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  entry.count++;
  attempts.set(key, entry);
  next();
}
function clearAttempts(ip) { attempts.delete(ip); }

// Por padrão o painel tem um único login (o da barbearia). MULTI_USER=true libera o cadastro de outros usuários.
// Os logins dos barbeiros são criados pelo dono em Admin → Usuários (o login principal vem das variáveis)
const SINGLE_USER = false;
// Com ADMIN_PASSWORD definida, a senha é gerenciada na hospedagem e não pode ser trocada pelo painel
// Valores colados no painel da hospedagem às vezes vêm com aspas ou espaços: "@senha" → @senha
const cleanEnv = (v) => String(v ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
const adminUser = () => cleanEnv(process.env.ADMIN_USER) || 'barbeariapatria@gmail.com';
const adminPassword = () => cleanEnv(process.env.ADMIN_PASSWORD) || null;
const PASSWORD_MANAGED = !!adminPassword();
// O login principal (dono) tem a senha definida na hospedagem; os demais trocam a própria senha no painel
const isPrincipal = (user) => !!user && String(user.username).toLowerCase() === adminUser().toLowerCase();
const passwordManaged = (user) => PASSWORD_MANAGED && isPrincipal(user);

// Diagnóstico do login para /api/health: diz se o login do banco confere com as variáveis, sem revelar a senha
async function adminStatus() {
  const raw = process.env.ADMIN_PASSWORD;
  const user = await db.get('SELECT username, password_hash FROM users WHERE lower(username) = lower(?)', adminUser());
  return {
    usuario: adminUser(),
    senha_variavel: adminPassword() ? `definida (${adminPassword().length} caracteres)` : 'FALTANDO: cadastre ADMIN_PASSWORD em Production e faça Redeploy',
    senha_tinha_aspas_ou_espacos: raw ? raw !== adminPassword() : false,
    login_no_banco: !!user,
    senha_do_banco_confere: user && adminPassword() ? verifyPassword(adminPassword(), user.password_hash) : false,
  };
}

async function ensureDefaultAdmin() {
  const username = adminUser();
  const envPassword = adminPassword();
  const existing = await db.get('SELECT * FROM users WHERE lower(username) = lower(?)', username);
  if (existing) {
    // ADMIN_PASSWORD é a senha oficial: se mudar na hospedagem, passa a valer no próximo início
    if (envPassword && !verifyPassword(envPassword, existing.password_hash)) {
      await db.run("UPDATE users SET password_hash = ?, must_change = 0, role = 'admin' WHERE id = ?", hashPassword(envPassword), existing.id);
      console.log(`🔑 Senha de ${username} atualizada a partir de ADMIN_PASSWORD.`);
    }
    return;
  }
  const password = envPassword || crypto.randomBytes(9).toString('base64url');
  await db.run('INSERT INTO users(username, name, password_hash, role, must_change) VALUES(?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
    username, 'Pátria Barbearia', hashPassword(password), 'admin', envPassword ? 0 : 1);
  console.log(`👤 Login criado: ${username} / ${envPassword ? '(senha definida em ADMIN_PASSWORD)' : `${password}  ← senha temporária, defina ADMIN_PASSWORD`}`);
}

module.exports = {
  hashPassword, verifyPassword, adminStatus, setSessionCookie, clearSessionCookie, publicUser, loadSecret,
  attachUser, requireAuth, requireAdmin, loginRateLimit, clearAttempts, ensureDefaultAdmin, SINGLE_USER, PASSWORD_MANAGED, isPrincipal, passwordManaged,
};
