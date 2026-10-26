// Banco de dados via libSQL: o mesmo SQL do SQLite roda em arquivo local (desenvolvimento, Docker/Render)
// ou no Turso (Vercel e outras plataformas serverless, onde o disco não é persistente).
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');

function databaseUrl() {
  const remote = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL;
  if (remote) return remote;
  if (process.env.VERCEL) {
    throw new Error('Na Vercel é obrigatório um banco Turso: defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN.');
  }
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  return `file:${path.join(dir, 'dashboard.db')}`;
}

const client = createClient({
  url: databaseUrl(),
  authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN,
});

const normArgs = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));
const toObj = (rs, row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]]));

// Mesma interface para o cliente e para transações: get (1 linha), all (todas), run (escrita)
function executor(ex) {
  const exec = (sql, args) => ex.execute({ sql, args: normArgs(args) });
  return {
    async get(sql, ...args) { const rs = await exec(sql, args); return rs.rows[0] ? toObj(rs, rs.rows[0]) : undefined; },
    async all(sql, ...args) { const rs = await exec(sql, args); return rs.rows.map((r) => toObj(rs, r)); },
    async run(sql, ...args) {
      const rs = await exec(sql, args);
      return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid === undefined ? undefined : Number(rs.lastInsertRowid) };
    },
  };
}

const db = executor(client);

async function tx(fn) {
  const t = await client.transaction('write');
  try {
    const result = await fn(executor(t));
    await t.commit();
    return result;
  } catch (e) {
    await t.rollback().catch(() => {});
    throw e;
  } finally {
    t.close();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  must_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS daily_revenue (
  date TEXT PRIMARY KEY,
  servicos REAL NOT NULL DEFAULT 0,
  produtos REAL NOT NULL DEFAULT 0,
  novas_assinaturas REAL NOT NULL DEFAULT 0,
  sva REAL NOT NULL DEFAULT 0,
  recorrencia REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PREVISTO',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS professionals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL COLLATE NOCASE,
  external_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS professional_monthly (
  professional_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  faturamento_total REAL NOT NULL DEFAULT 0,
  faturamento_assinatura REAL NOT NULL DEFAULT 0,
  comissao REAL NOT NULL DEFAULT 0,
  ticket_medio REAL,
  clientes_atendidos INTEGER NOT NULL DEFAULT 0,
  geracao_demanda INTEGER NOT NULL DEFAULT 0,
  servicos_realizados INTEGER NOT NULL DEFAULT 0,
  venda_produtos REAL NOT NULL DEFAULT 0,
  qtd_produtos INTEGER NOT NULL DEFAULT 0,
  extras TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (professional_id, year, month)
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT,
  event TEXT,
  status TEXT NOT NULL,
  message TEXT,
  payload TEXT,
  ip TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_webhook_ext ON webhook_events(external_id);
`;

const DEFAULT_EXTRAS = [
  'SOBRANCELHA', 'SOBRANCELHA (CERA)', 'SELAGEM', 'SPA CAPILAR', 'BARBOTERAPIA',
  'HID. BARBA', 'HID. CABELO', 'DEP. ORELHA', 'DEP. NARIZ', 'DEP. NARIZ E ORELHA',
  'PIG. BARBA', 'PIG. CABELO', 'ALISAMENTO', 'LAVAGEM RELAXANTE', 'PLATINADO',
  'CONE HINDU', 'LUZES',
];

const DEFAULT_SETTINGS = {
  unidade: 'Pátria Barbearia',
  meta_mensal: 23500,
  meta_quinzenal: 30000,
  dias_fechados: [0], // 0 = domingo
  feriados: [],
  extras_catalog: DEFAULT_EXTRAS,
  outgoing_webhook_url: '',
};

const parse = (v) => { try { return JSON.parse(v); } catch { return v; } };

async function getSetting(key) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? parse(row.value) : DEFAULT_SETTINGS[key];
}
async function setSetting(key, value) {
  await db.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}
async function getAllSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of await db.all('SELECT key, value FROM settings')) out[r.key] = parse(r.value);
  return out;
}

// Gera o segredo uma única vez; INSERT OR IGNORE evita sobrescrever se duas instâncias iniciarem juntas
async function ensureSecret(key, bytes = 32) {
  await db.run('INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)', key, JSON.stringify(crypto.randomBytes(bytes).toString('hex')));
  return getSetting(key);
}

async function migrate() {
  await client.executeMultiple(SCHEMA);
}

module.exports = { db, tx, getSetting, setSetting, getAllSettings, ensureSecret, migrate, DEFAULT_EXTRAS };
