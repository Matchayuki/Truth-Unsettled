/**
 * 云函数入口：身份识别、房间存取、事务与自动推进。
 * 规则本身全部位于 ./rules/ 中，可在本地用 node 测试。
 */
const cloudbase = require('@cloudbase/node-sdk');
const cloud = require('wx-server-sdk');
const ENV_ID = 'truth-unsettled-d5fu693h4e728350';
cloud.init({ env: ENV_ID });

// 普通事件云函数中，node-sdk 会自动读取当前函数的临时密钥，无需手填 SecretId。
const app = cloudbase.init({ env: ENV_ID });
const rdb = app.rdb();

const engine = require('./rules/engine.js');
const view = require('./rules/view.js');
const core = require('./rules/core.js');

const COLLECTION = 'truth_rooms';
const ROOM_VERSION = 2;
const ROOM_TTL = 6 * 60 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// 表在腾讯云 CloudBase 控制台的 SQL 编辑器里创建一次（见 README），
// 云函数的 $runSQL 只允许 DML，不允许 CREATE TABLE。
async function ensureTable() {
  return;
}

function ruleError(message) {
  const error = new Error(message);
  error.isRule = true;
  return error;
}

function need(condition, message) {
  if (!condition) throw ruleError(message);
}

function cleanRoom(room) {
  const copy = Object.assign({}, room);
  delete copy._id;
  delete copy._openid;
  return copy;
}

function randomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

function requestedCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : '';
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function loadRoom(code) {
  const { data, error } = await rdb
    .from(COLLECTION)
    .select('data,rev')
    .eq('code', code)
    .limit(1);
  if (error) throw new Error(error.message || '查询房间失败');
  const row = data && data[0];
  return row ? { room: row.data, rev: row.rev } : null;
}

/** 乐观锁：只有 rev 未变化时才写入，返回新 rev；冲突返回 null。 */
async function saveRoom(code, room, rev) {
  const { data, error } = await rdb
    .from(COLLECTION)
    .update({ data: cleanRoom(room), rev: rev + 1, updated_at: Date.now() })
    .eq('code', code)
    .eq('rev', rev)
    .select('rev');
  if (error) throw new Error(error.message || '保存房间失败');
  return Array.isArray(data) && data.length ? data[0].rev : null;
}

async function cleanup() {
  try {
    await rdb.from(COLLECTION).delete().lt('updated_at', Date.now() - ROOM_TTL);
  } catch (error) {
    // 清理失败不影响开局
  }
}

function isDue(room, now) {
  if (!room) return false;
  if (room.pending) return room.pending.deadline <= now;
  if (room.phase === 'night' && room.nightDeadline && room.nightDeadline <= now) return true;
  if (room.phase === 'action' && (!room.turnPlayerId || room.turnStartedAt + core.rules.timers.turn * 1000 <= now)) return true;
  if (room.phase === 'vote' && (room.voteDeadline <= now || core.allVoted(room))) return true;
  if (room.phase === 'ostracism' && room.ostracismDeadline && room.ostracismDeadline <= now) return true;
  if (room.phase === 'result' && room.nextAt && room.nextAt <= now) return true;
  return false;
}

/**
 * 读取房间、执行回调，再用 rev 乐观锁写回；冲突时重试。
 * 回调返回 undefined 时返回当前玩家视角。
 */
async function mutateRoom(code, openid, callback, opId) {
  await ensureTable();
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const doc = await loadRoom(code);
      need(doc, '找不到这个房间号。');
      const room = doc.room;
      need(room, '这个房间已经不存在。');
      need(room.v === ROOM_VERSION, '本局由旧版本创建，请重新建房。');
      const player = core.byOpenid(room, openid) || null;
      const now = Date.now();
      // 同一操作的超时重试直接返回当前状态，避免重复出牌/投票。
      if (opId && Array.isArray(room.recentOps) && room.recentOps.includes(opId)) {
        return view.makeView(room, player, now);
      }
      const result = callback(room, player, now);
      room.updatedAt = now;
      if (result && result.room) result.room.updatedAt = now;
      // 单人演练：在保存前让 AI 完成属于它们的回合/夜间目标/投票。
      if (room.phase !== 'lobby' && !(result && result.left)) {
        engine.runBots(room, Date.now());
      }
      if (opId) {
        room.recentOps = (Array.isArray(room.recentOps) ? room.recentOps : []).concat(opId).slice(-30);
      }
      const nextRev = await saveRoom(code, room, doc.rev);
      if (nextRev !== null) {
        if (result && result.left) return result;
        return view.makeView(room, core.byOpenid(room, openid) || player, Date.now());
      }
      lastError = new Error('房间状态已变化，请重试。');
    } catch (error) {
      lastError = error;
      if (error && error.isRule) throw error;
    }
    await sleep(40 + attempt * 60);
  }
  throw lastError || new Error('房间状态繁忙，请重试。');
}

async function handleCreate(event, openid) {
  const name = String(event.name || '').trim().slice(0, 16);
  const expected = Number(event.expected);
  need(name, '请填写昵称。');
  need(Number.isInteger(expected) && expected >= 4 && expected <= 8, '玩家人数须为 4—8 人。');

  await ensureTable();
  let code = requestedCode(event.code) || randomCode();
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const room = engine.createRoom(code, expected);
    const player = engine.joinRoom(room, openid, name);
    if (event.solo) engine.fillBots(room, expected - 1);
    room.updatedAt = Date.now();
    const { error } = await rdb.from(COLLECTION).insert({
      code,
      data: cleanRoom(room),
      rev: 1,
      updated_at: room.updatedAt
    });
    if (!error) {
      cleanup();
      return view.makeView(room, player, Date.now());
    }
    lastError = new Error(error.message || '创建房间失败');
    if (error.code !== '23505') break;
    // 客户端超时重试时可能已经创建成功：同一 openid 直接返回已有房间。
    const existing = await loadRoom(code);
    const existingPlayer = existing && core.byOpenid(existing.room, openid);
    if (existingPlayer) return view.makeView(existing.room, existingPlayer, Date.now());
    // 房间号已被其他玩家占用，换一个。
    code = randomCode();
  }
  throw lastError || new Error('房间号生成失败，请重试。');
}

async function handleJoin(event, openid) {
  const code = String(event.code || '').trim().toUpperCase();
  need(code, '缺少房间号。');
  return mutateRoom(code, openid, (room, player) => {
    if (player) return view.makeView(room, player, Date.now());
    const joined = engine.joinRoom(room, openid, event.name);
    return view.makeView(room, joined, Date.now());
  });
}

async function handleState(event, openid) {
  const code = String(event.code || '').trim().toUpperCase();
  need(code, '缺少房间号。');
  await ensureTable();
  const doc = await loadRoom(code);
  need(doc, '找不到这个房间号。');
  const room = doc.room;
  need(room.v === ROOM_VERSION, '本局由旧版本创建，请重新建房。');
  const player = core.byOpenid(room, openid);
  need(player, '你还没有加入这个房间。');
  const now = Date.now();

  if (!isDue(room, now) && !engine.botsPending(room)) return view.makeView(room, player, now);

  return mutateRoom(code, openid, (fresh, actor) => {
    need(actor, '你还没有加入这个房间。');
    engine.tick(fresh, now);
    engine.ensureTurn(fresh, now);
    return view.makeView(fresh, actor, now);
  });
}

async function handleAction(event, openid) {
  const code = String(event.code || '').trim().toUpperCase();
  const action = String(event.action || '');
  need(code, '缺少房间号。');
  need(action, '缺少操作类型。');
  const opId = action === 'leave' ? null : String(event.opId || '').slice(0, 64);
  return mutateRoom(code, openid, (room, player, now) => {
    need(player, '你还没有加入这个房间。');
    if (action === 'leave') {
      engine.leaveRoom(room, player);
      return { ok: true, left: true };
    }
    if (action === 'fillBots') {
      need(room.phase === 'lobby', '牌局已经开始。');
      need(room.players.length >= 2, '至少需要 2 名真人玩家才能补 AI。');
      engine.fillBots(room, room.expected - room.players.length);
      return view.makeView(room, player, now);
    }
    engine.dispatch(room, player, action, event, now);
    return view.makeView(room, player, now);
  }, opId);
}

exports.main = async (event) => {
  const input = event || {};
  try {
    const context = cloud.getWXContext();
    const openid = context && context.OPENID;
    need(openid, '无法识别微信用户身份，请在微信中打开。');
    const action = String(input.action || 'state');

    if (action === 'create') return await handleCreate(input, openid);
    if (action === 'join') return await handleJoin(input, openid);
    if (action === 'state') return await handleState(input, openid);
    return await handleAction(input, openid);
  } catch (error) {
    if (!error || !error.isRule) {
      console.error('[truth-unsettled]', error);
    }
    const message = (error && error.message) || '';
    const databaseMissing = /resource is not found|-501001|collection/i.test(message);
    const tableMissing = /relation .* does not exist|42P01|truth_rooms.*not exist/i.test(message);
    return {
      ok: false,
      error: error && error.isRule
        ? error.message
        : tableMissing
          ? '数据库表 truth_rooms 不存在：请在腾讯云 CloudBase 控制台的 SQL 编辑器执行 README 里的建表语句。'
          : databaseMissing
            ? '云数据库不可用：请确认当前环境是“微信云开发（文档型数据库）”，并已创建集合 truth_rooms。'
            : ('牌局服务异常：' + (message || '请查看云函数日志') + '。'),
      code: error && error.isRule ? 'RULE' : 'SYSTEM'
    };
  }
};

