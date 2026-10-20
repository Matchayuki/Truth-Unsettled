/**
 * 本地模拟测试：不依赖微信云开发，直接驱动规则引擎。
 *
 *   node tools/simulate.js [局数] [起始种子]
 *
 * 检查项：
 *   · 每局都能在限定步数内结束
 *   · 牌张守恒、没有重复实例、心智不越界
 *   · 隐藏信息没有泄漏（存活玩家的阵营、其他人的手牌、契约）
 *   · 投票、夜间、计时推进不会卡死
 */
const path = require('node:path');

const RULES_DIR = path.resolve(__dirname, '..', 'cloudfunctions', 'game', 'rules');
const engine = require(path.join(RULES_DIR, 'engine.js'));
const core = require(path.join(RULES_DIR, 'core.js'));
const play = require(path.join(RULES_DIR, 'play.js'));
const skills = require(path.join(RULES_DIR, 'skills.js'));
const catalog = require(path.join(RULES_DIR, 'catalog.js'));
const view = require(path.join(RULES_DIR, 'view.js'));

const STANCES = ['赞成', '反对', '悬置'];
const stats = {
  cards: new Set(),
  skills: new Set(),
  results: { 通过: 0, 否决: 0, 悬置: 0 },
  winners: new Set(),
  rounds: []
};

// 统计覆盖：记录成功打出的牌与技能
const originalPlayCard = play.playCard;
play.playCard = function wrappedPlayCard(room, player, payload, now) {
  const item = player.hand.find(card => card.instance === payload.instance);
  const def = item ? catalog.cardOf(item) : null;
  const result = originalPlayCard(room, player, payload, now);
  if (def) stats.cards.add(def.id);
  return result;
};
const originalUseSkill = skills.useSkill;
skills.useSkill = function wrappedUseSkill(room, player, payload, now) {
  const result = originalUseSkill(room, player, payload, now);
  if (player.role) stats.skills.add(player.role.id + ':' + payload.index);
  return result;
};

const TOTAL_CARDS = catalog.basics.reduce((sum, card) => sum + card.count, 0) +
  catalog.tricks.reduce((sum, card) => sum + card.count, 0) +
  catalog.equipment.reduce((sum, card) => sum + card.count, 0);

function assert(condition, message, context) {
  if (!condition) {
    const error = new Error('断言失败：' + message + (context ? '\n' + JSON.stringify(context, null, 2) : ''));
    error.isAssertion = true;
    throw error;
  }
}

function rngFor(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const pickOne = (random, list) => list.length ? list[Math.floor(random() * list.length)] : null;
const shuffleWith = (random, list) => list.slice().sort(() => random() - 0.5);

function makePlayers(room, count) {
  const names = ['苏格拉底', '柏拉图', '孔子', '庄子', '康德', '尼采', '阿伦特', '休谟', '希帕提娅'];
  for (let i = 0; i < count; i++) {
    engine.joinRoom(room, 'openid-' + i + '-' + Math.random().toString(36).slice(2, 8), names[i] + (i + 1));
  }
}

function buildPlayPayload(room, player, card, random) {
  const payload = { instance: card.instance };
  if (card.target === 'other') {
    const targets = play.targetsForCard(room, player, card);
    const target = pickOne(random, targets);
    if (!target) return null;
    payload.targetId = target.id;
    if (card.id === 'razor') {
      const slots = ['offense', 'defense'].filter(slot => target.equipment[slot]);
      if (!slots.length) return null;
      payload.slot = pickOne(random, slots);
    }
  }
  if (card.stance) payload.stance = pickOne(random, ['赞成', '反对']);
  if (card.id === 'counterexample') {
    const marks = room.marks.filter(mark => !mark.protected);
    if (!marks.length) return null;
    payload.markId = pickOne(random, marks).id;
  }
  if (card.id === 'citation') {
    const others = player.hand.filter(item => item.instance !== card.instance);
    if (!others.length) return null;
    payload.revealInstance = pickOne(random, others).instance;
  }
  if (card.id === 'experiment') payload.prediction = pickOne(random, STANCES);
  if (card.id === 'argument' && player.role.id === 'nietzsche' && (player.equipment.offense || player.equipment.defense)) {
    payload.boost = random() < 0.3;
  }
  return payload;
}

function trySkill(room, player, now, random) {
  if (room.phase !== 'action' && room.phase !== 'vote') return false;
  const options = skills.skillList(room, player).filter(skill => skill.usable);
  if (!options.length) return false;
  const skill = pickOne(random, options);
  const payload = { index: skill.index };
  const prompt = skill.prompt || {};
  if (prompt.target) {
    const living = core.alive(room).filter(other => other.id !== player.id);
    let candidates = living;
    if (prompt.target === 'marked') candidates = living.filter(other => room.marks.some(mark => mark.ownerId === other.id));
    if (prompt.target === 'moreHand') candidates = living.filter(other => other.hand.length > player.hand.length);
    if (prompt.target === 'voted') candidates = living.filter(other => other.vote || other.forcedVote || other.smokeVote);
    if (prompt.target === 'mindBelowMax') candidates = living.filter(other => other.mind < other.maxMind);
    if (prompt.target === 'equipment') candidates = living.filter(other => other.equipment.offense || other.equipment.defense);
    if (prompt.target === 'richest') {
      candidates = living.slice().sort((a, b) => b.hand.length - a.hand.length).slice(0, 1);
    }
    const target = pickOne(random, candidates);
    if (!target) return false;
    payload.targetId = target.id;
    if (prompt.target === 'equipment') {
      const slots = ['offense', 'defense'].filter(slot => target.equipment[slot]);
      payload.slot = pickOne(random, slots);
    }
  }
  if (prompt.mark) {
    const marks = room.marks.filter(mark => prompt.mark === 'own' ? mark.ownerId === player.id : true);
    if (!marks.length) return false;
    payload.markId = pickOne(random, marks).id;
  }
  if (prompt.stance) payload.stance = pickOne(random, STANCES);
  if (prompt.basicType) payload.cardId = pickOne(random, catalog.basics).id;
  if (prompt.trickType) payload.cardId = pickOne(random, catalog.tricks).id;
  if (prompt.agendaOrder) {
    const next = room.agendaDeck.slice(room.round, room.round + 2).filter(Boolean);
    if (next.length < 2) return false;
    payload.agendaId = pickOne(random, next).id;
  }
  try {
    engine.dispatch(room, player, 'skill', payload, now);
    return true;
  } catch (error) {
    if (error.isRule) return false;
    throw error;
  }
}

function chooseResponse(room, player, random) {
  const pending = room.pending;
  if (!pending || pending.chooserId !== player.id) return false;
  const options = play.promptOptions(room, pending);
  if (!options.length) return false;
  const paradox = options.find(option => option.value === 'paradox');
  const bagua = options.find(option => option.value === 'bagua');
  const option = (paradox && random() < 0.5) ? paradox : (bagua && random() < 0.4 ? bagua : pickOne(random, options));
  if (option.value === 'paradox') stats.cards.add('paradox');
  engine.dispatch(room, player, 'respond', { choice: option.value }, Date.now());
  return true;
}

function checkInvariants(room, label) {
  const instances = new Map();
  const all = [];
  const add = (item, where) => {
    all.push(item);
    assert(!instances.has(item.instance), '出现了重复的牌实例 ' + item.instance +
      '（' + instances.get(item.instance) + ' 与 ' + where + '）', { label, card: item });
    instances.set(item.instance, where);
  };
  room.deck.forEach((item, index) => add(item, '牌堆#' + index));
  room.discard.forEach((item, index) => add(item, '弃牌堆#' + index));
  room.players.forEach(player => {
    player.hand.forEach((item, index) => add(item, player.name + '手牌#' + index));
    if (player.equipment.offense) add(player.equipment.offense, player.name + '进攻装备');
    if (player.equipment.defense) add(player.equipment.defense, player.name + '防守装备');
  });
  if (room.pending && room.pending.cards) room.pending.cards.forEach((item, index) => add(item, '待选牌#' + index));
  assert(all.length === TOTAL_CARDS, '牌张总数不正确：' + all.length + ' / ' + TOTAL_CARDS, { label });

  room.players.forEach(player => {
    assert(player.mind >= 0 && player.mind <= player.maxMind, player.name + ' 的心智越界', {
      mind: player.mind, maxMind: player.maxMind
    });
    if (!player.alive) assert(player.mind === 0, '出局玩家心智不为 0：' + player.name);
    if (player.alive) assert(player.mind > 0, '存活玩家心智为 0：' + player.name);
  });

  const living = core.alive(room);
  if (room.phase !== 'finished') {
    living.forEach(player => {
      const snapshot = view.makeView(room, player, Date.now());
      snapshot.players.forEach(other => {
        if (other.id !== player.id) {
          assert(other.faction === null, '存活玩家的阵营被泄漏', { viewer: player.name, other: other.name, faction: other.faction });
        }
        assert(other.contract === null, '终局前契约被泄漏', { viewer: player.name, other: other.name });
      });
      assert(snapshot.self.faction === player.faction, '自己的阵营不可见', { viewer: player.name });
      assert(!Object.prototype.hasOwnProperty.call(snapshot.players[0], 'hand'), '公开视图包含手牌');
      assert(snapshot.self.hand.length === player.hand.length, '自己的手牌数量不一致');
    });
  }

  if (room.phase === 'vote' && core.allVoted(room)) {
    // 允许在下一步自动结算，不视为错误
  }
  if (room.phase === 'action') {
    assert(room.turnPlayerId || living.length === 0, '行动阶段却没有当前玩家', { label, phase: room.phase });
  }
}

function playOneGame(gameIndex, seed, verbose) {
  const random = rngFor(seed);
  const expected = 4 + (seed % 5);
  const room = engine.createRoom('T' + (gameIndex % 1000).toString(36).toUpperCase().padStart(3, '0'), expected);
  room.rngState = seed | 0;
  makePlayers(room, expected);
  engine.dispatch(room, room.players[0], 'start', {}, Date.now());

  let now = Date.now();
  let steps = 0;
  const maxSteps = 3000;

  while (room.phase !== 'finished' && steps < maxSteps) {
    steps++;
    now += 400;
    engine.tick(room, now);
    if (room.phase === 'finished') break;

    if (room.phase === 'action' && room.pending) {
      const chooser = core.findPlayer(room, room.pending.chooserId);
      if (!chooser || !chooser.alive) {
        engine.tick(room, now + 31000);
        continue;
      }
      // 其他玩家也可能使用「兼爱」「无为」等响应型技能
      const defenders = core.alive(room).filter(player => player.id !== chooser.id &&
        skills.skillList(room, player).some(skill => skill.usable && skill.interrupt));
      const defender = pickOne(random, defenders);
      if (defender && random() < 0.6 && trySkill(room, defender, now, random)) continue;
      if (random() < 0.35 && trySkill(room, chooser, now, random)) continue;
      if (!chooseResponse(room, chooser, random)) {
        engine.tick(room, now + 31000);
      }
      continue;
    }

    if (room.phase === 'night') {
      const skeptics = core.alive(room).filter(player => player.faction === '怀疑派' && !player.nightTarget);
      if (!skeptics.length) {
        now = room.nightDeadline + 1;
        continue;
      }
      const skeptic = pickOne(random, skeptics);
      const targets = core.alive(room).filter(player => player.id !== skeptic.id && player.faction !== '怀疑派');
      if (!targets.length) {
        now = room.nightDeadline + 1;
        continue;
      }
      engine.dispatch(room, skeptic, 'night', { targetId: pickOne(random, targets).id }, now);
      continue;
    }

    if (room.phase === 'action') {
      const current = core.findPlayer(room, room.turnPlayerId);
      if (!current) {
        engine.tick(room, now + 91000);
        continue;
      }
      if (random() < 0.15 && trySkill(room, current, now, random)) continue;
      if (random() < 0.12) {
        engine.dispatch(room, current, 'endTurn', {}, now);
        continue;
      }
      const hand = shuffleWith(random, current.hand);
      let acted = false;
      for (const item of hand) {
        const card = catalog.cardOf(item);
        if (!card || card.responseOnly) continue;
        const payload = buildPlayPayload(room, current, card, random);
        if (!payload) continue;
        try {
          engine.dispatch(room, current, 'play', payload, now);
          acted = true;
          break;
        } catch (error) {
          if (!error.isRule) throw error;
        }
      }
      if (!acted) {
        try {
          engine.dispatch(room, current, 'endTurn', {}, now);
        } catch (error) {
          if (!error.isRule) throw error;
          // 如果当前有未处理的响应，交给超时机制
          engine.tick(room, now + 31000);
        }
      }
      continue;
    }

    if (room.phase === 'vote') {
      const living = core.alive(room);
      if (random() < 0.25 && trySkill(room, pickOne(random, living), now, random)) continue;
      const waiting = living.filter(player => !player.vote && !player.forcedVote && !player.smokeVote);
      if (!waiting.length) {
        engine.tick(room, room.voteDeadline + 1);
        continue;
      }
      const voter = pickOne(random, waiting);
      const payload = { stance: pickOne(random, STANCES) };
      if (room.agenda && room.agenda.id === 'agenda-objection' && voter.hand.length && !voter.flags.objection && random() < 0.25) {
        payload.objection = true;
      }
      try {
        engine.dispatch(room, voter, 'vote', payload, now);
      } catch (error) {
        if (!error.isRule) throw error;
        engine.dispatch(room, voter, 'vote', { stance: payload.stance }, now);
      }
      continue;
    }

    if (room.phase === 'result') {
      const anyone = pickOne(random, core.alive(room)) || room.players[0];
      engine.dispatch(room, anyone, 'next', {}, now);
      // 主动推进一次时间，避免结算阶段空转
      if (room.phase === 'result') engine.tick(room, room.nextAt + 1);
      continue;
    }

    if (room.phase === 'lobby') {
      engine.dispatch(room, room.players[0], 'start', {}, now);
      continue;
    }
  }

  assert(room.phase === 'finished', '牌局没有在限定步数内结束（可能卡死）', {
    game: gameIndex, seed, phase: room.phase, round: room.round,
    turnPlayerId: room.turnPlayerId, pending: room.pending && room.pending.kind,
    events: room.events.slice(0, 5)
  });
  checkInvariants(room, 'game-' + gameIndex);

  if (verbose) {
    console.log('  第 ' + gameIndex + ' 局：' + expected + ' 人，' + room.maxRounds + ' 轮，结果 ' +
      room.results.map(result => result.result).join(' / ') + '，胜者：' + (room.winners.join('、') || '无'));
  }
  if (!room.results.length) {
    console.log('  [异常] 第 ' + gameIndex + ' 局没有结算任何议题；phase=' + room.phase +
      ' winners=' + room.winners.join(',') + ' round=' + room.round + ' maxRounds=' + room.maxRounds);
    console.log('  events: ' + room.events.slice(0, 8).map(event => event.text).join(' | '));
  }
  room.results.forEach(result => { stats.results[result.result] = (stats.results[result.result] || 0) + 1; });
  room.winners.forEach(winner => {
    stats.winners.add(winner.indexOf('游士契约') >= 0 ? '游士契约' : winner);
  });
  stats.rounds.push(room.results.length);
  return room;
}

function main() {
  const games = Number(process.argv[2] || 60);
  const baseSeed = Number(process.argv[3] || 20261020);
  const verbose = process.argv.indexOf('--verbose') >= 0;
  let finished = 0;
  let totalRounds = 0;
  let totalSteps = 0;

  console.log('规则数据：' + TOTAL_CARDS + ' 张主牌库组件；模拟 ' + games + ' 局。');
  for (let i = 0; i < games; i++) {
    const room = playOneGame(i, (baseSeed + i * 7919) >>> 0, verbose);
    finished++;
    totalRounds += room.results.length;
    assert(room.winners.length > 0 || room.results.length > 0, '牌局结束但没有结算记录', { game: i });
  }
  console.log('通过：' + finished + ' 局全部结束；平均结算 ' + (totalRounds / finished).toFixed(2) + ' 个议题。');
  const allCards = catalog.basics.concat(catalog.tricks, catalog.equipment).map(card => card.id);
  const missingCards = allCards.filter(id => !stats.cards.has(id));
  const activeSkills = [];
  Object.keys(skills.DEFINITIONS).forEach(roleId => {
    skills.DEFINITIONS[roleId].forEach((definition, index) => {
      if (definition.active) activeSkills.push(roleId + ':' + index);
    });
  });
  const missingSkills = activeSkills.filter(key => !stats.skills.has(key));
  console.log('牌面覆盖：' + (allCards.length - missingCards.length) + '/' + allCards.length +
    (missingCards.length ? '，未出现：' + missingCards.join('、') : ''));
  console.log('主动技能覆盖：' + (activeSkills.length - missingSkills.length) + '/' + activeSkills.length +
    (missingSkills.length ? '，未出现：' + missingSkills.join('、') : ''));
  console.log('投票结果分布：' + JSON.stringify(stats.results) + '；胜者类型：' + Array.from(stats.winners).join('、'));
  const rounds = stats.rounds.slice().sort((a, b) => a - b);
  console.log('每局结算议题数：最少 ' + rounds[0] + '，中位 ' + rounds[Math.floor(rounds.length / 2)] + '，最多 ' + rounds[rounds.length - 1]);
}

if (require.main === module) {
  main();
}

module.exports = { playOneGame, checkInvariants, TOTAL_CARDS };
