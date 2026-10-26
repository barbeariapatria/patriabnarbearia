// Copia o Chart.js para public/vendor, de onde o painel o carrega (a Vercel só publica a pasta public/).
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
const dest = path.join(__dirname, '..', 'public', 'vendor', 'chart.umd.js');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log('Chart.js copiado para public/vendor/');
