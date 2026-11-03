// Comissões do mês: o que vem do CashBarber (Gestão → Gerar comissões) + bruto de cada barbeiro + regras do painel.
// - Avulso é dividido em Barbearia (cabelo, barba…) e serviços extras, na proporção do bruto de cada um
// - Assinatura: o CashBarber usa taxa_cashbarber; quem tem outra taxa (ex.: Lucas 35%) é recalculado aqui
// - A receber = comissões + bônus − vales (os do CashBarber e os lançados no painel)
const { db, getSetting } = require('./db');
const { round2 } = require('./metrics');
const { normalize } = require('./team');

async function report(q, y, m, kind) {
  const row = await q.get('SELECT data, updated_at FROM monthly_reports WHERE year = ? AND month = ? AND kind = ?', y, m, kind);
  let data = null; try { data = row ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) : null; } catch {}
  return { data, updated_at: row?.updated_at || null };
}

function taxaAssinatura(regras, pro) {
  const porId = regras.assinatura?.[String(pro.id)];
  if (porId != null && porId !== '') return Number(porId);
  const nome = normalize(pro.name);
  const porNome = Object.entries(regras.assinatura_por_nome || {}).find(([k]) => normalize(k) === nome || nome.split(' ')[0] === normalize(k));
  return porNome ? Number(porNome[1]) : null;
}

async function calcular(y, m, q = db) {
  const [{ data: com, updated_at }, { data: bruto }, { data: vales }] = await Promise.all([
    report(q, y, m, 'comissoes'), report(q, y, m, 'bruto_pro'), report(q, y, m, 'vales'),
  ]);
  const regras = { taxa_cashbarber: 40, assinatura: {}, ...((await getSetting('comissao_regras')) || {}) };
  const taxaCb = Number(regras.taxa_cashbarber) || 40;
  const pros = await q.all('SELECT id, name FROM professionals');
  const ids = new Set([...(com?.lista || []).map((x) => x.professional_id), ...(vales?.lista || []).map((x) => x.professional_id)]);
  const linhas = [];
  for (const pid of ids) {
    const pro = pros.find((p) => p.id === pid) || { id: pid, name: '?' };
    const c = (com?.lista || []).find((x) => x.professional_id === pid) || {};
    const b = (bruto?.por_profissional || []).find((x) => x.professional_id === pid) || {};
    const avulso = Number(c.avulso_liquido ?? c.avulso_bruto) || 0;
    // divide a comissão do avulso entre Barbearia e extras pelo bruto de cada parte (sem o bruto, fica tudo em Barbearia)
    const bb = Number(b.barbearia) || 0; const be = Number(b.extras) || 0;
    const fracBarbearia = bb + be > 0 ? bb / (bb + be) : 1;
    const taxa = taxaAssinatura(regras, pro);
    const assinaturaCb = Number(c.assinatura_liquido ?? c.assinatura_bruto) || 0;
    const assinatura = taxa != null && taxa !== taxaCb ? round2((assinaturaCb * taxa) / taxaCb) : assinaturaCb;
    const produtos = Number(c.produtos_liquido ?? c.produtos_bruto) || 0;
    const valesPainel = (vales?.lista || []).filter((v) => v.professional_id === pid);
    const valesCb = Number(c.vales) || 0;
    const valesTotal = round2(valesCb + valesPainel.reduce((t, v) => t + (Number(v.valor) || 0), 0));
    const bonus = Number(c.bonus) || 0;
    const partes = {
      barbearia: { bruto: b.barbearia ?? null, comissao: round2(avulso * fracBarbearia) },
      extras: { bruto: b.extras ?? null, comissao: round2(avulso - round2(avulso * fracBarbearia)) },
      // bruto da assinatura: a parte do pote do barbeiro antes da taxa (comissão do CashBarber ÷ taxa)
      assinatura: { bruto: assinaturaCb ? round2(assinaturaCb / (taxaCb / 100)) : 0, comissao: assinatura, taxa: taxa ?? taxaCb, recalculada: taxa != null && taxa !== taxaCb },
      produtos: { bruto: b.produtos ?? null, comissao: produtos },
    };
    const comissao = round2(partes.barbearia.comissao + partes.extras.comissao + partes.assinatura.comissao + partes.produtos.comissao);
    linhas.push({
      professional_id: pid, nome: pro.name, partes, bonus, vales_cashbarber: valesCb, vales_painel: valesPainel, vales: valesTotal,
      comissao, total_liquido: round2(comissao + bonus - valesTotal), servicos: b.servicos || [],
      cashbarber_total: Number(c.total_liquido) || 0,
    });
  }
  linhas.sort((a, b) => b.total_liquido - a.total_liquido);
  return { linhas, taxa_cashbarber: taxaCb, tem_bruto: !!bruto, atualizado_em: com?.atualizado || updated_at };
}

// grava o "A receber" como a comissão do mês de cada profissional (aparece em Profissionais)
async function sincronizar(y, m, q = db) {
  const { linhas } = await calcular(y, m, q);
  for (const l of linhas) {
    await q.run('INSERT INTO professional_monthly(professional_id, year, month) VALUES(?, ?, ?) ON CONFLICT DO NOTHING', l.professional_id, y, m);
    await q.run('UPDATE professional_monthly SET comissao = ?, updated_at = CURRENT_TIMESTAMP WHERE professional_id = ? AND year = ? AND month = ?', l.total_liquido, l.professional_id, y, m);
  }
}

module.exports = { calcular, sincronizar, report };
