/**
 * 无头 UI 冒烟测试：用假的 canvas / wx 运行真实的界面代码，
 * 依次绘制首页、房间、各种牌局阶段、手牌详情与弹层。
 *
 *   node tools/ui-smoke.mjs
 *
 * 说明：客户端是原生 ES Module；为了在 Node 中运行，会先把 js/ 复制到
 * 临时目录并放入 {"type":"module"} 的 package.json，再动态导入。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = path.join(os.tmpdir(), 'truth-unsettled-ui-' + process.pid);
const jsSource = path.join(project, 'js');

fs.rmSync(temporary, { recursive: true, force: true });
fs.mkdirSync(temporary, { recursive: true });
fs.cpSync(jsSource, path.join(temporary, 'js'), { recursive: true });
fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');

/* ------------------------------ 假 canvas ------------------------------ */

function makeContext() {
  const state = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'top'
  };
  const methods = [
    'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo',
    'arc', 'arcTo', 'rect', 'clip', 'fill', 'stroke', 'save', 'restore', 'translate',
    'scale', 'rotate', 'setTransform', 'drawImage'
  ];
  const context = Object.assign({}, state, {
    measureText(value) {
      return { width: String(value == null ? '' : value).length * 7 };
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    fillText(value, x, y) {
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new Error('fillText 收到了非法文本：' + String(value));
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error('fillText 坐标不是有限数值：' + x + ',' + y);
      }
    }
  });
  methods.forEach(name => { context[name] = () => {}; });
  return context;
}

const context = makeContext();
const canvas = {
  width: 390,
  height: 844,
  getContext() { return context; }
};

const touchHandlers = {};
globalThis.GameGlobal = {};
globalThis.wx = {
  createCanvas() { return canvas; },
  createImage() {
    const image = { width: 800, height: 537 };
    setTimeout(() => { if (image.onload) image.onload(); }, 0);
    return image;
  },
  getWindowInfo() {
    return {
      windowWidth: 390,
      windowHeight: 844,
      screenWidth: 390,
      screenHeight: 844,
      pixelRatio: 3,
      statusBarHeight: 47,
      safeArea: { top: 47, bottom: 810, left: 0, right: 390, width: 390, height: 763 }
    };
  },
  getLaunchOptionsSync() { return { query: {} }; },
  getStorageSync() { return ''; },
  setStorageSync() {},
  removeStorageSync() {},
  onTouchStart(handler) { touchHandlers.start = handler; },
  onTouchMove(handler) { touchHandlers.move = handler; },
  onTouchEnd(handler) { touchHandlers.end = handler; },
  onHide() {},
  onShow() {},
  onWindowResize() {},
  showModal() {},
  showToast() {},
  setClipboardData(options) { if (options && options.success) options.success(); },
  shareAppMessage() {},
  showKeyboard() {},
  hideKeyboard() {},
  onKeyboardInput() {},
  onKeyboardConfirm() {},
  onKeyboardComplete() {},
  offKeyboardInput() {},
  offKeyboardConfirm() {},
  offKeyboardComplete() {},
  cloud: {
    init() {},
    callFunction() {
      return Promise.resolve({ result: { ok: false, error: '冒烟测试不连接云端' } });
    }
  }
};

/* ------------------------------ 规则引擎与视图 ------------------------------ */

const rulesDir = path.join(project, 'cloudfunctions', 'game', 'rules');
const engine = require(path.join(rulesDir, 'engine.js'));
const core = require(path.join(rulesDir, 'core.js'));
const viewModule = require(path.join(rulesDir, 'view.js'));
const catalog = require(path.join(rulesDir, 'catalog.js'));

const drew = [];

async function loadApp() {
  const module = await import(pathToFileURL(path.join(temporary, 'js', 'main.js')).href);
  return module.default;
}

function buildRoom(code, count, seed) {
  const room = engine.createRoom(code, count);
  room.rngState = seed || 7;
  for (let index = 0; index < count; index++) {
    engine.joinRoom(room, 'openid-' + code + '-' + index, '玩家' + (index + 1));
  }
  return room;
}

function auditHits(app, label) {
  const metricsWidth = 430;
  const metricsHeight = 932;
  const hits = app.hits || [];
  hits.forEach(hit => {
    if (![hit.x, hit.y, hit.w, hit.h].every(Number.isFinite)) {
      throw new Error('「' + label + '」存在非法点击区域：' + JSON.stringify(hit));
    }
    if (hit.w <= 0 || hit.h <= 0) {
      throw new Error('「' + label + '」存在零尺寸点击区域：' + JSON.stringify(hit));
    }
    if (hit.fixed && (hit.y < 0 || hit.y + hit.h > metricsHeight + 40 || hit.x < 0 || hit.x + hit.w > metricsWidth + 40)) {
      throw new Error('「' + label + '」固定按钮超出屏幕：' + (hit.label || '') + ' ' + JSON.stringify(hit));
    }
  });
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      const a = hits[i];
      const b = hits[j];
      if (!!a.overlay !== !!b.overlay) continue;
      if (!!a.fixed !== !!b.fixed) continue;
      const overlapWidth = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapHeight = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (overlapWidth <= 0 || overlapHeight <= 0) continue;
      const area = overlapWidth * overlapHeight;
      const smaller = Math.min(a.w * a.h, b.w * b.h);
      if (area > smaller * 0.35) {
        throw new Error('「' + label + '」按钮重叠：' + (a.label || '?') + ' 与 ' + (b.label || '?') +
          ' ' + JSON.stringify([a.x, a.y, a.w, a.h]) + ' / ' + JSON.stringify([b.x, b.y, b.w, b.h]));
      }
    }
  }
}

function drawStep(app, label) {
  try {
    app.draw(true);
    auditHits(app, label);
    drew.push(label);
  } catch (error) {
    throw new Error('绘制「' + label + '」失败：' + error.stack);
  }
}

const App = await loadApp();
const app = new App();

// 首页与静态页
drawStep(app, '首页');
app.page = 'rules'; app.scroll = 0; drawStep(app, '玩法说明');
app.page = 'create'; drawStep(app, '创建房间');
app.page = 'join'; drawStep(app, '加入房间');

// 等待大厅
const lobby = buildRoom('LOB123', 5, 3);
const lobbyPlayer = core.byOpenid(lobby, 'openid-LOB123-0');
app.roomCode = lobby.code;
app.view = viewModule.makeView(lobby, lobbyPlayer, Date.now());
app.page = 'lobby';
drawStep(app, '等待大厅');

// 正式牌局
const room = buildRoom('GAM123', 5, 11);
engine.dispatch(room, room.players[0], 'start', {}, Date.now());
const me = room.players[0];
app.roomCode = room.code;
app.view = viewModule.makeView(room, me, Date.now());
app.page = 'game';
app.tab = 'action';
drawStep(app, '夜间阶段');

engine.tick(room, room.nightDeadline + 1);
room.turnPlayerId = me.id;
room.turnStartedAt = Date.now();
me.turnDone = false;
app.view = viewModule.makeView(room, me, Date.now());
drawStep(app, '行动阶段');

// 逐张手牌查看详情
const hand = app.view.self.hand.slice();
hand.forEach(card => {
  app.selectCard(card.instance);
  drawStep(app, '手牌详情 · ' + card.name);
});
app.cancelSelection();

// 全部 35 种牌面的详情页（含目标、装备栏、标记、预测等分支）
const originalHand = me.hand.slice();
const originalEquipment = Object.assign({}, me.equipment);
const opponent = room.players[1];
const originalOpponentEquipment = Object.assign({}, opponent.equipment);
me.equipment.offense = { instance: 'smoke-eq-1', type: 'equipment', cardId: 'logic' };
opponent.equipment.offense = { instance: 'smoke-eq-2', type: 'equipment', cardId: 'staff' };
opponent.equipment.defense = { instance: 'smoke-eq-3', type: 'equipment', cardId: 'mala' };
room.marks.push({ id: 'smoke-mark-1', ownerId: opponent.id, stance: '赞成', hidden: false, bonus: 0, protected: false });
me.hand = [];
catalog.basics.concat(catalog.tricks, catalog.equipment).forEach(definition => {
  me.hand.push({ instance: 'smoke-' + definition.id, type: definition.type, cardId: definition.id });
});
app.view = viewModule.makeView(room, me, Date.now());
me.hand.forEach(item => {
  const definition = catalog.cardOf(item);
  app.selectCard(item.instance);
  drawStep(app, '全卡详情 · ' + definition.name);
  app.cancelSelection();
});
me.hand = originalHand;
me.equipment = originalEquipment;
opponent.equipment = originalOpponentEquipment;
room.marks = room.marks.filter(mark => mark.id !== 'smoke-mark-1');
app.view = viewModule.makeView(room, me, Date.now());
app.openHand();
drawStep(app, '我的手牌弹层');
app.sheet = null;

// 所有角色的技能列表
const originalRole = me.role;
const originalMind = me.mind;
const originalMaxMind = me.maxMind;
catalog.roles.forEach(role => {
  me.role = role;
  me.mind = role.mind;
  me.maxMind = role.mind;
  room.phase = 'action';
  room.pending = null;
  room.turnPlayerId = me.id;
  room.turnStartedAt = Date.now();
  me.turnDone = false;
  app.view = viewModule.makeView(room, me, Date.now());
  app.openSkills();
  drawStep(app, '技能列表 · ' + role.name);
  app.sheet = null;
});

// 技能选择链路（目标 / 标记 / 牌类 / 议题 / 装备栏）
function collectSkillFor(roleId, index, options) {
  const settings = options || {};
  me.role = catalog.roleById(roleId);
  me.mind = me.role.mind;
  me.maxMind = me.role.mind;
  room.phase = settings.phase || 'action';
  room.pending = settings.pending || null;
  room.turnPlayerId = settings.phase === 'vote' ? null : me.id;
  room.turnStartedAt = Date.now();
  room.marks = settings.marks || [];
  me.equipment = settings.equipment || { offense: null, defense: null };
  app.view = viewModule.makeView(room, me, Date.now());
  const skill = app.view.self.skills[index];
  if (!skill) return;
  app.collectSkill(skill);
  drawStep(app, '技能选择 · ' + me.role.name + '「' + skill.name + '」');
  app.sheet = null;
}

collectSkillFor('confucius', 0);
collectSkillFor('zhuangzi', 0, {
  marks: [{ id: 'smoke-mark-2', ownerId: me.id, stance: '赞成', hidden: false, bonus: 0, protected: false }]
});
collectSkillFor('xunzi', 1);
collectSkillFor('plato', 0);
collectSkillFor('plato', 1, { phase: 'vote' });
collectSkillFor('diogenes', 0, {
  pending: {
    id: 'smoke-pending', kind: 'reductio', sourceId: opponent.id, targetId: me.id,
    chooserId: me.id, cardName: '归谬法', question: '测试', deadline: Date.now() + 30000
  },
  equipment: { offense: { instance: 'smoke-eq-x', type: 'equipment', cardId: 'staff' }, defense: null }
});

// 恢复角色与牌局状态
me.role = originalRole;
me.mind = originalMind;
me.maxMind = originalMaxMind;
me.equipment = originalEquipment;
room.phase = 'action';
room.pending = null;
room.marks = [];
room.turnPlayerId = me.id;
app.view = viewModule.makeView(room, me, Date.now());

// 响应型弹层
const other = room.players[1];
room.pending = {
  id: 'pending-test',
  kind: 'challenge',
  sourceId: other.id,
  targetId: me.id,
  chooserId: me.id,
  cardName: '诘问',
  question: '诘问：打出反例抵消，或承受 1 点心智伤害并锁定悬置。',
  deadline: Date.now() + 30000
};
app.view = viewModule.makeView(room, me, Date.now());
drawStep(app, '响应诘问');
room.pending = null;

// 投票
room.phase = 'vote';
room.voteDeadline = Date.now() + 60000;
room.turnPlayerId = null;
app.view = viewModule.makeView(room, me, Date.now());
app.tab = 'action';
drawStep(app, '投票阶段');
app.choose = { objection: true };
drawStep(app, '投票阶段 · 议题选项');
app.choose = {};

// 结算
room.phase = 'result';
room.lastTally = {
  round: room.round,
  agenda: room.agenda.name,
  tally: { 赞成: 2, 反对: 1, 悬置: 2 },
  threshold: 3,
  result: '悬置'
};
room.nextAt = Date.now() + 20000;
app.view = viewModule.makeView(room, me, Date.now());
drawStep(app, '本轮结算');

// 玩家页与记录页
app.tab = 'players'; drawStep(app, '玩家页');
app.tab = 'log'; drawStep(app, '记录页');
app.tab = 'action';

// 弹层
app.openText('测试弹层', '第一行文字\n第二行文字，用于验证换行与截断。');
drawStep(app, '文本弹层');
app.sheet = null;

app.openPlayer(app.view.players[0]);
drawStep(app, '玩家详情弹层');
app.sheet = null;

app.openSkills();
drawStep(app, '技能弹层');
app.sheet = null;

app.openPicker({
  title: '测试选择',
  note: '选择一个选项',
  items: Array.from({ length: 9 }, (unused, index) => ({ label: '选项 ' + (index + 1), note: '说明', value: index })),
  onPick() {}
});
drawStep(app, '选择弹层');
app.sheet = null;

// 终局
core.finish(room, ['建构派', '玩家2（游士契约 · 心智守望）']);
app.view = viewModule.makeView(room, me, Date.now());
drawStep(app, '游戏结束');
app.tab = 'players'; drawStep(app, '终局玩家页');

// 小屏布局
const metrics = (await import(pathToFileURL(path.join(temporary, 'js', 'render.js')).href)).metrics;
metrics.width = 320;
metrics.height = 568;
app.tab = 'action';
drawStep(app, '小屏行动页');
metrics.width = 430;
metrics.height = 932;
drawStep(app, '大屏行动页');

// 滚动到底部
app.scroll = app.maxScroll;
drawStep(app, '滚动到底部');

app.stopTimers();
fs.rmSync(temporary, { recursive: true, force: true });

console.log('UI 冒烟测试通过，共绘制 ' + drew.length + ' 个界面：');
console.log('  ' + drew.join('、'));
