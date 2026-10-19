const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
require('./cards.js');

const { philosophers, basics, tricks, equipment, agendas, contracts } = globalThis.PlayData;
const ROOT = __dirname;
const PORT = Number(process.env.PHILO_PORT || 4317);
const factionsByCount = {
  4: ['建构派','建构派','怀疑派','游士'],
  5: ['建构派','建构派','建构派','怀疑派','游士'],
  6: ['建构派','建构派','建构派','怀疑派','怀疑派','游士'],
  7: ['建构派','建构派','建构派','建构派','怀疑派','怀疑派','游士'],
  8: ['建构派','建构派','建构派','建构派','怀疑派','怀疑派','怀疑派','游士']
};
let room = null;

const id = () => crypto.randomBytes(8).toString('hex');
const roomCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const shuffle = input => {
  const out = input.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const clone = value => JSON.parse(JSON.stringify(value));
const findPlayer = playerId => room?.players.find(player => player.id === playerId);
const cardCatalog = new Map();
for (const [type, list] of [['basic', basics], ['trick', tricks], ['equipment', equipment]]) {
  for (const card of list) cardCatalog.set(`${type}:${card.id}`, { ...card, type });
}

function addEvent(text, details = {}) {
  if (!room) return;
  room.events.unshift({ id: id(), at: Date.now(), text, ...details });
  room.events = room.events.slice(0, 80);
}

function makeDeck() {
  const cards = [];
  for (const [type, list] of [['basic', basics], ['trick', tricks], ['equipment', equipment]]) {
    for (const card of list) {
      for (let n = 0; n < card.count; n++) cards.push({ instance: id(), type, cardId: card.id });
    }
  }
  return shuffle(cards);
}

function drawCards(player, count) {
  let actual = 0;
  for (let i = 0; i < count; i++) {
    if (!room.deck.length && room.discard.length) room.deck = shuffle(room.discard.splice(0));
    const next = room.deck.pop();
    if (!next) break;
    player.hand.push(next);
    actual++;
  }
  return actual;
}

function cardOf(instance) {
  const item = cardCatalog.get(`${instance.type}:${instance.cardId}`);
  return item ? { ...item, instance: instance.instance } : null;
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    role: player.role ? { id: player.role.id, name: player.role.name, mind: player.role.mind, skills: player.role.skills } : null,
    alive: player.alive,
    mind: player.mind,
    maxMind: player.maxMind,
    faction: !player.alive || room.phase === 'finished' ? player.faction : null,
    contract: room.phase === 'finished' ? player.contract : null,
    equipment: Object.fromEntries(Object.entries(player.equipment).map(([slot, instance]) => [slot, instance ? cardOf(instance) : null])),
    marks: room.marks.filter(mark => mark.ownerId === player.id).map(mark => ({ stance: mark.stance, hidden: !!mark.hidden }))
  };
}

function winnerCheck(final = false) {
  const living = room.players.filter(p => p.alive);
  const skeptics = living.filter(p => p.faction === '怀疑派').length;
  const builders = living.filter(p => p.faction === '建构派').length;
  const threshold = Math.ceil(room.maxRounds / 2);
  const passed = room.results.filter(r => r.result === '通过').length;
  const resisted = room.results.filter(r => r.result === '否决' || r.result === '悬置').length;
  const wins = [];
  if (passed >= threshold || skeptics === 0) wins.push('建构派');
  if (resisted >= threshold || (skeptics > 0 && skeptics >= builders + living.filter(p => p.faction === '游士').length)) wins.push('怀疑派');
  if (final || wins.length) {
    const completed = room.players.filter(p => {
      if (p.faction !== '游士' || !p.contract) return false;
      const aliveContract = p.alive && (
        (p.contract.id === 'contract-guardian' && p.mind >= 2) ||
        (p.contract.id === 'contract-archivist' && p.hand.length >= 3) ||
        (p.contract.id === 'contract-concord' && room.results.length > 0 && (p.concordCount || 0) >= Math.ceil(room.results.length / 2)) ||
        (p.contract.id === 'contract-dissenter' && p.contractComplete) ||
        (p.contract.id === 'contract-witness' && room.results.some(r => r.result === '悬置')) ||
        (p.contract.id === 'contract-rhetor' && p.contractComplete) ||
        (p.contract.id === 'contract-pacifist' && !p.causedDamage) ||
        (p.contract.id === 'contract-curator' && p.everEquipped)
      );
      const deathContract = !p.alive && p.contractComplete && ['contract-martyr','contract-counterproof'].includes(p.contract.id);
      p.contractComplete = !!(aliveContract || deathContract);
      return p.contractComplete;
    });
    for (const player of completed) wins.push(`${player.name}（游士契约）`);
  }
  return [...new Set(wins)];
}

function setGameOver(winners) {
  room.phase = 'finished';
  room.winners = winners;
  room.pending = null;
  addEvent(winners.length ? `本局结束，胜者：${winners.join('、')}` : '本局结束：无人达成胜利条件。');
}

function eliminate(player, cause) {
  if (!player.alive) return;
  player.mind = 0;
  player.alive = false;
  if (player.contract?.id === 'contract-martyr' && player.martyrVote && player.tookDamage) player.contractComplete = true;
  if (player.contract?.id === 'contract-counterproof' && player.counterproofVote && player.tookDamage) player.contractComplete = true;
  room.marks = room.marks.filter(mark => mark.ownerId !== player.id);
  player.vote = null;
  if (room.pending && (room.pending.targetId === player.id || room.pending.nextId === player.id)) room.pending = null;
  addEvent(`${player.name}心智归零，出局；其阵营公开为「${player.faction}」。`, { kind: 'elimination', playerId: player.id, cause });
  const winners = winnerCheck(false);
  if (winners.length) setGameOver(winners);
}

function affectMind(player, amount, cause = '') {
  if (!player?.alive || !amount) return;
  const before = player.mind;
  player.mind = Math.max(0, Math.min(player.maxMind, player.mind + amount));
  const actual = player.mind - before;
  if (!actual) return;
  if (actual < 0) player.tookDamage = true;
  addEvent(`${player.name}${actual > 0 ? '恢复' : '失去'} ${Math.abs(actual)} 点心智${cause ? `（${cause}）` : ''}。`);
  if (player.mind === 0) eliminate(player, cause);
}

function privateView(player) {
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    role: player.role,
    faction: player.faction,
    mind: player.mind,
    maxMind: player.maxMind,
    alive: player.alive,
    hand: player.hand.map(cardOf),
    equipment: Object.fromEntries(Object.entries(player.equipment).map(([slot, instance]) => [slot, instance ? cardOf(instance) : null])),
    contract: player.contract,
    vote: player.vote,
    forcedVote: player.forcedVote,
    nightTarget: player.nightTarget,
    fellowSkeptics: player.faction === '怀疑派' ? room.players.filter(p => p.faction === '怀疑派').map(p => ({ id: p.id, name: p.name })) : [],
    skillsUsed: player.skillsUsed,
    turnCards: player.turnCards || [],
    contractComplete: !!player.contractComplete
  };
}

function makeView(token) {
  if (!room) return { room: null };
  if (token === room.hostToken) {
    return {
      room: { code: room.code, expected: room.expected, phase: room.phase, round: room.round, maxRounds: room.maxRounds, agenda: room.agenda, deckCount: room.deck.length, discardCount: room.discard.length, turnPlayerId: room.turnPlayerId, pending: room.pending, results: room.results, winners: room.winners, marks: room.marks, ballot: room.players.filter(p => p.alive).map(p => ({ id: p.id, name: p.name, vote: p.vote, forcedVote: p.forcedVote, nightTarget: p.nightTarget })) },
      self: { mode: 'host', name: '主持人' },
      players: room.players.map(publicPlayer),
      privatePlayers: room.players.map(privateView),
      events: room.events,
      isHost: true
    };
  }
  const player = room.players.find(p => p.token === token);
  if (!player) return { error: '会话无效，请重新加入房间。' };
  return {
    room: { code: room.code, expected: room.expected, phase: room.phase, round: room.round, maxRounds: room.maxRounds, agenda: room.agenda, deckCount: room.deck.length, discardCount: room.discard.length, turnPlayerId: room.turnPlayerId, pending: room.pending, results: room.results, winners: room.winners, marks: room.marks.map(({ id: markId, ownerId, stance, hidden }) => ({ id: markId, ownerId, stance, hidden })) },
    self: privateView(player),
    players: room.players.map(publicPlayer),
    events: room.events,
    isHost: false
  };
}

function requireRoom() {
  if (!room) throw new Error('当前没有房间。');
}

function auth(req) {
  const token = req.headers['x-session-token'];
  if (!room || !token) throw new Error('请先加入房间。');
  if (token === room.hostToken) return { host: true, token };
  const player = room.players.find(p => p.token === token);
  if (!player) throw new Error('会话无效，请重新加入房间。');
  return { host: false, player, token };
}

function hostOnly(session) {
  if (!session.host) throw new Error('只有主持人可以执行此操作。');
}

function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('请求内容过大。'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('请求格式有误。')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try {
      if (req.method === 'GET' && url.pathname === '/api/info') {
        const addresses = [];
        for (const list of Object.values(os.networkInterfaces())) for (const item of list || []) if (item.family === 'IPv4' && !item.internal) addresses.push(`http://${item.address}:${PORT}`);
        return send(res, 200, { addresses, port: PORT });
      }
      if (req.method === 'POST' && url.pathname === '/api/create') {
        if (room && room.phase !== 'finished') throw new Error('已有一局正在进行，请先结束本局。');
        const data = await body(req);
        const expected = Number(data.expected);
        if (!Number.isInteger(expected) || expected < 4 || expected > 8) throw new Error('玩家人数须为 4—8 人。');
        const token = id() + id();
        room = { code: roomCode(), hostToken: token, expected, players: [], phase: 'lobby', round: 0, maxRounds: 0, agenda: null, deck: [], discard: [], agendaDeck: [], marks: [], events: [], results: [], pending: null, turnPlayerId: null, winners: [] };
        return send(res, 200, { token, code: room.code });
      }
      if (req.method === 'POST' && url.pathname === '/api/join') {
        requireRoom();
        const data = await body(req);
        if (String(data.code || '').trim().toUpperCase() !== room.code) throw new Error('房间号不正确。');
        if (room.phase !== 'lobby') throw new Error('本局已经开始，暂时不能加入。');
        const name = String(data.name || '').trim().slice(0, 16);
        if (!name) throw new Error('请先填写玩家昵称。');
        if (room.players.length >= room.expected) throw new Error('房间人数已满。');
        if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error('这个昵称已经被使用。');
        const token = id() + id();
        room.players.push({ id: id(), token, name, role: null, faction: null, contract: null, mind: 0, maxMind: 0, alive: true, hand: [], equipment: { offense: null, defense: null }, vote: null, nightTarget: null, skillsUsed: {}, turnCards: [], contractComplete: false, tookDamage: false });
        addEvent(`${name}加入房间。`);
        return send(res, 200, { token, code: room.code });
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const view = makeView(req.headers['x-session-token']);
        return send(res, view.error ? 401 : 200, view);
      }
      const session = auth(req);
      if (req.method !== 'POST') return send(res, 405, { error: '不支持此请求。' });
      const data = await body(req);

      if (url.pathname === '/api/start') {
        hostOnly(session);
        if (room.phase !== 'lobby' || room.players.length !== room.expected) throw new Error('所有玩家加入后才能开始。');
        const roles = shuffle(philosophers);
        const factions = shuffle(factionsByCount[room.expected]);
        const contract = shuffle(contracts)[0];
        room.players.forEach((player, index) => {
          player.role = clone(roles[index]);
          player.maxMind = player.role.mind;
          player.mind = player.maxMind;
          player.faction = factions[index];
          player.alive = true;
          player.vote = null;
          player.nightTarget = null;
          player.skillsUsed = {};
          player.turnCards = [];
          if (player.faction === '游士') player.contract = clone(contract);
        });
        room.maxRounds = room.expected <= 5 ? 3 : 5;
        room.agendaDeck = shuffle(agendas).slice(0, room.maxRounds);
        room.deck = makeDeck();
        room.discard = [];
        room.marks = [];
        room.results = [];
        room.round = 1;
        room.agenda = room.agendaDeck[0];
        room.phase = 'night';
        room.players.forEach(player => drawCards(player, 4));
        addEvent(`第 1 轮开始，公开议题：「${room.agenda.name}」。`);
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/night') {
        if (session.host || !session.player.alive || room.phase !== 'night') throw new Error('当前不能提交夜间行动。');
        const player = session.player;
        if (player.faction !== '怀疑派') throw new Error('只有怀疑派需要提交秘密目标。');
        const target = findPlayer(data.targetId);
        if (!target?.alive || target.id === player.id || target.faction === '怀疑派') throw new Error('请选择一名存活的非怀疑派玩家。');
        player.nightTarget = target.id;
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/resolve-night') {
        hostOnly(session);
        if (room.phase !== 'night') throw new Error('现在不是夜间阶段。');
        const submitted = room.players.filter(p => p.alive && p.faction === '怀疑派' && p.nightTarget);
        let targetId = data.targetId;
        if (!targetId && submitted.length) {
          const counts = new Map();
          submitted.forEach(p => counts.set(p.nightTarget, (counts.get(p.nightTarget) || 0) + 1));
          const max = Math.max(...counts.values());
          const leaders = [...counts].filter(([, count]) => count === max).map(([key]) => key);
          if (leaders.length === 1) targetId = leaders[0];
        }
        if (targetId) {
          const target = findPlayer(targetId);
          if (!target?.alive || target.faction === '怀疑派') throw new Error('夜间目标无效。');
          addEvent(`夜间行动指向 ${target.name}。`, { kind: 'night' });
          room.players.filter(p => p.alive && p.faction === '怀疑派').forEach(p => { p.causedDamage = true; });
          affectMind(target, -1, '夜间行动');
        } else addEvent('怀疑派目标未能达成一致，本轮无人受到夜间伤害。');
        room.players.forEach(p => { p.nightTarget = null; });
        if (room.phase !== 'finished') {
          room.phase = 'debate';
          const first = room.players.find(p => p.alive);
          room.turnPlayerId = first?.id || null;
          room.players.forEach(p => { p.turnCards = []; });
          addEvent(`进入辩论阶段，${first?.name || '无人'}先行动。`);
        }
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/play') {
        if (session.host || room.phase !== 'debate' || !session.player.alive || room.pending) throw new Error('当前不能出牌。');
        const player = session.player;
        if (room.turnPlayerId !== player.id) throw new Error('还没有轮到你行动。');
        const cardIndex = player.hand.findIndex(c => c.instance === data.instance);
        if (cardIndex < 0) throw new Error('这张牌不在你的手牌中。');
        const instance = player.hand[cardIndex];
        const card = cardOf(instance);
        if (!card) throw new Error('找不到这张牌。');
        const target = data.targetId ? findPlayer(data.targetId) : null;
        if (target && (!target.alive || target.id === player.id)) throw new Error('目标必须是其他存活玩家。');
        if (card.id === 'argument') {
          if (!['赞成','反对'].includes(data.stance)) throw new Error('论证需要选择赞成或反对。');
          if (room.marks.filter(m => m.ownerId === player.id).length >= 2) throw new Error('你本议题已经有两枚论证标记。');
        }
        if (['challenge','debate','reductio','razor','scrutiny','chain'].includes(card.id) && !target) throw new Error('请先选择目标玩家。');
        player.hand.splice(cardIndex, 1);
        room.discard.push(instance);
        player.turnCards.push(card.id);
        let note = '';
        if (card.id === 'argument') {
          room.marks.push({ id: id(), ownerId: player.id, stance: data.stance, hidden: false });
          note = `，增加 1 枚${data.stance}论证标记`;
        } else if (card.id === 'breathe') {
          affectMind(player, 1, '调息');
          note = '，恢复 1 点心智';
        } else if (card.id === 'challenge') {
          room.pending = { kind: 'challenge', sourceId: player.id, targetId: target.id, cardName: card.name };
          note = `，等待 ${target.name} 回应`;
        } else if (card.id === 'debate') {
          room.pending = { kind: 'debate', sourceId: player.id, targetId: target.id, nextId: player.id, cardName: card.name, plays: 0 };
          note = `，对决由 ${player.name} 先出论证或反例`;
        } else if (card.type === 'equipment') {
          const slot = card.kind === '进攻' ? 'offense' : 'defense';
          const old = player.equipment[slot];
          if (old) room.discard.push(old);
          player.equipment[slot] = instance;
          player.everEquipped = true;
          note = `，装备到${card.kind}栏`;
        } else {
          note = '；其余效果按卡面文字由主持人协助结算';
        }
        addEvent(`${player.name}打出「${card.name}」${target ? `，目标：${target.name}` : ''}${data.stance ? `，立场：${data.stance}` : ''}${note}。`, { kind: 'play', playerId: player.id, cardName: card.name, targetId: target?.id || null });
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/challenge-answer') {
        if (session.host || room.pending?.kind !== 'challenge' || room.pending.targetId !== session.player.id) throw new Error('这次诘问不是对你发起的。');
        const player = session.player;
        if (data.block) {
          const idx = player.hand.findIndex(c => c.cardId === 'counterexample' && c.type === 'basic');
          if (idx < 0) throw new Error('你没有「反例」可以响应。');
          room.discard.push(player.hand.splice(idx, 1)[0]);
          addEvent(`${player.name}打出「反例」，抵消了诘问。`, { kind: 'response', playerId: player.id, cardName: '反例' });
        } else {
          player.forcedVote = '悬置';
          const attacker = findPlayer(room.pending.sourceId);
          if (attacker) attacker.causedDamage = true;
          affectMind(player, -1, '诘问');
          addEvent(`${player.name}未能反驳诘问，本议题投票立场锁定为悬置。`);
        }
        room.pending = null;
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/debate-answer') {
        if (session.host || room.pending?.kind !== 'debate') throw new Error('当前没有进行中的辩论。');
        const player = session.player;
        if (room.pending.nextId !== player.id || !player.alive) throw new Error('现在不是你回应辩论。');
        if (data.fold) {
          player.forcedVote = '悬置';
          const attackerId = player.id === room.pending.sourceId ? room.pending.targetId : room.pending.sourceId;
          const attacker = findPlayer(attackerId);
          if (attacker) attacker.causedDamage = true;
          affectMind(player, -1, '辩论落败');
          addEvent(`${player.name}无法继续辩论，失去 1 点心智，投票立场锁定为悬置。`);
          room.pending = null;
        } else {
          const wanted = String(data.cardId || '');
          if (!['argument','counterexample'].includes(wanted)) throw new Error('辩论只能打出「论证」或「反例」。');
          const idx = player.hand.findIndex(c => c.cardId === wanted && c.type === 'basic');
          if (idx < 0) throw new Error('你没有所选的牌。');
          const [used] = player.hand.splice(idx, 1);
          room.discard.push(used);
          room.pending.plays++;
          room.pending.nextId = player.id === room.pending.sourceId ? room.pending.targetId : room.pending.sourceId;
          addEvent(`${player.name}以「${cardCatalog.get(`basic:${wanted}`).name}」回应辩论。`, { kind: 'response', playerId: player.id, cardName: cardCatalog.get(`basic:${wanted}`).name });
        }
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/finish-turn') {
        if (session.host || room.phase !== 'debate' || room.turnPlayerId !== session.player.id || room.pending) throw new Error('当前不能结束行动。');
        const player = session.player;
        player.turnCards = player.turnCards || [];
        if (player.faction === '游士' && player.contract?.id === 'contract-rhetor' && new Set(player.turnCards).size >= 2) player.contractComplete = true;
        let nextIndex = room.players.findIndex(p => p.id === player.id);
        let next = null;
        for (let step = 1; step < room.players.length; step++) {
          const candidate = room.players[(nextIndex + step) % room.players.length];
          if (candidate.alive) { next = candidate; break; }
        }
        if (!next || next.id === player.id) {
          room.phase = 'vote';
          room.turnPlayerId = null;
          room.players.filter(p => p.alive).forEach(p => { p.vote = null; });
          addEvent('所有存活玩家已行动，进入秘密投票。');
        } else {
          room.turnPlayerId = next.id;
          next.turnCards = [];
          addEvent(`${player.name}结束行动，轮到 ${next.name}。`);
        }
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/vote') {
        if (session.host || room.phase !== 'vote' || !session.player.alive) throw new Error('当前不能投票。');
        if (!['赞成','反对','悬置'].includes(data.vote)) throw new Error('请选择一种投票立场。');
        if (session.player.forcedVote) session.player.vote = session.player.forcedVote;
        else session.player.vote = data.vote;
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/resolve-vote') {
        hostOnly(session);
        if (room.phase !== 'vote') throw new Error('现在不是投票阶段。');
        const tally = { 赞成: 0, 反对: 0, 悬置: 0 };
        const privateVotes = new Map();
        room.players.filter(p => p.alive).forEach(p => {
          const vote = p.vote || p.forcedVote || '悬置';
          privateVotes.set(p.id, vote);
          tally[vote]++;
        });
        room.marks.filter(m => !m.hidden).forEach(m => { tally[m.stance]++; });
        const living = room.players.filter(p => p.alive).length;
        const threshold = room.agenda?.id === 'agenda-majority' ? Math.ceil(living * 2 / 3) : Math.floor(living / 2) + 1;
        let result = tally['赞成'] >= threshold ? '通过' : tally['反对'] >= threshold ? '否决' : '悬置';
        if (room.agenda?.id === 'agenda-minority' && Math.abs(tally['赞成'] - tally['反对']) === 1) result = '悬置';
        room.results.push({ round: room.round, agenda: room.agenda?.name, tally, result });
        addEvent(`第 ${room.round} 轮表决：赞成 ${tally['赞成']}、反对 ${tally['反对']}、悬置 ${tally['悬置']}；结果：${result}。`, { kind: 'vote-result', tally, result });
        room.players.forEach(p => {
          const personalVote = privateVotes.get(p.id);
          p.vote = null;
          p.forcedVote = null;
          if (p.faction === '游士' && p.contract?.id === 'contract-witness' && result === '悬置') p.contractComplete = true;
          if (p.faction === '游士' && p.contract?.id === 'contract-concord' && ((result === '通过' && personalVote === '赞成') || (result === '否决' && personalVote === '反对'))) p.concordCount = (p.concordCount || 0) + 1;
          if (p.faction === '游士' && p.contract?.id === 'contract-dissenter' && ((result === '通过' && personalVote === '反对') || (result === '否决' && personalVote === '赞成'))) p.contractComplete = true;
          if (p.faction === '游士' && p.contract?.id === 'contract-martyr' && ((result === '通过' && personalVote === '赞成') || (result === '否决' && personalVote === '反对'))) p.martyrVote = true;
          if (p.faction === '游士' && p.contract?.id === 'contract-counterproof' && result === '悬置' && personalVote === '悬置') p.counterproofVote = true;
        });
        // Record private votes for contract resolution before clearing them.
        const winners = winnerCheck(false);
        if (winners.length) setGameOver(winners);
        else room.phase = 'result';
        room.marks = [];
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/next-round') {
        hostOnly(session);
        if (room.phase !== 'result') throw new Error('本轮尚未结算。');
        if (room.round >= room.maxRounds) {
          room.players.forEach(p => {
            if (p.faction !== '游士' || !p.contract) return;
            if (p.contract.id === 'contract-guardian') p.contractComplete ||= p.alive && p.mind >= 2;
            if (p.contract.id === 'contract-archivist') p.contractComplete ||= p.alive && p.hand.length >= 3;
            if (p.contract.id === 'contract-concord') p.contractComplete ||= p.alive && (p.concordCount || 0) >= Math.ceil(room.results.length / 2);
            if (p.contract.id === 'contract-dissenter' && p.alive) p.contractComplete ||= false;
            if (p.contract.id === 'contract-pacifist') p.contractComplete ||= p.alive && !p.causedDamage;
            if (p.contract.id === 'contract-curator') p.contractComplete ||= p.alive && p.everEquipped;
            if (p.contract.id === 'contract-martyr') p.contractComplete ||= !p.alive && p.martyrVote && p.tookDamage;
            if (p.contract.id === 'contract-counterproof') p.contractComplete ||= !p.alive && p.counterproofVote && p.tookDamage;
          });
          const winners = winnerCheck(true);
          setGameOver(winners);
          return send(res, 200, { ok: true });
        }
        room.round++;
        room.agenda = room.agendaDeck[room.round - 1];
        room.marks = [];
        room.players.forEach(p => {
          p.vote = null;
          p.forcedVote = null;
          p.nightTarget = null;
          p.turnCards = [];
          p.skillsUsed = {};
          if (p.alive) drawCards(p, room.expected <= 5 ? 1 : 2);
        });
        room.phase = 'night';
        room.pending = null;
        addEvent(`第 ${room.round} 轮开始，公开议题：「${room.agenda.name}」。`);
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/host/advance') {
        hostOnly(session);
        if (room.phase !== 'debate') throw new Error('只能在辩论阶段提前进入投票。');
        room.pending = null;
        room.phase = 'vote';
        room.turnPlayerId = null;
        room.players.filter(p => p.alive).forEach(p => { p.vote = null; });
        addEvent('主持人结束辩论阶段，进入秘密投票。');
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/host/mind') {
        hostOnly(session);
        const player = findPlayer(data.playerId);
        if (!player?.alive) throw new Error('玩家不在场或已出局。');
        const amount = Number(data.amount);
        if (![-1,1].includes(amount)) throw new Error('只能调整 1 点心智。');
        affectMind(player, amount, '主持人调整');
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/host/draw') {
        hostOnly(session);
        const player = findPlayer(data.playerId);
        if (!player?.alive) throw new Error('玩家不在场或已出局。');
        const amount = Math.max(1, Math.min(3, Number(data.amount) || 1));
        const actual = drawCards(player, amount);
        addEvent(`主持人令 ${player.name} 摸 ${actual} 张牌。`);
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/host/discard') {
        hostOnly(session);
        const player = findPlayer(data.playerId);
        if (!player?.alive) throw new Error('玩家不在场或已出局。');
        const index = player.hand.findIndex(card => card.instance === data.instance);
        if (index < 0) throw new Error('没有找到所选手牌。');
        const card = cardOf(player.hand[index]);
        room.discard.push(player.hand.splice(index, 1)[0]);
        addEvent(`主持人协助 ${player.name} 弃置一张手牌。`);
        return send(res, 200, { ok: true, cardName: card.name });
      }

      if (url.pathname === '/api/host/unequip') {
        hostOnly(session);
        const player = findPlayer(data.playerId);
        if (!player?.alive || !['offense','defense'].includes(data.slot)) throw new Error('装备栏无效。');
        const instance = player.equipment[data.slot];
        if (!instance) throw new Error('该装备栏目前为空。');
        const card = cardOf(instance);
        room.discard.push(instance);
        player.equipment[data.slot] = null;
        addEvent(`主持人将 ${player.name} 装备的「${card.name}」弃置。`);
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/host/mark') {
        hostOnly(session);
        const mark = room.marks.find(item => item.id === data.markId);
        if (!mark || !['remove','flip'].includes(data.operation)) throw new Error('论证标记不存在或操作无效。');
        const owner = findPlayer(mark.ownerId);
        if (data.operation === 'remove') {
          room.marks = room.marks.filter(item => item.id !== mark.id);
          addEvent(`主持人移除了 ${owner?.name || '一名玩家'} 的${mark.stance}论证标记。`);
        } else {
          mark.stance = mark.stance === '赞成' ? '反对' : '赞成';
          addEvent(`主持人将 ${owner?.name || '一名玩家'} 的论证标记改为${mark.stance}。`);
        }
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/host/vote') {
        hostOnly(session);
        if (room.phase !== 'vote') throw new Error('现在不是投票阶段。');
        const player = findPlayer(data.playerId);
        if (!player?.alive || !['赞成','反对','悬置'].includes(data.vote)) throw new Error('玩家或投票选项无效。');
        player.vote = data.vote;
        player.forcedVote = null;
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/host/eliminate') {
        hostOnly(session);
        const player = findPlayer(data.playerId);
        if (!player?.alive) throw new Error('玩家不在场或已出局。');
        eliminate(player, '主持人结算');
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/host/finish') {
        hostOnly(session);
        if (room.phase === 'finished') throw new Error('本局已经结束。');
        const winners = (Array.isArray(data.winners) ? data.winners : []).filter(Boolean).slice(0, 8);
        setGameOver(winners);
        return send(res, 200, { ok: true });
      }

      return send(res, 404, { error: '没有这个操作。' });
    } catch (error) {
      return send(res, 400, { error: error.message || '操作失败。' });
    }
  }

  const safePath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.resolve(ROOT, `.${safePath}`);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    res.writeHead(403); return res.end('Forbidden');
  }
  const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml' }[path.extname(filePath)] || 'application/octet-stream';
  fs.readFile(filePath, (error, data) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

http.createServer(handle).listen(PORT, '0.0.0.0', () => {
  console.log(`哲学对战游玩版已启动： http://localhost:${PORT}`);
  if (process.platform === 'win32') {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process 'http://localhost:${PORT}'`], { windowsHide: true, stdio: 'ignore' }, () => {});
  }
  for (const list of Object.values(os.networkInterfaces())) for (const item of list || []) if (item.family === 'IPv4' && !item.internal) console.log(`局域网入口： http://${item.address}:${PORT}`);
  console.log('同一 Wi-Fi 下的玩家使用局域网入口。按 Ctrl+C 结束服务。');
});
