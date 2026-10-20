/**
 * 规则引擎核心：随机数、牌堆、玩家、伤害、出局、胜负与阶段推进。
 * 不依赖云开发，可在 Node 中直接运行与模拟测试。
 */
const {
  basics, tricks, equipment, agendas, contracts, roles,
  cardOf, factionsByCount, rules
} = require('./catalog.js');

class RuleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RuleError';
    this.isRule = true;
  }
}

function fail(message) {
  throw new RuleError(message);
}

function need(condition, message) {
  if (!condition) fail(message);
}

/* ------------------------------------------------------------------ */
/* 随机数：状态保存在房间中，便于回放与测试                             */
/* ------------------------------------------------------------------ */

function rand(room) {
  let t = (room.rngState = (room.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function uid(room) {
  room.seq = (room.seq || 0) + 1;
  return room.seq.toString(36) + Math.floor(rand(room) * 1e8).toString(36);
}

function shuffle(room, list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand(room) * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function pick(room, list) {
  return list.length ? list[Math.floor(rand(room) * list.length)] : null;
}

/* ------------------------------------------------------------------ */
/* 房间与玩家                                                          */
/* ------------------------------------------------------------------ */

function addEvent(room, text, kind, extra) {
  room.seq = (room.seq || 0) + 1;
  room.events.unshift(Object.assign({
    id: 'e' + room.seq.toString(36),
    at: Date.now(),
    round: room.round || 0,
    text,
    kind: kind || 'info'
  }, extra || {}));
  if (room.events.length > 60) room.events.length = 60;
}

function newPlayer(openid, name, seat) {
  return {
    id: 'p' + seat + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    openid,
    name,
    seat,
    isBot: false,
    role: null,
    faction: null,
    contract: null,
    mind: 0,
    maxMind: 0,
    alive: true,
    hand: [],
    equipment: { offense: null, defense: null },
    vote: null,
    forcedVote: null,
    smokeVote: null,
    voteLocked: false,
    nightTarget: null,
    skillsUsed: {},
    gameUsed: {},
    flags: {},
    turnCards: [],
    turnPlayCounts: {},
    topicPlayCounts: {},
    turnDone: false,
    shield: 0,
    voteShield: false,
    causedDamage: false,
    roundCausedDamage: false,
    tookDamage: false,
    roundTookDamage: false,
    everEquipped: false,
    contractComplete: false,
    concordCount: 0,
    martyrVote: false,
    counterproofVote: false,
    lethalByPlayer: false
  };
}

function newRoom(code, expected) {
  return {
    v: 2,
    code,
    expected,
    phase: 'lobby',
    round: 0,
    maxRounds: 0,
    agenda: null,
    agendaDeck: [],
    agendaPool: [],
    players: [],
    deck: [],
    discard: [],
    marks: [],
    chips: [],
    results: [],
    events: [],
    pending: null,
    delayed: [],
    chorus: null,
    turnPlayerId: null,
    turnOrder: [],
    turnStartedAt: 0,
    nightDeadline: 0,
    voteDeadline: 0,
    nextAt: 0,
    winners: [],
    lastTally: null,
    recentOps: [],
    bannedTrickId: null,
    limitedBasicId: null,
    revoteUsed: false,
    rngState: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) | 0,
    seq: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

const findPlayer = (room, id) => room.players.find(player => player.id === id) || null;
const byOpenid = (room, openid) => room.players.find(player => player.openid === openid) || null;
const alive = room => room.players.filter(player => player.alive);
const aliveSkeptics = room => alive(room).filter(player => player.faction === '怀疑派');
const roleIs = (player, id) => !!(player && player.role && player.role.id === id);
const equipmentIs = (player, slot, id) =>
  !!(player && player.equipment[slot] && player.equipment[slot].cardId === id && !player.flags['disabled:' + slot]);

function publicFaction(room, player) {
  return (!player.alive || room.phase === 'finished') ? player.faction : null;
}

/* ------------------------------------------------------------------ */
/* 牌堆与手牌                                                          */
/* ------------------------------------------------------------------ */

function makeDeck(room) {
  const deck = [];
  const push = (type, list) => {
    list.forEach(card => {
      for (let i = 0; i < card.count; i++) deck.push({ instance: uid(room), type, cardId: card.id });
    });
  };
  push('basic', basics);
  push('trick', tricks);
  push('equipment', equipment);
  return shuffle(room, deck);
}

function handLimit(player) {
  if (!player) return 0;
  return Math.max(1, Number(player.mind || 0) + 1);
}

function enforceHandLimit(room, player) {
  if (!player || !player.alive) return;
  const limit = handLimit(player);
  while (player.hand.length > limit) {
    discardHand(room, player, player.hand.length - 1);
  }
}

function draw(room, player, count) {
  if (!player || !player.alive) return 0;
  let actual = 0;
  const limit = handLimit(player);
  for (let i = 0; i < count; i++) {
    if (player.hand.length >= limit) break;
    if (!room.deck.length) {
      if (!room.discard.length) break;
      room.deck = shuffle(room, room.discard.splice(0, room.discard.length));
    }
    player.hand.push(room.deck.pop());
    actual++;
  }
  return actual;
}

function pushDiscard(room, item, source) {
  if (!item) return;
  const duplicate = room.discard.find(card => card.instance === item.instance);
  if (duplicate) {
    fail('牌张状态异常：' + item.cardId + ' 已经在弃牌堆（' + (source || '未知来源') + '）。');
  }
  room.discard.push(item);
}

function discardHand(room, player, index) {
  if (index < 0 || index >= player.hand.length) return null;
  const item = player.hand.splice(index, 1)[0];
  pushDiscard(room, item, '弃置手牌');
  return item;
}

function discardInstance(room, player, instance) {
  const index = player.hand.findIndex(item => item.instance === instance);
  if (index < 0) return null;
  return discardHand(room, player, index);
}

function peekBottom(room, cards) {
  // 牌堆底位于数组头部：draw 使用 pop()
  cards.forEach(card => room.deck.unshift(card));
}

/* ------------------------------------------------------------------ */
/* 标记、票数影响与心智                                                */
/* ------------------------------------------------------------------ */

function addMark(room, player, stance, options) {
  const opts = options || {};
  const mark = {
    id: 'm' + uid(room),
    ownerId: player.id,
    stance,
    hidden: !!opts.hidden,
    bonus: opts.bonus || 0,
    protected: !!opts.protected
  };
  room.marks.push(mark);
  return mark;
}

function addChip(room, player, stance, amount, source) {
  room.chips.push({
    id: 'c' + uid(room),
    ownerId: player.id,
    stance,
    amount: amount || 1,
    source: source || ''
  });
}

function removeMark(room, markId) {
  const mark = room.marks.find(item => item.id === markId);
  if (!mark) return null;
  room.marks = room.marks.filter(item => item.id !== markId);
  if (room.agenda && room.agenda.id === 'agenda-countervoice') {
    const owner = findPlayer(room, mark.ownerId);
    if (owner && owner.alive) {
      draw(room, owner, 1);
      addEvent(room, owner.name + '的论证标记被移除，议题效果令其摸 1 张牌。', 'agenda');
    }
  }
  return mark;
}

function heal(room, player, amount, cause) {
  if (!player || !player.alive || amount <= 0) return 0;
  const before = player.mind;
  player.mind = Math.min(player.maxMind, player.mind + amount);
  const actual = player.mind - before;
  if (actual > 0) {
    addEvent(room, player.name + '恢复 ' + actual + ' 点心智' + (cause ? '（' + cause + '）' : '') + '。', 'heal');
  }
  return actual;
}

function forceVote(room, player, stance, cause) {
  if (!player || !player.alive) return false;
  if (player.voteShield) {
    player.voteShield = false;
    addEvent(room, player.name + '的「自然法」抵消了一次强制改票。', 'skill');
    return false;
  }
  if (equipmentIs(player, 'defense', 'cloak') && !player.flags.cloak) {
    player.flags.cloak = true;
    addEvent(room, player.name + '的「斯多亚斗篷」抵消了强制改票。', 'skill');
    return false;
  }
  if (room.agenda && room.agenda.id === 'agenda-law' && !player.flags.law && player.hand.length) {
    discardHand(room, player, 0);
    player.flags.law = true;
    addEvent(room, player.name + '弃 1 张手牌，抵消了强制改票（议题效果）。', 'agenda');
    return false;
  }
  if (roleIs(player, 'kant') && !player.flags.kant) {
    player.flags.kant = true;
    addEvent(room, player.name + '以「自律」抵消了强制改票。', 'skill');
    return false;
  }
  player.forcedVote = stance;
  player.vote = null;
  addEvent(room, player.name + '的投票被强制改为「' + stance + '」' + (cause ? '（' + cause + '）' : '') + '。', 'effect');
  return true;
}

/* ------------------------------------------------------------------ */
/* 伤害与出局                                                          */
/* ------------------------------------------------------------------ */

function damage(room, target, amount, source, cause) {
  if (!target || !target.alive || !amount || amount <= 0) return 0;
  let remaining = amount;
  const notes = [];

  while (remaining > 0 && target.shield > 0) {
    target.shield--;
    remaining--;
    notes.push('「仁者」护佑');
  }
  if (remaining > 0 && roleIs(target, 'spinoza') && !target.flags.spinozaGuard && target.hand.length) {
    discardHand(room, target, 0);
    target.flags.spinozaGuard = true;
    remaining--;
    notes.push('「单一实体」');
  }
  if (remaining > 0 && roleIs(target, 'aristotle') && !target.flags.aristotleMiddle && target.hand.length) {
    discardHand(room, target, 0);
    target.flags.aristotleMiddle = true;
    remaining--;
    notes.push('「中道」');
  }
  if (remaining > 0 && room.agenda && room.agenda.id === 'agenda-harm' && !target.flags.harm && target.hand.length) {
    discardHand(room, target, 0);
    target.flags.harm = true;
    remaining--;
    notes.push('议题护佑');
  }
  if (remaining > 0 && equipmentIs(target, 'defense', 'mala') && !target.flags.mala && target.hand.length) {
    discardHand(room, target, 0);
    target.flags.mala = true;
    remaining--;
    notes.push('佛珠');
  }

  if (remaining <= 0) {
    addEvent(room, target.name + '抵挡了来自' + (cause || '效果') + '的伤害（' + notes.join('、') + '）。', 'damage');
    return 0;
  }

  const actual = Math.min(target.mind, remaining);
  target.mind = Math.max(0, target.mind - remaining);
  target.tookDamage = true;
  target.roundTookDamage = true;
  if (source && source !== target) {
    source.causedDamage = true;
    source.roundCausedDamage = true;
  }
  target.lethalByPlayer = !!(source && source !== target) || cause === '夜间行动';

  addEvent(
    room,
    target.name + '因' + (cause || '未知原因') + '失去 ' + actual + ' 点心智' +
    (notes.length ? '（' + notes.join('、') + '已抵消 ' + (amount - remaining) + ' 点）' : '') + '。',
    'damage',
    { targetId: target.id }
  );

  // 孟子「四端」：任一玩家失去心智后恢复 1 点（每议题一次）
  const mencius = room.players.find(player => player.alive && roleIs(player, 'mencius') && !player.flags.menciusFour);
  if (mencius && target.alive && target.mind < target.maxMind) {
    mencius.flags.menciusFour = true;
    heal(room, target, 1, mencius.name + '「四端」');
  }

  // 汉谟拉比法典：受到其他玩家伤害时反制
  if (source && source.alive && source !== target && equipmentIs(target, 'defense', 'code') && !target.flags.code) {
    target.flags.code = true;
    if (source.hand.length) {
      discardHand(room, source, 0);
      addEvent(room, target.name + '的「汉谟拉比法典」令 ' + source.name + ' 弃 1 张手牌。', 'skill');
    } else {
      damage(room, source, 1, null, '汉谟拉比法典');
    }
  }

  // 尼采之锤：伤害结算后弃置受伤者一件装备
  if (source && source.alive && equipmentIs(source, 'offense', 'hammer') && !source.flags.hammer) {
    source.flags.hammer = true;
    const slot = target.equipment.offense ? 'offense' : (target.equipment.defense ? 'defense' : null);
    if (slot && discardEquipment(room, target, slot, source)) {
      addEvent(room, source.name + '的「尼采之锤」弃置了 ' + target.name + ' 的一件装备。', 'skill');
    }
  }

  if (target.mind <= 0) {
    // 伊本·西那「自因」：每局一次，避免出局
    if (roleIs(target, 'avicenna') && !target.gameUsed['avicenna:self'] && target.hand.length >= 2) {
      discardHand(room, target, 0);
      discardHand(room, target, 0);
      target.gameUsed['avicenna:self'] = true;
      target.mind = 1;
      addEvent(room, target.name + '发动「自因」，弃 2 张牌避免出局。', 'skill');
    } else {
      eliminate(room, target, cause);
    }
  }
  if (target.alive) enforceHandLimit(room, target);
  return actual;
}

function discardEquipment(room, player, slot, source) {
  const item = player.equipment[slot];
  if (!item) return false;
  if (player.alive && source && source !== player && !player.flags.locke && roleIs(player, 'locke') && player.hand.length) {
    player.flags.locke = true;
    discardHand(room, player, 0);
    addEvent(room, player.name + '弃 1 张手牌，以「财产权」保住装备。', 'skill');
    return false;
  }
  if (player.alive && source && source !== player && room.agenda && room.agenda.id === 'agenda-property' && !player.flags.property && player.hand.length) {
    player.flags.property = true;
    discardHand(room, player, 0);
    addEvent(room, player.name + '弃 1 张手牌，保住装备（议题效果）。', 'agenda');
    return false;
  }
  pushDiscard(room, item, '弃置装备');
  player.equipment[slot] = null;
  return true;
}

function eliminate(room, player, cause) {
  if (!player.alive) return;
  player.mind = 0;
  player.alive = false;
  player.vote = null;
  player.forcedVote = null;
  player.smokeVote = null;
  player.turnDone = true;
  room.marks = room.marks.filter(mark => mark.ownerId !== player.id);
  room.chips = room.chips.filter(chip => chip.ownerId !== player.id);
  ['offense', 'defense'].forEach(slot => {
    if (player.equipment[slot]) {
      pushDiscard(room, player.equipment[slot], '出局弃置装备');
      player.equipment[slot] = null;
    }
  });
  if (room.turnPlayerId === player.id) room.turnPlayerId = null;
  if (room.pending) {
    const ids = [room.pending.sourceId, room.pending.targetId, room.pending.chooserId, room.pending.nextId];
    if (ids.indexOf(player.id) >= 0) room.pending = null;
  }
  if (player.contract && player.contract.kind === 'death' && player.lethalByPlayer) {
    if (player.contract.id === 'contract-martyr' && player.martyrVote) player.contractComplete = true;
    if (player.contract.id === 'contract-counterproof' && player.counterproofVote) player.contractComplete = true;
  }
  addEvent(room, player.name + '心智归零，出局；其阵营公开为「' + player.faction + '」。', 'elimination', {
    playerId: player.id,
    cause: cause || ''
  });
  checkWinner(room, false);
}

/* ------------------------------------------------------------------ */
/* 契约与胜负                                                          */
/* ------------------------------------------------------------------ */

function contractSatisfied(room, player) {
  const contract = player.contract;
  if (!contract) return false;
  switch (contract.id) {
    case 'contract-guardian':
      return player.alive && player.mind >= 2;
    case 'contract-archivist':
      return player.alive && player.hand.length >= 3;
    case 'contract-concord':
      return player.alive && room.results.length > 0 &&
        player.concordCount >= Math.ceil(room.results.length / 2);
    case 'contract-dissenter':
      return player.alive && !!player.contractComplete;
    case 'contract-witness':
      return player.alive && room.results.some(result => result.result === '悬置');
    case 'contract-rhetor':
      return player.alive && !!player.contractComplete;
    case 'contract-pacifist':
      return player.alive && !player.causedDamage;
    case 'contract-curator':
      return player.alive && player.everEquipped;
    case 'contract-martyr':
      return !player.alive && !!player.contractComplete;
    case 'contract-counterproof':
      return !player.alive && !!player.contractComplete;
    default:
      return false;
  }
}

function winnerCheck(room, final) {
  if (room.phase === 'lobby') return [];
  const living = alive(room);
  const skeptics = living.filter(player => player.faction === '怀疑派').length;
  const builders = living.filter(player => player.faction === '建构派').length;
  const wanderers = living.filter(player => player.faction === '游士').length;
  const wins = [];
  // 至少完成一次公开表决后才宣布阵营胜负，避免第一轮出牌阶段就把人打死、
  // 连一次投票都没有就结束。
  const hasVote = room.results.length > 0;

  // 生存类胜利：出局对方全阵营，或怀疑派人数追平。
  if ((hasVote || final) && skeptics === 0 && builders > 0) wins.push('建构派');
  if ((hasVote || final) && builders === 0 && skeptics > 0) wins.push('怀疑派');
  if ((hasVote || final) && skeptics > 0 && skeptics >= builders + wanderers) wins.push('怀疑派');

  // 打满轮数后看结果分布：
  // 建构派要“通过过半 + 双方差距≤1”的均势；其余分布归怀疑派（极化）。
  if (final && !wins.length && room.results.length) {
    const total = room.results.length;
    const passed = room.results.filter(result => result.result === '通过').length;
    const rejected = total - passed;
    const balanced = passed > total / 2 && Math.abs(passed - rejected) <= 1;
    wins.push(balanced ? '建构派' : '怀疑派');
  }

  const ending = final || wins.length > 0 || living.length === 0 || room.phase === 'finished';
  if (ending) {
    room.players.forEach(player => {
      if (player.faction !== '游士' || !player.contract) return;
      if (contractSatisfied(room, player)) {
        player.contractComplete = true;
        wins.push(player.name + '（游士契约 · ' + player.contract.name + '）');
      }
    });
  }
  return Array.from(new Set(wins));
}

function finish(room, winners) {
  if (room.phase === 'finished') return;
  room.phase = 'finished';
  room.winners = winners.slice();
  room.pending = null;
  room.turnPlayerId = null;
  room.voteDeadline = 0;
  room.nightDeadline = 0;
  room.players.forEach(player => {
    player.vote = null;
    player.forcedVote = null;
    player.smokeVote = null;
  });
  addEvent(room, winners.length ? '本局结束，胜者：' + winners.join('、') : '本局结束：无人达成胜利条件。', 'end');
}

function checkWinner(room, final) {
  if (room.phase === 'finished') return true;
  const wins = winnerCheck(room, final);
  if (final || wins.length > 0 || alive(room).length === 0) {
    finish(room, wins);
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* 阶段推进                                                            */
/* ------------------------------------------------------------------ */

function clearRoundFlags(player) {
  player.vote = null;
  player.forcedVote = null;
  player.smokeVote = null;
  player.voteLocked = false;
  player.nightTarget = null;
  player.turnCards = [];
  player.turnPlayCounts = {};
  player.topicPlayCounts = {};
  player.turnDone = false;
  player.skillsUsed = {};
  player.flags = {};
  player.shield = 0;
  player.voteShield = false;
  player.roundCausedDamage = false;
  player.roundTookDamage = false;
  player.skillNote = '';
  player.skillNoteAt = 0;
}

function beginRound(room, round, now, options) {
  const opts = options || {};
  room.round = round;
  room.phase = 'night';
  room.agenda = room.agendaDeck[round - 1] || null;
  room.marks = [];
  room.chips = [];
  room.pending = null;
  room.delayed = [];
  room.chorus = null;
  room.lastTally = null;
  room.bannedTrickId = null;
  room.limitedBasicId = null;
  room.turnPlayerId = null;
  room.turnStartedAt = 0;
  room.nightDeadline = now + rules.timers.night * 1000;
  room.voteDeadline = 0;
  room.nextAt = 0;
  room.revoteRequested = false;

  room.players.forEach(player => {
    clearRoundFlags(player);
    if (player.alive && !opts.skipDraw) draw(room, player, rules.drawPerRound(room.expected));
  });

  addEvent(room, '第 ' + round + ' 轮开始，公开议题：「' + (room.agenda ? room.agenda.name : '无') + '」。', 'phase');
  if (!room.agenda) {
    checkWinner(room, true);
    return;
  }
  if (!aliveSkeptics(room).length) resolveNight(room, now, true);
}

function startTurn(room, player, now) {
  room.turnPlayerId = player.id;
  room.turnStartedAt = now;
  player.turnCards = [];
  player.turnPlayCounts = {};
  player.turnDone = false;
  if (roleIs(player, 'zhuangzi') && player.hand.length <= 1) {
    const got = draw(room, player, 1);
    if (got) addEvent(room, player.name + '触发「逍遥游」，摸 1 张牌。', 'skill');
  }
  addEvent(room, '轮到 ' + player.name + ' 行动。', 'turn', { playerId: player.id });
}

function beginAction(room, now) {
  if (checkWinner(room, false)) return;
  room.phase = 'action';
  room.pending = null;
  room.turnPlayerId = null;
  room.turnStartedAt = now;
  const order = shuffle(room, alive(room).map(player => player.id));
  room.turnOrder = order;
  alive(room).forEach(player => enforceHandLimit(room, player));
  addEvent(room, '夜间行动已结算，进入自由行动阶段。本轮出牌顺序随机。', 'phase');
  const first = order.length ? findPlayer(room, order[0]) : null;
  if (!first || !first.alive) {
    beginVote(room, now);
    return;
  }
  startTurn(room, first, now);
}

function nextTurn(room, now) {
  room.pending = null;
  const order = Array.isArray(room.turnOrder) && room.turnOrder.length
    ? room.turnOrder
    : room.players.map(player => player.id);
  const currentIndex = order.indexOf(room.turnPlayerId);
  for (let step = 1; step <= order.length; step++) {
    const player = findPlayer(room, order[((currentIndex + step) % order.length + order.length) % order.length]);
    if (player && player.alive && !player.turnDone) {
      startTurn(room, player, now);
      return;
    }
  }
  beginVote(room, now);
}

function endTurn(room, player, now) {
  need(room.phase === 'action', '现在不是行动阶段。');
  need(room.turnPlayerId === player.id, '现在不是你的行动回合。');
  need(!room.pending, '请先处理当前响应。');
  player.turnDone = true;
  if (player.faction === '游士' && player.contract && player.contract.id === 'contract-rhetor') {
    const names = new Set(player.turnCards);
    if (names.size >= 2) player.contractComplete = true;
  }
  addEvent(room, player.name + '结束行动。', 'turn');
  nextTurn(room, now);
}

function beginVote(room, now) {
  room.phase = 'vote';
  room.pending = null;
  room.turnPlayerId = null;
  room.voteDeadline = now + rules.timers.vote * 1000;
  room.players.forEach(player => {
    if (!player.alive) return;
    player.vote = null;
  });
  addEvent(room, '行动阶段结束，进入秘密投票。', 'phase');
}

function allVoted(room) {
  const living = alive(room);
  return living.length > 0 && living.every(player => player.vote || player.forcedVote || player.smokeVote);
}

function hasVoted(player) {
  return !!(player.vote || player.forcedVote || player.smokeVote);
}

function submittedCount(room) {
  return alive(room).filter(hasVoted).length;
}

/* ------------------------------------------------------------------ */
/* 夜间行动                                                            */
/* ------------------------------------------------------------------ */

function resolveNight(room, now, force) {
  if (room.phase !== 'night') return false;
  const agents = aliveSkeptics(room);
  const submitted = agents.filter(player => player.nightTarget);
  if (!force && submitted.length < agents.length) return false;

  const valid = submitted.filter(player => {
    const target = findPlayer(room, player.nightTarget);
    return target && target.alive && target.faction !== '怀疑派' && target.id !== player.id;
  });

  if (valid.length) {
    const counts = new Map();
    valid.forEach(player => counts.set(player.nightTarget, (counts.get(player.nightTarget) || 0) + 1));
    const max = Math.max.apply(null, Array.from(counts.values()));
    const leaders = Array.from(counts.entries()).filter(entry => entry[1] === max).map(entry => entry[0]);
    valid.forEach(player => {
      player.causedDamage = true;
      player.roundCausedDamage = true;
    });
    if (leaders.length === 1) {
      const target = findPlayer(room, leaders[0]);
      if (target && target.alive) {
        addEvent(room, '怀疑派的秘密行动指向了一名玩家。', 'night');
        damage(room, target, 1, null, '夜间行动');
      }
    } else {
      addEvent(room, '怀疑派的目标票数相同，本议题没有夜间伤害。', 'night');
    }
  } else {
    addEvent(room, '怀疑派没有形成有效目标，本议题无人受伤。', 'night');
  }

  room.players.forEach(player => { player.nightTarget = null; });
  if (room.phase === 'night') beginAction(room, now);
  return true;
}

function submitNight(room, player, targetId, now) {
  need(room.phase === 'night', '现在不是夜间阶段。');
  need(player.alive, '你已出局。');
  need(player.faction === '怀疑派', '只有怀疑派需要提交秘密目标。');
  const target = findPlayer(room, targetId);
  need(target && target.alive && target.id !== player.id && target.faction !== '怀疑派', '请选择一名存活的非怀疑派玩家。');
  player.nightTarget = targetId;
  addEvent(room, '一名怀疑派提交了秘密行动。', 'night');
  resolveNight(room, now, false);
}

/* ------------------------------------------------------------------ */
/* 出牌辅助                                                            */
/* ------------------------------------------------------------------ */

function addPending(room, data, now) {
  room.pending = Object.assign({
    id: 'x' + uid(room),
    createdAt: now,
    deadline: now + rules.timers.pending * 1000
  }, data);
  return room.pending;
}

function clearPending(room) {
  room.pending = null;
}

function createPlayer(openid, name, seat) {
  return newPlayer(openid, name, seat);
}

module.exports = {
  RuleError,
  fail,
  need,
  rand,
  uid,
  shuffle,
  pick,
  addEvent,
  newPlayer,
  newRoom,
  createPlayer,
  findPlayer,
  byOpenid,
  alive,
  aliveSkeptics,
  roleIs,
  equipmentIs,
  publicFaction,
  makeDeck,
  draw,
  handLimit,
  enforceHandLimit,
  discardHand,
  discardInstance,
  pushDiscard,
  peekBottom,
  addMark,
  addChip,
  removeMark,
  heal,
  forceVote,
  damage,
  discardEquipment,
  eliminate,
  contractSatisfied,
  winnerCheck,
  finish,
  checkWinner,
  clearRoundFlags,
  beginRound,
  startTurn,
  beginAction,
  nextTurn,
  endTurn,
  beginVote,
  allVoted,
  hasVoted,
  submittedCount,
  resolveNight,
  submitNight,
  addPending,
  clearPending,
  agendas,
  contracts,
  roles,
  factionsByCount,
  rules,
  cardOf
};

