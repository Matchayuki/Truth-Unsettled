/**
 * 云端入口适配测试：用内存数据库替换 wx-server-sdk，
 * 直接调用云函数 exports.main，验证建房、加入、状态读取、行动与投票。
 *
 *   node tools/cloud-adapter-test.js
 */
const path = require('node:path');
const Module = require('node:module');

const cloudFunction = process.env.CLOUD_ENTRY
  ? path.resolve(process.env.CLOUD_ENTRY)
  : path.resolve(__dirname, '..', 'cloudfunctions', 'game', 'index.js');

/* ------------------------------ 内存版 CloudBase ------------------------------ */

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function createMockCloud() {
  const collections = new Map();
  let sequence = 0;
  let currentOpenid = '';

  function bucket(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }

  function matches(doc, query) {
    return Object.keys(query).every(key => {
      const expected = query[key];
      if (expected && typeof expected === 'object' && Object.prototype.hasOwnProperty.call(expected, '__lt')) {
        return doc[key] < expected.__lt;
      }
      return doc[key] === expected;
    });
  }

  function collectionApi(name) {
    return {
      async add(options) {
        const id = 'doc' + (++sequence);
        const payload = options && options.data !== undefined && Object.keys(options).length === 1
          ? options.data
          : options;
        const data = clone(payload);
        data._id = id;
        bucket(name).set(id, data);
        return { _id: id };
      },
      async createCollection() {
        bucket(name);
        return { ok: true };
      },
      where(query) {
        return {
          limit(count) {
            return {
              async get() {
                const list = Array.from(bucket(name).values()).filter(doc => matches(doc, query)).slice(0, count || 100);
                return { data: list.map(clone) };
              }
            };
          },
          async get() {
            const list = Array.from(bucket(name).values()).filter(doc => matches(doc, query));
            return { data: list.map(clone) };
          },
          async count() {
            return { total: Array.from(bucket(name).values()).filter(doc => matches(doc, query)).length };
          },
          async remove() {
            const list = Array.from(bucket(name).values()).filter(doc => matches(doc, query));
            list.forEach(doc => bucket(name).delete(doc._id));
            return { stats: { removed: list.length } };
          }
        };
      },
      doc(id) {
        return {
          async get() {
            const doc = bucket(name).get(id);
            return { data: doc ? clone(doc) : null };
          },
          async update(options) {
            const doc = bucket(name).get(id);
            if (!doc) throw new Error('document not found');
            Object.assign(doc, clone(options.data));
            return { stats: { updated: 1 } };
          },
          async remove() {
            bucket(name).delete(id);
            return { stats: { removed: 1 } };
          }
        };
      }
    };
  }

  const database = {
    command: {
      lt(value) { return { __lt: value }; },
      eq(value) { return value; }
    },
    collection(name) { return collectionApi(name); },
    async createCollection(name) { bucket(name); return { ok: true }; },
    async runTransaction(callback) {
      return { result: await callback({ collection: collectionApi }) };
    }
  };

  return {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init() {},
    database() { return database; },
    getWXContext() { return { OPENID: currentOpenid }; },
    __setOpenid(value) { currentOpenid = value; },
    __collections: collections
  };
}

const mockCloud = createMockCloud();

/** 内存版 PostgREST（只实现本函数用到的 select/insert/update/delete 链）。 */
function createMockRdb() {
  const rows = new Map();

  class Query {
    constructor() {
      this.filters = [];
      this.mode = 'select';
      this.payload = null;
      this.max = 100;
    }
    select() { if (this.mode !== 'update' && this.mode !== 'delete') this.mode = 'select'; return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    lt(key, value) { this.filters.push(row => row[key] < value); return this; }
    limit(value) { this.max = value; return this; }
    update(payload) { this.mode = 'update'; this.payload = payload; return this; }
    delete() { this.mode = 'delete'; return this; }
    insert(payload) {
      if (rows.has(payload.code)) {
        return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } });
      }
      rows.set(payload.code, clone(payload));
      return Promise.resolve({ error: null, data: [clone(payload)] });
    }
    async run() {
      const matched = Array.from(rows.values()).filter(row => this.filters.every(filter => filter(row)));
      if (this.mode === 'update') {
        matched.forEach(row => Object.assign(row, clone(this.payload)));
        return { error: null, data: matched.map(row => ({ rev: row.rev })) };
      }
      if (this.mode === 'delete') {
        matched.forEach(row => rows.delete(row.code));
        return { error: null, data: [] };
      }
      return {
        error: null,
        data: matched.slice(0, this.max).map(row => ({ data: clone(row.data), rev: row.rev }))
      };
    }
    then(resolve, reject) {
      return this.run().then(resolve, reject);
    }
  }

  return {
    client: { from() { return new Query(); } },
    rows
  };
}

const mockRdb = createMockRdb();
const mockCloudbase = {
  init() {
    return {
      rdb: () => mockRdb.client,
      models: { $runSQL: async () => ({}) }
    };
  }
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'wx-server-sdk') return mockCloud;
  if (request === '@cloudbase/node-sdk') return mockCloudbase;
  return originalLoad.call(this, request, parent, isMain);
};

process.env.NODE_ENV = 'test';
const cloudEntry = require(cloudFunction);

/* ------------------------------ 断言与流程 ------------------------------ */

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error(message || '断言失败');
  passed++;
}

async function call(openid, event) {
  mockCloud.__setOpenid(openid);
  const result = await cloudEntry.main(event);
  if (!result || result.ok === false) {
    throw new Error('云端调用失败：' + (result && result.error));
  }
  return result;
}

async function main() {
  console.log('云端入口适配测试（内存数据库）');

  // 建房
  const created = await call('openid-A', { action: 'create', name: '甲', expected: 4 });
  const code = created.room.code;
  check(/^[A-Z0-9]{6}$/.test(code), '房间号应为 6 位');
  check(created.self.name === '甲', '创建者应自动入座');
  check(created.room.phase === 'lobby', '建房后应处于等待状态');
  console.log('  ✓ 建房：' + code);

  // 加入
  await call('openid-B', { action: 'join', code, name: '乙' });
  await call('openid-C', { action: 'join', code, name: '丙' });
  const joined = await call('openid-D', { action: 'join', code, name: '丁' });
  check(joined.players.length === 4, '应有 4 名玩家');
  const duplicate = await call('openid-D', { action: 'join', code, name: '丁丁' });
  check(duplicate.self.name === '丁', '同一 openid 重复加入应返回原座位');
  console.log('  ✓ 加入与重复加入');

  // 同一昵称被拒绝
  const duplicateRoom = await call('openid-A', { action: 'create', name: '甲', expected: 5 });
  await call('openid-B', { action: 'join', code: duplicateRoom.room.code, name: '乙' });
  mockCloud.__setOpenid('openid-E');
  const duplicateName = await cloudEntry.main({ action: 'join', code: duplicateRoom.room.code, name: '乙' });
  check(duplicateName.ok === false && duplicateName.error.indexOf('昵称') >= 0, '同名应被拒绝');

  // 开局
  const started = await call('openid-A', { action: 'start', code });
  check(started.room.phase === 'night', '开局应进入夜间阶段');
  check(started.room.round === 1 && started.room.maxRounds === 3, '4 人局应为 3 轮');
  started.players.forEach(player => {
    if (player.id !== started.self.id) check(player.faction === null, '存活玩家的阵营应保密');
    check(!!player.role, '角色应公开');
  });
  console.log('  ✓ 开局、角色公开、阵营保密');

  // 找出怀疑派并提交夜间目标
  const openids = ['openid-A', 'openid-B', 'openid-C', 'openid-D'];
  const states = {};
  for (let index = 0; index < openids.length; index++) {
    states[openids[index]] = await call(openids[index], { action: 'state', code });
  }
  const skeptics = openids.filter(openid => states[openid].self.faction === '怀疑派');
  check(skeptics.length === 1, '4 人局应有 1 名怀疑派');

  // 选择一名非怀疑派目标
  const skepticState = states[skeptics[0]];
  const target = skepticState.players.find(player => player.id !== skepticState.self.id);
  check(!!target, '应能找到夜间目标');
  await call(skeptics[0], { action: 'night', code, targetId: target.id });
  const afterNight = await call(openids[0], { action: 'state', code });
  check(afterNight.room.phase === 'action', '夜间行动完成后应进入行动阶段');
  console.log('  ✓ 夜间行动与阶段推进');

  // 当前玩家出一张牌（若是论证则声明立场）
  const view = await call(openids[0], { action: 'state', code });
  const currentId = view.room.turnPlayerId;
  const currentIndex = view.players.findIndex(player => player.id === currentId);
  const currentOpenid = openids[currentIndex];
  const currentView = await call(currentOpenid, { action: 'state', code });
  const card = currentView.self.hand.find(item => !item.requires.responseOnly && !item.requires.target &&
    !item.requires.mark && !item.requires.reveal && !item.requires.slot);
  if (card) {
    const payload = { action: 'play', code, instance: card.instance };
    if (card.requires.stance) payload.stance = '赞成';
    if (card.requires.prediction) payload.prediction = '悬置';
    const played = await call(currentOpenid, payload);
    check(!!played.room, '出牌后应返回牌局状态');
    console.log('  ✓ 出牌：' + card.name);
  } else {
    await call(currentOpenid, { action: 'endTurn', code });
    console.log('  ✓ 出牌：无可直接打出的牌，改为结束行动');
  }

  // 推进到投票：所有存活玩家结束行动
  let guard = 0;
  let phaseView = await call(openids[0], { action: 'state', code });
  while (phaseView.room.phase === 'action' && guard < 20) {
    guard++;
    const index = phaseView.players.findIndex(player => player.id === phaseView.room.turnPlayerId);
    if (index < 0) break;
    const actor = openids[index];
    const actorView = await call(actor, { action: 'state', code });
    if (actorView.self.prompt) {
      const option = actorView.self.prompt.options[0];
      await call(actor, { action: 'respond', code, choice: option.value });
    } else {
      await call(actor, { action: 'endTurn', code });
    }
    phaseView = await call(openids[0], { action: 'state', code });
  }
  check(phaseView.room.phase === 'vote', '所有玩家行动后应进入投票');
  console.log('  ✓ 行动顺序与投票阶段');

  // 投票
  for (const openid of openids) {
    const state = await call(openid, { action: 'state', code });
    if (state.room.phase !== 'vote') break;
    if (state.self.canVote) {
      await call(openid, { action: 'vote', code, stance: openid === openids[0] ? '赞成' : '反对' });
    }
  }
  const voted = await call(openids[0], { action: 'state', code });
  check(voted.room.phase === 'result' || voted.room.phase === 'finished', '投票后应进入结算或结束');
  check(voted.room.results.length >= 1, '应记录一次议题结果');
  check(!!voted.room.lastTally, '应公开总票');
  console.log('  ✓ 秘密投票与自动结算');

  // 退出房间（新房间测试）
  const lobby2 = await call('openid-X', { action: 'create', name: '新人', expected: 4 });
  await call('openid-Y', { action: 'join', code: lobby2.room.code, name: '路人' });
  const left = await call('openid-Y', { action: 'leave', code: lobby2.room.code });
  check(left.left === true, '等待阶段应可退出房间');
  const afterLeave = await call('openid-X', { action: 'state', code: lobby2.room.code });
  check(afterLeave.players.length === 1, '退出后应释放座位');
  console.log('  ✓ 等待阶段退出房间');

  // 单人演练：自动补 3 个 AI 并开局
  const solo = await call('openid-SOLO', { action: 'create', name: '单人', expected: 4, solo: true });
  check(solo.players.length === 4, '单人演练应补齐 4 人');
  check(solo.players.filter(player => player.isBot).length === 3, '单人演练应有 3 个 AI');
  const soloStarted = await call('openid-SOLO', { action: 'start', code: solo.room.code });
  check(soloStarted.room.phase !== 'lobby', '单人演练应能开始');
  console.log('  ✓ 单人演练与 AI 补位');

  // 两名真人 + AI 补满：异地朋友联机的最快路径
  const duo = await call('openid-DUO-A', { action: 'create', name: '甲', expected: 4 });
  await call('openid-DUO-B', { action: 'join', code: duo.room.code, name: '乙' });
  const filled = await call('openid-DUO-A', { action: 'fillBots', code: duo.room.code });
  check(filled.players.length === 4, '两名真人应能补满 4 人');
  check(filled.players.filter(player => player.isBot).length === 2, '两名真人应补 2 个 AI');
  const duoStarted = await call('openid-DUO-A', { action: 'start', code: duo.room.code });
  check(duoStarted.room.phase !== 'lobby', '两名真人 + AI 应能开始');
  console.log('  ✓ 两名真人 + AI 补位');

  // 错误路径
  mockCloud.__setOpenid('openid-Z');
  const missing = await cloudEntry.main({ action: 'state', code: 'ZZZZZZ' });
  check(missing.ok === false, '不存在的房间应返回错误');
  const notJoined = await cloudEntry.main({ action: 'state', code });
  check(notJoined.ok === false && notJoined.error.indexOf('加入') >= 0, '未加入房间应返回错误');

  console.log('\n全部 ' + passed + ' 条云端适配断言通过。');
}

main().catch(error => {
  console.error('\n云端适配测试失败：');
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
