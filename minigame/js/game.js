/**
 * 牌局界面：行动、玩家、记录三个页签，以及出牌/响应/投票的交互面板。
 */
import { ctx, metrics } from './render.js';
import { C, F, PHASE, PHASE_HINT, FACTION_COLOR } from './theme.js';
import {
  button, chip, divider, hearts, panel, roundRect, text, wrap, wrapHeight, emptyState, tag, bar, truncate
} from './ui.js';
import {
  playerById, targetsForCard, removableMarks, slotsOf, canPlayCard, describePlayer
} from './selectors.js';

const M = 14;

function width() {
  return metrics.width - M * 2;
}

export function drawGame(app) {
  if (!app.view) return 0;
  let y = metrics.pageTop + 10;
  if (app.tab === 'players') y = drawPlayers(app, y);
  else if (app.tab === 'log') y = drawLog(app, y);
  else y = drawAction(app, y);
  return y;
}

/* ------------------------------ 页签 ------------------------------ */

export function drawGameTabs(app) {
  const tabs = [['行动', 'action'], ['玩家', 'players'], ['记录', 'log']];
  const gap = 6;
  const tabWidth = (metrics.width - M * 2 - gap * 2) / 3;
  tabs.forEach((tab, index) => {
    button(app, {
      x: M + index * (tabWidth + gap),
      y: metrics.contentTop + 5,
      w: tabWidth,
      h: 34,
      label: tab[0],
      size: F.small,
      style: app.tab === tab[1] ? 'selected' : 'secondary',
      fixed: true,
      onTap: () => { app.tab = tab[1]; app.scroll = 0; app.draw(true); }
    });
  });
}

/* ------------------------------ 行动页 ------------------------------ */

function drawAction(app, y) {
  const view = app.view;
  const room = view.room;
  const me = view.self;

  y = phaseCard(app, y);
  y = agendaCard(app, y, room);
  y = selfCard(app, y, me);

  if (room.phase === 'night') y = drawNight(app, y, view);
  else if (room.phase === 'action') y = drawActionPhase(app, y, view);
  else if (room.phase === 'vote') y = drawVote(app, y, view);
  else if (room.phase === 'ostracism') y = drawOstracism(app, y, view);
  else if (room.phase === 'result') y = drawResult(app, y, view);
  else if (room.phase === 'finished') y = drawFinished(app, y, view);

  if (room.phase !== 'finished') y = eventTicker(app, y, view);
  return y;
}

function phaseCard(app, y) {
  const room = app.view.room;
  const w = width();
  const h = 60;
  roundRect(M, y, w, h, 12, C.ink, null);
  text(PHASE[room.phase] || '牌局', M + 14, y + 12, { size: F.h2, weight: 'bold', color: C.white });
  const turn = room.turnPlayerId ? playerById(app.view, room.turnPlayerId) : null;
  const detail = room.phase === 'action' && turn ? '当前行动：' + turn.name : (PHASE_HINT[room.phase] || '');
  text(truncate(detail, w - 130, F.tiny), M + 14, y + 36, { size: F.tiny, color: 'rgba(255,255,255,0.7)' });
  text('第 ' + room.round + ' / ' + room.maxRounds + ' 轮', M + w - 14, y + 12, {
    size: F.tiny, color: 'rgba(255,255,255,0.7)', align: 'right'
  });
  const seconds = app.remaining();
  text(seconds == null ? '—' : seconds + 's', M + w - 14, y + 30, {
    size: 17, weight: 'bold', color: C.gold, align: 'right'
  });
  return y + h + 10;
}

function agendaCard(app, y, room) {
  const agenda = room.agenda;
  const w = width();
  if (!agenda) return y;
  const restrictions = [];
  if (room.limitedBasicName) restrictions.push('每人至多 1 张「' + room.limitedBasicName + '」');
  if (room.bannedTrickName) restrictions.push('禁用「' + room.bannedTrickName + '」');
  const restrictionText = restrictions.length ? '本议题限制：' + restrictions.join(' · ') : '';
  const nameHeight = wrapHeight(agenda.name, w - 28, F.body, 'bold', 20, 2);
  const effectHeight = wrapHeight(agenda.text, w - 28, F.tiny, null, 16, 3);
  const h = 38 + nameHeight + 6 + effectHeight + (restrictionText ? 20 : 0) + 30;
  roundRect(M, y, w, h, 14, C.paper, C.line);
  text('本轮议题', M + 14, y + 12, { size: F.tiny, weight: 'bold', color: C.gold });
  const nameEnd = wrap(agenda.name, M + 14, y + 30, w - 28, 20, 2, { size: F.body, weight: 'bold', color: C.ink });
  const effectEnd = wrap(agenda.text, M + 14, y + 30 + nameEnd + 4, w - 28, 16, 3, { size: F.tiny, color: C.muted });
  if (restrictionText) {
    text(restrictionText, M + 14, y + 30 + nameEnd + 4 + effectEnd + 2, {
      size: F.tiny, weight: 'bold', color: C.purple
    });
  }
  button(app, {
    x: M + 12, y: y + h - 26, w: 74, h: 20, label: '完整规则', size: F.tiny, style: 'secondary',
    onTap: () => app.openText(agenda.name, agenda.text + '\n\n设计说明：' + (agenda.note || '—'))
  });
  return y + h + 10;
}

function selfCard(app, y, me) {
  const w = width();
  const hasContract = !!me.contract;
  const h = hasContract ? 154 : 136;
  roundRect(M, y, w, h, 14, C.paper, C.line);
  const factionColor = FACTION_COLOR[me.faction] || C.gold;
  text(me.role ? me.role.name : '身份未分配', M + 14, y + 12, { size: F.h2, weight: 'bold', color: C.ink });
  const nameWidth = me.role ? 110 : 90;
  text(me.faction || '阵营未分配', M + 14 + nameWidth, y + 15, { size: F.small, weight: 'bold', color: factionColor });
  text('心智 ' + me.mind + ' / ' + me.maxMind, M + w - 14, y + 14, {
    size: F.small, weight: 'bold', color: C.muted, align: 'right'
  });
  hearts(me.mind, me.maxMind, M + 14, y + 42, { size: 14 });

  // 装备栏：固定一攻一守；第一件直接装备，同栏第二件替换旧装备。
  const gap = 8;
  const slotW = (w - 28 - gap) / 2;
  equipmentSlot(app, M + 14, y + 68, slotW, '进攻', me.equipment.offense, me.equipment.offenseDisabled);
  equipmentSlot(app, M + 14 + slotW + gap, y + 68, slotW, '防守', me.equipment.defense, me.equipment.defenseDisabled);

  if (hasContract) {
    text('秘密契约：' + me.contract.name, M + 14, y + 110, { size: F.small, weight: 'bold', color: C.purple });
    button(app, {
      x: M + w - 112, y: y + 104, w: 98, h: 28, label: '契约详情', size: F.tiny, style: 'secondary',
      onTap: () => app.openText(me.contract.name, me.contract.text + '\n\n设计说明：' + (me.contract.note || ''))
    });
  }
  button(app, {
    x: M + w - 112, y: y + 30, w: 98, h: 30, label: '角色技能', size: F.small, style: 'secondary',
    onTap: () => app.openSkills()
  });
  if (me.role) {
    text(me.role.era || '', M + 14, y + h - 22, { size: F.tiny, color: C.faint });
  }
  return y + h + 10;
}

function equipmentSlot(app, x, y, w, label, item, disabled) {
  roundRect(x, y, w, 32, 8, item ? C.goldPale : '#f8f4ea', item ? C.gold : C.line);
  text(label, x + 8, y + 8, { size: F.tiny, color: C.muted });
  const name = item ? truncate(item.name, w - 44, F.tiny) : '空';
  text(name, x + 38, y + 7, {
    size: F.tiny, weight: 'bold', color: item ? (disabled ? C.red : C.ink) : C.faint
  });
  if (item) {
    app.hits.push({
      x, y, w, h: 32, label: '装备 · ' + item.name,
      onTap: () => app.openText(item.name, item.text || '')
    });
  }
}

function drawNight(app, y, view) {
  const me = view.self;
  const w = width();
  if (!me.alive) {
    roundRect(M, y, w, 64, 12, '#f8f4ea', C.line);
    wrap('你已出局，可以旁观牌局。', M + 14, y + 20, w - 28, 18, 2, { size: F.body, color: C.muted });
    return y + 74;
  }
  if (me.faction !== '怀疑派') {
    roundRect(M, y, w, 84, 12, '#f8f4ea', C.line);
    text('夜间行动', M + 14, y + 13, { size: F.small, weight: 'bold', color: C.ink });
    wrap('怀疑派正在秘密选择目标。夜间的选择不会公开，只有伤害结果会公布。', M + 14, y + 36, w - 28, 18, 3, {
      size: F.small, color: C.muted
    });
    return handButton(app, y + 94);
  }
  if (me.nightSubmitted) {
    roundRect(M, y, w, 78, 12, '#f8f4ea', C.line);
    text('秘密行动已提交', M + 14, y + 13, { size: F.small, weight: 'bold', color: C.green });
    wrap('等待其他怀疑派完成选择；全员提交或倒计时结束后，系统会按多数结算。', M + 14, y + 36, w - 28, 18, 3, {
      size: F.small, color: C.muted
    });
    return handButton(app, y + 90);
  }
  text('选择夜间目标', M + 2, y, { size: F.small, weight: 'bold', color: C.ink });
  y += 24;
  const mates = (me.fellows || []).filter(item => item.alive && item.id !== me.id).map(item => item.name);
  if (mates.length) {
    text('同阵营的怀疑派：' + mates.join('、'), M + 2, y, { size: F.tiny, color: C.purple });
    y += 20;
  }
  const skepticIds = new Set([me.id].concat((me.fellows || []).map(item => item.id)));
  const candidates = view.players.filter(player => player.alive && !skepticIds.has(player.id));
  if (!candidates.length) {
    emptyState(M, y, w, '没有可选目标', '等待系统结束夜间阶段。');
    return y + 90;
  }
  candidates.forEach(player => {
    button(app, {
      x: M, y, w, h: 44,
      label: player.name + ' · ' + (player.role ? player.role.name : '身份未定'),
      sub: '心智 ' + player.mind + ' / ' + player.maxMind,
      style: 'secondary',
      align: 'left',
      onTap: () => app.nightTarget(player.id)
    });
    y += 52;
  });
  return y + 4;
}

function drawActionPhase(app, y, view) {
  const room = view.room;
  const me = view.self;
  const w = width();

  if (!me.alive) {
    roundRect(M, y, w, 64, 12, '#f8f4ea', C.line);
    wrap('你已出局，可以继续查看牌桌与记录。', M + 14, y + 20, w - 28, 18, 2, {
      size: F.body, color: C.muted
    });
    return y + 74;
  }

  if (me.prompt) return drawPrompt(app, y, me.prompt);

  if (room.pending) {
    const chooser = playerById(view, room.pending.chooserId);
    const h = 82;
    roundRect(M, y, w, h, 12, '#f8f4ea', C.line);
    text('等待回应', M + 14, y + 12, { size: F.small, weight: 'bold', color: C.ink });
    wrap(
      (chooser ? chooser.name : '另一位玩家') + ' 需要处理「' + room.pending.cardName + '」。' + room.pending.question,
      M + 14, y + 34, w - 28, 19, 3, { size: F.small, color: C.muted }
    );
    y += h + 10;
    if (usableSkills(view).length) {
      button(app, {
        x: M, y, w, h: 40, label: '使用响应型角色技能', style: 'gold',
        onTap: () => app.openSkills()
      });
      y += 50;
    }
    return handButton(app, y + 2);
  }

  if (me.canAct) {
    if (app.selected) return drawSelectedCard(app, y);
    return drawHand(app, y);
  }

  const turn = playerById(view, room.turnPlayerId);
  roundRect(M, y, w, 70, 12, '#f8f4ea', C.line);
  text('等待行动', M + 14, y + 12, { size: F.small, weight: 'bold', color: C.ink });
  wrap(turn ? '现在轮到 ' + turn.name + ' 行动。你可以查看手牌、玩家与记录。' : '等待系统推进牌局。',
    M + 14, y + 34, w - 28, 18, 2, { size: F.small, color: C.muted });
  y += 82;
  if (usableSkills(view).length) {
    button(app, { x: M, y, w, h: 40, label: '使用角色技能', style: 'secondary', onTap: () => app.openSkills() });
    y += 50;
  }
  return handButton(app, y);
}

function usableSkills(view) {
  return (view.self.skills || []).filter(skill => skill.active && skill.usable);
}

function handButton(app, y) {
  button(app, {
    x: M, y, w: width(), h: 38, label: '查看我的手牌', style: 'secondary', size: F.small,
    onTap: () => app.openHand()
  });
  return y + 46;
}

function drawHand(app, y) {
  const view = app.view;
  const me = view.self;
  const w = width();
  text('我的手牌 · ' + me.hand.length + ' / ' + (me.mind + 1) + ' 张', M + 2, y, { size: F.small, weight: 'bold', color: C.ink });
  text('点选一张查看效果', M + w, y + 1, { size: F.tiny, color: C.faint, align: 'right' });
  y += 24;
  if (!me.hand.length) {
    emptyState(M, y, w, '没有手牌', '结束行动后，下一轮开始时会摸牌。');
    y += 90;
  } else {
    me.hand.forEach(card => {
      const playable = canPlayCard(view, card);
      y = cardRow(app, y, card, playable);
    });
  }
  y += 4;
  button(app, {
    x: M, y, w, h: 46, label: '结束我的行动', style: 'secondary',
    onTap: () => app.endTurn()
  });
  y += 56;
  return y;
}

function cardRow(app, y, card, playable) {
  const w = width();
  const h = 74;
  roundRect(M, y, w, h, 12, C.paper, playable ? C.line : '#e9e3d8');
  const color = card.type === 'trick' ? C.purple : card.type === 'equipment' ? C.gold : C.blue;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(M + 26, y + 30, 15, 0, Math.PI * 2);
  ctx.fill();
  text(card.icon || '·', M + 26, y + 21, { size: 15, weight: 'bold', color: C.white, align: 'center' });
  text(truncate(card.name, w - 120, F.body, 'bold'), M + 50, y + 10, {
    size: F.body, weight: 'bold', color: playable ? C.ink : C.faint
  });
  text(card.tag || '', M + w - 12, y + 12, { size: F.tiny, color: C.faint, align: 'right' });
  wrap(card.text, M + 50, y + 33, w - 66, 15, 2, { size: F.tiny, color: playable ? C.muted : C.faint });
  if (!playable) {
    text(card.requires && card.requires.responseOnly ? '只能响应' : '当前不可用', M + w - 12, y + 54, {
      size: F.tiny, color: C.red, align: 'right'
    });
  }
  app.hits.push({
    x: M, y, w, h, label: '手牌 · ' + card.name,
    onTap: () => { app.selectCard(card.instance); }
  });
  return y + h + 8;
}

function drawSelectedCard(app, y) {
  const view = app.view;
  const me = view.self;
  const card = me.hand.find(item => item.instance === app.selected);
  if (!card) {
    app.selected = null;
    return drawHand(app, y);
  }
  const w = width();
  const choose = app.choose || {};
  const targets = card.requires.target ? targetsForCard(view, card) : [];
  const target = choose.targetId ? playerById(view, choose.targetId) : null;
  const marks = card.requires.mark ? removableMarks(view) : [];
  const slots = card.id === 'razor' && target ? slotsOf(target) : [];
  const revealCards = card.requires.reveal ? me.hand.filter(item => item.instance !== card.instance) : [];
  const effectHeight = wrapHeight(card.text, w - 28, F.small, null, 18, 6);
  const hintHeight = 18;

  let height = 52 + effectHeight + hintHeight + 16;
  if (card.requires.target) height += 30 + Math.ceil(targets.length / 2) * 46;
  if (card.requires.stance) height += 66;
  if (card.requires.mark) height += 34 + Math.max(1, marks.length) * 36;
  if (card.requires.slot) height += 34 + slots.length * 38;
  if (card.requires.reveal) height += 46;
  if (card.requires.prediction) height += 66;
  if (card.id === 'argument' && me.role && me.role.id === 'nietzsche') height += 42;
  height += 144;

  roundRect(M, y, w, height, 14, C.paper, C.line);
  text('打出「' + card.name + '」', M + 14, y + 12, { size: F.h2, weight: 'bold', color: C.ink });
  text(card.tag || '', M + w - 14, y + 15, { size: F.tiny, color: C.faint, align: 'right' });
  let cursor = y + 38;
  cursor += wrap(card.text, M + 14, cursor, w - 28, 18, 6, { size: F.small, color: C.muted }) + 6;
  const missing = [];
  if (card.requires.target && !target) missing.push('目标');
  if (card.requires.stance && !choose.stance) missing.push('立场');
  if (card.requires.mark && !choose.markId) missing.push('论证标记');
  if (card.requires.slot && !choose.slot) missing.push('装备栏');
  if (card.requires.reveal && !choose.revealInstance) missing.push('要展示的手牌');
  if (card.requires.prediction && !choose.prediction) missing.push('预测');
  if (missing.length) {
    text('还需要选择：' + missing.join('、'), M + 14, cursor, { size: F.tiny, color: C.red });
    cursor += 20;
  } else {
    text('选择已完整，可以确认打出。', M + 14, cursor, { size: F.tiny, color: C.green });
    cursor += 20;
  }

  if (card.requires.target) {
    text('选择目标', M + 14, cursor, { size: F.small, weight: 'bold', color: C.ink });
    cursor += 26;
    if (!targets.length) {
      roundRect(M + 14, cursor, w - 28, 40, 10, '#f6f1e7', C.line);
      text('没有符合条件的目标', M + 28, cursor + 12, { size: F.small, color: C.muted });
      cursor += 46;
    } else {
      const gap = 8;
      const bw = (w - 28 - gap) / 2;
      targets.forEach((player, index) => {
        const row = Math.floor(index / 2);
        const column = index % 2;
        button(app, {
          x: M + 14 + column * (bw + gap),
          y: cursor + row * 46,
          w: bw,
          h: 40,
          label: (choose.targetId === player.id ? '✓ ' : '') + player.name,
          sub: (player.role ? player.role.name : '') + ' · 心智 ' + player.mind,
          size: F.small,
          align: 'left',
          style: choose.targetId === player.id ? 'selected' : 'secondary',
          onTap: () => {
            app.choose.targetId = player.id;
            app.choose.slot = null;
            app.draw(true);
          }
        });
      });
      cursor += Math.ceil(targets.length / 2) * 46;
    }
    cursor += 6;
  }

  if (card.requires.slot) {
    text('选择要弃置的装备栏', M + 14, cursor, { size: F.small, weight: 'bold', color: C.ink });
    cursor += 26;
    if (!slots.length) {
      text('目标该装备栏为空，请重新选择目标。', M + 20, cursor, { size: F.tiny, color: C.red });
      cursor += 24;
    } else {
      slots.forEach((slot, index) => {
        button(app, {
          x: M + 14, y: cursor + index * 38, w: w - 28, h: 34,
          label: (choose.slot === slot ? '✓ ' : '') + (slot === 'offense' ? '进攻装备' : '防守装备') +
            ' · ' + target.equipment[slot].name,
          size: F.small, style: choose.slot === slot ? 'selected' : 'secondary', align: 'left',
          onTap: () => { app.choose.slot = slot; app.draw(true); }
        });
      });
      cursor += slots.length * 38;
    }
    cursor += 6;
  }

  if (card.requires.mark) {
    text('选择要移除的论证标记', M + 14, cursor, { size: F.small, weight: 'bold', color: C.ink });
    cursor += 26;
    if (!marks.length) {
      text('场上没有可移除的标记。', M + 20, cursor, { size: F.tiny, color: C.red });
      cursor += 24;
    } else {
      marks.forEach((mark, index) => {
        const owner = playerById(view, mark.ownerId);
        button(app, {
          x: M + 14, y: cursor + index * 36, w: w - 28, h: 32,
          label: (choose.markId === mark.id ? '✓ ' : '') + (owner ? owner.name : '玩家') + ' · ' + (mark.stance || '暗置'),
          size: F.small, style: choose.markId === mark.id ? 'selected' : 'secondary', align: 'left',
          onTap: () => { app.choose.markId = mark.id; app.draw(true); }
        });
      });
      cursor += marks.length * 36;
    }
    cursor += 6;
  }

  if (card.requires.stance) {
    text('选择立场', M + 14, cursor, { size: F.small, weight: 'bold', color: C.ink });
    cursor += 26;
    const bw = (w - 36) / 2;
    ['赞成', '反对'].forEach((stance, index) => {
      button(app, {
        x: M + 14 + index * (bw + 8), y: cursor, w: bw, h: 36,
        label: stance, size: F.small,
        style: choose.stance === stance ? 'selected' : 'secondary',
        onTap: () => { app.choose.stance = stance; app.draw(true); }
      });
    });
    cursor += 48;
  }

  if (card.requires.reveal) {
    const shown = me.hand.find(item => item.instance === choose.revealInstance);
    button(app, {
      x: M + 14, y: cursor, w: w - 28, h: 36,
      label: choose.revealInstance ? '展示：' + (shown ? shown.name : '已选') : '选择一张手牌公开展示',
      size: F.small, style: choose.revealInstance ? 'selected' : 'secondary',
      onTap: () => app.openRevealPicker(card)
    });
    cursor += 46;
  }

  if (card.requires.prediction) {
    text('预测本轮结果', M + 14, cursor, { size: F.small, weight: 'bold', color: C.ink });
    cursor += 26;
    const bw = (w - 44) / 3;
    ['通过', '否决', '悬置'].forEach((prediction, index) => {
      button(app, {
        x: M + 14 + index * (bw + 6), y: cursor, w: bw, h: 34,
        label: prediction, size: F.small,
        style: choose.prediction === prediction ? 'selected' : 'secondary',
        onTap: () => { app.choose.prediction = prediction; app.draw(true); }
      });
    });
    cursor += 46;
  }

  if (card.id === 'argument' && me.role && me.role.id === 'nietzsche') {
    const hasEquipment = me.equipment.offense || me.equipment.defense;
    button(app, {
      x: M + 14, y: cursor, w: w - 28, h: 34,
      label: (choose.boost ? '✓ ' : '') + '重估价值：弃置一件装备，论证额外 +2',
      size: F.tiny, style: choose.boost ? 'selected' : 'secondary', align: 'left',
      disabled: !hasEquipment,
      onTap: () => { app.choose.boost = !app.choose.boost; app.draw(true); }
    });
    cursor += 42;
  }

  cursor += 6;
  const ready = !missing.length;
  button(app, {
    x: M + 14, y: cursor, w: w - 28, h: 44,
    label: ready ? '确认打出' : '请先完成上方选择',
    style: ready ? 'primary' : 'disabled',
    disabled: !ready,
    onTap: () => app.playSelected()
  });
  cursor += 52;
  button(app, {
    x: M + 14, y: cursor, w: w - 28, h: 38, label: '返回手牌', style: 'secondary',
    onTap: () => app.cancelSelection()
  });
  cursor += 48;
  return Math.max(y + height, cursor) + 6;
}

function drawPrompt(app, y, prompt) {
  const w = width();
  const me = app.view.self;
  const questionHeight = wrapHeight(prompt.question, w - 28, F.small, null, 19, 4);
  const h = 46 + questionHeight + (prompt.options.length) * 52 + 18;
  roundRect(M, y, w, h, 14, C.paper, C.line);
  text('轮到你回应', M + 14, y + 12, { size: F.h2, weight: 'bold', color: C.ink });
  text('「' + (prompt.cardName || '效果') + '」', M + w - 14, y + 15, {
    size: F.small, color: C.purple, align: 'right'
  });
  let cursor = y + 38;
  cursor += wrap(prompt.question, M + 14, cursor, w - 28, 19, 4, { size: F.small, color: C.muted }) + 8;
  prompt.options.forEach(option => {
    button(app, {
      x: M + 14, y: cursor, w: w - 28, h: 44, label: option.label, style: 'secondary', size: F.small,
      onTap: () => app.respond(option.value)
    });
    cursor += 52;
  });
  if (usableSkills(app.view).length) {
    button(app, {
      x: M + 14, y: cursor, w: w - 28, h: 38, label: '改用自己的角色技能', style: 'gold', size: F.small,
      onTap: () => app.openSkills()
    });
    cursor += 46;
  }
  return Math.max(y + h, cursor) + 10;
}

function drawOstracism(app, y, view) {
  const me = view.self;
  const room = view.room;
  const w = width();

  if (!me.alive) {
    roundRect(M, y, w, 64, 12, '#f8f4ea', C.line);
    wrap('你已出局，可以旁观本轮陶片放逐。', M + 14, y + 20, w - 28, 18, 2, {
      size: F.body, color: C.muted
    });
    return y + 74;
  }

  roundRect(M, y, w, 86, 12, '#f6efe4', C.line);
  text('陶片放逐', M + 14, y + 12, { size: F.h2, weight: 'bold', color: C.ink });
  wrap('每名存活玩家秘密投下一枚陶片。所有陶片混合后随机抽出一枚，被抽中者失去 1 点心智。',
    M + 14, y + 36, w - 28, 17, 3, { size: F.small, color: C.muted });
  text('已投 ' + room.ostracismSubmitted + ' / ' + room.ostracismTotal, M + w - 14, y + 14, {
    size: F.tiny, color: C.muted, align: 'right'
  });
  y += 96;

  if (me.ostracizeSubmitted) {
    roundRect(M, y, w, 74, 12, '#f8f4ea', C.line);
    text('陶片已投下', M + 14, y + 14, { size: F.body, weight: 'bold', color: C.green });
    wrap('等待其他玩家投下陶片；全员提交或倒计时结束后，系统会随机抽出一枚并公布被放逐者。',
      M + 14, y + 36, w - 28, 17, 3, { size: F.small, color: C.muted });
    return y + 84;
  }

  text('选择一名怀疑对象', M + 2, y, { size: F.small, weight: 'bold', color: C.ink });
  y += 24;
  const candidates = view.players.filter(player => player.alive && player.id !== me.id);
  candidates.forEach(player => {
    button(app, {
      x: M, y, w, h: 44,
      label: player.name + ' · ' + (player.role ? player.role.name : '身份未定'),
      sub: '心智 ' + player.mind + ' / ' + player.maxMind,
      style: 'secondary', align: 'left',
      onTap: () => app.ostracize(player.id)
    });
    y += 52;
  });
  return y + 4;
}

function drawVote(app, y, view) {
  const me = view.self;
  const room = view.room;
  const w = width();
  const living = view.players.filter(player => player.alive).length;
  const submitted = view.players.filter(player => player.voteSubmitted).length;

  if (!me.alive) {
    roundRect(M, y, w, 64, 12, '#f8f4ea', C.line);
    wrap('你已出局，本轮不能投票。可以查看玩家与记录。', M + 14, y + 20, w - 28, 18, 2, {
      size: F.body, color: C.muted
    });
    return y + 74;
  }

  roundRect(M, y, w, 78, 12, C.paper, C.line);
  text('秘密投票', M + 14, y + 12, { size: F.h2, weight: 'bold', color: C.ink });
  text(submitted + ' / ' + living + ' 已提交', M + w - 14, y + 15, { size: F.small, color: C.muted, align: 'right' });
  wrap('超过存活人数一半即通过或否决；都未过半则悬置。投票在结算前可以修改。', M + 14, y + 38, w - 28, 17, 2, {
    size: F.tiny, color: C.muted
  });
  y += 90;

  if (me.forcedVote) {
    roundRect(M, y, w, 58, 12, '#f6efe4', C.line);
    text('投票已被锁定为「' + me.forcedVote + '」', M + 14, y + 18, {
      size: F.small, weight: 'bold', color: C.red
    });
    return y + 70;
  }
  if (me.smokeVote) {
    roundRect(M, y, w, 58, 12, '#f6efe4', C.line);
    text('已通过「修辞烟幕」秘密放置「' + me.smokeVote + '」', M + 14, y + 18, {
      size: F.small, weight: 'bold', color: C.purple
    });
    return y + 70;
  }

  const gap = 6;
  const bw = (w - gap * 2) / 3;
  ['赞成', '反对', '悬置'].forEach((stance, index) => {
    const style = me.vote === stance ? 'selected' : 'secondary';
    button(app, {
      x: M + index * (bw + gap), y, w: bw, h: 48, label: stance, style, size: F.body,
      onTap: () => app.vote(stance)
    });
  });
  y += 58;

  if (me.vote) {
    text('已提交「' + me.vote + '」；可在结算前改投其他选项。', M + 2, y, {
      size: F.tiny, color: C.muted
    });
    y += 22;
  }

  if (me.objectionAvailable) {
    button(app, {
      x: M, y, w, h: 38,
      label: (app.choose.objection ? '✓ ' : '') + '弃 1 张手牌，把投票改为悬置（议题效果）',
      size: F.tiny, style: app.choose.objection ? 'selected' : 'secondary', align: 'left',
      onTap: () => { app.choose.objection = !app.choose.objection; app.draw(true); }
    });
    y += 46;
  }

  if (me.tasbihReady) {
    const gift = app.choose.giftToId ? playerById(view, app.choose.giftToId) : null;
    button(app, {
      x: M, y, w, h: 38,
      label: gift ? '塔斯比念珠：交给 ' + gift.name : '塔斯比念珠：投悬置时把 1 张牌交给…',
      size: F.tiny, style: gift ? 'selected' : 'secondary', align: 'left',
      onTap: () => app.openGiftPicker()
    });
    y += 46;
  }

  if (usableSkills(view).length) {
    button(app, {
      x: M, y, w, h: 38, label: '使用投票阶段的角色技能', style: 'secondary', size: F.small,
      onTap: () => app.openSkills()
    });
    y += 46;
  }
  return handButton(app, y + 4);
}

function drawResult(app, y, view) {
  const room = view.room;
  const w = width();
  const last = (room.results || [])[room.results.length - 1];
  const h = 150;
  roundRect(M, y, w, h, 14, C.paper, C.line);
  text('第 ' + room.round + ' 轮结算', M + 14, y + 12, { size: F.h2, weight: 'bold', color: C.ink });
  if (last) {
    text(last.result, M + w - 14, y + 12, {
      size: F.h1, weight: 'bold', align: 'right',
      color: last.result === '通过' ? C.green : last.result === '否决' ? C.red : C.gold
    });
    const total = Math.max(1, last.tally['赞成'] + last.tally['反对'] + last.tally['悬置']);
    const bars = [['赞成', C.green], ['反对', C.red], ['悬置', C.gold]];
    let cursor = y + 48;
    bars.forEach(item => {
      const value = last.tally[item[0]] || 0;
      text(item[0], M + 14, cursor, { size: F.tiny, color: C.muted });
      text(String(value), M + 52, cursor, { size: F.tiny, weight: 'bold', color: C.ink });
      bar(M + 74, cursor + 3, w - 150, 8, value / total, item[1]);
      cursor += 20;
    });
    text('门槛 ' + last.threshold + ' 票 · 议题：' + truncate(last.agenda, w - 120, F.tiny), M + 14, cursor + 4, {
      size: F.tiny, color: C.faint
    });
  }
  y += h + 10;
  if (room.agenda) {
    roundRect(M, y, w, 56, 10, '#f8f4ea', C.line);
    text('本轮议题效果已结算', M + 14, y + 10, { size: F.tiny, weight: 'bold', color: C.muted });
    wrap(room.agenda.text, M + 14, y + 28, w - 28, 15, 2, { size: F.tiny, color: C.faint });
    y += 66;
  }
  if (room.ostracismResult) {
    roundRect(M, y, w, 46, 10, '#f6efe4', C.line);
    const exiled = room.ostracismResult.targetName;
    const lost = room.ostracismResult.lost || 0;
    text(exiled
      ? '陶片放逐：' + exiled + (lost > 0 ? ' 失去 ' + lost + ' 点心智' : ' 的伤害被抵消')
      : '陶片放逐：没有产生有效目标',
      M + 14, y + 14, { size: F.small, weight: 'bold', color: C.ink });
    y += 56;
  }
  button(app, {
    x: M, y, w, h: 48,
    label: room.round >= room.maxRounds ? '结束本局' : '开始下一轮',
    style: 'primary',
    onTap: () => app.nextRound()
  });
  y += 58;
  const seconds = app.remaining();
  if (seconds != null) {
    text(seconds > 0 ? seconds + ' 秒后自动开始下一轮' : '其他玩家可以立即开始下一轮', M + w / 2, y, {
      size: F.tiny, color: C.faint, align: 'center'
    });
    y += 22;
  }
  return y;
}

function drawFinished(app, y, view) {
  const room = view.room;
  const w = width();
  const winners = room.winners || [];
  const h = 118 + Math.max(1, winners.length) * 24;
  roundRect(M, y, w, h, 14, C.ink, null);
  text('本局结束', M + 14, y + 14, { size: F.h2, weight: 'bold', color: C.gold });
  if (!winners.length) {
    text('无人达成胜利条件', M + 14, y + 46, { size: F.body, color: C.white });
  } else {
    winners.forEach((winner, index) => {
      text('✦ ' + winner, M + 14, y + 44 + index * 24, { size: F.body, weight: 'bold', color: C.white });
    });
  }
  const passes = room.results.filter(item => item.result === '通过').length;
  const total = room.results.length;
  text('最终分布：' + passes + ' 通过 / ' + (total - passes) + ' 非通过', M + 14, y + h - 44, {
    size: F.tiny, color: 'rgba(255,255,255,0.72)'
  });
  text('身份、阵营与契约已在「玩家」页公开。', M + 14, y + h - 24, {
    size: F.tiny, color: 'rgba(255,255,255,0.6)'
  });
  y += h + 12;
  button(app, { x: M, y, w, h: 46, label: '查看所有身份', style: 'secondary', onTap: () => { app.tab = 'players'; app.scroll = 0; app.draw(true); } });
  y += 56;
  button(app, { x: M, y, w, h: 46, label: '返回首页', style: 'gold', onTap: () => app.leaveToHome() });
  y += 58;
  return y;
}

function eventTicker(app, y, view) {
  const events = (view.events || []).slice(0, 3);
  if (!events.length) return y;
  y += 6;
  text('最近动态', M + 2, y, { size: F.tiny, weight: 'bold', color: C.faint });
  y += 20;
  events.forEach(event => {
    const height = wrapHeight(event.text, width() - 20, F.tiny, null, 15, 2);
    roundRect(M, y, width(), height + 10, 8, '#f8f4ea', null);
    wrap(event.text, M + 10, y + 5, width() - 20, 15, 2, { size: F.tiny, color: C.muted });
    y += height + 16;
  });
  return y;
}

/* ------------------------------ 玩家页 ------------------------------ */

function drawPlayers(app, y) {
  const view = app.view;
  const me = view.self;
  const w = width();
  const aliveCount = view.players.filter(player => player.alive).length;
  text('牌桌成员 · ' + aliveCount + ' / ' + view.players.length + ' 存活', M + 2, y, {
    size: F.small, weight: 'bold', color: C.ink
  });
  y += 24;

  if (me.role) {
    const roleHeight = 104 + wrapHeight(me.role.insight, w - 28, F.tiny, null, 15, 3);
    roundRect(M, y, w, roleHeight, 14, C.paper, C.line);
    text(me.role.name, M + 14, y + 12, { size: F.h1, weight: 'bold', color: C.ink });
    text(me.role.era + ' · ' + me.role.school, M + 14, y + 36, { size: F.tiny, color: C.muted });
    wrap(me.role.insight, M + 14, y + 54, w - 28, 15, 3, { size: F.tiny, color: C.muted });
    let skillY = y + 54 + Math.min(45, wrapHeight(me.role.insight, w - 28, F.tiny, null, 15, 3)) + 4;
    (me.role.skills || []).forEach(skill => {
      text('「' + skill.name + '」', M + 14, skillY, { size: F.tiny, weight: 'bold', color: C.purple });
      text(truncate(skill.text, w - 130, F.tiny), M + 84, skillY, { size: F.tiny, color: C.muted });
      skillY += 16;
    });
    y += roleHeight + 10;
  }

  view.players.forEach(player => {
    const h = 78;
    roundRect(M, y, w, h, 12, player.alive ? C.paper : '#efeade', player.alive ? C.line : '#e0d8c8');
    text(player.name, M + 14, y + 10, {
      size: F.body, weight: 'bold', color: player.alive ? C.ink : C.faint
    });
    text(player.role ? player.role.name : '身份未定', M + 14, y + 32, { size: F.tiny, color: C.muted });
    if (player.faction) {
      tag(player.faction, M + w - 76, y + 10, { color: FACTION_COLOR[player.faction], fill: '#f4ead4' });
    }
    hearts(player.mind, player.maxMind, M + 14, y + 54, { size: 12 });
    text('手牌 ' + player.handCount, M + w - 14, y + 50, { size: F.tiny, color: C.faint, align: 'right' });
    const eq = [];
    if (player.equipment.offense) eq.push('攻:' + player.equipment.offense.name + (player.equipment.offenseDisabled ? '(失效)' : ''));
    if (player.equipment.defense) eq.push('守:' + player.equipment.defense.name + (player.equipment.defenseDisabled ? '(失效)' : ''));
    if (player.marks.length) eq.push('论证×' + player.marks.length);
    if (eq.length) {
      text(truncate(eq.join('  '), w - 120, F.tiny), M + 82, y + 52, {
        size: F.tiny, color: C.faint
      });
    }
    if (!player.alive) {
      text('出局', M + w - 14, y + 28, { size: F.tiny, weight: 'bold', color: C.red, align: 'right' });
    } else if (view.room.turnPlayerId === player.id && view.room.phase === 'action') {
      text('行动中', M + w - 14, y + 28, { size: F.tiny, weight: 'bold', color: C.green, align: 'right' });
    } else if (player.voteSubmitted && view.room.phase === 'vote') {
      text('已投票', M + w - 14, y + 28, { size: F.tiny, color: C.green, align: 'right' });
    }
    app.hits.push({ x: M, y, w, h, label: '玩家 · ' + player.name, onTap: () => app.openPlayer(player) });
    y += h + 8;
  });
  return y;
}

/* ------------------------------ 记录页 ------------------------------ */

function drawLog(app, y) {
  const view = app.view;
  const room = view.room;
  const w = width();
  text('已结算议题', M + 2, y, { size: F.small, weight: 'bold', color: C.ink });
  y += 24;
  if (!room.results.length) {
    emptyState(M, y, w, '还没有结算记录', '第一轮投票结束后会显示在这里。');
    y += 90;
  } else {
    room.results.slice().reverse().forEach(result => {
      const h = 78;
      roundRect(M, y, w, h, 12, C.paper, C.line);
      text('第 ' + result.round + ' 轮 · ' + result.result, M + 14, y + 10, {
        size: F.small, weight: 'bold',
        color: result.result === '通过' ? C.green : result.result === '否决' ? C.red : C.gold
      });
      text(truncate(result.agenda, w - 28, F.tiny), M + 14, y + 30, { size: F.tiny, color: C.muted });
      text('赞成 ' + result.tally['赞成'] + ' · 反对 ' + result.tally['反对'] + ' · 悬置 ' + result.tally['悬置'],
        M + 14, y + 50, { size: F.tiny, color: C.faint });
      y += h + 8;
    });
  }
  y += 6;
  text('牌局记录', M + 2, y, { size: F.small, weight: 'bold', color: C.ink });
  y += 24;
  const events = view.events || [];
  if (!events.length) {
    emptyState(M, y, w, '暂无事件', '');
    y += 90;
  }
  events.forEach(event => {
    const height = wrapHeight(event.text, w - 24, F.small, null, 17, 3);
    roundRect(M, y, w, height + 14, 10, '#f8f4ea', null);
    wrap(event.text, M + 12, y + 7, w - 24, 17, 3, { size: F.small, color: C.muted });
    y += height + 22;
  });
  return y;
}
