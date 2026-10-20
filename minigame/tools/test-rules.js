/**
 * 规则单元测试：不依赖微信云开发。
 *
 *   node tools/test-rules.js
 *
 * 每条用例都在隔离的房间中构造确定状态，验证核心规则的边界。
 */
const path = require('node:path');

const RULES_DIR = path.resolve(__dirname, '..', 'cloudfunctions', 'game', 'rules');
const engine = require(path.join(RULES_DIR, 'engine.js'));
const core = require(path.join(RULES_DIR, 'core.js'));
const play = require(path.join(RULES_DIR, 'play.js'));
const skills = require(path.join(RULES_DIR, 'skills.js'));
const view = require(path.join(RULES_DIR, 'view.js'));

let passed = 0;
const failures = [];

function check(condition, message) {
  if (!condition) throw new Error(message || '断言失败');
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || '值不相等') + '：期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
  }
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (error) {
    failures.push({ name, error });
    console.log('  ✗ ' + name + ' —— ' + error.message);
  }
}

const NOW = 1760000000000;

function makeRoom(count, seed) {
  const room = engine.createRoom('TST' + String(seed || 1).padStart(3, '0'), count);
  room.rngState = (seed || 1) * 7919;
  for (let i = 0; i < count; i++) engine.joinRoom(room, 'openid-' + i, '玩家' + (i + 1));
  engine.dispatch(room, room.players[0], 'start', {}, NOW);
  return room;
}

function neutralise(room) {
  // 用无技能角色隔离卡牌效果，避免随机角色技能干扰
  room.players.forEach((player, index) => {
    player.role = { id: 'test', name: '测试者' + (index + 1), latin: '', era: '', school: '', hue: '#888', insight: '', skills: [] };
    player.maxMind = 4;
    player.mind = 4;
    player.hand = [];
    player.equipment = { offense: null, defense: null };
  });
}

function give(player, cardId, type) {
  const instance = 'test-' + cardId + '-' + Math.random().toString(36).slice(2, 7);
  const item = { instance, type: type || 'basic', cardId };
  player.hand.push(item);
  return item;
}

function toAction(room) {
  engine.tick(room, room.nightDeadline + 1);
  equal(room.phase, 'action', '夜间结束后应进入行动阶段');
}

function setTurn(room, player) {
  room.phase = 'action';
  room.pending = null;
  room.turnPlayerId = player.id;
  room.turnStartedAt = NOW;
  player.turnDone = false;
}

function runVote(room, votes, agendaId) {
  room.phase = 'vote';
  room.voteDeadline = NOW + 60000;
  room.pending = null;
  room.marks = [];
  room.chips = [];
  if (agendaId) room.agenda = require(path.join(RULES_DIR, 'catalog.js')).agendaById(agendaId);
  room.players.forEach(player => {
    player.vote = null;
    player.forcedVote = null;
    player.smokeVote = null;
    player.voteLocked = false;
  });
  Object.keys(votes).forEach(name => {
    const player = room.players.find(item => item.name === name);
    player.vote = votes[name];
  });
  engine.evaluateVote(room, NOW);
}

console.log('《真理未决》规则单元测试');

test('开局：4 人局阵营为 2 建构 / 1 怀疑 / 1 游士，3 轮，手牌不超过心智+1', () => {
  const room = makeRoom(4, 1);
  equal(room.phase, 'night', '开局应进入夜间阶段');
  equal(room.maxRounds, 3);
  equal(room.players.filter(player => player.faction === '建构派').length, 2);
  equal(room.players.filter(player => player.faction === '怀疑派').length, 1);
  equal(room.players.filter(player => player.faction === '游士').length, 1);
  room.players.forEach(player => equal(player.hand.length, Math.min(4, player.maxMind + 1), '起始手牌'));
  equal(new Set(room.players.map(player => player.role.id)).size, 4, '角色不应重复');
});

test('开局：8 人局为 4 / 3 / 1，5 轮，6 人以上每轮摸 2 张', () => {
  const room = makeRoom(8, 2);
  equal(room.maxRounds, 5);
  equal(room.players.filter(player => player.faction === '建构派').length, 4);
  equal(room.players.filter(player => player.faction === '怀疑派').length, 3);
  equal(room.players.filter(player => player.faction === '游士').length, 1);
  const first = room.players[0];
  const before = first.hand.length;
  core.beginRound(room, 2, NOW);
  equal(first.hand.length, Math.min(before + 2, first.mind + 1), '6—8 人局每轮摸 2 张，但不超过心智+1');
});

test('行动顺序：每名存活玩家各行动一次后进入投票', () => {
  const room = makeRoom(4, 3);
  neutralise(room);
  toAction(room);
  const order = [];
  for (let i = 0; i < 4; i++) {
    const current = core.findPlayer(room, room.turnPlayerId);
    check(current, '行动阶段应有当前玩家');
    order.push(current.name);
    engine.dispatch(room, current, 'endTurn', {}, NOW);
  }
  equal(room.phase, 'vote', '四人各行动一次后应进入投票');
  equal(new Set(order).size, 4, '不应有人重复行动');
});

test('夜间：两名怀疑派目标相同时结算 1 点伤害，平票则不结算', () => {
  const room = makeRoom(6, 4);
  neutralise(room);
  const skeptics = room.players.filter(player => player.faction === '怀疑派');
  equal(skeptics.length, 2);
  const outsiders = room.players.filter(player => player.faction !== '怀疑派');
  skeptics[0].nightTarget = outsiders[0].id;
  skeptics[1].nightTarget = outsiders[0].id;
  engine.tick(room, room.nightDeadline + 1);
  equal(outsiders[0].mind, 3, '多数目标应失去 1 点心智');

  const room2 = makeRoom(6, 5);
  neutralise(room2);
  const skeptics2 = room2.players.filter(player => player.faction === '怀疑派');
  const outsiders2 = room2.players.filter(player => player.faction !== '怀疑派');
  skeptics2[0].nightTarget = outsiders2[0].id;
  skeptics2[1].nightTarget = outsiders2[1].id;
  engine.tick(room2, room2.nightDeadline + 1);
  equal(outsiders2[0].mind, 4, '平票不应造成伤害');
  equal(outsiders2[1].mind, 4, '平票不应造成伤害');
});

test('投票门槛：4 人局需 3 票，2 / 1 / 1 结算为悬置', () => {
  const room = makeRoom(4, 6);
  neutralise(room);
  runVote(room, { 玩家1: '赞成', 玩家2: '赞成', 玩家3: '赞成', 玩家4: '反对' });
  equal(room.results[0].result, '通过');

  const room2 = makeRoom(4, 7);
  neutralise(room2);
  runVote(room2, { 玩家1: '赞成', 玩家2: '赞成', 玩家3: '反对', 玩家4: '悬置' });
  equal(room2.results[0].result, '悬置');
});

test('论证标记计入票数，且每人最多保留 2 枚', () => {
  const room = makeRoom(4, 8);
  neutralise(room);
  const player = room.players[0];
  setTurn(room, player);
  give(player, 'argument');
  give(player, 'argument');
  give(player, 'argument');
  engine.dispatch(room, player, 'play', { instance: player.hand[0].instance, stance: '赞成' }, NOW);
  engine.dispatch(room, player, 'play', { instance: player.hand[0].instance, stance: '赞成' }, NOW);
  let error = null;
  try {
    engine.dispatch(room, player, 'play', { instance: player.hand[0].instance, stance: '赞成' }, NOW);
  } catch (caught) {
    error = caught;
  }
  check(error && error.isRule, '第三枚论证应被拒绝');
  equal(room.marks.filter(mark => mark.ownerId === player.id).length, 2);
});

test('议题「多数裁决」把门槛提高到三分之二', () => {
  const room = makeRoom(4, 9);
  neutralise(room);
  runVote(room, { 玩家1: '赞成', 玩家2: '赞成', 玩家3: '反对', 玩家4: '反对' }, 'agenda-majority');
  equal(room.results[0].result, '悬置');
});

test('议题「少数权利」在票差为 1 时强制悬置', () => {
  const room = makeRoom(5, 10);
  neutralise(room);
  runVote(room, { 玩家1: '赞成', 玩家2: '赞成', 玩家3: '赞成', 玩家4: '反对', 玩家5: '反对' }, 'agenda-minority');
  equal(room.results[0].result, '悬置');
});

test('诘问：打出反例则免疫，否则失去 1 点心智并锁定悬置', () => {
  const room = makeRoom(4, 11);
  neutralise(room);
  const attacker = room.players[0];
  const defender = room.players[1];
  setTurn(room, attacker);
  give(attacker, 'challenge');
  give(defender, 'counterexample');
  engine.dispatch(room, attacker, 'play', { instance: attacker.hand[0].instance, targetId: defender.id }, NOW);
  engine.dispatch(room, defender, 'respond', { choice: 'block' }, NOW);
  equal(defender.mind, 4, '反例应抵消诘问');

  const room2 = makeRoom(4, 12);
  neutralise(room2);
  const attacker2 = room2.players[0];
  const defender2 = room2.players[1];
  setTurn(room2, attacker2);
  give(attacker2, 'challenge');
  engine.dispatch(room2, attacker2, 'play', { instance: attacker2.hand[0].instance, targetId: defender2.id }, NOW);
  engine.dispatch(room2, defender2, 'respond', { choice: 'take' }, NOW);
  equal(defender2.mind, 3, '未防御应失去 1 点心智');
  equal(defender2.forcedVote, '悬置');
});

test('辩论：轮流弃论证或反例，无法出牌者失去心智并锁定悬置', () => {
  const room = makeRoom(4, 13);
  neutralise(room);
  const source = room.players[0];
  const target = room.players[1];
  setTurn(room, source);
  give(source, 'debate', 'trick');
  const sourceCard = give(source, 'argument');
  const targetCard = give(target, 'argument');
  engine.dispatch(room, source, 'play', { instance: source.hand.find(item => item.cardId === 'debate').instance, targetId: target.id }, NOW);
  equal(room.pending.kind, 'debate');
  engine.dispatch(room, source, 'respond', { choice: sourceCard.instance }, NOW);
  equal(room.pending.chooserId, target.id);
  engine.dispatch(room, target, 'respond', { choice: targetCard.instance }, NOW);
  equal(room.pending.chooserId, source.id);
  engine.dispatch(room, source, 'respond', { choice: 'fold' }, NOW);
  equal(source.mind, 3, '辩论落败者失去 1 点心智');
  equal(source.forcedVote, '悬置');
});

test('研读：摸 2 张后弃 1 张，净增 1 张', () => {
  const room = makeRoom(4, 14);
  neutralise(room);
  const player = room.players[0];
  setTurn(room, player);
  give(player, 'study');
  const before = player.hand.length;
  engine.dispatch(room, player, 'play', { instance: player.hand[0].instance }, NOW);
  equal(player.hand.length, before - 1 + 2, '研读后手牌应增加 2 张');
  equal(room.pending.kind, 'discard-own');
  engine.dispatch(room, player, 'respond', { choice: player.hand[0].instance }, NOW);
  equal(player.hand.length, before, '弃牌后应净增 1 张');
});

test('角色技能：孔子「仁者」护盾吸收 1 点伤害', () => {
  const room = makeRoom(4, 15);
  neutralise(room);
  const confucius = room.players[0];
  confucius.role = require(path.join(RULES_DIR, 'catalog.js')).roleById('confucius');
  confucius.maxMind = 4;
  confucius.mind = 4;
  const target = room.players[1];
  setTurn(room, confucius);
  engine.dispatch(room, confucius, 'skill', { index: 0, targetId: target.id }, NOW);
  core.damage(room, target, 1, room.players[2], '测试伤害');
  equal(target.mind, 4, '护盾应吸收伤害');
  equal(target.shield, 0, '护盾应被消耗');
});

test('每回合同名主牌上限：诘问一回合只能打出 1 张', () => {
  const room = makeRoom(4, 24);
  neutralise(room);
  const attacker = room.players[0];
  const defender = room.players[1];
  setTurn(room, attacker);
  give(attacker, 'challenge');
  give(attacker, 'challenge');
  give(defender, 'argument');
  give(defender, 'argument');
  engine.dispatch(room, attacker, 'play', { instance: attacker.hand[0].instance, targetId: defender.id }, NOW);
  engine.dispatch(room, defender, 'respond', { choice: 'take' }, NOW);
  let error = null;
  try {
    engine.dispatch(room, attacker, 'play', { instance: attacker.hand[0].instance, targetId: defender.id }, NOW);
  } catch (caught) {
    error = caught;
  }
  check(error && error.isRule, '同一回合第二张诘问应被拒绝');
});

test('让步可以响应诘问：取消伤害并锁定悬置', () => {
  const room = makeRoom(4, 25);
  neutralise(room);
  const attacker = room.players[0];
  const defender = room.players[1];
  setTurn(room, attacker);
  give(attacker, 'challenge');
  give(defender, 'concede');
  give(defender, 'argument');
  engine.dispatch(room, attacker, 'play', { instance: attacker.hand[0].instance, targetId: defender.id }, NOW);
  const options = play.promptOptions(room, room.pending);
  check(options.some(option => option.value === 'concede'), '诘问响应应包含让步');
  engine.dispatch(room, defender, 'respond', { choice: 'concede' }, NOW);
  equal(defender.mind, 4, '让步应免除伤害');
  equal(defender.forcedVote, '悬置', '让步应锁定悬置');
  equal(room.pending, null, '让步后诘问应结束');
});

test('荀子「礼法」：每名玩家本议题至多打出 1 张指定基础牌', () => {
  const room = makeRoom(4, 26);
  neutralise(room);
  const xunzi = room.players[0];
  xunzi.role = require(path.join(RULES_DIR, 'catalog.js')).roleById('xunzi');
  xunzi.maxMind = 4;
  xunzi.mind = 4;
  const player = room.players[1];
  setTurn(room, xunzi);
  engine.dispatch(room, xunzi, 'skill', { index: 1, cardId: 'argument' }, NOW);
  setTurn(room, player);
  give(player, 'argument');
  give(player, 'argument');
  engine.dispatch(room, player, 'play', { instance: player.hand[0].instance, stance: '赞成' }, NOW);
  let error = null;
  try {
    engine.dispatch(room, player, 'play', { instance: player.hand[0].instance, stance: '赞成' }, NOW);
  } catch (caught) {
    error = caught;
  }
  check(error && error.isRule, '礼法限制下第二张同名基础牌应被拒绝');
});

test('角色技能：苏格拉底「反诘」使目标弃反例或移除标记', () => {
  const room = makeRoom(4, 16);
  neutralise(room);
  const socrates = room.players[0];
  socrates.role = require(path.join(RULES_DIR, 'catalog.js')).roleById('socrates');
  socrates.maxMind = 4;
  socrates.mind = 4;
  const target = room.players[1];
  setTurn(room, socrates);
  room.marks.push({ id: 'mark-1', ownerId: target.id, stance: '赞成', hidden: false, bonus: 0, protected: false });
  give(target, 'counterexample');
  engine.dispatch(room, socrates, 'skill', { index: 0, targetId: target.id }, NOW);
  equal(target.hand.length, 0, '目标应被迫弃置反例');
  equal(room.marks.length, 1, '目标有反例时标记应保留');
});

test('游士契约：存活类条件在终局判定', () => {
  const room = makeRoom(4, 17);
  neutralise(room);
  const wanderer = room.players[0];
  wanderer.faction = '游士';
  wanderer.contract = { id: 'contract-archivist', name: '藏书人' };
  wanderer.hand = [{ instance: 'a', type: 'basic', cardId: 'argument' }, { instance: 'b', type: 'basic', cardId: 'argument' }, { instance: 'c', type: 'basic', cardId: 'argument' }];
  check(core.contractSatisfied(room, wanderer), '三张手牌应满足藏书人');
  wanderer.hand.pop();
  check(!core.contractSatisfied(room, wanderer), '两张手牌不满足藏书人');
});

test('出局全部怀疑派后，至少完成一次表决才宣布建构派获胜', () => {
  const room = makeRoom(4, 18);
  neutralise(room);
  const skeptic = room.players.find(player => player.faction === '怀疑派');
  core.eliminate(room, skeptic, '测试');
  check(room.phase !== 'finished', '第一次表决前不应直接结束');
  runVote(room, { 玩家1: '赞成', 玩家2: '赞成', 玩家3: '反对', 玩家4: '悬置' });
  equal(room.phase, 'finished');
  check(room.winners.indexOf('建构派') >= 0, '建构派应获胜');
});

test('游士契约：十种契约的条件判定', () => {
  const room = makeRoom(4, 27);
  neutralise(room);
  const player = room.players[0];
  player.faction = '游士';
  const base = { alive: true, mind: 4, maxMind: 4, hand: [], causedDamage: false, everEquipped: false, contractComplete: false, concordCount: 0 };
  const cases = [
    { id: 'contract-guardian', patch: { mind: 2 }, expect: true, name: '心智守望' },
    { id: 'contract-archivist', patch: { hand: [1, 2, 3] }, expect: true, name: '藏书人' },
    { id: 'contract-concord', patch: { concordCount: 2 }, expect: true, name: '合议者' },
    { id: 'contract-dissenter', patch: { contractComplete: true }, expect: true, name: '异议者' },
    { id: 'contract-witness', patch: {}, expect: true, name: '悬置见证者' },
    { id: 'contract-rhetor', patch: { contractComplete: true }, expect: true, name: '连环论者' },
    { id: 'contract-pacifist', patch: {}, expect: true, name: '不伤者' },
    { id: 'contract-curator', patch: { everEquipped: true }, expect: true, name: '器物守护者' },
    { id: 'contract-martyr', patch: { alive: false, contractComplete: true }, expect: true, name: '殉道者' },
    { id: 'contract-counterproof', patch: { alive: false, contractComplete: true }, expect: true, name: '反证者' }
  ];
  room.results = [
    { result: '通过' },
    { result: '悬置' },
    { result: '否决' }
  ];
  cases.forEach(item => {
    Object.assign(player, base, item.patch);
    player.contract = { id: item.id, name: item.name };
    const actual = core.contractSatisfied(room, player);
    equal(actual, item.expect, item.name + ' 契约判定');
  });
  // 存活类契约在出局后不成立
  Object.assign(player, base, { alive: false, contractComplete: true });
  player.contract = { id: 'contract-dissenter', name: '异议者' };
  equal(core.contractSatisfied(room, player), false, '出局后存活类契约不成立');
});

test('投票阶段超时：未提交者按悬置处理并自动结算', () => {
  const room = makeRoom(4, 19);
  neutralise(room);
  room.phase = 'vote';
  room.voteDeadline = NOW + 1000;
  room.players.forEach(player => { player.vote = null; });
  room.players[0].vote = '赞成';
  engine.tick(room, NOW + 2000);
  equal(room.results.length, 1, '应自动结算');
  equal(room.results[0].tally['悬置'], 3);
});

test('隐藏信息：存活玩家看不到他人阵营、契约与手牌', () => {
  const room = makeRoom(5, 20);
  const viewer = room.players[0];
  const snapshot = view.makeView(room, viewer, NOW);
  snapshot.players.forEach(other => {
    if (other.id === viewer.id) return;
    equal(other.faction, null, '他人阵营');
    equal(other.contract, null, '他人契约');
    check(!Object.prototype.hasOwnProperty.call(other, 'hand'), '公开视图不应包含手牌');
  });
  equal(snapshot.self.faction, viewer.faction);
  equal(snapshot.self.hand.length, viewer.hand.length);
  check(snapshot.self.contract === null || !!snapshot.self.contract, '契约只在下发给自己时存在');
});

test('终局公开：结束时公开所有人的阵营与契约', () => {
  const room = makeRoom(4, 21);
  core.finish(room, ['建构派']);
  const snapshot = view.makeView(room, room.players[0], NOW);
  snapshot.players.forEach(other => {
    check(!!other.faction, '终局应公开阵营');
  });
});

test('可以复现的随机性：相同种子产生相同牌堆', () => {
  const roomA = makeRoom(4, 22);
  const roomB = makeRoom(4, 22);
  equal(roomA.deck.length, roomB.deck.length);
  equal(roomA.deck[0].cardId, roomB.deck[0].cardId);
  equal(roomA.players[0].role.id, roomB.players[0].role.id);
});

test('技能时机：不在自己回合时不能使用主动技能', () => {
  const room = makeRoom(4, 23);
  neutralise(room);
  const player = room.players[0];
  player.role = require(path.join(RULES_DIR, 'catalog.js')).roleById('confucius');
  setTurn(room, room.players[1]);
  let error = null;
  try {
    engine.dispatch(room, player, 'skill', { index: 0, targetId: room.players[2].id }, NOW);
  } catch (caught) {
    error = caught;
  }
  check(error && error.isRule, '非当前玩家不应能使用主动技能');
});

test('装备栏：第一件直接装备，同栏第二件替换旧装备', () => {
  const room = makeRoom(4, 31);
  neutralise(room);
  const player = room.players[0];
  setTurn(room, player);

  const first = give(player, 'staff', 'equipment');
  play.playCard(room, player, { instance: first.instance }, NOW);
  equal(player.equipment.offense.cardId, 'staff', '第一件进攻装备应直接进入进攻栏');

  const second = give(player, 'mask', 'equipment');
  play.playCard(room, player, { instance: second.instance }, NOW);
  equal(player.equipment.offense.cardId, 'mask', '同栏第二件装备应替换第一件');
  check(room.discard.some(item => item.instance === first.instance), '被替换的旧装备应进入弃牌堆');
});

test('心智上限整体下调 1 点', () => {
  const room = makeRoom(8, 32);
  check(room.players.every(player => player.maxMind <= 3), '所有角色心智上限不应超过 3');
  check(room.players.some(player => player.maxMind === 2), '应存在 2 点心智的角色');
});

test('手牌上限=心智+1，超出时自动弃到上限', () => {
  const room = makeRoom(4, 33);
  neutralise(room);
  const player = room.players[0];
  player.mind = 2;
  player.maxMind = 2;
  player.hand = [];
  for (let i = 0; i < 5; i++) give(player, 'argument');
  core.enforceHandLimit(room, player);
  equal(player.hand.length, 3, '心智 2 时手牌上限应为 3');
});

test('行动阶段每轮使用随机顺序，且当前行动者在顺序中', () => {
  const room = makeRoom(4, 34);
  core.beginAction(room, NOW);
  check(Array.isArray(room.turnOrder), '应生成出牌顺序');
  equal(room.turnOrder.length, 4, '顺序应覆盖所有存活玩家');
  equal(new Set(room.turnOrder).size, 4, '顺序不应重复');
  check(room.turnOrder.indexOf(room.turnPlayerId) >= 0, '当前行动者应在顺序中');
});

if (failures.length) {
  console.log('\n失败用例：');
  failures.forEach(item => {
    console.log('  · ' + item.name);
    console.log('    ' + (item.error.stack || item.error.message).split('\n').slice(0, 4).join('\n    '));
  });
  process.exitCode = 1;
} else {
  console.log('\n全部 ' + passed + ' 条规则测试通过。');
}
