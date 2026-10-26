// Banco de dados com três destinos possíveis, todos com a mesma interface (get / all / run / tx):
//   - Supabase (Postgres): na Vercel, via POSTGRES_URL criada pela integração Supabase
//   - Turso (libSQL na nuvem): alternativa serverless, via TURSO_DATABASE_URL
//   - Arquivo SQLite local: desenvolvimento, Docker e Render (disco persistente)
// O SQL do código é escrito no dialeto comum aos dois; o driver do Postgres faz os poucos ajustes necessários.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// As integrações da Vercel podem criar as variáveis com prefixo (ex.: STORAGE_POSTGRES_URL),
// então aceitamos os nomes padrão e, na falta deles, qualquer variável que termine com o mesmo nome.
function findEnv(names, suffixes, valueTest = () => true) {
  for (const n of names) if (process.env[n] && valueTest(process.env[n])) return { name: n, value: process.env[n] };
  for (const [k, v] of Object.entries(process.env)) {
    if (v && suffixes.some((s) => k.endsWith(s)) && valueTest(v)) return { name: k, value: v };
  }
  return null;
}
const isPgUrl = (v) => /^postgres(ql)?:\/\//.test(v);
const isLibsqlUrl = (v) => /^(libsql|https?|wss?):\/\//.test(v);

function postgresConfig() {
  // POSTGRES_URL é o "pooler" do Supabase (recomendado para serverless); as demais são alternativas
  return findEnv(['POSTGRES_URL', 'DATABASE_URL', 'SUPABASE_DB_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL_NON_POOLING'],
    ['POSTGRES_URL', '_DATABASE_URL', 'SUPABASE_DB_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL_NON_POOLING'], isPgUrl);
}
function tursoConfig() {
  const url = findEnv(['TURSO_DATABASE_URL', 'LIBSQL_URL'], ['TURSO_DATABASE_URL', 'LIBSQL_URL'], isLibsqlUrl);
  if (!url) return null;
  return { url, token: findEnv(['TURSO_AUTH_TOKEN', 'LIBSQL_AUTH_TOKEN'], ['TURSO_AUTH_TOKEN', 'LIBSQL_AUTH_TOKEN']) };
}

const normArgs = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));

// ---------------------------------------------------------------- Postgres (Supabase)
// No Postgres as tabelas levam o prefixo "patria_" para não colidir com outras tabelas do projeto Supabase
const TABLES = ['users', 'settings', 'daily_revenue', 'professionals', 'professional_monthly', 'webhook_events', 'monthly_reports'];
const TABLE_RE = new RegExp(`\\b(${TABLES.join('|')})\\b`, 'g');
const PG_NOW = "to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')";

function toPgSql(sql) {
  let n = 0; let out = ''; let inString = false;
  for (const ch of sql) {
    if (ch === "'") inString = !inString;
    out += ch === '?' && !inString ? `$${++n}` : ch;
  }
  return out
    .replace(TABLE_RE, 'patria_$1')
    .replace(/\bMAX\(0,/g, 'GREATEST(0,')
    .replace(/\bCURRENT_TIMESTAMP\b/g, PG_NOW);
}

function postgresDriver(cfg) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, (v) => parseInt(v, 10)); // bigint (COUNT, SUM de inteiros)
  types.setTypeParser(1700, (v) => parseFloat(v)); // numeric
  const url = new URL(cfg.value);
  // parâmetros que o Supabase coloca na URL mas que o driver "pg" não entende (ou entende de outro jeito)
  for (const p of ['sslmode', 'pgbouncer', 'supa', 'connection_limit', 'pool_timeout']) url.searchParams.delete(p);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  const pool = new Pool({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX || 3),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (e) => console.warn('Postgres (conexão ociosa):', e.message));
  const run = async (ex, sql, args) => {
    const r = await ex.query(toPgSql(sql), normArgs(args));
    return { rows: r.rows, changes: r.rowCount };
  };
  return {
    kind: 'postgres',
    query: (sql, args) => run(pool, sql, args),
    exec: (sql) => pool.query(sql),
    async transaction(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const result = await fn((sql, args) => run(c, sql, args));
        await c.query('COMMIT');
        return result;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
  };
}

// ---------------------------------------------------------------- libSQL (Turso ou arquivo local)
function libsqlDriver(client) {
  const run = async (ex, sql, args) => {
    const rs = await ex.execute({ sql, args: normArgs(args) });
    return { rows: rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]]))), changes: rs.rowsAffected };
  };
  return {
    kind: 'libsql',
    query: (sql, args) => run(client, sql, args),
    exec: (sql) => client.executeMultiple(sql),
    async transaction(fn) {
      const t = await client.transaction('write');
      try {
        const result = await fn((sql, args) => run(t, sql, args));
        await t.commit();
        return result;
      } catch (e) {
        await t.rollback().catch(() => {});
        throw e;
      } finally {
        t.close();
      }
    },
  };
}

let driver;
function getDriver() {
  if (driver) return driver;
  const pg = postgresConfig();
  const turso = !pg && tursoConfig();
  if (pg) {
    driver = postgresDriver(pg);
  } else if (turso) {
    // Cliente só HTTP: não depende do módulo nativo do SQLite (que pode faltar no pacote da Vercel)
    const { createClient } = require('@libsql/client/web');
    driver = libsqlDriver(createClient({ url: turso.url.value, authToken: turso.token?.value }));
  } else {
    if (process.env.VERCEL) {
      const hint = Object.keys(process.env).some((k) => k.endsWith('SUPABASE_URL'))
        ? 'A integração do Supabase está ligada, mas falta a variável POSTGRES_URL (Supabase → Connect → Transaction pooler).'
        : 'Conecte o Supabase ao projeto na Vercel (Storage / Integrations → Supabase) para criar a variável POSTGRES_URL.';
      throw new Error(`Banco não configurado. ${hint}`);
    }
    const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
    fs.mkdirSync(dir, { recursive: true });
    const { createClient } = require('@libsql/client');
    driver = libsqlDriver(createClient({ url: `file:${path.join(dir, 'dashboard.db')}` }));
  }
  return driver;
}

// Diagnóstico sem expor segredos: qual banco e quais variáveis foram encontradas
function databaseInfo() {
  const pg = postgresConfig();
  if (pg) {
    const u = new URL(pg.value);
    return { tipo: 'supabase_postgres', variavel: pg.name, host: u.hostname, porta: u.port || '5432' };
  }
  const turso = tursoConfig();
  if (turso) return { tipo: 'turso', variavel_url: turso.url.name, variavel_token: turso.token?.name || null };
  return { tipo: process.env.VERCEL ? 'nao_configurado' : 'arquivo_local' };
}

// Mesma interface para consultas avulsas e dentro de transações: get (1 linha), all (todas), run (escrita)
function executor(query) {
  return {
    async get(sql, ...args) { return (await query(sql, args)).rows[0]; },
    async all(sql, ...args) { return (await query(sql, args)).rows; },
    async run(sql, ...args) { return { changes: (await query(sql, args)).changes }; },
  };
}

const db = executor((sql, args) => getDriver().query(sql, args));

function tx(fn) {
  return getDriver().transaction((query) => fn(executor(query)));
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
-- Resumos mensais importados do CashBarber (agenda, assinaturas, serviços): só totais, sem dados de clientes
CREATE TABLE IF NOT EXISTS monthly_reports (
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (year, month, kind)
);
`;

// Esquema equivalente no Postgres: tabelas com prefixo, números em DOUBLE PRECISION (centavos sem perda),
// nomes sem diferenciar maiúsculas e RLS ligado (a API pública do Supabase não enxerga estas tabelas;
// o painel acessa como dono das tabelas, que não é afetado pelo RLS).
const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS patria_users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  must_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT ${PG_NOW},
  last_login TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS patria_users_username ON patria_users (lower(username));
CREATE TABLE IF NOT EXISTS patria_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS patria_daily_revenue (
  date TEXT PRIMARY KEY,
  servicos DOUBLE PRECISION NOT NULL DEFAULT 0,
  produtos DOUBLE PRECISION NOT NULL DEFAULT 0,
  novas_assinaturas DOUBLE PRECISION NOT NULL DEFAULT 0,
  sva DOUBLE PRECISION NOT NULL DEFAULT 0,
  recorrencia DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PREVISTO',
  updated_at TEXT DEFAULT ${PG_NOW}
);
CREATE TABLE IF NOT EXISTS patria_professionals (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  external_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT ${PG_NOW}
);
CREATE UNIQUE INDEX IF NOT EXISTS patria_professionals_name ON patria_professionals (lower(name));
CREATE TABLE IF NOT EXISTS patria_professional_monthly (
  professional_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  faturamento_total DOUBLE PRECISION NOT NULL DEFAULT 0,
  faturamento_assinatura DOUBLE PRECISION NOT NULL DEFAULT 0,
  comissao DOUBLE PRECISION NOT NULL DEFAULT 0,
  ticket_medio DOUBLE PRECISION,
  clientes_atendidos INTEGER NOT NULL DEFAULT 0,
  geracao_demanda INTEGER NOT NULL DEFAULT 0,
  servicos_realizados INTEGER NOT NULL DEFAULT 0,
  venda_produtos DOUBLE PRECISION NOT NULL DEFAULT 0,
  qtd_produtos INTEGER NOT NULL DEFAULT 0,
  extras TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT DEFAULT ${PG_NOW},
  PRIMARY KEY (professional_id, year, month)
);
CREATE TABLE IF NOT EXISTS patria_webhook_events (
  id SERIAL PRIMARY KEY,
  external_id TEXT,
  event TEXT,
  status TEXT NOT NULL,
  message TEXT,
  payload TEXT,
  ip TEXT,
  created_at TEXT DEFAULT ${PG_NOW}
);
CREATE INDEX IF NOT EXISTS patria_webhook_ext ON patria_webhook_events (external_id);
CREATE TABLE IF NOT EXISTS patria_monthly_reports (
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT DEFAULT ${PG_NOW},
  PRIMARY KEY (year, month, kind)
);
${TABLES.map((t) => `ALTER TABLE patria_${t} ENABLE ROW LEVEL SECURITY;`).join('\n')}
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

// Gera o segredo uma única vez; ON CONFLICT DO NOTHING evita sobrescrever se duas instâncias iniciarem juntas
async function ensureSecret(key, bytes = 32) {
  await db.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT DO NOTHING', key, JSON.stringify(crypto.randomBytes(bytes).toString('hex')));
  return getSetting(key);
}

async function migrate() {
  const d = getDriver();
  await d.exec(d.kind === 'postgres' ? PG_SCHEMA : SCHEMA);
}

module.exports = { db, tx, getSetting, setSetting, getAllSettings, ensureSecret, migrate, databaseInfo, DEFAULT_EXTRAS };
