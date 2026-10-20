/**
 * 首页、玩法说明、创建房间、加入房间、等待大厅。
 */
import { ctx, metrics } from './render.js';
import { C, F, FACTION_COLOR } from './theme.js';
import {
  button, chip, divider, panel, roundRect, text, wrap, wrapHeight, imageCover, imageCircle
} from './ui.js';
import { image } from './images.js';

const M = 16;

function width() {
  return metrics.width - M * 2;
}

export function drawHome(app) {
  const w = width();
  let y = metrics.contentTop;
  const heroHeight = 214;

  ctx.fillStyle = C.deep;
  ctx.fillRect(0, y, metrics.width, heroHeight);
  const banner = image('banner');
  if (banner) imageCover(banner, 0, y, metrics.width, heroHeight);
  const gradient = ctx.createLinearGradient(0, y, 0, y + heroHeight);
  gradient.addColorStop(0, 'rgba(22,34,47,0.10)');
  gradient.addColorStop(0.52, 'rgba(22,34,47,0.42)');
  gradient.addColorStop(1, 'rgba(22,34,47,0.94)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, y, metrics.width, heroHeight);

  text('真理未决', M + 4, y + 94, { size: 34, weight: 'bold', color: '#f7ead0' });
  text('THESIS  /  COUNTERTHESIS', M + 5, y + 140, {
    size: 10, weight: 'bold', color: 'rgba(232,185,103,0.94)'
  });
  ctx.strokeStyle = 'rgba(232,185,103,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M + 5, y + 160);
  ctx.lineTo(M + 58, y + 160);
  ctx.stroke();
  text('角色公开 · 阵营保密 · 票数公开 · 票向保密', M + 5, y + 174, {
    size: F.tiny, color: 'rgba(255,255,255,0.78)'
  });
  y += heroHeight + 14;

  y += wrap(
    '把哲学史搬上一张牌桌。每轮争一道公共命题，用论证、诘问与秘密投票，把城邦推向自己的方向。',
    M + 2, y, w - 4, 20, 2, { size: F.body, color: C.muted }
  );
  y += 14;

  const factions = [
    ['建构派', '＋', '让最终结果通过过半且双方差距不超过 1', 'builder'],
    ['怀疑派', '?', '让最终结果一边倒（全通过或全否决）', 'skeptic'],
    ['游士', '∞', '完成秘密契约，可与其他阵营共胜', 'wanderer']
  ];
  factions.forEach(item => {
    y = factionRow(y, w, item[0], item[1], item[2], item[3]);
  });
  y += 6;

  button(app, {
    x: M, y, w, h: 52, label: '创建房间', style: 'primary',
    onTap: () => app.go('create')
  });
  y += 60;
  button(app, {
    x: M, y, w, h: 44, label: '单人演练 · 3 个 AI', style: 'gold',
    onTap: () => app.createRoom(true)
  });
  y += 54;
  button(app, {
    x: M, y, w, h: 44, label: '输入房间号加入', style: 'secondary',
    onTap: () => app.go('join')
  });
  y += 54;
  button(app, {
    x: M, y, w, h: 38, label: '玩法说明', style: 'secondary',
    onTap: () => app.go('rules')
  });
  y += 50;

  roundRectFrame(M, y, w, 96);
  text('开始之前', M + 14, y + 12, { size: F.small, weight: 'bold', color: C.ink });
  wrap(
    '4—8 人，每人使用自己的微信设备；创建者也是玩家，没有额外权限。人齐后任何玩家都可以开始。',
    M + 14, y + 34, w - 28, 18, 3, { size: F.tiny, color: C.muted }
  );
  y += 110;

  text('系统主持 · 无需房主常驻 · 身份与手牌由云端分开保存', M, y, {
    size: F.tiny, color: C.faint, align: 'left'
  });
  y += 20;
  return y;
}

function factionRow(y, w, name, symbol, description, imageKey) {
  const h = 58;
  roundRectFrame(M, y, w, h);
  const color = FACTION_COLOR[name] || C.gold;
  const badge = image(imageKey);
  if (badge) {
    imageCircle(badge, M + 31, y + 29, 20);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(M + 31, y + 29, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(M + 43, y + 41, 9, 0, Math.PI * 2);
    ctx.fill();
    text(symbol, M + 43, y + 36, { size: 9, weight: 'bold', color: C.white, align: 'center' });
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(M + 31, y + 29, 17, 0, Math.PI * 2);
    ctx.fill();
    text(symbol, M + 31, y + 21, { size: 15, weight: 'bold', color: C.white, align: 'center' });
  }
  text(name, M + 62, y + 10, { size: F.body, weight: 'bold', color: C.ink });
  text(description, M + 62, y + 31, { size: F.tiny, color: C.muted });
  return y + h + 8;
}

function roundRectFrame(x, y, w, h) {
  roundRect(x, y, w, h, 12, C.paper, C.line);
}

function roundRectNote(x, y, w, h) {
  roundRect(x, y, w, h, 12, '#f8f4ea', C.line);
}

export function drawRules(app) {
  const w = width();
  let y = metrics.contentTop + 8;

  y = article(y, '一局怎么走', [
    '① 抽取身份：每人一张公开角色牌、一张秘密阵营牌；游士另抽秘密契约。心智上限 2 或 3 点，起始手牌不超过心智+1。',
    '② 翻题与夜议：公开本轮议题；怀疑派闭眼互认并秘密选择目标，系统按多数结算 1 点夜间伤害。',
    '③ 公开辩论：每轮按随机顺序行动，每人 120 秒；可以连续出牌，也可以提前结束。每回合最多 2 张论证、1 张诘问、1 张辩论，其他同名主牌各 1 张。',
    '④ 秘密表决：全员同时秘密投票，系统只公布总票与结果。超过存活人数一半即通过或否决，都未过半则悬置。'
  ]);

  y = article(y, '胜负看分布，不数单题', [
    '最终不比较“通过了多少道题”，而看通过与非通过（否决/悬置）的分布。',
    '建构派要均势：通过必须过半，且通过与非通过的数量差不超过 1。',
    '怀疑派要极化：全通过、全否决，或双方数量差达到 2。'
  ]);

  y = article(y, '三种立场', [
    '建构派：让最终结果保持均势，或淘汰全部怀疑派。',
    '怀疑派：让最终结果一边倒（全通过或全否决），或存活人数不少于其他所有阵营之和。',
    '游士：完成自己的秘密契约，可与任何阵营同时获胜。死亡契约在出局后仍可能获胜。'
  ]);

  y = article(y, '牌与出牌', [
    '论证：选择赞成或反对，增加 1 票；每人每议题最多 2 枚。',
    '诘问：目标打出反例则无效，否则失去 1 点心智并锁定悬置。',
    '反例：响应诘问，或在投票前移除场上一枚论证标记。',
    '锦囊：辩论、归谬法、公意契约、奥卡姆剃刀、思想实验、议程改写、修辞烟幕、群体记忆、众声合鸣、逻辑悖论、公开审查、证据链。',
    '装备：固定一攻一守两个装备栏。第一件直接装备；同栏第二件会替换旧装备并弃置旧牌。效果每议题一次，可被拆解与保护。'
  ]);

  y = article(y, '议题与契约', [
    '每轮公开一道命题与一条本轮规则：改变资源、技能、装备或投票门槛，结算后弃置。',
    '十种游士契约只发给游士：其中八种要求存活到终局，另外两种（殉道者、反证者）要求完成条件后出局。'
  ]);

  y = article(y, '在手机上操作', [
    '点手牌查看效果；按提示选择目标、立场、装备栏或论证标记，再确认打出。',
    '轮到你回应时，选择反例、弃牌或承受后果；有可用角色技能时会出现技能按钮。',
    '秘密投票提交后，在结算前仍可修改；被诘问或「让步」锁定的投票不能更改。',
    '每个阶段都有倒计时；超时由系统按默认选项推进，不会卡住牌局。'
  ]);

  y += 6;
  button(app, { x: M, y, w, h: 44, label: '返回首页', style: 'secondary', onTap: () => app.go('home') });
  y += 56;
  return y;
}

function article(y, title, paragraphs) {
  const w = width();
  let cursor = y;
  text(title, M, cursor, { size: F.h1, weight: 'bold', color: C.ink });
  cursor += 28;
  paragraphs.forEach(item => {
    const height = wrapHeight(item, w, F.body, null, 20, 6);
    wrap(item, M, cursor, w, 20, 6, { size: F.body, color: C.muted });
    cursor += height + 8;
  });
  cursor += 4;
  divider(M, cursor, w);
  cursor += 18;
  return cursor;
}

export function drawCreate(app) {
  const w = width();
  let y = metrics.contentTop + 8;
  y = panel(M, y, w, 92, '创建房间', '人数包含你自己；创建者也是普通玩家。') + 14;

  text('总人数', M + 2, y, { size: F.small, weight: 'bold', color: C.ink });
  y += 24;
  const gap = 6;
  const chipWidth = (w - gap * 4) / 5;
  for (let count = 4; count <= 8; count++) {
    const x = M + (count - 4) * (chipWidth + gap);
    chip(app, {
      x, y, w: chipWidth, h: 44, label: String(count), size: F.h1,
      selected: app.form.expected === count,
      onTap: () => { app.form.expected = count; app.draw(); }
    });
  }
  y += 58;

  y = panel(M, y, w, 96, '你的昵称', '牌桌上其他人会看到这个名字。') + 56;
  button(app, {
    x: M + 12, y, w: w - 24, h: 40,
    label: app.form.name || '点此填写昵称',
    style: app.form.name ? 'secondary' : 'selected',
    onTap: () => app.editText('name', 16)
  });
  y += 54;

  const noteHeight = 74;
  roundRectNote(M, y, w, noteHeight);
  text('开局说明', M + 14, y + 12, { size: F.small, weight: 'bold', color: C.ink });
  wrap(
    '系统随机分配角色、阵营与契约。房间坐满后，任何玩家都可以开始；游戏中没有玩家主持人。',
    M + 14, y + 34, w - 28, 17, 2, { size: F.small, color: C.muted }
  );
  y += noteHeight + 16;

  button(app, {
    x: M, y, w, h: 52,
    label: app.busy ? '正在创建…' : '创建房间',
    style: app.busy ? 'disabled' : (app.form.name.trim() ? 'primary' : 'disabled'),
    disabled: app.busy || !app.form.name.trim(),
    onTap: () => app.createRoom()
  });
  y += 62;
  button(app, {
    x: M, y, w, h: 44,
    label: '单人演练 · 3 个 AI',
    style: app.busy || !app.form.name.trim() ? 'disabled' : 'gold',
    disabled: app.busy || !app.form.name.trim(),
    onTap: () => app.createRoom(true)
  });
  y += 54;
  button(app, { x: M, y, w, h: 42, label: '返回首页', style: 'secondary', onTap: () => app.go('home') });
  y += 54;
  return y;
}

export function drawJoin(app) {
  const w = width();
  let y = metrics.contentTop + 8;
  y = panel(M, y, w, 92, '加入房间', '向创建者索要 6 位房间号。') + 14;

  text('房间号', M + 2, y, { size: F.small, weight: 'bold', color: C.ink });
  y += 24;
  button(app, {
    x: M, y, w, h: 50,
    label: app.form.code || '点此输入 6 位房间号',
    style: app.form.code ? 'secondary' : 'selected',
    onTap: () => app.editText('code', 6)
  });
  y += 64;

  text('你的昵称', M + 2, y, { size: F.small, weight: 'bold', color: C.ink });
  y += 24;
  button(app, {
    x: M, y, w, h: 50,
    label: app.form.name || '点此填写昵称',
    style: app.form.name ? 'secondary' : 'selected',
    onTap: () => app.editText('name', 16)
  });
  y += 66;

  roundRectNote(M, y, w, 68);
  text('隐私说明', M + 14, y + 12, { size: F.small, weight: 'bold', color: C.ink });
  wrap('身份、手牌与投票分别保存；其他玩家只能看到公开信息。', M + 14, y + 34, w - 28, 17, 2, {
    size: F.small, color: C.muted
  });
  y += 82;

  const ready = app.form.code.length === 6 && !!app.form.name.trim() && !app.busy;
  button(app, {
    x: M, y, w, h: 52, label: app.busy ? '正在加入…' : '加入房间',
    style: ready ? 'primary' : 'disabled', disabled: !ready,
    onTap: () => app.joinRoom()
  });
  y += 62;
  button(app, { x: M, y, w, h: 42, label: '返回首页', style: 'secondary', onTap: () => app.go('home') });
  y += 54;
  return y;
}

export function drawLobby(app) {
  const view = app.view;
  const room = view.room;
  const w = width();
  let y = metrics.contentTop + 8;

  roundRectFrame(M, y, w, 112);
  text('房间号', M + 14, y + 12, { size: F.small, color: C.muted });
  text(room.code, M + 14, y + 30, { size: 30, weight: 'bold', color: C.ink });
  text(room.expected + ' 人局 · ' + room.maxRounds + ' 个议题 · 当前 ' + view.players.length + ' 人', M + 14, y + 78, {
    size: F.small, color: C.muted
  });
  button(app, {
    x: M + w - 152, y: y + 26, w: 66, h: 36, label: '复制', style: 'secondary',
    onTap: () => app.copyRoom()
  });
  button(app, {
    x: M + w - 80, y: y + 26, w: 66, h: 36, label: '分享', style: 'gold',
    onTap: () => app.shareRoom()
  });
  y += 126;

  text('玩家席位', M + 2, y, { size: F.small, weight: 'bold', color: C.ink });
  y += 26;
  for (let index = 0; index < room.expected; index++) {
    const player = view.players[index];
    roundRectFrame(M, y, w, 46);
    text(String(index + 1).padStart(2, '0'), M + 12, y + 14, { size: F.small, color: C.faint });
    if (player) {
      text(player.name, M + 44, y + 13, { size: F.body, weight: 'bold', color: C.ink });
      text('已就座', M + w - 66, y + 14, { size: F.small, color: C.green });
    } else {
      text('等待加入…', M + 44, y + 14, { size: F.small, color: C.faint });
    }
    y += 54;
  }
  y += 4;

  if (view.players.length >= 2 && view.players.length < room.expected) {
    button(app, {
      x: M, y, w, h: 44, label: '补 AI 补满空位（' + (room.expected - view.players.length) + ' 个）',
      style: app.busy ? 'disabled' : 'gold', disabled: app.busy,
      onTap: () => app.fillBots()
    });
    y += 54;
  }

  if (view.players.length === room.expected) {
    button(app, {
      x: M, y, w, h: 52, label: '开始游戏 · 随机分配身份',
      style: app.busy ? 'disabled' : 'primary', disabled: app.busy,
      onTap: () => app.startGame()
    });
  } else {
    roundRectFrame(M, y, w, 52);
    text('等待 ' + (room.expected - view.players.length) + ' 位玩家加入…', M + w / 2, y + 17, {
      size: F.body, color: C.muted, align: 'center'
    });
  }
  y += 64;
  button(app, { x: M, y, w, h: 40, label: '退出房间', style: 'secondary', onTap: () => app.leaveRoom() });
  y += 52;

  text('把房间号发给朋友；他们打开小游戏后选择「加入房间」。', M, y, {
    size: F.tiny, color: C.faint
  });
  y += 22;
  return y;
}
