// Copia as bibliotecas do navegador para public/vendor, de onde o painel as carrega (a Vercel só publica a pasta public/).
const fs = require('node:fs');
const path = require('node:path');

const nm = path.join(__dirname, '..', 'node_modules');
const files = [
  ['chart.js/dist/chart.umd.js', 'chart.umd.js'],
  ['jspdf/dist/jspdf.umd.min.js', 'jspdf.umd.min.js'],
  ['jspdf-autotable/dist/jspdf.plugin.autotable.min.js', 'jspdf.plugin.autotable.min.js'],
];
const dir = path.join(__dirname, '..', 'public', 'vendor');
fs.mkdirSync(dir, { recursive: true });
for (const [src, dest] of files) fs.copyFileSync(path.join(nm, src), path.join(dir, dest));
console.log('Chart.js e jsPDF copiados para public/vendor/');
