const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'dashboard.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
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
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
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
`);

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

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return DEFAULT_SETTINGS[key];
  try { return JSON.parse(row.value); } catch { return row.value; }
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
function getAllSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

function ensureSecret(key, bytes = 32) {
  let v = getSetting(key);
  if (!v) { v = crypto.randomBytes(bytes).toString('hex'); setSetting(key, v); }
  return v;
}

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, getSetting, setSetting, getAllSettings, ensureSecret, tx, DEFAULT_EXTRAS };
