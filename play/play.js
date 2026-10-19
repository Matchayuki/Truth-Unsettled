(() => {
  const app = document.querySelector('#app');
  const DATA = window.PlayData;
  const staticPreview = location.hostname.endsWith('.github.io');
  const phaseNames = { lobby:'等待玩家', night:'夜间行动', debate:'辩论行动', vote:'秘密投票', result:'本轮结算', finished:'本局结束' };
  const phaseSteps = ['night','debate','vote','result'];
  const targeted = new Set(['challenge','debate','reductio','razor','scrutiny','chain']);
  let token = sessionStorage.getItem('philo-play-token');
  let state = null;
  let lastSnapshot = '';
  let selectedCard = null;
  let hostTab = 'flow';
  let toastTimer;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const playerName = id => state?.players.find(player => player.id === id)?.name || '玩家';
  const cardDef = (type, cardId) => {
    const list = type === 'basic' ? DATA.basics : type === 'trick' ? DATA.tricks : DATA.equipment;
    return list.find(card => card.id === cardId);
  };
  const factionClass = faction => faction === '建构派' ? 'builder' : faction === '怀疑派' ? 'skeptic' : faction === '游士' ? 'wanderer' : 'hidden';
  const factionTag = faction => `<span class="faction-tag ${factionClass(faction)}">${esc(faction || '身份未知')}</span>`;
  const markText = stance => stance === '赞成' ? '赞成' : stance === '反对' ? '反对' : stance;
  const timeText = stamp => new Date(stamp).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});

  function notify(text) {
    const el = document.querySelector('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function api(path, data) {
    let response;
    try {
      response = await fetch(path, {
        method: data === undefined ? 'GET' : 'POST',
        headers: { ...(token ? { 'x-session-token': token } : {}), ...(data === undefined ? {} : { 'Content-Type':'application/json' }) },
        body: data === undefined ? undefined : JSON.stringify(data),
        cache: 'no-store'
      });
    } catch {
      throw new Error(staticPreview ? '这是 GitHub Pages 静态预览页。GitHub Pages 不运行牌局服务；要创建房间，需要另行部署 play/server.js 并配置页面连接。' : '连接不到牌局服务。请在主持人电脑双击 start-lan.cmd 启动服务，并保持窗口开启；不要直接打开 index.html。');
    }
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.error || '操作失败。'); error.status = response.status; throw error; }
    return result;
  }

  function setToken(value) {
    token = value;
    sessionStorage.setItem('philo-play-token', value);
    lastSnapshot = '';
  }

  function clearSession() {
    sessionStorage.removeItem('philo-play-token');
    token = null; state = null; lastSnapshot = ''; selectedCard = null;
    renderLanding();
  }

  function setConnection(mode, text) {
    const node = document.querySelector('#connection-status');
    node.className = `connection ${mode}`;
    node.querySelector('span').textContent = text;
  }

  function renderLanding(message = '') {
    if (location.protocol === 'file:') {
      setConnection('offline','尚未启动服务');
      app.innerHTML = `
        <section class="landing">
          <div class="landing-head">
            <div class="eyebrow">需要先启动牌局服务</div>
            <h1 class="display-title">这不是可直接打开的网页文件</h1>
            <p class="subhead">创建房间需要一台设备运行牌局服务，其他玩家再通过同一 Wi-Fi 连接。</p>
          </div>
          <div class="entry-card">
            <h2>主持人这样开始</h2>
            <ol><li>打开本文件所在的 <strong>play</strong> 文件夹。</li><li>双击 <strong>start-lan.cmd</strong>，并保持弹出的黑色窗口开启。</li><li>在自动打开的网页中创建房间；如果没有自动打开，请访问 <strong>http://localhost:4317</strong>。</li></ol>
            <p class="small-copy">玩家使用主持人页面显示的局域网地址加入。请不要直接双击 index.html。</p>
          </div>
        </section>`;
      return;
    }
    if (!staticPreview) api('/api/info').then(info => {
      window.serverInfo = info;
      const node = document.querySelector('#lan-addresses');
      if (node && info.addresses?.length) node.innerHTML = info.addresses.map(address=>`<div><strong>${esc(address)}</strong></div>`).join('');
    }).catch(() => {});
    app.innerHTML = `
      <section class="landing">
        <div class="landing-head">
          <div class="eyebrow">局域网对战 · 4—8 名玩家</div>
          <h1 class="display-title">把观点带上桌</h1>
          <p class="subhead">主持人创建房间，玩家各自加入。身份、手牌和投票按个人视角显示；出牌与结算记录同步给全桌。</p>
        </div>
        ${staticPreview ? '<div class="note" style="margin-bottom:16px">GitHub Pages 静态预览：页面可公开浏览，但开房联机需要另行部署 Node 牌局服务。</div>' : ''}
        ${message ? `<div class="note" style="margin-bottom:16px">${esc(message)}</div>` : ''}
        <div class="entry-grid">
          <form class="entry-card" id="host-form">
            <div class="eyebrow">01 · 主持人</div><h2>创建一局</h2>
            <p>主持人不参与阵营和胜负，负责夜间、争议牌面及议题效果的裁定。</p>
            <div class="field"><label for="player-count">玩家人数</label><select id="player-count" name="expected"><option value="4">4 人</option><option value="5">5 人</option><option value="6">6 人</option><option value="7">7 人</option><option value="8">8 人</option></select></div>
            <button class="button full" type="submit" ${staticPreview?'disabled':''}>${staticPreview?'需要部署后端后开房':'创建房间'}</button>
          </form>
          <form class="entry-card" id="join-form">
            <div class="eyebrow">02 · 玩家</div><h2>加入一局</h2>
            <p>输入主持人分享的房间号和你的桌上昵称。</p>
            <div class="field"><label for="room-code">房间号</label><input id="room-code" name="code" maxlength="6" autocomplete="off" placeholder="例如：A3F91C" required></div>
            <div class="field"><label for="player-name">桌上昵称</label><input id="player-name" name="name" maxlength="16" autocomplete="nickname" placeholder="输入昵称" required></div>
            <button class="button full" type="submit" ${staticPreview?'disabled':''}>${staticPreview?'需要部署后端后加入':'加入房间'}</button>
          </form>
        </div>
        <div class="note" style="margin-top:18px"><strong>开局方式：</strong>先在主持人设备创建房间，再让玩家连接同一 Wi-Fi 并输入房间号。每位玩家使用自己的设备或浏览器页面。该游玩版独立于介绍页。</div>
      </section>`;
  }

  function renderSeats() {
    const room = state.room;
    const rows = state.players.map((player,index) => `<div class="seat"><span class="seat-number">${index+1}</span><span class="seat-name">${esc(player.name)}</span><span class="seat-status">已加入</span></div>`).join('');
    const empty = Array.from({length:Math.max(0,room.expected-state.players.length)},(_,i) => `<div class="seat"><span class="seat-number">${state.players.length+i+1}</span><span class="seat-name muted">等待加入</span><span class="seat-status muted">空位</span></div>`).join('');
    return `<div class="seat-list">${rows}${empty}</div>`;
  }

  function playerRow(player, isSelf = false) {
    const dots = Array.from({length:player.maxMind || player.role?.mind || 4},(_,i) => `<i class="mind-dot ${i < player.mind ? 'full' : ''}"></i>`).join('');
    const dead = !player.alive;
    const faction = state.isHost ? (player.faction || '') : (dead ? player.faction : (isSelf ? state.self.faction : ''));
    const gear = Object.values(player.equipment || {}).filter(Boolean).map(card => card.name).join(' · ');
    return `<div class="player-row">
      <div><div class="player-name">${esc(player.name)}${isSelf ? ' · 我' : ''}${dead ? ' <span class="danger-text">出局</span>' : ''}</div><div class="player-meta">${esc(player.role?.name || (state.room.phase === 'lobby' ? '等待分配角色' : ''))}${gear?` · 装备：${esc(gear)}`:''}</div></div>
      <div class="mind-track" aria-label="心智 ${player.mind}/${player.maxMind}">${dots}<span class="mind-num">${player.mind}/${player.maxMind || '—'}</span></div>
      ${factionTag(faction)}
    </div>`;
  }

  function eventFeed() {
    const events = state.events || [];
    return events.length ? events.map(event => `<div class="feed-item"><time>${timeText(event.at)}</time>${esc(event.text)}</div>`).join('') : '<div class="empty">牌桌记录会显示在这里。</div>';
  }

  function agendaBlock() {
    const agenda = state.room.agenda;
    if (!agenda) return '';
    return `<section class="agenda-card"><div class="eyebrow">第 ${state.room.round} / ${state.room.maxRounds} 轮议题</div><h2>${esc(agenda.name)}</h2><p><span class="card-effect-label">本议题效果</span>${esc(agenda.effect)}</p></section>`;
  }

  function phaseTrack() {
    return `<div class="choice-row" aria-label="当前流程">${phaseSteps.map((phase,index) => `<span class="phase-chip"><b style="background:${state.room.phase===phase?'var(--gold)':phaseSteps.indexOf(state.room.phase)>index?'var(--green)':'#c9c6bb'}"></b>${['夜间','辩论','投票','结算'][index]}</span>`).join('')}</div>`;
  }

  function playerIdentity() {
    const self = state.self;
    if (!self.role) return `<section class="panel self-card"><span class="section-label">我的身份</span><h2 style="margin-top:4px">等待主持人开始</h2><p class="small-copy">角色、阵营、契约和起始手牌将在开局时秘密分配。</p></section>`;
    const card = self.contract;
    return `<section class="panel self-card">
      <div class="panel-heading"><div><span class="section-label">我的身份</span><h2 style="margin-top:4px">${esc(self.role.name)}</h2><div class="small-copy">${esc(self.role.era)} · ${esc(self.role.school)}</div></div>${factionTag(self.faction)}</div>
      <div class="identity-grid"><div class="identity-box"><div class="mini-label">心智</div><strong>${self.mind} / ${self.maxMind}</strong><div class="secondary-line">归零即出局</div></div><div class="identity-box"><div class="mini-label">秘密契约</div><strong>${card ? esc(card.name) : '无'}</strong><div class="secondary-line">${card ? esc(card.tag || '游士契约') : '阵营目标'}</div></div></div>
      ${card ? `<div class="small-copy" style="margin-top:8px">${esc(card.effect)}</div>` : ''}
      <div class="identity-skills"><div class="section-label">角色技能</div>${self.role.skills.map(([name,effect]) => `<div class="skill"><b>${esc(name)}</b> · ${esc(effect)}</div>`).join('')}</div>
    </section>`;
  }

  function handOverview() {
    const self = state.self;
    const cards = self.hand || [];
    return `<section class="panel"><div class="panel-heading"><div><span class="section-label">仅自己可见</span><h2 style="margin-top:3px">我的手牌</h2></div><span class="small-copy">${cards.length} 张</span></div>${cards.length?`<div class="hand-list">${cards.map(card=>`<article class="hand-card"><div class="card-top"><span class="card-icon">${esc(card.icon)}</span><span><span class="card-name">${esc(card.name)}</span><span class="card-category">${esc(card.tag)}</span></span></div><div class="card-text">${esc(card.effect)}</div></article>`).join('')}</div>`:'<div class="empty">当前没有手牌。</div>'}</section>`;
  }

  function selectedCardPanel() {
    if (!selectedCard) return '';
    const item = state.self.hand.find(card => card.instance === selectedCard);
    if (!item) { selectedCard = null; return ''; }
    const needsTarget = targeted.has(item.id);
    const choices = state.players.filter(p => p.alive && p.id !== state.self.id);
    return `<div class="play-options"><div class="field"><label>打出「${esc(item.name)}」${needsTarget?' · 选择目标':''}</label>${choices.length ? `<select id="play-target"><option value="">${needsTarget?'选择目标玩家':'不指定目标'}</option>${choices.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>` : '<span class="small-copy">没有可选目标</span>'}</div>
      ${item.id === 'argument' ? `<div class="field"><label>论证立场</label><select id="play-stance"><option>赞成</option><option>反对</option></select></div>` : ''}
      <button class="button" data-action="play-card" data-instance="${item.instance}">确认打出</button><button class="button secondary" data-action="cancel-card">取消</button></div>`;
  }

  function challengePrompt() {
    const pending = state.room.pending;
    if (!pending) return '';
    if (pending.kind === 'challenge') {
      if (pending.targetId === state.self.id) {
        const hasCounter = state.self.hand.some(c=>c.id==='counterexample');
        return `<div class="pending-box"><h3>你受到诘问</h3><p>你可以打出一张「反例」抵消；若不回应，你失去 1 点心智，本议题投票锁定为悬置。</p><div class="choice-row">${hasCounter?'<button class="button" data-action="answer-challenge" data-block="yes">打出反例</button>':''}<button class="button danger" data-action="answer-challenge" data-block="no">无法反驳</button></div></div>`;
      }
      return `<div class="waiting">${esc(playerName(pending.targetId))}正在回应诘问。</div>`;
    }
    if (pending.kind === 'debate') {
      if (pending.nextId !== state.self.id) return `<div class="waiting">辩论中 · 等待 ${esc(playerName(pending.nextId))} 出牌。</div>`;
      const hasArgument = state.self.hand.some(c=>c.id==='argument');
      const hasCounter = state.self.hand.some(c=>c.id==='counterexample');
      return `<div class="pending-box"><h3>轮到你回应「辩论」</h3><p>依次打出「论证」或「反例」；无法继续时选择认输，失去 1 点心智并将本议题投票锁定为悬置。</p><div class="choice-row">${hasArgument?'<button class="button secondary" data-action="debate-answer" data-card="argument">出论证</button>':''}${hasCounter?'<button class="button secondary" data-action="debate-answer" data-card="counterexample">出反例</button>':''}<button class="button danger" data-action="debate-fold">无法继续</button></div></div>`;
    }
    return '';
  }

  function phaseAction() {
    const room = state.room;
    const self = state.self;
    if (room.phase === 'lobby') return `<section class="panel action-panel"><h2>等待主持人开局</h2><p>所有玩家加入后，主持人会发放角色、阵营和起始手牌。</p></section>`;
    if (room.phase === 'finished') return `<section class="panel winners"><h2>本局结束</h2><p>${room.winners?.length ? `胜者：${esc(room.winners.join('、'))}` : '无人达成胜利条件。'} 主持人已公开终局结果。</p></section>`;
    if (!self.alive) return `<section class="panel action-panel"><h2>你已出局</h2><p>你可以继续观看公开牌桌记录；出局玩家不再行动或投票。</p>${room.phase==='finished'&&self.contract?`<div class="note">你的秘密契约：${esc(self.contract.name)} · ${self.contractComplete?'已完成':'未完成'}</div>`:''}</section>`;
    if (room.phase === 'night') {
      if (self.faction !== '怀疑派') return `<section class="panel action-panel"><span class="section-label">夜间行动</span><h2>请等待夜间结束</h2><p>本阶段由怀疑派秘密选择目标。你的角色和阵营信息只在本页显示。</p></section>`;
      if (self.nightTarget) return `<section class="panel action-panel"><span class="section-label">夜间行动</span><h2>目标已秘密提交</h2><p>主持人结算前，你的选择仅自己与主持人可见。</p><div class="my-turn">已提交夜间目标</div></section>`;
      const allies = new Set((self.fellowSkeptics || []).map(p=>p.id));
      const targets = state.players.filter(p=>p.alive && p.id!==self.id && !allies.has(p.id));
      return `<section class="panel action-panel"><span class="section-label">夜间行动</span><h2>秘密选择目标</h2><p>怀疑派彼此相认；每名怀疑派私下选择一名非怀疑派玩家。主持人按多数选择结算，平票则无夜间伤害。</p><div class="small-copy" style="margin:-5px 0 11px">同阵营：${(self.fellowSkeptics||[]).filter(p=>p.id!==self.id).map(p=>esc(p.name)).join('、')||'你是唯一的怀疑派'}</div><div class="secret-target"><select id="night-target"><option value="">选择目标</option>${targets.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button class="button" data-action="submit-night">秘密提交</button></div></section>`;
    }
    if (room.phase === 'debate') {
      const isTurn = room.turnPlayerId === self.id;
      const prompt = challengePrompt();
      if (prompt) return `<section class="panel action-panel"><span class="section-label">当前阶段 · 辩论</span><h2>牌面响应</h2><p>有响应效果正在结算，其他行动暂时暂停。</p>${prompt}</section>`;
      if (!isTurn) return `<section class="panel action-panel"><span class="section-label">当前阶段 · 辩论</span><h2>等待轮到你</h2><p>一人完成自己的行动后，顺时针交给下一位存活玩家。</p><div class="waiting">当前行动：${esc(playerName(room.turnPlayerId))}</div></section>`;
      return `<section class="panel action-panel"><span class="section-label">你的回合</span><h2>可连续打出多张牌</h2><p>没有全局每回合一张的限制。打完想用的牌后，再结束本回合；其他卡牌效果由主持人按卡面协助结算。</p>${challengePrompt()}${selectedCardPanel()}<div class="hand-list">${self.hand.map(card=>`<article class="hand-card ${selectedCard===card.instance?'selected':''}"><div class="card-top"><span class="card-icon">${esc(card.icon)}</span><span><span class="card-name">${esc(card.name)}</span><span class="card-category">${esc(card.tag)}</span></span></div><div class="card-text">${esc(card.effect)}</div><div class="card-action"><button class="button secondary small" data-action="select-card" data-instance="${card.instance}">${selectedCard===card.instance?'已选择':'选择此牌'}</button></div></article>`).join('') || '<div class="empty">手牌已空。</div>'}</div><div style="margin-top:14px;display:flex;justify-content:flex-end"><button class="button" data-action="finish-turn" ${room.pending?'disabled':''}>结束我的回合</button></div></section>`;
    }
    if (room.phase === 'vote') {
      if (self.vote) return `<section class="panel action-panel"><span class="section-label">秘密投票</span><h2>你的投票已提交</h2><p>主持人可以查看个人投票以处理规则；其他玩家只会看到最终票数。</p><div class="my-turn">已提交 · ${esc(self.forcedVote || self.vote)}</div></section>`;
      const locked = self.forcedVote;
      return `<section class="panel action-panel"><span class="section-label">秘密投票</span><h2>选择你的立场</h2><p>${locked ? `你的立场已被规则锁定为「${esc(locked)}」。` : '所有存活玩家各自秘密投票，主持人公布汇总票数。'}</p><div class="choice-row">${['赞成','反对','悬置'].map(v=>`<button class="choice-button ${locked===v?'active':''}" data-action="vote" data-vote="${v}" ${locked&&locked!==v?'disabled':''}>${v}</button>`).join('')}</div></section>`;
    }
    if (room.phase === 'result') {
      const result = room.results.at(-1);
      return `<section class="panel action-panel"><span class="section-label">议题结算</span><h2>等待主持人开启下一轮</h2>${result?`<div class="result-banner"><h2>第 ${result.round} 轮 · ${esc(result.result)}</h2><p>赞成 ${result.tally['赞成']} · 反对 ${result.tally['反对']} · 悬置 ${result.tally['悬置']}</p></div>`:''}<p style="margin-top:12px">请查看本轮结果与全桌记录。下一轮开始后，你会获得新手牌并继续行动。</p></section>`;
    }
    return '';
  }

  function playerGame() {
    const room = state.room;
    const self = state.self;
    const progress = self.role ? `第 ${room.round} / ${room.maxRounds} 轮` : '等待玩家';
    return `<section class="lobby-shell">
      <div class="game-head"><div><div class="eyebrow">玩家视角 · ${esc(self.name)}</div><h1 class="display-title" style="font-size:32px;margin:5px 0">哲学家对局</h1><div class="round-label">${progress} · ${esc(phaseNames[room.phase])}</div></div><div class="room-badge"><span>房间号</span><strong>${esc(room.code)}</strong></div></div>
      ${room.phase==='lobby'?`<section class="panel"><div class="panel-heading"><div><h2>玩家席位</h2><p>等待主持人开局 · ${state.players.length}/${room.expected} 人</p></div></div><div class="seat-list">${state.players.map((p,i)=>`<div class="seat"><span class="seat-number">${i+1}</span><span class="seat-name">${esc(p.name)}${p.id===self.id?' · 我':''}</span><span class="seat-status">已连接</span></div>`).join('')}</div></section>`:''}
      ${room.phase==='lobby'?'':agendaBlock()}
      <div class="app-layout"><div class="main-column">${room.phase!=='lobby'?playerIdentity():''}${phaseAction()}${room.phase!=='lobby'?`<section class="panel"><div class="panel-heading"><div><span class="section-label">全桌状态</span><h2 style="margin-top:4px">玩家与心智</h2></div><span class="small-copy">角色公开 · 活人阵营隐藏</span></div><div class="player-list">${state.players.map(p=>playerRow(p,p.id===self.id)).join('')}</div></section>`:''}</div>
      <aside class="side-column">${room.phase!=='lobby'?`<section class="panel"><div class="panel-heading"><div><span class="section-label">行动顺序</span><h2 style="margin-top:3px">当前流程</h2></div></div>${phaseTrack()}<div class="small-copy" style="margin-top:12px">${room.phase==='debate'?`当前行动：${esc(playerName(room.turnPlayerId))}`:`${esc(phaseNames[room.phase])} · ${room.deckCount} 张牌堆剩余`}</div></section>`:''}${self.role && !(room.phase==='debate' && room.turnPlayerId===self.id && !room.pending) ? handOverview() : ''}<section class="panel"><div class="panel-heading"><div><span class="section-label">公开记录</span><h2 style="margin-top:3px">牌桌动态</h2></div></div><div class="feed">${eventFeed()}</div></section></aside></div>
      ${room.phase==='finished'?`<section class="panel" style="margin-top:16px"><div class="winners"><h2>终局身份公开</h2>${state.players.map(p=>`<p>${esc(p.name)}：${esc(p.faction||'')} · ${esc(p.role?.name||'')}${p.contract?` · 契约「${esc(p.contract.name)}」`:''}</p>`).join('')}</div></section>`:''}
    </section>`;
  }

  function hostPrivatePlayers() {
    return `<div>${state.privatePlayers.map(p=>`<article class="host-player-card"><div class="host-player-head"><strong>${esc(p.name)}${p.alive?'':' · 已出局'}</strong>${factionTag(p.faction || '')}</div><div class="private-line"><b>角色：</b>${esc(p.role?.name || '尚未分配')}　<b>心智：</b>${p.mind}/${p.maxMind || '—'}</div>${p.role?.skills?.length?`<details class="host-details"><summary>角色技能</summary>${p.role.skills.map(([name,effect])=>`<div class="private-line"><b>${esc(name)}：</b>${esc(effect)}</div>`).join('')}</details>`:''}${p.contract?`<div class="private-line"><b>秘密契约：</b>${esc(p.contract.name)} · ${esc(p.contract.effect)}</div>`:''}<div class="private-line"><b>装备：</b>${Object.values(p.equipment||{}).filter(Boolean).map(c=>esc(c.name)).join('、')||'无'}</div><details class="host-details"><summary>手牌 ${p.hand?.length||0} 张</summary>${(p.hand||[]).map(c=>`<div class="host-card-effect"><b>${esc(c.name)}</b> · ${esc(c.tag)}<br>${esc(c.effect)}</div>`).join('')||'<div class="private-line">无手牌</div>'}</details></article>`).join('')}</div>`;
  }

  function hostFlow() {
    const room = state.room;
    if (room.phase === 'lobby') return `<div class="host-controls"><div class="control-card"><h3>开始条件</h3><p>已加入 ${state.players.length} / ${room.expected} 名玩家。主持人不占玩家席位。</p><button class="button" data-action="start-game" ${state.players.length!==room.expected?'disabled':''}>开始游戏并秘密发身份</button></div><div class="control-card"><h3>邀请玩家</h3><p>让所有人连接同一 Wi-Fi，再输入下面的地址和房间号。</p><div class="small-copy" id="lan-addresses">正在读取本机地址…</div></div></div>`;
    if (room.phase === 'finished') return `<div class="winners"><h2>本局结束</h2><p>${room.winners?.length?`胜者：${esc(room.winners.join('、'))}`:'无人达成胜利条件。'}</p><div class="private-line">游士契约与所有真实阵营已经公开。主持人可创建新房间重新开局。</div></div><button class="button" style="margin-top:12px" data-action="new-game">创建新房间</button>`;
    if (room.phase === 'night') {
      const submitted = room.ballot.filter(p=>p.nightTarget);
      const targets = state.privatePlayers.filter(p=>p.alive && p.faction!=='怀疑派');
      return `<div class="host-controls"><div class="control-card"><h3>夜间行动</h3><p>收到 ${submitted.length} 名存活怀疑派的选择。投票细节只在主持人视角显示。</p>${submitted.map(p=>`<div class="summary-row"><span>${esc(p.name)} 的秘密选择</span><b>${esc(playerName(p.nightTarget))}</b></div>`).join('')||'<div class="empty">尚无人提交。</div>'}<div class="field"><label for="host-night-target">主持人指定结算目标（可选）</label><select id="host-night-target"><option value="">按怀疑派多数选择</option>${targets.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div><button class="button" data-action="resolve-night">结算夜间行动</button></div><div class="note">平票时无人受到夜间伤害。主持人可以根据桌面协商手动指定目标。</div></div>`;
    }
    if (room.phase === 'debate') return `<div class="host-controls"><div class="control-card"><h3>辩论阶段</h3><p>当前行动：<strong>${esc(playerName(room.turnPlayerId))}</strong>。每人可以连续打出多张牌，直到自行结束行动。</p>${room.pending?`<div class="note">正在结算${esc(room.pending.cardName)}：等待 ${esc(playerName(room.pending.kind==='debate'?room.pending.nextId:room.pending.targetId))} 响应。</div>`:''}<button class="button secondary" data-action="advance-debate">结束辩论并进入投票</button></div><div class="note">按主持人判断结束行动阶段。按跳过会清除尚未完成的卡牌响应。</div></div>`;
    if (room.phase === 'vote') {
      const cast = room.ballot.filter(p=>p.vote).length;
      return `<div class="host-controls"><div class="control-card"><h3>秘密投票</h3><p>已收到 ${cast} / ${state.players.filter(p=>p.alive).length} 张票。主持人可以查看个人票，并按角色技能修正。</p><div class="summary-list">${room.ballot.map(p=>`<div class="vote-review"><div class="summary-row"><span>${esc(p.name)}</span><b>${p.vote?esc(p.vote):p.forcedVote?`锁定：${esc(p.forcedVote)}`:'尚未投票'}</b></div>${p.id&&state.players.find(item=>item.id===p.id)?.alive?`<div class="vote-edit"><select id="host-vote-${p.id}"><option value="赞成" ${p.vote==='赞成'||(!p.vote&&p.forcedVote==='赞成')?'selected':''}>赞成</option><option value="反对" ${p.vote==='反对'||(!p.vote&&p.forcedVote==='反对')?'selected':''}>反对</option><option value="悬置" ${!p.vote&&p.forcedVote!=='赞成'&&p.forcedVote!=='反对'||p.vote==='悬置'?'selected':''}>悬置</option></select><button class="button secondary small" data-action="set-vote" data-player="${p.id}">修正此票</button></div>`:''}</div>`).join('')}</div><button class="button" data-action="resolve-vote">汇总并公布结果</button></div><div class="note">未提交的票按「悬置」处理。公布后只展示总数和议题结果。</div></div>`;
    }
    if (room.phase === 'result') {
      const r = room.results.at(-1);
      return `<div class="host-controls"><div class="control-card"><h3>本轮结果</h3>${r?`<div class="result-banner"><h2>${esc(r.result)}</h2><p>赞成 ${r.tally['赞成']} · 反对 ${r.tally['反对']} · 悬置 ${r.tally['悬置']}</p></div>`:''}<p style="margin-top:10px">依照当前议题效果处理额外结算，再开启下一轮。</p><button class="button" data-action="next-round">${room.round>=room.maxRounds?'结束游戏并判定胜负':'开始下一轮'}</button></div></div>`;
    }
    return '';
  }

  function hostRosterTools() {
    return `<div>${state.privatePlayers.map(p=>{
      const marks = (state.room.marks||[]).filter(mark=>mark.ownerId===p.id);
      const equipment = p.equipment || {};
      return `<article class="host-player-card"><div class="host-player-head"><strong>${esc(p.name)} · ${esc(p.role?.name||'未分配')}</strong><span>${p.mind}/${p.maxMind||'—'} 心智</span></div><div class="private-line">${p.alive?'存活':'出局'} · ${esc(p.faction||'')}</div>${p.alive?`<div class="host-tools"><button class="button secondary small" data-action="mind" data-player="${p.id}" data-amount="1">恢复 1</button><button class="button secondary small" data-action="mind" data-player="${p.id}" data-amount="-1">失去 1</button><button class="button secondary small" data-action="draw" data-player="${p.id}">摸 1 张</button><button class="button danger small" data-action="eliminate" data-player="${p.id}">判定出局</button></div>
        ${p.hand.length?`<div class="host-tools"><select id="discard-${p.id}" aria-label="选择 ${esc(p.name)} 的弃牌" class="host-select"><option value="">选择一张手牌弃置</option>${p.hand.map(card=>`<option value="${card.instance}">${esc(card.name)}</option>`).join('')}</select><button class="button secondary small" data-action="discard" data-player="${p.id}">弃置</button></div>`:''}
        <div class="host-tools">${equipment.offense?`<button class="button secondary small" data-action="unequip" data-player="${p.id}" data-slot="offense">弃置进攻装备</button>`:''}${equipment.defense?`<button class="button secondary small" data-action="unequip" data-player="${p.id}" data-slot="defense">弃置防守装备</button>`:''}${marks.map(mark=>`<span class="mark-tool">${mark.stance}<button class="button secondary small" data-action="mark" data-mark="${mark.id}" data-operation="remove">移除</button><button class="button secondary small" data-action="mark" data-mark="${mark.id}" data-operation="flip">转向</button></span>`).join('')}</div>`:''}</article>`;
    }).join('')}</div>`;
  }

  function hostGame() {
    const room = state.room;
    const resultRows = room.results.map(r=>`<div class="summary-row"><span>第 ${r.round} 轮 · ${esc(r.agenda)}</span><b>${esc(r.result)}（赞 ${r.tally['赞成']} / 反 ${r.tally['反对']} / 悬 ${r.tally['悬置']}）</b></div>`).join('');
    return `<section class="lobby-shell">
      <div class="game-head"><div><div class="eyebrow">主持人视角 · 不参与胜负</div><h1 class="display-title" style="font-size:32px;margin:5px 0">主持桌</h1><div class="round-label">${esc(phaseNames[room.phase])}${room.round?` · 第 ${room.round}/${room.maxRounds} 轮`:''}</div></div><div class="room-badge"><span>房间号</span><strong>${esc(room.code)}</strong></div></div>
      ${room.phase==='lobby'?`<section class="panel"><div class="panel-heading"><div><span class="section-label">开局准备</span><h2 style="margin-top:4px">玩家席位</h2><p>达到 ${room.expected} 名玩家后即可开始。</p></div></div>${renderSeats()}</section>`:''}
      ${agendaBlock()}
      <div class="app-layout"><div class="main-column">
        <section class="panel"><div class="panel-heading"><div><span class="section-label">主持人工作区</span><h2 style="margin-top:4px">${esc(phaseNames[room.phase])}</h2></div><span class="small-copy">${state.players.length} 名玩家 · ${room.deckCount} 张牌堆</span></div><div class="host-tabs"><button class="tab-button ${hostTab==='flow'?'active':''}" data-action="host-tab" data-tab="flow">流程控制</button><button class="tab-button ${hostTab==='private'?'active':''}" data-action="host-tab" data-tab="private">私密信息</button><button class="tab-button ${hostTab==='players'?'active':''}" data-action="host-tab" data-tab="players">玩家状态</button><button class="tab-button ${hostTab==='history'?'active':''}" data-action="host-tab" data-tab="history">结算记录</button></div>
          <div class="host-tab-panel ${hostTab==='flow'?'active':''}">${hostFlow()}</div>
          <div class="host-tab-panel ${hostTab==='private'?'active':''}"><div class="note" style="margin-bottom:12px">仅主持人可见：真实阵营、游士契约、个人手牌。夜间选择和秘密投票会在「流程控制」阶段出现。</div>${hostPrivatePlayers()}</div>
          <div class="host-tab-panel ${hostTab==='players'?'active':''}"><div class="note" style="margin-bottom:12px">主持人辅助按钮用于角色技能和特殊牌面。调整会记入全桌动态；普通出牌按卡面效果裁定。</div>${hostRosterTools()}</div>
          <div class="host-tab-panel ${hostTab==='history'?'active':''}"><h3 style="margin:0 0 10px">议题结果</h3><div class="summary-list">${resultRows||'<div class="empty">尚无已结算议题。</div>'}</div></div>
        </section>
      </div><aside class="side-column"><section class="panel"><div class="panel-heading"><div><span class="section-label">主持提示</span><h2 style="margin-top:3px">本局流程</h2></div></div>${phaseTrack()}<div class="small-copy" style="margin-top:12px">${esc(phaseNames[room.phase])} · 弃牌堆 ${room.discardCount} 张</div></section><section class="panel"><div class="panel-heading"><div><span class="section-label">公开记录</span><h2 style="margin-top:3px">全桌动态</h2></div></div><div class="feed">${eventFeed()}</div></section></aside></div>
      ${room.phase==='finished'?`<section class="panel" style="margin-top:16px"><div class="winners"><h2>终局身份公开</h2>${state.privatePlayers.map(p=>`<p>${esc(p.name)}：${esc(p.faction)} · ${esc(p.role?.name||'')} ${p.contract?`· 契约「${esc(p.contract.name)}」${p.contractComplete?'已完成':'未完成'}`:''}</p>`).join('')}</div></section>`:''}
    </section>`;
  }

  function render() {
    if (!state?.room) { renderLanding(); return; }
    setConnection('online','已连接 · 实时同步');
    app.innerHTML = state.isHost ? hostGame() : playerGame();
    if (state.isHost && state.room.phase === 'lobby') {
      const info = window.serverInfo;
      const node = document.querySelector('#lan-addresses');
      if (node && info?.addresses?.length) node.innerHTML = info.addresses.map(address=>`<div><strong>${esc(address)}</strong></div>`).join('');
    }
  }

  async function pullState() {
    try {
      if (!token) { setConnection('','未连接'); return; }
      const data = await api('/api/state');
      if (data.error) { clearSession(); notify(data.error); return; }
      const snapshot = JSON.stringify(data);
      state = data;
      if (snapshot !== lastSnapshot) { lastSnapshot = snapshot; render(); }
      else setConnection('online','已连接 · 实时同步');
    } catch (error) {
      if (error.status === 401) { clearSession(); notify(error.message); return; }
      setConnection('offline','连接中断');
    }
  }

  async function action(button) {
    const type = button.dataset.action;
    try {
      if (type === 'select-card') { selectedCard = selectedCard === button.dataset.instance ? null : button.dataset.instance; render(); return; }
      if (type === 'cancel-card') { selectedCard = null; render(); return; }
      if (type === 'host-tab') { hostTab = button.dataset.tab; render(); return; }
      let path, data = {};
      if (type === 'start-game') path = '/api/start';
      if (type === 'resolve-night') { path = '/api/resolve-night'; data.targetId = document.querySelector('#host-night-target')?.value || ''; }
      if (type === 'advance-debate') path = '/api/host/advance';
      if (type === 'resolve-vote') path = '/api/resolve-vote';
      if (type === 'next-round') path = '/api/next-round';
      if (type === 'submit-night') { path = '/api/night'; data.targetId = document.querySelector('#night-target')?.value; if (!data.targetId) throw new Error('先选择一名目标玩家。'); }
      if (type === 'play-card') {
        path = '/api/play'; data.instance = button.dataset.instance;
        data.targetId = document.querySelector('#play-target')?.value || '';
        data.stance = document.querySelector('#play-stance')?.value || '';
        const handCard = state.self.hand.find(c=>c.instance===data.instance);
        if (handCard && targeted.has(handCard.id) && !data.targetId) throw new Error('这张牌需要先选择目标。');
      }
      if (type === 'finish-turn') path = '/api/finish-turn';
      if (type === 'answer-challenge') { path = '/api/challenge-answer'; data.block = button.dataset.block==='yes'; }
      if (type === 'debate-answer') { path = '/api/debate-answer'; data.cardId = button.dataset.card; }
      if (type === 'debate-fold') { path = '/api/debate-answer'; data.fold = true; }
      if (type === 'vote') { path = '/api/vote'; data.vote = button.dataset.vote; }
      if (type === 'mind') { path = '/api/host/mind'; data.playerId = button.dataset.player; data.amount = Number(button.dataset.amount); }
      if (type === 'draw') { path = '/api/host/draw'; data.playerId = button.dataset.player; data.amount = 1; }
      if (type === 'discard') { path = '/api/host/discard'; data.playerId = button.dataset.player; data.instance = document.querySelector(`#discard-${button.dataset.player}`)?.value; if (!data.instance) throw new Error('先选择一张要弃置的手牌。'); }
      if (type === 'unequip') { path = '/api/host/unequip'; data.playerId = button.dataset.player; data.slot = button.dataset.slot; }
      if (type === 'mark') { path = '/api/host/mark'; data.markId = button.dataset.mark; data.operation = button.dataset.operation; }
      if (type === 'set-vote') { path = '/api/host/vote'; data.playerId = button.dataset.player; data.vote = document.querySelector(`#host-vote-${button.dataset.player}`)?.value; }
      if (type === 'eliminate') { if (!confirm('确认判定这名玩家出局？')) return; path='/api/host/eliminate'; data.playerId=button.dataset.player; }
      if (type === 'new-game') { clearSession(); return; }
      if (!path) return;
      await api(path,data);
      selectedCard = null;
      await pullState();
    } catch (error) { notify(error.message); }
  }

  app.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (button) action(button);
  });
  app.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    if (staticPreview) { notify('这是 GitHub Pages 静态预览页；开房联机需要另行部署牌局服务。'); return; }
    try {
      if (form.id === 'host-form') {
        const result = await api('/api/create',{ expected:Number(new FormData(form).get('expected')) });
        setToken(result.token);
        await pullState();
      } else if (form.id === 'join-form') {
        const formData = new FormData(form);
        const result = await api('/api/join',{code:formData.get('code'),name:formData.get('name')});
        setToken(result.token);
        await pullState();
      }
    } catch (error) { notify(error.message); }
  });

  if (location.protocol === 'file:') renderLanding();
  else if (token) pullState();
  else { renderLanding(); setConnection('','未连接'); }
  if (location.protocol !== 'file:') setInterval(pullState,1200);
})();
