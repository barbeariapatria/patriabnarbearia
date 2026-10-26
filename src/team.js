// Liga os nomes/IDs do CashBarber aos profissionais do painel.
// Ordem: ID do CashBarber → nome completo do cadastro da equipe → nome igual → primeiro nome (se for único).
const { getSetting } = require('./db');

const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[.\-_]/g, ' ').replace(/\s+/g, ' ').trim();
const firstName = (s) => normalize(s).split(' ')[0];

// Cadastro da equipe importado do CashBarber: [{ id, nome, tipo, ativo, desde }] (sem e-mails)
async function directory() {
  return (await getSetting('cashbarber_equipe')) || [];
}

function matchProfessional(fullName, pros, dir = [], externalId = null) {
  const full = normalize(fullName);
  const byId = (id) => id && pros.find((p) => String(p.external_id || '') === String(id));
  if (externalId && byId(externalId)) return byId(externalId);
  const entry = dir.find((d) => normalize(d.nome) === full && d.tipo === 'PROFISSIONAL') || dir.find((d) => normalize(d.nome) === full);
  if (entry && byId(entry.id)) return byId(entry.id);
  const exact = pros.find((p) => normalize(p.name) === full || normalize(p.external_id) === full);
  if (exact) return exact;
  const sameFirst = pros.filter((p) => firstName(p.name) === firstName(fullName));
  return sameFirst.length === 1 ? sameFirst[0] : null;
}

// Nome curto para um profissional novo: primeiro nome, ou o nome completo se o primeiro já estiver em uso
function displayName(fullName, pros) {
  const first = String(fullName).trim().split(/\s+/)[0];
  return pros.some((p) => firstName(p.name) === normalize(first)) ? String(fullName).trim() : first;
}

module.exports = { normalize, matchProfessional, displayName, directory };
