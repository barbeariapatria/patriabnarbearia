// Servidor local / Docker / Render. Na Vercel, a API roda em api/index.js e os arquivos de public/ são servidos direto.
const path = require('node:path');
const fs = require('node:fs');

// Carrega .env simples (sem dependências)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const express = require('express');
const { app, init } = require('./src/app');

const server = express();
server.use(app);
server.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
server.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = Number(process.env.PORT || 3000);
init()
  .then(() => server.listen(PORT, () => console.log(`🚀 Dashboard rodando em http://localhost:${PORT}`)))
  .catch((e) => { console.error('Falha ao iniciar:', e); process.exit(1); });
