/**
 * 房间状态机：开局、夜间、行动、投票、结算、下一轮、超时推进与总调度。
 */
const core = require('./core.js');
const catalog = require('./catalog.js');
const play = require('./play.js');
const skills = require('./skills.js');

const {
  need, fail, addEvent, findPlayer, byOpenid, alive, roleIs, equipmentIs,
  draw, discardHand, clearPending, damage, heal, checkWinner,
  beginRound, nextTurn, endTurn, allVoted, resolveNight, submitNight, rules,
  makeDeck, shuffle, enforceHandLimit, beginOstracism, resolveOstracism, submitOstracism
} = core;

const { DATA } = catalog;

/* ------------------------------------------------------------------ */
/* 建房与加入                                                          */
/* ------------------------------------------------------------------ */

function createRoom(code, expected) {
  need(Number.isInteger(expected) && expected >= rules.minPlayers && expected <= rules.maxPlayers, '玩家人数须为 4—8 人。');
  return core.newRoom(code, expected);
}

function joinRoom(room, openid, name) {
  const existing = byOpenid(room, openid);
  if (existing) return existing;
  need(room.phase === 'lobby', '本局已经开始，暂时不能加入。');
  const clean = String(name || '').trim().slice(0, 16);
  need(clean, '请填写昵称。');
  need(room.players.length < room.expected, '房间人数已满。');
  need(!room.players.some(player => player.name.toLowerCase() === clean.toLowerCase()), '这个昵称已经被使用。');
  const player = core.createPlayer(openid, clean, room.players.length + 1);
  room.players.push(player);
  addEvent(room, clean + '加入房间。', 'join');
  return player;
}

function leaveRoom(room, player) {
  need(room.phase === 'lobby', '牌局已经开始，不能退出房间。');
  room.players = room.players.filter(item => item.id !== player.id);
  room.players.forEach((item, index) => { item.seat = index + 1; });
  addEvent(room, player.name + '离开了房间。', 'join');
}

/* ------------------------------------------------------------------ */
/* 开局                                                                */
/* ------------------------------------------------------------------ */

const clone = value => JSON.parse(JSON.stringify(value));

function startGame(room, now) {
  need(room.phase === 'lobby', '房间已经开始。');
  need(room.players.length === room.expected, '人数还没有到齐。');

  const roles = shuffle(room, DATA.philosophers.map(clone));
  const factions = shuffle(room, DATA.factionsByCount[room.expected]);
  const contract = clone(DATA.contracts[Math.floor(core.rand(room) * DATA.contracts.length)]);

  room.players.forEach((player, index) => {
    player.role = roles[index];
    player.maxMind = player.role.mind;
    player.mind = player.maxMind;
    player.faction = factions[index];
    player.contract = player.faction === '游士' ? clone(contract) : null;
    player.alive = true;
    player.hand = [];
    player.equipment = { offense: null, defense: null };
    player.vote = null;
    player.forcedVote = null;
    player.smokeVote = null;
    player.voteLocked = false;
    player.nightTarget = null;
    player.skillsUsed = {};
    player.gameUsed = {};
    player.flags = {};
    player.turnCards = [];
    player.turnPlayCounts = {};
    player.topicPlayCounts = {};
    player.turnDone = false;
    player.shield = 0;
    player.voteShield = false;
    player.causedDamage = false;
    player.roundCausedDamage = false;
    player.tookDamage = false;
    player.roundTookDamage = false;
    player.everEquipped = false;
    player.contractComplete = false;
    player.concordCount = 0;
    player.martyrVote = false;
    player.counterproofVote = false;
    player.lethalByPlayer = false;
    player.skillNote = '';
    player.skillNoteAt = 0;
  });

  room.maxRounds = rules.maxRounds(room.expected);
  const pool = shuffle(room, DATA.agendas.map(clone));
  room.agendaDeck = pool.splice(0, room.maxRounds);
  room.agendaPool = pool;
  room.deck = makeDeck(room);
  room.discard = [];
  room.marks = [];
  room.chips = [];
  room.results = [];
  room.events = [];
  room.winners = [];
  room.lastTally = null;
  room.pending = null;
  room.delayed = [];
  room.chorus = null;
  room.revoteRequested = false;
  room.revoteDone = false;
  room.round = 0;

  // 起始手牌 4 张；洛克「白板」额外 1 张
  room.players.forEach(player => draw(room, player, rules.handSize + (roleIs(player, 'locke') ? 1 : 0)));

  addEvent(room, '游戏开始。角色公开，阵营与契约保密。', 'phase');
  beginRound(room, 1, now, { skipDraw: true });
}

/* ------------------------------------------------------------------ */
/* 出牌、响应、技能、投票                                              */
/* ------------------------------------------------------------------ */

function actPlay(room, player, payload, now) {
  return play.playCard(room, player, payload, now);
}

function actRespond(room, player, payload, now) {
  play.respond(room, player, String(payload.choice || ''), now);
  if (room.pending) {
    const chooser = findPlayer(room, room.pending.chooserId);
    if (!chooser || !chooser.alive) clearPending(room);
  }
}

function actSkill(room, player, payload, now) {
  skills.useSkill(room, player, payload, now);
  if (room.pending) {
    const chooser = findPlayer(room, room.pending.chooserId);
    if (!chooser || !chooser.alive) clearPending(room);
  }
}

function actVote(room, player, payload, now) {
  need(room.phase === 'vote', '现在不是投票阶段。');
  need(player.alive, '你已出局，不能投票。');
  need(!player.forcedVote, '你的投票已经被锁定。');
  need(!player.smokeVote, '你已经通过「修辞烟幕」秘密放置了投票。');
  const stance = payload.stance;
  need(stance === '赞成' || stance === '反对' || stance === '悬置', '请选择赞成、反对或悬置。');

  if (payload.objection) {
    need(room.agenda && room.agenda.id === 'agenda-objection', '当前议题没有「拒绝服从」效果。');
    need(!player.flags.objection, '你本议题已经使用过这项效果。');
    need(player.hand.length, '需要弃置 1 张手牌。');
    discardHand(room, player, 0);
    player.flags.objection = true;
    player.vote = '悬置';
    addEvent(room, player.name + '弃 1 张手牌，将自己的投票改为悬置（议题效果）。', 'agenda');
  } else {
    player.vote = stance;
  }
  addEvent(room, player.name + '已提交秘密投票。', 'vote');

  // 塔斯比念珠：投悬置后交出一张牌并摸一张
  const finalStance = player.forcedVote || player.vote;
  if (finalStance === '悬置' && equipmentIs(player, 'defense', 'tasbih') && !player.flags.tasbih && player.hand.length) {
    const target = payload.giftToId ? findPlayer(room, payload.giftToId) : null;
    if (target && target.alive && target.id !== player.id) {
      player.flags.tasbih = true;
      const item = player.hand.splice(0, 1)[0];
      target.hand.push(item);
      draw(room, player, 1);
      addEvent(room, player.name + '以「塔斯比念珠」把 1 张牌交给 ' + target.name + '，并摸 1 张。', 'skill');
    }
  }

  if (allVoted(room)) evaluateVote(room, now);
}

function actNext(room, player, now) {
  need(room.phase === 'result', '当前没有待开始的新一轮。');
  if (room.round >= room.maxRounds) {
    checkWinner(room, true);
    return;
  }
  beginRound(room, room.round + 1, now);
}

/* ------------------------------------------------------------------ */
/* 投票结算                                                            */
/* ------------------------------------------------------------------ */

function evaluateVote(room, now) {
  need(room.phase === 'vote', '现在不是投票阶段。');
  const living = alive(room);
  const votes = new Map();
  living.forEach(player => {
    votes.set(player.id, player.forcedVote || player.smokeVote || player.vote || '悬置');
  });

  // 阿伦特「公共领域」：发起重投（每局一次）
  if (room.revoteRequested && !room.revoteDone) {
    room.revoteRequested = false;
    room.revoteDone = true;
    room.players.forEach(player => {
      player.vote = null;
      player.smokeVote = null;
      player.voteLocked = false;
    });
    room.voteDeadline = now + rules.timers.vote * 1000;
    addEvent(room, '「公共领域」生效：所有存活玩家重新秘密投票。', 'skill');
    return false;
  }
  room.revoteRequested = false;

  const tally = { 赞成: 0, 反对: 0, 悬置: 0 };
  votes.forEach(stance => { tally[stance] += 1; });
  room.marks.forEach(mark => { tally[mark.stance] += 1 + (mark.bonus || 0); });
  room.chips.forEach(chip => { tally[chip.stance] += chip.amount || 1; });

  // 马克思「联合行动」
  living.filter(player => roleIs(player, 'marx')).forEach(player => {
    const stance = votes.get(player.id);
    const partner = living.find(other => other.id !== player.id && other.hand.length < player.hand.length && votes.get(other.id) === stance);
    if (partner && !player.flags.marx) {
      player.flags.marx = true;
      tally[stance] += 2;
      addEvent(room, player.name + '与 ' + partner.name + '触发「联合行动」，' + stance + ' +2 票。', 'skill');
    }
  });

  // 阿伦特「共同行动」
  living.filter(player => roleIs(player, 'arendt')).forEach(player => {
    const stance = votes.get(player.id);
    const allies = living.filter(other => other.id !== player.id && votes.get(other.id) === stance).length;
    if (allies >= 2) {
      tally[stance] += 1;
      addEvent(room, player.name + '触发「共同行动」，' + stance + ' +1 票。', 'skill');
    }
  });

  // 众声合鸣
  if (room.chorus) {
    const stance = room.chorus.stance;
    const count = living.filter(player => votes.get(player.id) === stance).length;
    const owner = findPlayer(room, room.chorus.ownerId);
    if (count >= 3) {
      tally[stance] += 2;
      addEvent(room, '「众声合鸣」生效，' + stance + ' +2 票。', 'effect');
    } else if (owner && owner.alive) {
      addEvent(room, '「众声合鸣」落空，' + owner.name + '失去 1 点心智。', 'effect');
      damage(room, owner, 1, null, '众声合鸣落空');
    }
    room.chorus = null;
    if (room.phase === 'finished') return true;
  }

  // 延迟效果：公意契约 / 思想实验 / 引证
  const delayed = room.delayed || [];
  room.delayed = [];
  delayed.forEach(effect => {
    const owner = findPlayer(room, effect.ownerId);
    if (effect.kind === 'pact') {
      const voters = living.filter(player => votes.get(player.id) === effect.stance);
      if (voters.length >= 2) {
        voters.forEach(player => draw(room, player, 1));
        addEvent(room, '「公意契约」生效，' + effect.stance + '阵营各摸 1 张牌。', 'effect');
      } else if (owner) {
        if (owner.hand.length) discardHand(room, owner, 0);
        addEvent(room, '「公意契约」没有获得足够支持，' + owner.name + '弃 1 张牌。', 'effect');
      }
    } else if (effect.kind === 'experiment' && owner) {
      // 结果稍后才知道，先把预测暂存
      effect.pendingResolve = true;
    } else if (effect.kind === 'citation-draw' && owner) {
      draw(room, owner, 1);
    }
  });

  const n = living.length;
  const majorityAgenda = room.agenda && room.agenda.id === 'agenda-majority';
  const threshold = majorityAgenda ? Math.ceil(n * 2 / 3) : Math.floor(n / 2) + 1;
  let result = tally['赞成'] >= threshold ? '通过' : (tally['反对'] >= threshold ? '否决' : '悬置');
  if (room.agenda && room.agenda.id === 'agenda-minority' && Math.abs(tally['赞成'] - tally['反对']) === 1) result = '悬置';

  // 思想实验：现在揭晓预测
  delayed.forEach(effect => {
    if (effect.kind !== 'experiment') return;
    const owner = findPlayer(room, effect.ownerId);
    if (!owner) return;
    if (result === effect.prediction) {
      draw(room, owner, 2);
      addEvent(room, '「思想实验」命中，' + owner.name + '摸 2 张牌。', 'effect');
    } else if (owner.hand.length) {
      discardHand(room, owner, 0);
      addEvent(room, '「思想实验」落空，' + owner.name + '弃 1 张牌。', 'effect');
    }
  });

  room.lastTally = {
    round: room.round,
    agenda: room.agenda ? room.agenda.name : '',
    tally: Object.assign({}, tally),
    threshold,
    result
  };
  room.results.push({
    round: room.round,
    agendaId: room.agenda ? room.agenda.id : '',
    agenda: room.agenda ? room.agenda.name : '',
    tally: Object.assign({}, tally),
    result
  });
  addEvent(
    room,
    '第 ' + room.round + ' 轮表决：赞成 ' + tally['赞成'] + '、反对 ' + tally['反对'] + '、悬置 ' + tally['悬置'] +
    '；结果：' + result + '（门槛 ' + threshold + '）。',
    'vote-result'
  );

  // 契约与个人结算
  living.forEach(player => {
    const vote = votes.get(player.id);

    if (roleIs(player, 'confucius') && !player.flags.zhengming &&
      ((result === '通过' && vote === '赞成') || (result === '否决' && vote === '反对') ||
        (result === '悬置' && vote === '悬置'))) {
      player.flags.zhengming = true;
      draw(room, player, 1);
      addEvent(room, player.name + '触发「正名」，摸 1 张牌。', 'skill');
    }

    if (player.faction === '游士' && player.contract) {
      const contract = player.contract;
      if (contract.id === 'contract-witness' && result === '悬置') player.contractComplete = true;
      if (contract.id === 'contract-concord' &&
        ((result === '通过' && vote === '赞成') || (result === '否决' && vote === '反对'))) {
        player.concordCount = (player.concordCount || 0) + 1;
      }
      if (contract.id === 'contract-dissenter' &&
        ((result === '通过' && vote === '反对') || (result === '否决' && vote === '赞成'))) {
        player.contractComplete = true;
      }
      if (contract.id === 'contract-martyr' && result !== '悬置' &&
        ((result === '通过' && vote === '赞成') || (result === '否决' && vote === '反对'))) {
        player.martyrVote = true;
      }
      if (contract.id === 'contract-counterproof' && result === '悬置' && vote === '悬置') {
        player.counterproofVote = true;
      }
    }

    if (equipmentIs(player, 'defense', 'rosary') && vote === '悬置' && !player.roundTookDamage && player.mind < player.maxMind) {
      player.flags.rosary = true;
      heal(room, player, 1, '玫瑰经念珠');
    }
  });

  // 论证标记保留到结算后的角色收益
  living.forEach(player => {
    const survived = room.marks.some(mark => mark.ownerId === player.id);
    if (roleIs(player, 'socrates') && survived && !player.flags.labor) {
      player.flags.labor = true;
      draw(room, player, 1);
      addEvent(room, player.name + '触发「助产术」，摸 1 张牌。', 'skill');
    }
    if (roleIs(player, 'spinoza') && survived && !player.flags.geometry) {
      player.flags.geometry = true;
      draw(room, player, 1);
      addEvent(room, player.name + '触发「情感几何」，摸 1 张牌。', 'skill');
    }
  });

  if (result === '悬置') {
    living.filter(player => roleIs(player, 'laozi') && !player.flags.laoziSuspension).forEach(player => {
      player.flags.laoziSuspension = true;
      heal(room, player, 1, '反者道之动');
      addEvent(room, player.name + '触发「反者道之动」，恢复 1 点心智。', 'skill');
    });
    living.filter(player => roleIs(player, 'hegel') && !player.flags.hegelSpirit).forEach(player => {
      player.flags.hegelSpirit = true;
      draw(room, player, 2);
      if (player.hand.length) discardHand(room, player, 0);
      addEvent(room, player.name + '触发「精神显现」，摸 2 张弃 1 张。', 'skill');
    });
  }

  living.filter(player => roleIs(player, 'epicurus') && !player.roundCausedDamage && !player.flags.epicurusCalm).forEach(player => {
    player.flags.epicurusCalm = true;
    heal(room, player, 1, '宁静');
    addEvent(room, player.name + '触发「宁静」，恢复 1 点心智。', 'skill');
  });

  // 议题：财富差距
  if (room.agenda && room.agenda.id === 'agenda-wealth') {
    const current = alive(room);
    if (current.length) {
      const sizes = current.map(player => player.hand.length);
      const high = Math.max.apply(null, sizes);
      const low = Math.min.apply(null, sizes);
      current.filter(player => player.hand.length === high).forEach(player => {
        if (player.hand.length) discardHand(room, player, 0);
      });
      current.filter(player => player.hand.length === low).forEach(player => draw(room, player, 1));
      addEvent(room, '议题效果结算：手牌最多者弃 1 张，最少者摸 1 张。', 'agenda');
    }
  }

  room.players.forEach(player => {
    player.vote = null;
    player.forcedVote = null;
    player.smokeVote = null;
    player.voteLocked = false;
  });
  room.marks = [];
  room.chips = [];
  living.forEach(player => enforceHandLimit(room, player));

  if (checkWinner(room, false)) return true;

  beginOstracism(room, now);
  return true;
}

/* ------------------------------------------------------------------ */
/* 强制推进                                                            */
/* ------------------------------------------------------------------ */

function resolvePendingDefault(room, now) {
  const pending = room.pending;
  if (!pending) return;
  const chooser = findPlayer(room, pending.chooserId);
  if (!chooser || !chooser.alive) {
    clearPending(room);
    return;
  }
  const choice = play.defaultChoice(room, pending);
  if (choice === null || choice === undefined) {
    clearPending(room);
    return;
  }
  addEvent(room, '响应超时，系统按默认选项为 ' + chooser.name + ' 结算。', 'system');
  play.respond(room, chooser, choice, now);
}

function ensureTurn(room, now) {
  if (room.phase !== 'action') return;
  if (room.turnPlayerId) {
    const current = findPlayer(room, room.turnPlayerId);
    if (current && current.alive && !current.turnDone) return;
  }
  nextTurn(room, now);
}

function tick(room, now) {
  for (let guard = 0; guard < 24; guard++) {
    if (room.phase === 'finished') return;
    if (room.pending && room.pending.deadline <= now) {
      resolvePendingDefault(room, now);
      continue;
    }
    if (room.phase === 'night' && room.nightDeadline && room.nightDeadline <= now) {
      addEvent(room, '夜间阶段超时，系统结算怀疑派的秘密行动。', 'system');
      resolveNight(room, now, true);
      continue;
    }
    if (room.phase === 'action' && !room.pending) {
      const current = findPlayer(room, room.turnPlayerId);
      if (!current || !current.alive) {
        nextTurn(room, now);
        continue;
      }
      if (room.turnStartedAt + rules.timers.turn * 1000 <= now) {
        addEvent(room, current.name + '行动超时，系统自动结束其回合。', 'system');
        current.turnDone = true;
        nextTurn(room, now);
        continue;
      }
    }
    if (room.phase === 'vote' && room.voteDeadline && room.voteDeadline <= now) {
      const missing = alive(room).filter(player => !player.vote && !player.forcedVote && !player.smokeVote);
      if (missing.length) addEvent(room, '投票超时，未提交的玩家按悬置处理。', 'system');
      missing.forEach(player => { player.vote = '悬置'; });
      evaluateVote(room, now);
      continue;
    }
    if (room.phase === 'ostracism' && room.ostracismDeadline && room.ostracismDeadline <= now) {
      addEvent(room, '陶片放逐超时，系统为未提交者随机投下陶片。', 'system');
      resolveOstracism(room, now, true);
      continue;
    }
    if (room.phase === 'result' && room.nextAt && room.nextAt <= now) {
      if (room.round >= room.maxRounds) {
        checkWinner(room, true);
      } else {
        beginRound(room, room.round + 1, now);
      }
      continue;
    }
    if (room.phase === 'vote' && allVoted(room)) {
      evaluateVote(room, now);
      continue;
    }
    break;
  }
}

/* ------------------------------------------------------------------ */
/* 总调度                                                              */
/* ------------------------------------------------------------------ */

function dispatch(room, player, action, payload, now) {
  const data = payload || {};
  tick(room, now);
  if (room.phase === 'finished') {
    // 已结束的牌局仍允许读取状态
    if (action !== 'state') fail('本局已经结束。');
  }

  switch (action) {
    case 'start':
      startGame(room, now);
      break;
    case 'night':
      submitNight(room, player, data.targetId, now);
      break;
    case 'play':
      play.playCard(room, player, data, now);
      break;
    case 'respond':
      actRespond(room, player, data, now);
      break;
    case 'skill':
      actSkill(room, player, data, now);
      break;
    case 'vote':
      actVote(room, player, data, now);
      break;
    case 'ostracize':
      submitOstracism(room, player, data.targetId, now);
      break;
    case 'endTurn':
      endTurn(room, player, now);
      break;
    case 'next':
      actNext(room, player, now);
      break;
    default:
      fail('未知操作。');
  }

  tick(room, now);
  ensureTurn(room, now);
  alive(room).forEach(player => enforceHandLimit(room, player));
  if (room.phase === 'vote' && allVoted(room)) evaluateVote(room, now);
  if (room.phase !== 'finished') checkWinner(room, false);
  return room;
}

/* ------------------------------------------------------------------ */
/* 单人演练：AI 玩家                                                    */
/* ------------------------------------------------------------------ */

function fillBots(room, count) {
  need(room.phase === 'lobby', '房间已经开始。');
  const target = Math.min(room.players.length + count, room.expected);
  while (room.players.length < target) {
    const seat = room.players.length + 1;
    const bot = core.createPlayer('bot:' + room.code + ':' + seat, 'AI 玩家 ' + seat, seat);
    bot.isBot = true;
    room.players.push(bot);
    addEvent(room, bot.name + '（AI）加入房间。', 'join');
  }
}

function botsPending(room) {
  if (!room) return false;
  if (room.phase === 'night') {
    return alive(room).some(player => player.isBot && player.faction === '怀疑派' && !player.nightTarget);
  }
  if (room.phase === 'action') {
    if (room.pending) {
      const chooser = findPlayer(room, room.pending.chooserId);
      return !!(chooser && chooser.isBot && chooser.alive);
    }
    const current = findPlayer(room, room.turnPlayerId);
    return !!(current && current.isBot && current.alive && !current.turnDone);
  }
  if (room.phase === 'vote') {
    return alive(room).some(player => player.isBot && !player.vote && !player.forcedVote && !player.smokeVote);
  }
  if (room.phase === 'ostracism') {
    return alive(room).some(player => player.isBot && !room.ostracismChoices[player.id]);
  }
  return false;
}

function botStance() {
  const roll = Math.random();
  if (roll < 0.42) return '赞成';
  if (roll < 0.72) return '反对';
  return '悬置';
}

/**
 * AI 只做最低限度行动：怀疑派夜间随机选目标、行动回合直接结束、投票随机。
 * 目的是让单人演练/截图能走完整个流程，不追求竞技强度。
 */
function runBots(room, now) {
  for (let guard = 0; guard < 48; guard++) {
    if (room.phase === 'finished') return;
    if (room.phase === 'night') {
      const agents = alive(room).filter(player =>
        player.isBot && player.faction === '怀疑派' && !player.nightTarget);
      if (!agents.length) return;
      let acted = false;
      for (let index = 0; index < agents.length; index++) {
        const bot = agents[index];
        const targets = alive(room).filter(player =>
          player.id !== bot.id && player.faction !== '怀疑派');
        if (targets.length) {
          const target = targets[Math.floor(Math.random() * targets.length)];
          submitNight(room, bot, target.id, now);
          acted = true;
        }
        if (room.phase !== 'night') break;
      }
      if (!acted) {
        resolveNight(room, now, true);
        return;
      }
      continue;
    }
    if (room.phase === 'action') {
      if (room.pending) {
        const chooser = findPlayer(room, room.pending.chooserId);
        if (!chooser || !chooser.isBot || !chooser.alive) return;
        const choice = play.defaultChoice(room, room.pending);
        if (choice === null || choice === undefined) clearPending(room);
        else play.respond(room, chooser, choice, now);
        continue;
      }
      const current = findPlayer(room, room.turnPlayerId);
      if (!current || !current.isBot || !current.alive || current.turnDone) return;
      endTurn(room, current, now);
      continue;
    }
    if (room.phase === 'vote') {
      const bots = alive(room).filter(player =>
        player.isBot && !player.vote && !player.forcedVote && !player.smokeVote);
      if (!bots.length) return;
      for (let index = 0; index < bots.length; index++) {
        actVote(room, bots[index], { stance: botStance() }, now);
        if (room.phase !== 'vote') break;
      }
      continue;
    }
    if (room.phase === 'ostracism') {
      const bots = alive(room).filter(player => player.isBot && !room.ostracismChoices[player.id]);
      if (!bots.length) return;
      for (let index = 0; index < bots.length; index++) {
        const bot = bots[index];
        const targets = alive(room).filter(player => player.id !== bot.id);
        if (targets.length) {
          const target = targets[Math.floor(Math.random() * targets.length)];
          submitOstracism(room, bot, target.id, now);
        }
        if (room.phase !== 'ostracism') break;
      }
      continue;
    }
    return;
  }
}

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  startGame,
  dispatch,
  tick,
  evaluateVote,
  ensureTurn,
  resolvePendingDefault,
  fillBots,
  botsPending,
  runBots
};

