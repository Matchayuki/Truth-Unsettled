/**
 * 出牌与响应：所有主动牌的效果、待处理响应、响应选项。
 */
const core = require('./core.js');
const { cardOf, cards } = require('./catalog.js');
const {
  need, fail, addEvent, findPlayer, alive, roleIs, equipmentIs,
  draw, discardHand, discardInstance, peekBottom, addMark, addChip, removeMark,
  heal, forceVote, damage, discardEquipment, addPending, clearPending,
  checkWinner, nextTurn, rules
} = core;

const STANCES = ['赞成', '反对', '悬置'];

function ownMarks(room, player) {
  return room.marks.filter(mark => mark.ownerId === player.id);
}

function handCard(room, player, instance) {
  const index = player.hand.findIndex(item => item.instance === instance);
  if (index < 0) return null;
  return { index, item: player.hand[index], def: cardOf(player.hand[index]) };
}

function highestEquipmentSlot(player) {
  if (player.equipment.offense) return 'offense';
  if (player.equipment.defense) return 'defense';
  return null;
}

function targetsForCard(room, player, def) {
  if (def.target !== 'other') return [];
  let list = alive(room).filter(other => other.id !== player.id);
  if (def.id === 'reductio' || def.id === 'chain') {
    list = list.filter(other => room.marks.some(mark => mark.ownerId === other.id));
  }
  if (def.id === 'razor') {
    list = list.filter(other => other.equipment.offense || other.equipment.defense);
  }
  return list;
}

function validatePlay(room, player, def, payload) {
  need(def, '牌面不存在。');
  need(!def.responseOnly, '「' + def.name + '」只能在响应时使用。');
  const turnLimit = def.id === 'argument' ? 2 : 1;
  const playedThisTurn = (player.turnPlayCounts && player.turnPlayCounts[def.id]) || 0;
  need(playedThisTurn < turnLimit, '本回合已经打出上限数量的「' + def.name + '」。');
  if (def.type === 'basic' && room.limitedBasicId === def.id &&
    ((player.topicPlayCounts && player.topicPlayCounts[def.id]) || 0) >= 1) {
    fail('荀子的「礼法」令本议题内每名玩家至多打出 1 张「' + def.name + '」。');
  }
  if (def.type === 'trick' && room.bannedTrickId === def.id) fail('康德的「定言令式」禁止本议题使用「' + def.name + '」。');

  if (def.target === 'other') {
    const target = findPlayer(room, payload.targetId);
    need(target && target.alive && target.id !== player.id, '请选择一名其他存活玩家。');
    if (def.id === 'reductio' || def.id === 'chain') {
      need(room.marks.some(mark => mark.ownerId === target.id), '目标没有可指定的论证标记。');
    }
    if (def.id === 'razor') {
      need(payload.slot === 'offense' || payload.slot === 'defense', '请选择目标的装备栏。');
      need(target.equipment[payload.slot], '目标该装备栏是空的。');
    }
  }

  if (def.stance) need(STANCES.indexOf(payload.stance) === 0 || STANCES.indexOf(payload.stance) === 1, '请选择赞成或反对。');

  if (def.id === 'argument') {
    need(ownMarks(room, player).length < 2, '你本议题已经有两枚论证标记。');
  }

  if (def.id === 'counterexample') {
    need(room.marks.length > 0, '场上没有可以移除的论证标记。');
    const mark = room.marks.find(item => item.id === payload.markId);
    need(mark, '请选择要移除的论证标记。');
    need(!mark.protected, '这枚论证标记受「逻辑尺」保护，不能被反例移除。');
  }

  if (def.id === 'citation') {
    const reveal = handCard(room, player, payload.revealInstance);
    need(reveal && reveal.item.instance !== payload.instance, '请选择另一张手牌作为引证。');
  }

  if (def.id === 'experiment') {
    need(STANCES.indexOf(payload.prediction) >= 0, '请预测本轮结果。');
  }

  if (def.id === 'rewrite') {
    need(room.round < room.maxRounds, '最后一轮不能改写议程。');
    need(room.agendaPool.length > 0, '没有可以替换的议题牌。');
  }

  if (def.id === 'chorus') {
    need(!room.chorus, '本议题已经有「众声合鸣」生效。');
  }

  if (def.id === 'argument') {
    if (payload.boost) {
      need(roleIs(player, 'nietzsche'), '只有尼采可以使用重估价值。');
      need(highestEquipmentSlot(player), '「重估价值」需要先弃置自己的一件装备。');
      need(!player.flags.nietzscheBoost, '「重估价值」每议题只能使用一次。');
    }
  }
}

function playCard(room, player, payload, now) {
  need(room.phase === 'action', '现在不是行动阶段。');
  need(room.turnPlayerId === player.id, '现在不是你的行动回合。');
  need(player.alive, '你已出局。');
  need(!room.pending, '请先处理当前响应。');

  const found = handCard(room, player, payload.instance);
  need(found, '这张牌不在你的手牌中。');
  const def = found.def;
  validatePlay(room, player, def, payload);

  // 支付：先离手，再结算
  discardHand(room, player, found.index);
  player.turnCards.push(def.id);
  player.turnPlayCounts = player.turnPlayCounts || {};
  player.turnPlayCounts[def.id] = (player.turnPlayCounts[def.id] || 0) + 1;
  player.topicPlayCounts = player.topicPlayCounts || {};
  player.topicPlayCounts[def.id] = (player.topicPlayCounts[def.id] || 0) + 1;

  switch (def.id) {
    case 'argument': playArgument(room, player, def, payload); break;
    case 'challenge': playChallenge(room, player, def, payload, now); break;
    case 'counterexample': playCounterexample(room, player, def, payload); break;
    case 'study': playStudy(room, player, def, now); break;
    case 'breathe': playBreathe(room, player, def); break;
    case 'citation': playCitation(room, player, def, payload); break;
    case 'concede': playConcede(room, player, def); break;
    case 'listen': playListen(room, player, def, now); break;
    case 'reflection': playReflection(room, player, def); break;
    case 'evidence': playEvidence(room, player, def, now); break;
    case 'deliberation': playDeliberation(room, player, def, payload, now); break;
    case 'debate': playDebate(room, player, def, payload, now); break;
    case 'reductio': playReductio(room, player, def, payload, now); break;
    case 'pact': playPact(room, player, def, payload); break;
    case 'razor': playRazor(room, player, def, payload, now); break;
    case 'experiment': playExperiment(room, player, def, payload); break;
    case 'rewrite': playRewrite(room, player, def); break;
    case 'smokescreen': playSmokescreen(room, player, def, payload); break;
    case 'memory': playMemory(room, player, def, now); break;
    case 'chorus': playChorus(room, player, def, payload); break;
    case 'scrutiny': playScrutiny(room, player, def, payload, now); break;
    case 'chain': playChain(room, player, def, payload, now); break;
    default:
      if (def.type === 'equipment') playEquipment(room, player, def, found.item);
      else addEvent(room, player.name + '打出「' + def.name + '」。', 'play');
  }

  afterPlay(room, player, def);
  return def;
}

/* ------------------------------ 基础牌 ------------------------------ */

function playEquipment(room, player, def, item) {
  const slot = def.slot;
  // 出牌时这张牌已被放入弃牌堆，装备时把它取回
  const index = room.discard.findIndex(card => card.instance === item.instance);
  if (index >= 0) room.discard.splice(index, 1);
  if (player.equipment[slot]) core.pushDiscard(room, player.equipment[slot], '更换装备');
  player.equipment[slot] = item;
  player.everEquipped = true;
  addEvent(room, player.name + '装备「' + def.name + '」（' + (slot === 'offense' ? '进攻' : '防守') + '栏）。', 'play');
}

function playArgument(room, player, def, payload) {
  let bonus = 0;
  if (roleIs(player, 'mencius') && player.mind <= 2 && !player.flags.ardent) {
    player.flags.ardent = true;
    bonus += 1;
    addEvent(room, player.name + '触发「浩然之气」，论证额外 +1 票。', 'skill');
  }
  if (payload.boost) {
    player.flags.nietzscheBoost = true;
    const slot = highestEquipmentSlot(player);
    core.pushDiscard(room, player.equipment[slot], '重估价值');
    player.equipment[slot] = null;
    bonus += 2;
    addEvent(room, player.name + '发动「重估价值」，弃置装备使论证 +2 票。', 'skill');
  }
  const hidden = equipmentIs(player, 'offense', 'mask') && !player.flags.maskHidden;
  if (hidden) player.flags.maskHidden = true;
  const protectedMark = equipmentIs(player, 'offense', 'logic') && ownMarks(room, player).length === 0;
  const mark = addMark(room, player, payload.stance, { hidden, bonus, protected: protectedMark });
  player.flags['mark:' + mark.id] = true;
  addEvent(room, player.name + '打出「论证」' + (hidden ? '（立场暗置）' : '（' + payload.stance + '）') +
    '，影响 +' + (1 + bonus) + '。', 'play');
}

function playChallenge(room, player, def, payload, now) {
  const target = findPlayer(room, payload.targetId);
  const staff = equipmentIs(player, 'offense', 'staff') && !player.flags.staff;
  if (staff) player.flags.staff = true;
  addPending(room, {
    kind: 'challenge',
    sourceId: player.id,
    targetId: target.id,
    chooserId: target.id,
    cardName: def.name,
    staff,
    question: staff
      ? '诘问（诡辩手杖）：打出反例，或弃 2 张手牌；否则失去 1 点心智并锁定悬置。'
      : '诘问：打出反例抵消，或承受 1 点心智伤害并锁定悬置。'
  }, now);
  addEvent(room, player.name + '对 ' + target.name + ' 发起「诘问」' + (staff ? '（诡辩手杖）' : '') + '。', 'play');
}

function playCounterexample(room, player, def, payload) {
  const mark = removeMark(room, payload.markId);
  if (mark) {
    addEvent(room, player.name + '打出「反例」，移除了一枚论证标记。', 'play');
  }
}

function playStudy(room, player, def, now) {
  draw(room, player, 2);
  addEvent(room, player.name + '使用「研读」，摸 2 张牌。', 'play');

  if (roleIs(player, 'xunzi') && !player.flags.xunziStudy && player.hand.length) {
    player.flags.xunziStudy = true;
    discardHand(room, player, 0);
    draw(room, player, 1);
    addEvent(room, player.name + '触发「化性起伪」，额外弃 1 张并摸 1 张。', 'skill');
  }
  if (roleIs(player, 'hypatia') && !player.flags.hypatiaLecture && player.hand.some(item => item.type === 'basic')) {
    player.flags.hypatiaLecture = true;
    const basic = player.hand.find(item => item.type === 'basic');
    addEvent(room, player.name + '触发「学园讲坛」，展示「' + cardOf(basic).name + '」并额外摸 1 张。', 'skill');
    draw(room, player, 1);
  }
  const optionCards = player.hand.map(item => cardOf(item));
  if (optionCards.length) {
    addPending(room, {
      kind: 'discard-own',
      sourceId: player.id,
      targetId: player.id,
      chooserId: player.id,
      cardName: def.name,
      question: '研读：选择 1 张手牌弃置。'
    }, now);
  }
}

function playBreathe(room, player, def) {
  let amount = 1;
  if (room.agenda && room.agenda.id === 'agenda-happiness' && !player.flags.happiness) {
    player.flags.happiness = true;
    amount = 2;
  }
  const actual = heal(room, player, amount, '调息');
  addEvent(room, player.name + '使用「调息」，恢复 ' + actual + ' 点心智。', 'play');
}

function playCitation(room, player, def, payload) {
  const reveal = handCard(room, player, payload.revealInstance);
  const revealed = reveal.def;
  addChip(room, player, payload.stance, 1, 'citation');
  addEvent(room, player.name + '以「引证」展示「' + revealed.name + '」，为' + payload.stance + '增加 1 票影响。', 'play');
  if (revealed.type === 'trick') room.delayed.push({ kind: 'citation-draw', ownerId: player.id });
}

function playConcede(room, player, def) {
  player.forcedVote = '悬置';
  player.vote = null;
  if (room.pending && room.pending.kind === 'challenge' && room.pending.targetId === player.id) {
    room.pending = null;
    addEvent(room, player.name + '以「让步」抵消了针对自己的诘问。', 'play');
  }
  draw(room, player, 1);
  addEvent(room, player.name + '使用「让步」，本议题投票锁定为悬置，并摸 1 张牌。', 'play');
}

function playListen(room, player, def, now) {
  const first = room.deck.pop();
  const second = room.deck.pop();
  const peeked = [first, second].filter(Boolean);
  if (!peeked.length) {
    draw(room, player, 1);
    addEvent(room, player.name + '使用「旁听」，牌堆已空，改为摸 1 张。', 'play');
    return;
  }
  addPending(room, {
    kind: 'choose-card',
    sourceId: player.id,
    targetId: player.id,
    chooserId: player.id,
    cardName: def.name,
    cards: peeked,
    question: '旁听：选择 1 张加入手牌，其余放回牌堆底。'
  }, now);
  addEvent(room, player.name + '使用「旁听」，查看牌堆顶 ' + peeked.length + ' 张牌。', 'play');
}

function playReflection(room, player, def) {
  const mark = ownMarks(room, player)[0];
  if (mark) {
    mark.stance = mark.stance === '赞成' ? '反对' : '赞成';
    mark.hidden = false;
    if (mark.protected) mark.protected = false;
    addEvent(room, player.name + '使用「反思」，将自己的论证改为' + mark.stance + '。', 'play');
  } else {
    draw(room, player, 1);
    addEvent(room, player.name + '使用「反思」，没有论证标记，改为摸 1 张牌。', 'play');
  }
}

function playEvidence(room, player, def, now) {
  let count = 3;
  if (room.agenda && room.agenda.id === 'agenda-knowledge' && !player.flags.knowledge) {
    player.flags.knowledge = true;
    count = 4;
  }
  const take = Math.min(count, room.deck.length);
  const peeked = take ? room.deck.splice(room.deck.length - take, take) : [];
  const basics = peeked.filter(item => item.type === 'basic');
  const others = peeked.filter(item => item.type !== 'basic');
  peekBottom(room, others);

  if (!basics.length) {
    draw(room, player, 1);
    addEvent(room, player.name + '使用「求证」，没有找到基础牌，改为摸 1 张。', 'play');
    return;
  }
  if (basics.length === 1) {
    player.hand.push(basics[0]);
    addEvent(room, player.name + '使用「求证」，找到「' + cardOf(basics[0]).name + '」。', 'play');
    return;
  }
  addPending(room, {
    kind: 'choose-card',
    sourceId: player.id,
    targetId: player.id,
    chooserId: player.id,
    cardName: def.name,
    cards: basics,
    question: '求证：选择 1 张基础牌加入手牌，其余放到牌堆底。'
  }, now);
  addEvent(room, player.name + '使用「求证」，发现 ' + basics.length + ' 张基础牌。', 'play');
}

function playDeliberation(room, player, def, payload, now) {
  const target = findPlayer(room, payload.targetId);
  need(target && target.alive, '共议的目标已经不在场。');
  draw(room, player, 1);
  draw(room, target, 1);
  addEvent(room, player.name + '与 ' + target.name + ' 进行「共议」，双方各摸 1 张牌。', 'play');
  if (player.hand.length) {
    addPending(room, {
      kind: 'deliberation',
      sourceId: player.id,
      targetId: target.id,
      chooserId: player.id,
      stage: 'source',
      cardName: def.name,
      question: '共议：你与 ' + target.name + ' 各弃 1 张手牌。先选择你要弃置的牌。'
    }, now);
  } else if (target.hand.length) {
    addPending(room, {
      kind: 'deliberation',
      sourceId: player.id,
      targetId: target.id,
      chooserId: target.id,
      stage: 'target',
      cardName: def.name,
      question: '共议：选择 1 张手牌弃置。'
    }, now);
  }
}

/* ------------------------------ 锦囊牌 ------------------------------ */

function playDebate(room, player, def, payload, now) {
  const target = findPlayer(room, payload.targetId);
  const sword = equipmentIs(player, 'offense', 'sword');
  const nextId = sword ? target.id : player.id;
  addPending(room, {
    kind: 'debate',
    sourceId: player.id,
    targetId: target.id,
    nextId,
    chooserId: nextId,
    sword,
    plays: 0,
    cardName: def.name,
    question: '辩论：弃 1 张「论证」或「反例」继续；无法出牌者失去 1 点心智并锁定悬置。'
  }, now);
  addEvent(room, player.name + '对 ' + target.name + ' 发起「辩论」' + (sword ? '（达摩克利斯之剑：对方先出牌）' : '') + '。', 'play');
}

function playReductio(room, player, def, payload, now) {
  const target = findPlayer(room, payload.targetId);
  const mark = room.marks.find(item => item.ownerId === target.id);
  const lever = equipmentIs(player, 'offense', 'lever') && !player.flags.lever;
  if (lever) player.flags.lever = true;
  addPending(room, {
    kind: 'reductio',
    sourceId: player.id,
    targetId: target.id,
    chooserId: target.id,
    markId: mark.id,
    lever,
    cardName: def.name,
    question: '归谬法：弃 1 张「反例」保留标记，或移除标记并弃 1 张手牌。'
  }, now);
  addEvent(room, player.name + '对 ' + target.name + ' 使用「归谬法」。', 'play');
}

function playPact(room, player, def, payload) {
  room.delayed.push({ kind: 'pact', ownerId: player.id, stance: payload.stance });
  addEvent(room, player.name + '使用「公意契约」，声明支持' + payload.stance + '。', 'play');
}

function playRazor(room, player, def, payload, now) {
  const target = findPlayer(room, payload.targetId);
  addPending(room, {
    kind: 'razor',
    sourceId: player.id,
    targetId: target.id,
    chooserId: target.id,
    slot: payload.slot,
    cardName: def.name,
    question: '奥卡姆剃刀指定了你的装备；可以使用反制牌或技能，或确认结算。'
  }, now);
  addEvent(room, player.name + '以「奥卡姆剃刀」指定 ' + target.name + ' 的装备。', 'play');
}

function playExperiment(room, player, def, payload) {
  room.delayed.push({ kind: 'experiment', ownerId: player.id, prediction: payload.prediction });
  addEvent(room, player.name + '使用「思想实验」，秘密写下了预测。', 'play');
}

function playRewrite(room, player, def) {
  const next = room.agendaPool.shift();
  need(next, '没有可以替换的议题牌。');
  const old = room.agenda;
  room.agenda = next;
  room.agendaDeck[room.round - 1] = next;
  room.marks = [];
  room.chips = [];
  addEvent(room, player.name + '使用「议程改写」，将「' + (old ? old.name : '原议题') + '」替换为「' + next.name + '」。', 'play');
}

function playSmokescreen(room, player, def, payload, now) {
  const target = findPlayer(room, payload.targetId);
  target.voteLocked = true;
  addPending(room, {
    kind: 'smoke-vote',
    sourceId: player.id,
    targetId: target.id,
    chooserId: target.id,
    cardName: def.name,
    question: '修辞烟幕：现在秘密放置你的投票；提交后不能更改。'
  }, now);
  addEvent(room, player.name + '使用「修辞烟幕」，' + target.name + '须先秘密放置投票。', 'play');
}

function playMemory(room, player, def, now) {
  const basicsInDiscard = room.discard.filter(item => item.type === 'basic');
  if (!basicsInDiscard.length) {
    draw(room, player, 1);
    addEvent(room, player.name + '使用「群体记忆」，弃牌堆没有基础牌，改为摸 1 张。', 'play');
    return;
  }
  if (basicsInDiscard.length === 1) {
    room.discard = room.discard.filter(item => item.instance !== basicsInDiscard[0].instance);
    player.hand.push(basicsInDiscard[0]);
    addEvent(room, player.name + '使用「群体记忆」，回收了「' + cardOf(basicsInDiscard[0]).name + '」。', 'play');
    return;
  }
  // 把可选的基础牌暂时从弃牌堆取走，响应时再放回未选的牌
  room.discard = room.discard.filter(item => item.type !== 'basic');
  addPending(room, {
    kind: 'memory',
    sourceId: player.id,
    targetId: player.id,
    chooserId: player.id,
    cardName: def.name,
    cards: basicsInDiscard,
    question: '群体记忆：从弃牌堆选择 1 张基础牌加入手牌。'
  }, now);
}

function playChorus(room, player, def, payload) {
  room.chorus = { ownerId: player.id, stance: payload.stance };
  addEvent(room, player.name + '使用「众声合鸣」，声明支持' + payload.stance + '。', 'play');
}

function playScrutiny(room, player, def, payload, now) {
  const target = findPlayer(room, payload.targetId);
  if (!target.hand.length) {
    addEvent(room, player.name + '使用「公开审查」，' + target.name + '没有手牌。', 'play');
    damage(room, target, 1, player, '公开审查');
    return;
  }
  addPending(room, {
    kind: 'scrutiny-ward',
    sourceId: player.id,
    targetId: target.id,
    chooserId: target.id,
    cardName: def.name,
    question: '公开审查：你须展示全部手牌；可以使用反制牌或技能，或允许对方选择一张弃置。'
  }, now);
  addEvent(room, target.name + '的手牌被公开审查。', 'play');
}

function playChain(room, player, def, payload, now) {
  const target = findPlayer(room, payload.targetId);
  addPending(room, {
    kind: 'chain',
    sourceId: player.id,
    targetId: target.id,
    chooserId: target.id,
    cardName: def.name,
    question: '证据链：弃 1 张手牌，或移除自己一枚论证标记。'
  }, now);
  addEvent(room, player.name + '对 ' + target.name + ' 使用「证据链」。', 'play');
}

/* ------------------------------ 回合内自动技能 ------------------------------ */

function afterPlay(room, player, def) {
  // 阿奎那「经院合题」：本回合打出两类牌
  if (roleIs(player, 'aquinas') && !player.flags.aquinasMix) {
    const types = new Set();
    player.turnCards.forEach(id => {
      const found = cards.get('basic:' + id) || cards.get('trick:' + id) || cards.get('equipment:' + id);
      if (found) types.add(found.type);
    });
    if (types.size >= 2) {
      player.flags.aquinasMix = true;
      draw(room, player, 1);
      addEvent(room, player.name + '触发「经院合题」，摸 1 张牌。', 'skill');
    }
  }
  // 笛卡尔「我思」：打牌后手牌为空
  if (roleIs(player, 'descartes') && !player.flags.descartesEmpty && !player.hand.length) {
    player.flags.descartesEmpty = true;
    draw(room, player, 1);
    addEvent(room, player.name + '触发「我思」，摸 1 张牌。', 'skill');
  }
  // 休谟「经验主义」：牌堆顶与刚打出的牌类别相同
  if (roleIs(player, 'hume') && !player.flags.humeExperience && room.deck.length) {
    const top = room.deck[room.deck.length - 1];
    if (top.type === def.type) {
      player.flags.humeExperience = true;
      player.hand.push(room.deck.pop());
      addEvent(room, player.name + '触发「经验主义」，摸入牌堆顶的' + (top.type === 'basic' ? '基础牌' : top.type === 'trick' ? '锦囊牌' : '装备牌') + '。', 'skill');
    }
  }
}

/* ------------------------------ 响应 ------------------------------ */

function promptOptions(room, pending) {
  if (!pending) return [];
  const chooser = findPlayer(room, pending.chooserId);
  if (!chooser || !chooser.alive) return [];
  const options = [];

  switch (pending.kind) {
    case 'challenge': {
      const hasCounter = chooser.hand.some(item => item.cardId === 'counterexample' && item.type === 'basic');
      const hasConcede = chooser.hand.some(item => item.cardId === 'concede' && item.type === 'basic');
      if (hasCounter) options.push({ label: '打出「反例」抵消诘问', value: 'block' });
      if (hasConcede) options.push({ label: '打出「让步」脱身并摸 1 张', value: 'concede' });
      if (pending.staff && chooser.hand.length >= 2) options.push({ label: '弃 2 张手牌抵挡（诡辩手杖）', value: 'discard2' });
      if (!pending.staff || (!hasCounter && !hasConcede && chooser.hand.length < 2)) {
        options.push({ label: '承受 1 点心智伤害，投票锁定悬置', value: 'take' });
      }
      break;
    }
    case 'debate': {
      const canFortify = roleIs(chooser, 'mozi') && !chooser.flags.moziFortify;
      chooser.hand.forEach(item => {
        if (item.type === 'basic' && (item.cardId === 'argument' || item.cardId === 'counterexample')) {
          options.push({ label: '打出「' + cardOf(item).name + '」继续辩论', value: item.instance });
        } else if (canFortify) {
          options.push({ label: '守城：亮出「' + cardOf(item).name + '」视为反例', value: 'fortify:' + item.instance });
        }
      });
      options.push({ label: '无法继续，接受失败', value: 'fold' });
      break;
    }
    case 'discard-own':
    case 'deliberation':
      chooser.hand.forEach(item => options.push({ label: '弃置「' + cardOf(item).name + '」', value: item.instance }));
      break;
    case 'choose-card':
    case 'memory':
      (pending.cards || []).forEach(item => options.push({ label: '选择「' + cardOf(item).name + '」', value: item.instance }));
      break;
    case 'reductio':
      if (chooser.hand.some(item => item.cardId === 'counterexample')) options.push({ label: '弃 1 张「反例」保留标记', value: 'counter' });
      options.push({ label: '移除标记并弃 1 张手牌', value: 'remove' });
      break;
    case 'scrutiny-ward':
      options.push({ label: '允许对方选择一张手牌弃置', value: 'allow' });
      break;
    case 'scrutiny': {
      const target = findPlayer(room, pending.targetId);
      if (target) target.hand.forEach(item => options.push({ label: '令其弃置「' + cardOf(item).name + '」', value: item.instance }));
      break;
    }
    case 'razor':
      options.push({ label: '确认结算', value: 'resolve' });
      break;
    case 'razor-save':
      options.push({ label: '弃 1 张手牌，保住装备', value: 'save' });
      options.push({ label: '不保护，弃置装备', value: 'remove' });
      break;
    case 'lever': {
      ['offense', 'defense'].forEach(slot => {
        if (chooser.equipment[slot]) options.push({ label: '弃置' + (slot === 'offense' ? '进攻' : '防守') + '装备', value: slot });
      });
      options.push({ label: '失去 1 点心智', value: 'mind' });
      break;
    }
    case 'chain':
      options.push({ label: '移除自己一枚论证标记', value: 'remove' });
      chooser.hand.forEach(item => options.push({ label: '弃置「' + cardOf(item).name + '」', value: item.instance }));
      break;
    case 'smoke-vote':
      STANCES.forEach(stance => options.push({ label: '秘密投「' + stance + '」', value: stance }));
      break;
    case 'give-card':
      chooser.hand.forEach(item => options.push({ label: '交给对方「' + cardOf(item).name + '」', value: item.instance }));
      break;
    case 'pick-discard': {
      const target = findPlayer(room, pending.targetId);
      if (target) target.hand.filter(item => item.type === 'basic').forEach(item => {
        options.push({ label: '令其弃置「' + cardOf(item).name + '」', value: item.instance });
      });
      break;
    }
    default:
      break;
  }

  // 针对指定自己的锦囊牌，可使用「逻辑悖论」或「八卦镜」
  const trickTarget = ['reductio', 'scrutiny-ward', 'chain', 'razor'].indexOf(pending.kind) >= 0;
  if (trickTarget) {
    if (chooser.hand.some(item => item.cardId === 'paradox' && item.type === 'trick')) {
      options.push({ label: '打出「逻辑悖论」抵消这张锦囊', value: 'paradox' });
    }
    if (equipmentIs(chooser, 'defense', 'bagua') && !chooser.flags.bagua) {
      options.push({ label: '发动「八卦镜」把效果转移给使用者', value: 'bagua' });
    }
  }
  return options;
}

function promptFor(room, player) {
  const pending = room.pending;
  if (!pending || pending.chooserId !== player.id) return null;
  const options = promptOptions(room, pending);
  if (!options.length) return null;
  const source = findPlayer(room, pending.sourceId);
  const target = findPlayer(room, pending.targetId);
  return {
    id: pending.id,
    kind: pending.kind,
    cardName: pending.cardName || '',
    question: pending.question || '请选择如何响应。',
    sourceName: source ? source.name : '',
    targetName: target ? target.name : '',
    options
  };
}

function defaultChoice(room, pending) {
  const options = promptOptions(room, pending);
  if (!options.length) return null;
  const preferred = {
    challenge: 'take',
    debate: 'fold',
    reductio: 'remove',
    'scrutiny-ward': 'allow',
    razor: 'resolve',
    'razor-save': 'remove',
    lever: 'mind',
    chain: 'remove',
    'smoke-vote': '悬置'
  }[pending.kind];
  const found = options.find(option => option.value === preferred);
  return found ? found.value : options[0].value;
}

function respond(room, player, choice, now) {
  const pending = room.pending;
  need(pending, '当前没有待处理的响应。');
  need(pending.chooserId === player.id, '当前响应不是发给你的。');
  const options = promptOptions(room, pending);
  need(options.some(option => option.value === choice), '这个选项当前不可用。');

  if (choice === 'paradox' || choice === 'bagua') {
    cancelTrick(room, player, pending, choice);
    checkWinner(room, false);
    return room.pending;
  }

  switch (pending.kind) {
    case 'challenge': resolveChallenge(room, player, pending, choice); break;
    case 'debate': resolveDebate(room, player, pending, choice, now); break;
    case 'discard-own':
      discardInstance(room, player, choice);
      clearPending(room);
      break;
    case 'choose-card': {
      const cards = pending.cards || [];
      const card = cards.find(item => item.instance === choice);
      need(card, '这张牌已经不在展示区。');
      player.hand.push(card);
      const rest = cards.filter(item => item.instance !== choice);
      peekBottom(room, rest);
      addEvent(room, player.name + '从展示的牌中选择了「' + cardOf(card).name + '」。', 'play');
      clearPending(room);
      break;
    }
    case 'memory': {
      const cards = pending.cards || [];
      const card = cards.find(item => item.instance === choice);
      need(card, '这张牌已经不在展示区。');
      player.hand.push(card);
      const rest = cards.filter(item => item.instance !== choice);
      rest.forEach(item => core.pushDiscard(room, item, '群体记忆放回弃牌堆'));
      clearPending(room);
      addEvent(room, player.name + '从弃牌堆回收了一张牌。', 'play');
      break;
    }
    case 'reductio': resolveReductio(room, player, pending, choice, now); break;
    case 'scrutiny-ward': {
      const source = findPlayer(room, pending.sourceId);
      const target = findPlayer(room, pending.targetId);
      if (!source || !target || !target.hand.length) { clearPending(room); break; }
      room.pending = null;
      addEvent(room, target.name + '展示了手牌：' + target.hand.map(item => cardOf(item).name).join('、') + '。', 'reveal');
      addPending(room, {
        kind: 'scrutiny',
        sourceId: source.id,
        targetId: target.id,
        chooserId: source.id,
        cardName: pending.cardName,
        question: '公开审查：选择 ' + target.name + ' 的一张手牌弃置。'
      }, now);
      addEvent(room, source.name + '将选择 ' + target.name + ' 的一张手牌弃置。', 'play');
      break;
    }
    case 'scrutiny': {
      const target = findPlayer(room, pending.targetId);
      need(target, '目标已经不在场。');
      discardInstance(room, target, choice);
      clearPending(room);
      addEvent(room, pending.cardName + '令 ' + target.name + ' 弃置了 1 张手牌。', 'play');
      break;
    }
    case 'razor': {
      const target = findPlayer(room, pending.targetId);
      const source = findPlayer(room, pending.sourceId);
      const otherSlot = pending.slot === 'offense' ? 'defense' : 'offense';
      if (target && target.equipment[otherSlot] && target.hand.length) {
        addPending(room, {
          kind: 'razor-save',
          sourceId: pending.sourceId,
          targetId: pending.targetId,
          chooserId: target.id,
          slot: pending.slot,
          cardName: pending.cardName,
          question: '你已有另一件装备，可弃 1 张手牌保护被指定的装备。'
        }, now);
      } else if (target) {
        if (discardEquipment(room, target, pending.slot, source)) {
          addEvent(room, target.name + '的装备被「奥卡姆剃刀」弃置。', 'play');
        }
        clearPending(room);
      } else {
        clearPending(room);
      }
      break;
    }
    case 'razor-save': {
      const target = findPlayer(room, pending.targetId);
      if (choice === 'save' && target.hand.length) {
        discardHand(room, target, 0);
        clearPending(room);
        addEvent(room, target.name + '弃 1 张牌，保住了装备。', 'play');
      } else if (target) {
        discardEquipment(room, target, pending.slot, null);
        clearPending(room);
      } else clearPending(room);
      break;
    }
    case 'lever': {
      const target = findPlayer(room, pending.targetId);
      if (choice === 'mind') {
        const source = findPlayer(room, pending.sourceId);
        damage(room, target, 1, source, '阿基米德杠杆');
      } else if (target && target.equipment[choice]) {
        discardEquipment(room, target, choice, findPlayer(room, pending.sourceId));
      }
      clearPending(room);
      break;
    }
    case 'chain': {
      if (choice === 'remove') {
        const mark = room.marks.find(item => item.ownerId === player.id);
        if (mark) removeMark(room, mark.id);
      } else {
        discardInstance(room, player, choice);
      }
      clearPending(room);
      addEvent(room, player.name + '结算了「证据链」。', 'play');
      break;
    }
    case 'deliberation': {
      discardInstance(room, player, choice);
      if (pending.stage === 'source') {
        const target = findPlayer(room, pending.targetId);
        clearPending(room);
        if (target && target.alive && target.hand.length) {
          addPending(room, {
            kind: 'deliberation',
            sourceId: pending.sourceId,
            targetId: pending.targetId,
            chooserId: target.id,
            stage: 'target',
            cardName: pending.cardName,
            question: '共议：选择 1 张手牌弃置。'
          }, now);
        }
      } else {
        clearPending(room);
      }
      break;
    }
    case 'smoke-vote': {
      player.smokeVote = choice;
      player.voteLocked = true;
      clearPending(room);
      addEvent(room, player.name + '已秘密放置投票，不能再更改。', 'vote');
      break;
    }
    case 'give-card': {
      const index = player.hand.findIndex(item => item.instance === choice);
      need(index >= 0, '这张牌已经不在你的手牌中。');
      const item = player.hand.splice(index, 1)[0];
      const target = findPlayer(room, pending.targetId);
      if (target) target.hand.push(item);
      draw(room, player, 1);
      draw(room, target, 1);
      clearPending(room);
      addEvent(room, player.name + '将 1 张牌交给 ' + (target ? target.name : '对方') + '，双方各摸 1 张。', 'play');
      break;
    }
    case 'pick-discard': {
      const target = findPlayer(room, pending.targetId);
      if (target) discardInstance(room, target, choice);
      clearPending(room);
      addEvent(room, player.name + '令 ' + (target ? target.name : '目标') + ' 弃置了 1 张基础牌。', 'skill');
      break;
    }
    default:
      fail('不支持的响应类型。');
  }

  checkWinner(room, false);
  return room.pending;
}

function resolveChallenge(room, player, pending, choice) {
  const source = findPlayer(room, pending.sourceId);
  if (choice === 'block') {
    const index = player.hand.findIndex(item => item.cardId === 'counterexample' && item.type === 'basic');
    discardHand(room, player, index);
    clearPending(room);
    addEvent(room, player.name + '打出「反例」，抵消了诘问。', 'response');
    return;
  }
  if (choice === 'concede') {
    const index = player.hand.findIndex(item => item.cardId === 'concede' && item.type === 'basic');
    discardHand(room, player, index);
    player.forcedVote = '悬置';
    player.vote = null;
    draw(room, player, 1);
    clearPending(room);
    addEvent(room, player.name + '打出「让步」，取消诘问并摸 1 张牌。', 'response');
    return;
  }
  if (choice === 'discard2') {
    discardHand(room, player, 0);
    discardHand(room, player, 0);
    clearPending(room);
    addEvent(room, player.name + '弃 2 张手牌，抵挡了「诡辩手杖」的诘问。', 'response');
    return;
  }
  forceVote(room, player, '悬置', '诘问');
  const actual = damage(room, player, 1, source, '诘问');
  clearPending(room);
  addEvent(room, player.name + '未能反驳诘问，失去 1 点心智。', 'response');
  if (actual > 0 && source && source.alive && roleIs(source, 'hanfei') && !source.flags.hanfeiPower) {
    source.flags.hanfeiPower = true;
    draw(room, source, 1);
    addEvent(room, source.name + '触发「二柄」，摸 1 张牌。', 'skill');
  }
}

function resolveDebate(room, player, pending, choice, now) {
  const source = findPlayer(room, pending.sourceId);
  if (choice === 'fold') {
    forceVote(room, player, '悬置', '辩论');
    const actual = damage(room, player, 1, source, '辩论落败');
    if (actual > 0 && pending.sword && player.id !== pending.sourceId && player.hand.length) {
      discardHand(room, player, 0);
      addEvent(room, player.name + '因「达摩克利斯之剑」额外弃 1 张手牌。', 'skill');
    }
    clearPending(room);
    addEvent(room, player.name + '无法继续辩论，失去 1 点心智并锁定悬置。', 'response');
    return;
  }

  if (choice.indexOf('fortify:') === 0) {
    need(roleIs(player, 'mozi') && !player.flags.moziFortify, '你无法使用「守城」。');
    player.flags.moziFortify = true;
    const item = discardInstance(room, player, choice.slice(8));
    addEvent(room, player.name + '发动「守城」，亮出「' + cardOf(item).name + '」视为反例。', 'skill');
  } else {
    const item = discardInstance(room, player, choice);
    need(item, '这张牌不在你的手牌中。');
    addEvent(room, player.name + '以「' + cardOf(item).name + '」继续辩论。', 'response');
  }
  pending.plays = (pending.plays || 0) + 1;
  pending.nextId = player.id === pending.sourceId ? pending.targetId : pending.sourceId;
  const next = findPlayer(room, pending.nextId);
  need(next && next.alive, '对手已经不在场。');
  pending.chooserId = pending.nextId;
  pending.deadline = now + rules.timers.pending * 1000;
  pending.question = '辩论：弃 1 张「论证」或「反例」继续；无法出牌者失去 1 点心智并锁定悬置。';
}

function resolveReductio(room, player, pending, choice, now) {
  const source = findPlayer(room, pending.sourceId);
  if (choice === 'counter') {
    const index = player.hand.findIndex(item => item.cardId === 'counterexample');
    discardHand(room, player, index);
    clearPending(room);
    addEvent(room, player.name + '弃 1 张「反例」，保留了论证标记。', 'response');
    return;
  }
  removeMark(room, pending.markId);
  if (player.hand.length) discardHand(room, player, 0);
  addEvent(room, player.name + '的论证标记被「归谬法」移除，并弃 1 张手牌。', 'response');
  clearPending(room);
  if (pending.lever) {
    if (player.equipment.offense || player.equipment.defense) {
      addPending(room, {
        kind: 'lever',
        sourceId: source ? source.id : pending.sourceId,
        targetId: player.id,
        chooserId: player.id,
        cardName: '阿基米德杠杆',
        question: '阿基米德杠杆：弃置一件装备，或失去 1 点心智。'
      }, now);
    } else {
      damage(room, player, 1, source, '阿基米德杠杆');
    }
  }
}

function cancelTrick(room, player, pending, choice) {
  const source = findPlayer(room, pending.sourceId);
  if (choice === 'paradox') {
    const index = player.hand.findIndex(item => item.cardId === 'paradox' && item.type === 'trick');
    discardHand(room, player, index);
    clearPending(room);
    addEvent(room, player.name + '打出「逻辑悖论」，抵消了「' + pending.cardName + '」。', 'response');
    return;
  }

  player.flags.bagua = true;
  clearPending(room);
  if (!source || !source.alive) {
    addEvent(room, player.name + '发动「八卦镜」，但使用者已不在场。', 'response');
    return;
  }
  if (pending.kind === 'reductio' || pending.kind === 'chain') {
    const mark = room.marks.find(item => item.ownerId === source.id);
    if (mark) removeMark(room, mark.id);
    else if (source.hand.length) discardHand(room, source, 0);
  } else if (pending.kind === 'scrutiny-ward') {
    if (source.hand.length) discardHand(room, source, 0);
  } else if (pending.kind === 'razor') {
    discardEquipment(room, source, pending.slot, null);
  }
  addEvent(room, player.name + '发动「八卦镜」，将「' + pending.cardName + '」转移给 ' + source.name + '。', 'response');
}

module.exports = {
  STANCES,
  targetsForCard,
  validatePlay,
  playCard,
  promptOptions,
  promptFor,
  defaultChoice,
  respond,
  ownMarks,
  handCard,
  highestEquipmentSlot
};

