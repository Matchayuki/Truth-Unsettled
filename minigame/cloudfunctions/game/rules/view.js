/**
 * 玩家视角：把房间状态裁剪成每个玩家应看到的内容。
 * 原则：角色公开、阵营保密、手牌与票向保密、契约保密。
 */
const core = require('./core.js');
const { cardOf, cardById } = require('./catalog.js');
const skills = require('./skills.js');
const play = require('./play.js');

const { rules, equipmentIs } = core;

function cardView(item) {
  const def = cardOf(item);
  if (!def) return null;
  return Object.assign({}, def, {
    requires: {
      target: def.target === 'other',
      stance: !!def.stance,
      mark: def.id === 'counterexample',
      slot: def.type !== 'equipment' && !!def.slot,
      reveal: !!def.reveal,
      prediction: !!def.prediction,
      responseOnly: !!def.responseOnly
    }
  });
}

function equipmentView(player) {
  return {
    offense: player.equipment.offense ? cardView(player.equipment.offense) : null,
    defense: player.equipment.defense ? cardView(player.equipment.defense) : null,
    offenseDisabled: !!player.flags['disabled:offense'],
    defenseDisabled: !!player.flags['disabled:defense']
  };
}

function marksOf(room, playerId) {
  return room.marks.filter(mark => mark.ownerId === playerId).map(mark => ({
    id: mark.id,
    ownerId: mark.ownerId,
    stance: mark.hidden ? null : mark.stance,
    hidden: !!mark.hidden,
    protected: !!mark.protected
  }));
}

function publicPlayer(room, player) {
  const revealed = !player.alive || room.phase === 'finished';
  return {
    id: player.id,
    seat: player.seat,
    name: player.name,
    isBot: !!player.isBot,
    alive: player.alive,
    mind: player.mind,
    maxMind: player.maxMind,
    role: player.role ? {
      id: player.role.id,
      name: player.role.name,
      latin: player.role.latin,
      era: player.role.era,
      school: player.role.school,
      hue: player.role.hue,
      insight: player.role.insight,
      mind: player.role.mind,
      skills: player.role.skills
    } : null,
    faction: revealed ? player.faction : null,
    contract: room.phase === 'finished' ? player.contract : null,
    handCount: player.hand.length,
    equipment: equipmentView(player),
    marks: marksOf(room, player.id),
    voteSubmitted: !!(player.vote || player.forcedVote || player.smokeVote),
    voteLocked: !!player.voteLocked,
    turnDone: !!player.turnDone,
    contractComplete: room.phase === 'finished' ? !!player.contractComplete : false
  };
}

function privateSelf(room, player) {
  const prompt = play.promptFor(room, player);
  return {
    id: player.id,
    seat: player.seat,
    name: player.name,
    role: player.role,
    faction: player.faction,
    contract: player.contract,
    mind: player.mind,
    maxMind: player.maxMind,
    alive: player.alive,
    hand: player.hand.map(cardView).filter(Boolean),
    equipment: equipmentView(player),
    vote: player.vote,
    forcedVote: player.forcedVote,
    smokeVote: player.smokeVote,
    voteLocked: !!player.voteLocked,
    nightSubmitted: !!player.nightTarget,
    ostracizeSubmitted: !!(room.ostracismChoices && room.ostracismChoices[player.id]),
    canOstracize: room.phase === 'ostracism' && player.alive && !(room.ostracismChoices && room.ostracismChoices[player.id]),
    turnCards: player.turnCards.slice(),
    contractComplete: !!player.contractComplete,
    fellows: player.faction === '怀疑派'
      ? room.players.filter(other => other.faction === '怀疑派').map(other => ({ id: other.id, name: other.name, alive: other.alive }))
      : [],
    skills: skills.skillList(room, player),
    prompt,
    skillNote: player.skillNote || '',
    skillNoteAt: player.skillNoteAt || 0,
    canAct: room.phase === 'action' && room.turnPlayerId === player.id && player.alive && !room.pending,
    canEndTurn: room.phase === 'action' && room.turnPlayerId === player.id && player.alive && !room.pending,
    canVote: room.phase === 'vote' && player.alive && !player.forcedVote && !player.smokeVote,
    canStartNext: room.phase === 'result',
    tasbihReady: equipmentIs(player, 'defense', 'tasbih') && !player.flags.tasbih,
    objectionAvailable: !!(room.agenda && room.agenda.id === 'agenda-objection' &&
      room.phase === 'vote' && !player.flags.objection && player.hand.length && !player.forcedVote && !player.smokeVote)
  };
}

function publicPending(room) {
  const pending = room.pending;
  if (!pending) return null;
  return {
    id: pending.id,
    kind: pending.kind,
    cardName: pending.cardName || '',
    question: pending.question || '',
    sourceId: pending.sourceId,
    targetId: pending.targetId,
    chooserId: pending.chooserId,
    deadline: pending.deadline
  };
}

function deadlineFor(room) {
  switch (room.phase) {
    case 'night': return room.nightDeadline;
    case 'action': return room.turnStartedAt ? room.turnStartedAt + rules.timers.turn * 1000 : 0;
    case 'vote': return room.voteDeadline;
    case 'ostracism': return room.ostracismDeadline;
    case 'result': return room.nextAt;
    default: return 0;
  }
}

function roomView(room, now) {
  return {
    code: room.code,
    expected: room.expected,
    phase: room.phase,
    round: room.round,
    maxRounds: room.maxRounds,
    agenda: room.agenda,
    deckCount: room.deck.length,
    discardCount: room.discard.length,
    turnPlayerId: room.turnPlayerId,
    pending: publicPending(room),
    results: room.results,
    winners: room.winners,
    marks: room.marks.map(mark => ({
      id: mark.id,
      ownerId: mark.ownerId,
      stance: mark.hidden ? null : mark.stance,
      hidden: !!mark.hidden,
      protected: !!mark.protected
    })),
    chips: room.chips.map(chip => ({ id: chip.id, ownerId: chip.ownerId, stance: chip.stance, amount: chip.amount, source: chip.source })),
    chorus: room.chorus ? { ownerId: room.chorus.ownerId, stance: room.chorus.stance } : null,
    limitedBasicId: room.limitedBasicId,
    bannedTrickId: room.bannedTrickId,
    limitedBasicName: room.limitedBasicId ? (cardById('basic', room.limitedBasicId) || {}).name || '' : '',
    bannedTrickName: room.bannedTrickId ? (cardById('trick', room.bannedTrickId) || {}).name || '' : '',
    lastTally: room.lastTally,
    deadlines: {
      pending: room.pending ? room.pending.deadline : 0,
      phase: deadlineFor(room)
    },
    submittedCount: core.submittedCount(room),
    ostracismSubmitted: Object.keys(room.ostracismChoices || {}).length,
    ostracismTotal: room.players.filter(player => player.alive).length,
    ostracismResult: room.ostracismResult,
    updatedAt: room.updatedAt || 0,
    serverNow: now
  };
}

function makeView(room, player, now) {
  return {
    ok: true,
    room: roomView(room, now),
    self: player ? privateSelf(room, player) : null,
    players: room.players.map(other => publicPlayer(room, other)),
    events: room.events
  };
}

module.exports = {
  makeView,
  cardView,
  publicPlayer,
  privateSelf
};

