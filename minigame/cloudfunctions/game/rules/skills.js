/**
 * 角色技能：主动技能的可用性判定与结算。
 * 自动技能分散在 core.js（伤害、结算、回合开始）与 play.js（出牌后）中。
 */
const core = require('./core.js');
const { cardOf, basics, tricks, agendas } = require('./catalog.js');

const {
  need, fail, addEvent, findPlayer, alive, roleIs, equipmentIs,
  draw, discardHand, discardInstance, heal, damage, discardEquipment,
  addPending, clearPending, rules
} = core;

const PER_GAME = new Set(['plato:1', 'xunzi:1', 'kant:0', 'arendt:0', 'ghazali:1']);
const TRICK_TARGET_KINDS = ['reductio', 'scrutiny-ward', 'chain', 'razor', 'debate'];
// 这些技能描述里没有“自己的回合”限制，可在辩论阶段随时使用
const ANYTIME_ACTION = new Set(['socrates:0', 'hegel:0', 'ghazali:0']);
const INTERRUPT_SKILLS = new Set(['laozi:0', 'mozi:0', 'diogenes:0', 'descartes:0', 'hume:1']);
const VOTE_SKILLS = new Set(['plato:1', 'ghazali:1', 'hypatia:0', 'arendt:0']);

const DEFINITIONS = {
  socrates: [
    { name: '反诘', active: true, prompt: { target: 'marked' }, hint: '选择一名有论证标记的玩家：其弃反例，否则移除标记。' },
    { name: '助产术', active: false, hint: '自动：结算时若你的论证标记仍在场，摸 1 张。' }
  ],
  plato: [
    { name: '理念型', active: true, prompt: { agendaOrder: true }, hint: '查看接下来两张议题，选择下一张出现的那张。' },
    { name: '洞穴寓言', active: true, prompt: { stance: true }, hint: '每局一次：在投票阶段秘密改写自己的票。' }
  ],
  aristotle: [
    { name: '范畴', active: true, prompt: {}, hint: '查看牌堆顶两张，选择一张加入手牌。' },
    { name: '中道', active: false, hint: '自动：每议题第一次失去心智时改为弃 1 张牌。' }
  ],
  confucius: [
    { name: '仁者', active: true, prompt: { target: 'aliveOther' }, hint: '选择一名其他玩家，挡下其下一次 1 点伤害。' },
    { name: '正名', active: false, hint: '自动：结算后，若你的投票与结果一致，摸 1 张。' }
  ],
  laozi: [
    { name: '无为', active: true, prompt: {}, hint: '被锦囊指定时：弃 1 张牌，令该锦囊对你无效。', interrupt: true },
    { name: '反者道之动', active: false, hint: '自动：命题被悬置时恢复 1 点心智。' }
  ],
  zhuangzi: [
    { name: '齐物', active: true, prompt: { mark: 'own' }, hint: '把自己的一枚论证标记移到相反立场。' },
    { name: '逍遥游', active: false, hint: '自动：回合开始时若手牌不超过 1 张，摸 1 张。' }
  ],
  mozi: [
    { name: '兼爱', active: true, prompt: {}, hint: '其他玩家被诘问时，替其打出一张反例。', interrupt: true },
    { name: '守城', active: false, hint: '自动：辩论中可亮出一张手牌视为反例。' }
  ],
  mencius: [
    { name: '四端', active: false, hint: '自动：任一玩家失去心智后，令其恢复 1 点。' },
    { name: '浩然之气', active: false, hint: '自动：心智不高于 2 时，第一张论证 +1 票。' }
  ],
  xunzi: [
    { name: '化性起伪', active: false, hint: '自动：研读后额外弃 1 张、摸 1 张。' },
    { name: '礼法', active: true, prompt: { basicType: true }, hint: '每局一次：本议题禁止继续打出某一种基础牌。' }
  ],
  hanfei: [
    { name: '法不阿贵', active: true, prompt: { target: 'equipment' }, hint: '选择一名玩家的装备，令其本议题失效。' },
    { name: '二柄', active: false, hint: '自动：诘问造成伤害后摸 1 张。' }
  ],
  epicurus: [
    { name: '宁静', active: false, hint: '自动：本议题未造成伤害时，结算恢复 1 点心智。' },
    { name: '友谊', active: true, prompt: { target: 'aliveOther' }, hint: '把 1 张手牌交给一名玩家，双方各摸 1 张。' }
  ],
  diogenes: [
    { name: '不持所有', active: true, prompt: { slot: true }, hint: '被锦囊指定时：弃置一件自己的装备，令该锦囊无效。', interrupt: true },
    { name: '直言', active: true, prompt: { target: 'moreHand' }, hint: '手牌比你多的玩家展示手牌，你令其弃一张基础牌。' }
  ],
  hypatia: [
    { name: '星盘', active: true, prompt: { target: 'voted' }, hint: '秘密查看一名已提交投票玩家的选择。' },
    { name: '学园讲坛', active: false, hint: '自动：研读时展示基础牌并额外摸 1 张。' }
  ],
  avicenna: [
    { name: '医者', active: true, prompt: { target: 'mindBelowMax' }, hint: '令一名玩家恢复 1 点心智。' },
    { name: '自因', active: false, hint: '自动：每局一次，心智归零时弃 2 张牌保留 1 点。' }
  ],
  ghazali: [
    { name: '怀疑之路', active: true, prompt: { mark: 'any' }, hint: '取消场上一枚票数影响标记；若是对手的，摸 1 张。' },
    { name: '确信', active: true, prompt: {}, hint: '每局一次：在投票阶段把自己的票锁定为悬置。' }
  ],
  aquinas: [
    { name: '自然法', active: true, prompt: { target: 'alive' }, hint: '令一名玩家免受一次强制改票。' },
    { name: '经院合题', active: false, hint: '自动：一回合打出两类牌后摸 1 张。' }
  ],
  descartes: [
    { name: '方法怀疑', active: true, prompt: {}, hint: '被锦囊指定时：弃 1 张牌，抵消该锦囊。', interrupt: true },
    { name: '我思', active: false, hint: '自动：打牌后手牌为空时摸 1 张。' }
  ],
  spinoza: [
    { name: '单一实体', active: false, hint: '自动：每议题一次，弃 1 张牌抵消 1 点伤害。' },
    { name: '情感几何', active: false, hint: '自动：论证标记保留到结算后摸 1 张。' }
  ],
  locke: [
    { name: '白板', active: false, hint: '自动：开局额外摸 1 张牌。' },
    { name: '财产权', active: false, hint: '自动：每议题一次，弃 1 张牌保住装备。' }
  ],
  hume: [
    { name: '经验主义', active: false, hint: '自动：牌堆顶与刚打出的牌同类时摸入。' },
    { name: '因果怀疑', active: true, prompt: {}, hint: '被锦囊指定时：取消该锦囊对你的效果。', interrupt: true }
  ],
  kant: [
    { name: '定言令式', active: true, prompt: { trickType: true }, hint: '每局一次：本议题禁止任何人使用某种锦囊。' },
    { name: '自律', active: false, hint: '自动：抵消强制改变你投票的效果。' }
  ],
  marx: [
    { name: '阶级分析', active: true, prompt: { target: 'richest' }, hint: '查看手牌最多者的手牌，并令其弃一件装备。' },
    { name: '联合行动', active: false, hint: '自动：与手牌更少的玩家同立场时，各 +1 票。' }
  ],
  nietzsche: [
    { name: '重估价值', active: false, hint: '打出论证时可勾选：弃置自己一件装备，额外 +2 票。' },
    { name: '强力意志', active: false, hint: '自动：心智不高于 2 时，诘问不能被装备抵挡。' }
  ],
  hegel: [
    { name: '辩证扬弃', active: true, prompt: { mark: 'any' }, hint: '把场上一枚论证标记移到相反立场。' },
    { name: '精神显现', active: false, hint: '自动：命题悬置时摸 2 张弃 1 张。' }
  ],
  arendt: [
    { name: '公共领域', active: true, prompt: {}, hint: '每局一次：投票阶段发起重新投票。' },
    { name: '共同行动', active: false, hint: '自动：至少两名其他玩家与你同立场时 +1 票。' }
  ]
};

function definitionsFor(roleId) {
  const list = DEFINITIONS[roleId];
  if (!list) return [];
  return list.map((skill, index) => ({
    index,
    name: skill.name,
    text: skill.text || '',
    active: !!skill.active,
    hint: skill.hint || '',
    prompt: skill.prompt || {},
    interrupt: !!skill.interrupt,
    perGame: PER_GAME.has(roleId + ':' + index)
  }));
}

function hasUsed(player, roleId, index) {
  return PER_GAME.has(roleId + ':' + index)
    ? !!player.gameUsed[roleId + ':' + index]
    : !!player.skillsUsed[index];
}

function markUsed(player, roleId, index) {
  if (PER_GAME.has(roleId + ':' + index)) player.gameUsed[roleId + ':' + index] = true;
  else player.skillsUsed[index] = true;
}

function pendingTargetsSelf(room, player) {
  const pending = room.pending;
  return !!(pending && pending.targetId === player.id && TRICK_TARGET_KINDS.indexOf(pending.kind) >= 0);
}

function availability(room, player, index) {
  const roleId = player.role ? player.role.id : '';
  const definition = DEFINITIONS[roleId] && DEFINITIONS[roleId][index];
  if (!definition) return { usable: false, reason: '没有这个技能。' };
  if (!definition.active) return { usable: false, reason: '自动生效' };
  if (hasUsed(player, roleId, index)) {
    return { usable: false, reason: PER_GAME.has(roleId + ':' + index) ? '本局已使用' : '本议题已使用' };
  }
  if (!player.alive) return { usable: false, reason: '你已出局' };

  const key = roleId + ':' + index;
  const isInterrupt = INTERRUPT_SKILLS.has(key);
  const isVote = VOTE_SKILLS.has(key);

  if (isInterrupt) {
    if (key === 'mozi:0') {
      if (!room.pending || room.pending.kind !== 'challenge' || room.pending.targetId === player.id) {
        return { usable: false, reason: '需在其他玩家被诘问时使用' };
      }
      if (!player.hand.some(item => item.cardId === 'counterexample')) return { usable: false, reason: '手牌中没有「反例」' };
      return { usable: true, reason: '' };
    }
    if (!pendingTargetsSelf(room, player)) return { usable: false, reason: '需在成为锦囊目标时使用' };
    if (key === 'diogenes:0') {
      if (!player.equipment.offense && !player.equipment.defense) return { usable: false, reason: '没有可弃置的装备' };
    } else if (key !== 'hume:1' && !player.hand.length) {
      return { usable: false, reason: '需要至少 1 张手牌' };
    }
    return { usable: true, reason: '' };
  }

  if (isVote) {
    if (room.phase !== 'vote') return { usable: false, reason: '只能在投票阶段使用' };
    if (key === 'hypatia:0') {
      if (!alive(room).some(other => other.id !== player.id && (other.vote || other.forcedVote || other.smokeVote))) {
        return { usable: false, reason: '还没有其他玩家提交投票' };
      }
    }
    if (key === 'ghazali:1' && player.forcedVote) return { usable: false, reason: '你的投票已经被锁定' };
    return { usable: true, reason: '' };
  }

  if (room.phase !== 'action') return { usable: false, reason: '只能在自己行动时使用' };
  if (room.turnPlayerId !== player.id && !ANYTIME_ACTION.has(key)) return { usable: false, reason: '现在不是你的回合' };
  if (room.pending) return { usable: false, reason: '请先处理当前响应' };

  if (key === 'socrates:0' && !room.marks.some(mark => mark.ownerId !== player.id)) {
    return { usable: false, reason: '没有玩家持有论证标记' };
  }
  if (key === 'zhuangzi:0' && !room.marks.some(mark => mark.ownerId === player.id)) {
    return { usable: false, reason: '你没有论证标记' };
  }
  if (key === 'ghazali:0' || key === 'hegel:0') {
    if (!room.marks.length && !room.chips.length) return { usable: false, reason: '场上没有可取消的标记' };
  }
  if (key === 'plato:0' && room.agendaDeck.slice(room.round, room.round + 2).filter(Boolean).length < 2) {
    return { usable: false, reason: '后面的议题不足两张' };
  }
  if (key === 'epicurus:1' && !player.hand.length) return { usable: false, reason: '需要至少 1 张手牌' };
  if (key === 'marx:0') {
    const richest = richestPlayer(room, player);
    if (!richest || !(richest.equipment.offense || richest.equipment.defense)) {
      return { usable: false, reason: '手牌最多者没有装备' };
    }
  }
  return { usable: true, reason: '' };
}

function richestPlayer(room, player) {
  const others = alive(room).filter(other => other.id !== player.id);
  if (!others.length) return null;
  return others.slice().sort((a, b) => b.hand.length - a.hand.length)[0];
}

function skillList(room, player) {
  const roleId = player.role ? player.role.id : '';
  const roleSkills = (player.role && player.role.skills) || [];
  return definitionsFor(roleId).map(definition => {
    const state = availability(room, player, definition.index);
    const item = Object.assign({}, definition, { usable: state.usable, reason: state.reason });
    if (roleSkills[definition.index] && roleSkills[definition.index].text) {
      item.text = roleSkills[definition.index].text;
    }
    const prompt = definition.prompt || {};
    if (prompt.basicType) item.choices = basics.map(card => ({ label: card.name, value: card.id }));
    if (prompt.trickType) item.choices = tricks.map(card => ({ label: card.name, value: card.id }));
    if (prompt.agendaOrder) {
      item.choices = room.agendaDeck.slice(room.round, room.round + 2)
        .filter(Boolean)
        .map(agenda => ({ label: agenda.name, value: agenda.id }));
    }
    return item;
  });
}

function useSkill(room, player, payload, now) {
  const index = Number(payload.index);
  const roleId = player.role ? player.role.id : '';
  need(roleId, '角色尚未分配。');
  need(index === 0 || index === 1, '技能编号无效。');
  const definition = DEFINITIONS[roleId] && DEFINITIONS[roleId][index];
  need(definition && definition.active, '这个技能不是主动技能。');
  need(!hasUsed(player, roleId, index), '这个技能已经使用过了。');
  const key = roleId + ':' + index;

  // 统一的时机校验，避免客户端绕过 UI 直接调用
  if (INTERRUPT_SKILLS.has(key)) {
    if (key === 'mozi:0') {
      need(room.pending && room.pending.kind === 'challenge' && room.pending.targetId !== player.id, '「兼爱」只能替其他被诘问的玩家使用。');
    } else {
      need(pendingTargetsSelf(room, player), '只能在成为锦囊目标时使用这个技能。');
    }
  } else if (VOTE_SKILLS.has(key)) {
    need(room.phase === 'vote', '只能在投票阶段使用这个技能。');
  } else {
    need(room.phase === 'action', '只能在自己行动时使用这个技能。');
    need(!room.pending, '请先处理当前响应。');
    if (!ANYTIME_ACTION.has(key)) need(room.turnPlayerId === player.id, '现在不是你的回合。');
  }

  switch (key) {
    case 'socrates:0': {
      const target = requireTarget(room, player, payload, 'marked');
      const mark = room.marks.find(item => item.ownerId === target.id);
      need(mark, '目标没有论证标记。');
      const counter = target.hand.findIndex(item => item.cardId === 'counterexample' && item.type === 'basic');
      if (counter >= 0) {
        discardHand(room, target, counter);
        addEvent(room, player.name + '发动「反诘」，' + target.name + '弃置了「反例」。', 'skill');
      } else {
        core.removeMark(room, mark.id);
        addEvent(room, player.name + '发动「反诘」，移除了 ' + target.name + ' 的论证标记。', 'skill');
      }
      break;
    }
    case 'plato:0': {
      const deckPart = room.agendaDeck.slice(room.round, room.round + 2).filter(Boolean);
      need(deckPart.length === 2, '后面的议题不足两张。');
      const chosen = deckPart.find(agenda => agenda.id === payload.agendaId);
      need(chosen, '请选择接下来出现的一张议题。');
      if (chosen.id === deckPart[1].id) {
        const firstIndex = room.agendaDeck.indexOf(deckPart[0]);
        room.agendaDeck[firstIndex] = deckPart[1];
        room.agendaDeck[firstIndex + 1] = deckPart[0];
      }
      addEvent(room, player.name + '发动「理念型」，查看了接下来的议题顺序。', 'skill');
      break;
    }
    case 'plato:1': {
      need(room.phase === 'vote', '「洞穴寓言」只能在投票阶段使用。');
      need(['赞成', '反对', '悬置'].indexOf(payload.stance) >= 0, '请选择要改成的投票。');
      player.vote = payload.stance;
      player.forcedVote = null;
      break;
    }
    case 'aristotle:0': {
      need(room.phase === 'action' && room.turnPlayerId === player.id, '「范畴」只能在自己的行动阶段使用。');
      const first = room.deck.pop();
      const second = room.deck.pop();
      const peeked = [first, second].filter(Boolean);
      need(peeked.length, '牌堆已空。');
      if (peeked.length === 1) {
        player.hand.push(peeked[0]);
        addEvent(room, player.name + '发动「范畴」，获得牌堆最后 1 张牌。', 'skill');
      } else {
        addPending(room, {
          kind: 'choose-card',
          sourceId: player.id,
          targetId: player.id,
          chooserId: player.id,
          cardName: '范畴',
          cards: peeked,
          question: '范畴：选择 1 张加入手牌，另一张放回牌堆底。'
        }, now);
        addEvent(room, player.name + '发动「范畴」，查看牌堆顶两张。', 'skill');
      }
      break;
    }
    case 'confucius:0': {
      const target = requireTarget(room, player, payload, 'aliveOther');
      target.shield += 1;
      addEvent(room, player.name + '发动「仁者」，为 ' + target.name + ' 挡下下一次伤害。', 'skill');
      break;
    }
    case 'laozi:0': {
      need(pendingTargetsSelf(room, player), '「无为」只能在你成为锦囊目标时使用。');
      need(player.hand.length, '需要弃置一张手牌。');
      discardHand(room, player, 0);
      clearPending(room);
      addEvent(room, player.name + '发动「无为」，弃 1 张牌令锦囊无效。', 'skill');
      break;
    }
    case 'zhuangzi:0': {
      const mark = requireMark(room, player, payload, 'own');
      mark.stance = mark.stance === '赞成' ? '反对' : '赞成';
      mark.hidden = false;
      addEvent(room, player.name + '发动「齐物」，把自己的论证改为' + mark.stance + '。', 'skill');
      break;
    }
    case 'mozi:0': {
      const pending = room.pending;
      need(pending && pending.kind === 'challenge' && pending.targetId !== player.id, '「兼爱」只能替其他被诘问的玩家使用。');
      const indexInHand = player.hand.findIndex(item => item.cardId === 'counterexample' && item.type === 'basic');
      need(indexInHand >= 0, '你需要一张「反例」。');
      discardHand(room, player, indexInHand);
      const target = findPlayer(room, pending.targetId);
      clearPending(room);
      addEvent(room, player.name + '发动「兼爱」，替 ' + (target ? target.name : '玩家') + ' 抵消了诘问。', 'skill');
      break;
    }
    case 'xunzi:1': {
      need(room.phase === 'action' && room.turnPlayerId === player.id, '「礼法」只能在自己的行动阶段使用。');
      need(basics.some(card => card.id === payload.cardId), '请选择一种基础牌。');
      room.limitedBasicId = payload.cardId;
      addEvent(room, player.name + '发动「礼法」，本议题内每名玩家至多打出 1 张「' + cardOf({ type: 'basic', cardId: payload.cardId }).name + '」。', 'skill');
      break;
    }
    case 'hanfei:0': {
      const target = requireTarget(room, player, payload, 'equipment');
      const slot = payload.slot === 'defense' ? 'defense' : 'offense';
      need(target.equipment[slot], '目标该装备栏是空的。');
      target.flags['disabled:' + slot] = true;
      addEvent(room, player.name + '发动「法不阿贵」，令 ' + target.name + ' 的「' + cardOf(target.equipment[slot]).name + '」本议题失效。', 'skill');
      break;
    }
    case 'epicurus:1': {
      const target = requireTarget(room, player, payload, 'aliveOther');
      need(player.hand.length, '需要至少 1 张手牌。');
      addPending(room, {
        kind: 'give-card',
        sourceId: player.id,
        targetId: target.id,
        chooserId: player.id,
        cardName: '友谊',
        question: '友谊：选择 1 张手牌交给 ' + target.name + '，双方各摸 1 张。'
      }, now);
      addEvent(room, player.name + '发动「友谊」，与 ' + target.name + ' 分享手牌。', 'skill');
      break;
    }
    case 'diogenes:0': {
      need(pendingTargetsSelf(room, player), '「不持所有」只能在你成为锦囊目标时使用。');
      const slot = payload.slot === 'defense' ? 'defense' : 'offense';
      need(player.equipment[slot], '请选择一件自己的装备弃置。');
      core.pushDiscard(room, player.equipment[slot], '不持所有');
      player.equipment[slot] = null;
      clearPending(room);
      addEvent(room, player.name + '发动「不持所有」，弃置装备令锦囊无效。', 'skill');
      break;
    }
    case 'diogenes:1': {
      const target = requireTarget(room, player, payload, 'moreHand');
      need(target.hand.some(item => item.type === 'basic'), '目标没有基础牌。');
      player.skillNote = target.name + '的手牌：' + target.hand.map(item => cardOf(item).name).join('、');
      player.skillNoteAt = Date.now();
      addEvent(room, target.name + '展示了手牌：' + target.hand.map(item => cardOf(item).name).join('、') + '。', 'reveal');
      addPending(room, {
        kind: 'pick-discard',
        sourceId: player.id,
        targetId: target.id,
        chooserId: player.id,
        cardName: '直言',
        question: '直言：选择 ' + target.name + ' 的一张基础牌弃置。'
      }, now);
      addEvent(room, player.name + '发动「直言」，查看了 ' + target.name + ' 的手牌。', 'skill');
      break;
    }
    case 'hypatia:0': {
      const target = requireTarget(room, player, payload, 'voted');
      const vote = target.forcedVote || target.smokeVote || target.vote;
      player.skillNote = target.name + '的投票是「' + vote + '」。';
      player.skillNoteAt = Date.now();
      break;
    }
    case 'avicenna:0': {
      const target = requireTarget(room, player, payload, 'alive');
      need(target.mind < target.maxMind, '目标心智已满。');
      heal(room, target, 1, '医者');
      addEvent(room, player.name + '发动「医者」，令 ' + target.name + ' 恢复 1 点心智。', 'skill');
      break;
    }
    case 'ghazali:0': {
      const mark = requireMark(room, player, payload, 'any');
      const owner = findPlayer(room, mark.ownerId);
      core.removeMark(room, mark.id);
      if (owner && owner.id !== player.id) draw(room, player, 1);
      addEvent(room, player.name + '发动「怀疑之路」，取消了一枚论证标记。', 'skill');
      break;
    }
    case 'ghazali:1': {
      need(room.phase === 'vote', '「确信」只能在投票阶段使用。');
      player.vote = '悬置';
      player.forcedVote = '悬置';
      break;
    }
    case 'aquinas:0': {
      const target = requireTarget(room, player, payload, 'alive');
      target.voteShield = true;
      addEvent(room, player.name + '发动「自然法」，保护 ' + target.name + ' 免受一次强制改票。', 'skill');
      break;
    }
    case 'descartes:0': {
      need(pendingTargetsSelf(room, player), '「方法怀疑」只能在你成为锦囊目标时使用。');
      need(player.hand.length, '需要弃置一张手牌。');
      discardHand(room, player, 0);
      clearPending(room);
      addEvent(room, player.name + '发动「方法怀疑」，弃 1 张牌抵消锦囊。', 'skill');
      break;
    }
    case 'hume:1': {
      need(pendingTargetsSelf(room, player), '「因果怀疑」只能在你成为锦囊目标时使用。');
      clearPending(room);
      addEvent(room, player.name + '发动「因果怀疑」，取消了刚发生的锦囊效果。', 'skill');
      break;
    }
    case 'kant:0': {
      need(room.phase === 'action' && room.turnPlayerId === player.id, '「定言令式」只能在自己的行动阶段使用。');
      need(tricks.some(card => card.id === payload.cardId), '请选择一种锦囊牌。');
      room.bannedTrickId = payload.cardId;
      addEvent(room, player.name + '发动「定言令式」，本议题禁止使用「' + cardOf({ type: 'trick', cardId: payload.cardId }).name + '」。', 'skill');
      break;
    }
    case 'marx:0': {
      const target = requireTarget(room, player, payload, 'richest');
      const slot = target.equipment.offense ? 'offense' : (target.equipment.defense ? 'defense' : null);
      need(slot, '目标没有装备。');
      player.skillNote = target.name + '的手牌：' + target.hand.map(item => cardOf(item).name).join('、');
      player.skillNoteAt = Date.now();
      discardEquipment(room, target, slot, player);
      addEvent(room, player.name + '发动「阶级分析」，令 ' + target.name + ' 弃置了一件装备。', 'skill');
      break;
    }
    case 'hegel:0': {
      need(room.phase === 'action', '「辩证扬弃」只能在辩论阶段使用。');
      const mark = requireMark(room, player, payload, 'any');
      mark.stance = mark.stance === '赞成' ? '反对' : '赞成';
      mark.hidden = false;
      addEvent(room, player.name + '发动「辩证扬弃」，把一枚论证标记移到' + mark.stance + '。', 'skill');
      break;
    }
    case 'arendt:0': {
      need(room.phase === 'vote', '「公共领域」只能在投票阶段使用。');
      room.revoteRequested = true;
      addEvent(room, player.name + '发动「公共领域」，本轮将重新投票。', 'skill');
      break;
    }
    default:
      fail('这个技能暂时无法使用。');
  }

  markUsed(player, roleId, index);
  return true;
}

function requireTarget(room, player, payload, mode) {
  const target = findPlayer(room, payload.targetId);
  need(target && target.alive, '请选择一名存活玩家。');
  if (mode !== 'alive') need(target.id !== player.id, '不能选择自己。');
  if (mode === 'marked') need(room.marks.some(mark => mark.ownerId === target.id), '目标没有论证标记。');
  if (mode === 'moreHand') need(target.hand.length > player.hand.length, '目标的手牌必须比你多。');
  if (mode === 'mindBelowMax') need(target.mind < target.maxMind, '目标心智已满。');
  if (mode === 'voted') need(target.vote || target.forcedVote || target.smokeVote, '目标还没有投票。');
  if (mode === 'equipment') need(target.equipment.offense || target.equipment.defense, '目标没有装备。');
  if (mode === 'richest') {
    const richest = richestPlayer(room, player);
    need(richest && richest.id === target.id, '请选择手牌最多的玩家。');
    need(richest.equipment.offense || richest.equipment.defense, '目标没有装备。');
  }
  return target;
}

function requireMark(room, player, payload, mode) {
  const mark = room.marks.find(item => item.id === payload.markId);
  need(mark, '请选择一枚论证标记。');
  if (mode === 'own') need(mark.ownerId === player.id, '请选择你自己的一枚论证标记。');
  return mark;
}

module.exports = {
  DEFINITIONS,
  definitionsFor,
  availability,
  skillList,
  useSkill,
  PER_GAME,
  richestPlayer
};

