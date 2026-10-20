/**
 * 从服务器视角数据推导出的客户端选择逻辑。
 * 只做「哪些目标可以被点选」的过滤，真正的合法性仍由云端裁决。
 */

export function playerById(view, id) {
  return (view.players || []).find(player => player.id === id) || null;
}

export function targetsForCard(view, card) {
  const self = view.self;
  if (!self) return [];
  let list = view.players.filter(player => player.alive && player.id !== self.id);
  if (card.id === 'reductio' || card.id === 'chain') {
    list = list.filter(player => (player.marks || []).length > 0);
  }
  if (card.id === 'razor') {
    list = list.filter(player => player.equipment && (player.equipment.offense || player.equipment.defense));
  }
  return list;
}

export function removableMarks(view) {
  return (view.room.marks || []).filter(mark => !mark.protected);
}

export function slotsOf(player) {
  if (!player || !player.equipment) return [];
  return ['offense', 'defense'].filter(slot => !!player.equipment[slot]);
}

export function skillTargets(view, mode) {
  const self = view.self;
  const others = view.players.filter(player => player.alive && player.id !== self.id);
  switch (mode) {
    case 'alive': return view.players.filter(player => player.alive);
    case 'aliveOther': return others;
    case 'marked': return others.filter(player => (player.marks || []).length > 0);
    case 'equipment': return others.filter(player => player.equipment && (player.equipment.offense || player.equipment.defense));
    case 'moreHand': return others.filter(player => player.handCount > self.hand.length);
    case 'voted': return others.filter(player => player.voteSubmitted);
    case 'mindBelowMax': return others.filter(player => player.mind < player.maxMind);
    case 'richest': {
      const sorted = others.slice().sort((a, b) => b.handCount - a.handCount);
      if (!sorted.length) return [];
      const top = sorted[0].handCount;
      return sorted.filter(player => player.handCount === top);
    }
    default: return others;
  }
}

export function markTargets(view, mode) {
  const self = view.self;
  return (view.room.marks || []).filter(mark => mode === 'own' ? mark.ownerId === self.id : true);
}

export function equipmentTargets(view, mode) {
  const self = view.self;
  if (mode === 'own') return slotsOf({ equipment: self.equipment });
  return view.players.filter(player => player.alive && ((player.equipment && (player.equipment.offense || player.equipment.defense))));
}

export function describePlayer(player) {
  if (!player) return '未知玩家';
  const role = player.role ? player.role.name : '身份未定';
  if (!player.alive) return player.name + '（' + role + ' · 出局）';
  return player.name + '（' + role + '）';
}

export function canPlayCard(view, card) {
  if (!view || !view.self) return false;
  if (card.requires && card.requires.responseOnly) return false;
  // 每回合同名主牌上限：论证 2 张，其余 1 张（响应不计入）
  const playedThisTurn = (view.self.turnCards || []).filter(id => id === card.id).length;
  if (playedThisTurn >= (card.id === 'argument' ? 2 : 1)) return false;
  if (card.requires && card.requires.target && !targetsForCard(view, card).length) return false;
  if (card.requires && card.requires.mark && !removableMarks(view).length) return false;
  return true;
}
