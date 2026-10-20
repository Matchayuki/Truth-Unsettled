/**
 * 把 shared/cards.js 的数据整理成引擎使用的索引结构。
 * 该文件由 tools/sync-cards.js 复制到 cloudfunctions/game/rules/ 下使用。
 */
const DATA = require('./cards.js');

const typeLabel = { basic: '基础牌', trick: '锦囊牌', equipment: '装备牌' };

const cards = new Map();

function addCard(type, card, extra) {
  const def = Object.assign({}, card, extra, {
    type,
    tag: `${typeLabel[type]} · ${card.category || card.kind || ''}`.replace(/ · $/, '')
  });
  cards.set(`${type}:${card.id}`, def);
  return def;
}

const basics = DATA.basics.map(card => addCard('basic', card));
const tricks = DATA.tricks.map(card => addCard('trick', card));
const equipment = DATA.equipment.map(card => addCard('equipment', card, {
  slot: card.kind === '进攻' ? 'offense' : 'defense'
}));

const roles = new Map(DATA.philosophers.map(role => [role.id, role]));
const agendas = new Map(DATA.agendas.map(agenda => [agenda.id, Object.assign({ type: 'agenda' }, agenda)]));
const contracts = new Map(DATA.contracts.map(contract => [contract.id, contract]));

function cardOf(item) {
  if (!item) return null;
  const def = cards.get(`${item.type}:${item.cardId}`);
  if (!def) return null;
  return Object.assign({}, def, { instance: item.instance });
}

function cardById(type, id) {
  return cards.get(`${type}:${id}`) || null;
}

function agendaById(id) {
  return agendas.get(id) || null;
}

function roleById(id) {
  return roles.get(id) || null;
}

module.exports = {
  DATA,
  cardCatalog: cards,
  cards,
  basics,
  tricks,
  equipment,
  roles,
  agendas,
  contracts,
  cardOf,
  cardById,
  agendaById,
  roleById,
  factionsByCount: DATA.factionsByCount,
  rules: DATA.rules
};

