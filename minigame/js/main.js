/**
 * 小游戏主控制器：会话恢复、轮询、触摸、输入、页面切换与所有云端操作。
 */
import { ctx, metrics } from './render.js';
import { C, F } from './theme.js';
import {
  button, roundRect, scrollbar, text, wrap, wrapHeight, truncate
} from './ui.js';
import { call } from './net.js';
import { loadImages } from './images.js';
import { drawHome, drawRules, drawCreate, drawJoin, drawLobby } from './screens.js';
import { drawGame, drawGameTabs } from './game.js';
import { playerById, targetsForCard, removableMarks, slotsOf, skillTargets, markTargets } from './selectors.js';

const STORAGE_KEY = 'truth-room-code';
const POLL_INTERVAL = 2300;

const PAGE_LABEL = {
  home: '哲学阵营对战',
  rules: '玩法说明',
  create: '创建房间',
  join: '加入房间',
  lobby: '等待玩家',
  game: '牌局'
};

function inside(hit, x, y, scroll) {
  const hy = hit.fixed ? y : y + scroll;
  return x >= hit.x && x <= hit.x + hit.w && hy >= hit.y && hy <= hit.y + hit.h;
}

export default class App {
  constructor() {
    this.page = 'home';
    this.view = null;
    this.roomCode = '';
    this.busy = false;
    this.polling = false;
    this.notice = '';
    this.noticeTimer = null;
    this.scroll = 0;
    this.maxScroll = 0;
    this.hits = [];
    this.touch = null;
    this.selected = null;
    this.choose = {};
    this.sheet = null;
    this.tab = 'action';
    this.form = { name: this.defaultName(), code: '', expected: 4 };
    this.input = null;
    this.keyboardHandlers = null;
    this.clockSkew = 0;
    this.lastSkillNote = 0;
    this.pollTimer = null;
    this.tickTimer = null;

    GameGlobal.truthApp = this;
    loadImages(() => this.draw());
    this.bindTouch();
    this.bindLifecycle();
    this.startTimers();
    this.restoreSession();
    this.draw();
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  defaultName() {
    let saved = '';
    try {
      saved = wx.getStorageSync('truth-player-name') || '';
    } catch (error) {
      saved = '';
    }
    if (saved) return saved;
    return '玩家' + Math.floor(100 + Math.random() * 900);
  }

  saveName() {
    try {
      wx.setStorageSync('truth-player-name', String(this.form.name || '').trim());
    } catch (error) {
      // 忽略存储失败
    }
  }

  async restoreSession() {
    const launch = wx.getLaunchOptionsSync ? wx.getLaunchOptionsSync() : {};
    const query = (launch && launch.query) || {};
    if (query.room) {
      this.form.code = String(query.room).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      this.page = 'join';
      this.draw();
      return;
    }
    let code = '';
    try {
      code = wx.getStorageSync(STORAGE_KEY) || '';
    } catch (error) {
      code = '';
    }
    if (!code) return;
    this.roomCode = code;
    const ok = await this.refresh(true, true);
    if (!ok) {
      this.clearSession();
      this.page = 'home';
      this.notice = '上次的牌局无法恢复，请重新加入。';
      this.draw();
    }
  }

  bindLifecycle() {
    if (wx.onHide) {
      wx.onHide(() => this.stopTimers());
    }
    if (wx.onShow) {
      wx.onShow(() => {
        this.startTimers();
        if (this.roomCode) this.refresh(false, true);
      });
    }
  }

  startTimers() {
    this.stopTimers();
    this.pollTimer = setInterval(() => {
      if (!this.roomCode || this.busy || this.polling) return;
      if (this.page !== 'game' && this.page !== 'lobby') return;
      this.refresh(false, true);
    }, POLL_INTERVAL);
    this.tickTimer = setInterval(() => {
      if (!this.view || this.sheet) return;
      this.draw();
    }, 500);
  }

  stopTimers() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.pollTimer = null;
    this.tickTimer = null;
  }

  /* ------------------------------ 触摸与绘制 ------------------------------ */

  bindTouch() {
    wx.onTouchStart(event => {
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      this.touch = { startX: touch.clientX, startY: touch.clientY, lastY: touch.clientY, moved: false };
    });

    wx.onTouchMove(event => {
      if (!this.touch || this.sheet) return;
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      const total = Math.abs(touch.clientY - this.touch.startY) + Math.abs(touch.clientX - this.touch.startX);
      if (total > 8) this.touch.moved = true;
      if (!this.touch.moved) return;
      const delta = this.touch.lastY - touch.clientY;
      this.touch.lastY = touch.clientY;
      this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + delta));
      if (Math.abs(delta) >= 3) this.draw();
    });

    wx.onTouchEnd(event => {
      const touch = event.changedTouches && event.changedTouches[0];
      const state = this.touch;
      this.touch = null;
      if (!touch || !state) return;
      if (state.moved) return;
      this.tap(touch.clientX, touch.clientY);
    });
  }

  draw(force) {
    if (!ctx) return;
    const width = metrics.width;
    const height = metrics.height;
    this.hits = [];
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, width, height);

    this.drawHeader();

    let bottom = 0;
    const isGame = this.view && this.page === 'game';
    const top = isGame ? metrics.pageTop : metrics.contentTop;
    if (isGame) drawGameTabs(this);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, width, Math.max(0, metrics.contentBottom - top));
    ctx.clip();
    ctx.translate(0, -this.scroll);
    bottom = isGame ? drawGame(this) : this.drawStaticPage();
    ctx.restore();

    this.maxScroll = Math.max(0, bottom - metrics.contentBottom + 16);
    if (this.scroll > this.maxScroll) this.scroll = this.maxScroll;
    scrollbar(this);
    this.drawFooter();
    if (this.sheet) this.drawSheet();
  }

  drawStaticPage() {
    if (this.view && this.view.room.phase === 'lobby') return drawLobby(this);
    if (this.page === 'rules') return drawRules(this);
    if (this.page === 'create') return drawCreate(this);
    if (this.page === 'join') return drawJoin(this);
    if (this.page === 'lobby' && this.view) return drawLobby(this);
    return drawHome(this);
  }

  drawHeader() {
    const width = metrics.width;
    const top = metrics.safeTop;
    const height = metrics.headerHeight;
    const isHome = !this.view && this.page === 'home';
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, 0, width, top + height);
    if (isHome) {
      text('THESIS / COUNTERTHESIS', 16, top + 14, { size: 9, weight: 'bold', color: C.gold });
      text('一场关于公共命题的阵营推理', 16, top + 31, {
        size: F.tiny, color: 'rgba(255,255,255,0.66)'
      });
      return;
    }
    text('真理未决', 16, top + 9, { size: 17, weight: 'bold', color: C.gold });
    let subtitle = PAGE_LABEL[this.page] || '牌局';
    if (this.view && this.page !== 'home' && this.page !== 'rules' && this.page !== 'create' && this.page !== 'join') {
      const room = this.view.room;
      subtitle = '房间 ' + room.code + ' · 第 ' + room.round + ' / ' + room.maxRounds + ' 轮';
    }
    text(truncate(subtitle, width - 120, F.tiny), 16, top + 32, {
      size: F.tiny, color: 'rgba(255,255,255,0.66)'
    });

    if (this.view && this.page === 'game' && this.view.room.phase !== 'finished') {
      const seconds = this.remaining();
      if (seconds != null) {
        text(seconds + 's', width - 16, top + 10, {
          size: 19, weight: 'bold', color: seconds <= 10 ? '#e8b967' : C.gold, align: 'right'
        });
        text('剩余', width - 16, top + 34, { size: F.tiny, color: 'rgba(255,255,255,0.5)', align: 'right' });
      }
    } else if (this.page === 'rules' || this.page === 'create' || this.page === 'join') {
      button(this, {
        x: width - 76, y: top + 14, w: 60, h: 28, label: '返回', size: F.tiny, style: 'ghost', fixed: true,
        onTap: () => this.go('home')
      });
    }
  }

  drawFooter() {
    const width = metrics.width;
    const y = metrics.height - metrics.safeBottom - metrics.footerHeight;
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, y, width, metrics.footerHeight);
    let hint = '点按操作 · 上下滑动查看';
    if (this.input) hint = '正在输入，完成后点键盘上的“完成”';
    else if (this.busy) hint = '正在与牌局服务同步…';
    else if (this.notice) hint = this.notice;
    else if (this.page === 'home') hint = '4—8 人 · 系统主持 · 角色公开、阵营保密';
    else if (this.view && this.view.room.phase === 'night') hint = '夜间行动保密进行中';
    else if (this.view && this.view.room.phase === 'vote') hint = '投票将在结算前保持保密';
    text(truncate(hint, width - 24, F.tiny), width / 2, y + 9, {
      size: F.tiny, color: 'rgba(242,227,196,0.8)', align: 'center'
    });
  }

  tap(x, y) {
    // 弹层优先
    for (let index = this.hits.length - 1; index >= 0; index--) {
      const hit = this.hits[index];
      if (!hit.overlay) continue;
      if (inside(hit, x, y, this.scroll)) {
        hit.onTap();
        return;
      }
    }
    if (this.sheet) {
      this.sheet = null;
      this.draw();
      return;
    }
    for (let index = this.hits.length - 1; index >= 0; index--) {
      const hit = this.hits[index];
      if (hit.overlay) continue;
      if (inside(hit, x, y, this.scroll)) {
        hit.onTap();
        return;
      }
    }
  }

  /* ------------------------------ 页面与状态 ------------------------------ */

  go(page) {
    this.page = page;
    this.scroll = 0;
    this.selected = null;
    this.choose = {};
    this.sheet = null;
    this.draw();
  }

  accept(view, reset) {
    if (!view || !view.room) return;
    const version = view.room.updatedAt || 0;
    if (version && version < (this.lastVersion || 0)) return;
    this.lastVersion = version;
    this.view = view;
    this.roomCode = view.room.code;
    this.clockSkew = (view.room.serverNow || Date.now()) - Date.now();
    if (view.room.code !== this.lastRoomCode) {
      this.lastRoomCode = view.room.code;
      this.tab = 'action';
      this.scroll = 0;
    }
    try {
      wx.setStorageSync(STORAGE_KEY, this.roomCode);
    } catch (error) {
      // 存储失败不影响本局
    }
    if (view.room.phase === 'lobby') {
      this.page = 'lobby';
    } else {
      this.page = 'game';
    }
    if (view.self && view.self.skillNoteAt && view.self.skillNoteAt !== this.lastSkillNote) {
      this.lastSkillNote = view.self.skillNoteAt;
      wx.showModal({ title: '技能信息', content: view.self.skillNote, showCancel: false, confirmText: '知道了' });
    }
    if (reset) {
      this.selected = null;
      this.choose = {};
    }
    if (this.selected) {
      const hand = (view.self && view.self.hand) || [];
      if (!hand.some(card => card.instance === this.selected)) {
        this.selected = null;
        this.choose = {};
      }
    }
    if (view.room.pending && view.room.pending.chooserId === view.self.id && this.selected) {
      this.selected = null;
      this.choose = {};
    }
  }

  clearSession() {
    try {
      wx.removeStorageSync(STORAGE_KEY);
    } catch (error) {
      // 忽略
    }
    this.view = null;
    this.roomCode = '';
    this.selected = null;
    this.choose = {};
    this.sheet = null;
    this.scroll = 0;
    this.lastVersion = 0;
  }

  async refresh(showError, silent) {
    if (!this.roomCode || this.polling) return false;
    this.polling = true;
    try {
      const view = await call('state', { code: this.roomCode });
      this.accept(view, false);
      this.draw();
      return true;
    } catch (error) {
      if (error && /找不到这个房间|你还没有加入/.test(error.message || '')) {
        this.clearSession();
        this.page = 'home';
        this.notice = '牌局已经结束或被清理，请重新创建房间。';
        this.draw();
        return false;
      }
      if (showError) this.showProblem('连接牌局失败', error);
      if (!silent && !showError) this.toast(error.message);
      return false;
    } finally {
      this.polling = false;
    }
  }

  /* ------------------------------ 云端操作 ------------------------------ */

  async action(name, payload) {
    if (this.busy) return false;
    this.busy = true;
    this.notice = '';
    this.draw();
    try {
      const view = await call(name, Object.assign({ code: this.roomCode }, payload || {}));
      this.accept(view, true);
      return true;
    } catch (error) {
      if (error && error.code === 'RULE') {
        this.toast(error.message);
        this.refresh(false, true);
      } else {
        this.showProblem('操作未完成', error);
      }
      return false;
    } finally {
      this.busy = false;
      this.draw();
    }
  }

  async createRoom(solo) {
    const name = String(this.form.name || '').trim();
    if (!name) {
      this.toast('请先填写昵称。');
      return;
    }
    if (this.busy) return;
    this.busy = true;
    this.saveName();
    this.draw();
    try {
      const view = await call('create', { name, expected: this.form.expected, solo: !!solo });
      this.accept(view, true);
      this.notice = solo ? '单人演练已开始，3 个 AI 玩家已入座。' : '房间已创建，把房间号发给朋友。';
      this.draw();
    } catch (error) {
      this.showProblem('创建房间失败', error);
    } finally {
      this.busy = false;
      this.draw();
    }
  }

  async joinRoom() {
    const name = String(this.form.name || '').trim();
    const code = String(this.form.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      this.toast('房间号是 6 位字母或数字。');
      return;
    }
    if (!name) {
      this.toast('请先填写昵称。');
      return;
    }
    if (this.busy) return;
    this.roomCode = code;
    this.busy = true;
    this.saveName();
    this.draw();
    try {
      const view = await call('join', { code, name });
      this.accept(view, true);
      this.draw();
    } catch (error) {
      this.roomCode = '';
      this.showProblem('加入房间失败', error);
    } finally {
      this.busy = false;
      this.draw();
    }
  }

  startGame() {
    this.action('start');
  }

  fillBots() {
    this.action('fillBots');
  }

  nightTarget(targetId) {
    this.action('night', { targetId });
  }

  respond(choice) {
    this.action('respond', { choice });
  }

  endTurn() {
    this.action('endTurn');
  }

  nextRound() {
    this.action('next');
  }

  async vote(stance) {
    const payload = { stance };
    if (this.choose.objection) payload.objection = true;
    if (this.choose.giftToId) payload.giftToId = this.choose.giftToId;
    const ok = await this.action('vote', payload);
    if (ok) this.choose = {};
  }

  useSkill(payload) {
    this.action('skill', payload);
  }

  async playSelected() {
    const me = this.view && this.view.self;
    if (!me || !this.selected) return;
    const card = me.hand.find(item => item.instance === this.selected);
    if (!card) {
      this.selected = null;
      this.draw();
      return;
    }
    if (!this.readyToPlay(card)) {
      this.toast('请先完成目标、立场等选择。');
      return;
    }
    const payload = { instance: card.instance };
    if (card.requires.target) payload.targetId = this.choose.targetId;
    if (card.requires.stance) payload.stance = this.choose.stance;
    if (card.requires.mark) payload.markId = this.choose.markId;
    if (card.requires.slot) payload.slot = this.choose.slot;
    if (card.requires.reveal) payload.revealInstance = this.choose.revealInstance;
    if (card.requires.prediction) payload.prediction = this.choose.prediction;
    if (card.id === 'argument') payload.boost = !!this.choose.boost;
    const ok = await this.action('play', payload);
    if (ok) this.choose = {};
  }

  readyToPlay(card) {
    const choose = this.choose || {};
    if (card.requires.target && !choose.targetId) return false;
    if (card.requires.stance && !choose.stance) return false;
    if (card.requires.mark && !choose.markId) return false;
    if (card.requires.slot && !choose.slot) return false;
    if (card.requires.reveal && !choose.revealInstance) return false;
    if (card.requires.prediction && !choose.prediction) return false;
    return true;
  }

  /* ------------------------------ 出牌选择 ------------------------------ */

  selectCard(instance) {
    const me = this.view && this.view.self;
    if (!me) return;
    const card = me.hand.find(item => item.instance === instance);
    if (!card) return;
    this.selected = instance;
    this.choose = { stance: '赞成', prediction: '悬置' };
    if (card.requires.target) {
      const targets = targetsForCard(this.view, card);
      if (targets.length === 1) {
        this.choose.targetId = targets[0].id;
        if (card.id === 'razor') {
          const slots = slotsOf(targets[0]);
          if (slots.length === 1) this.choose.slot = slots[0];
        }
      }
    }
    if (card.requires.mark) {
      const marks = removableMarks(this.view);
      if (marks.length === 1) this.choose.markId = marks[0].id;
    }
    if (card.requires.reveal) {
      const others = me.hand.filter(item => item.instance !== card.instance);
      if (others.length === 1) this.choose.revealInstance = others[0].instance;
    }
    this.draw();
  }

  cancelSelection() {
    this.selected = null;
    this.choose = {};
    this.draw();
  }

  openRevealPicker(card) {
    const me = this.view.self;
    const items = me.hand
      .filter(item => item.instance !== card.instance)
      .map(item => ({ label: item.name, note: item.tag, value: item.instance }));
    this.openPicker({
      title: '选择要展示的手牌',
      items,
      emptyText: '没有其他手牌可以展示。',
      onPick: value => {
        this.choose.revealInstance = value;
        this.draw();
      }
    });
  }

  openGiftPicker() {
    const me = this.view.self;
    const items = this.view.players
      .filter(player => player.alive && player.id !== me.id)
      .map(player => ({ label: player.name, note: player.role ? player.role.name : '', value: player.id }));
    this.openPicker({
      title: '塔斯比念珠：把 1 张牌交给',
      note: '交出 1 张手牌后，你会摸 1 张牌。',
      items,
      onPick: value => {
        this.choose.giftToId = value;
        this.draw();
      }
    });
  }

  /* ------------------------------ 角色技能 ------------------------------ */

  openSkills() {
    const me = this.view && this.view.self;
    if (!me || !me.skills || !me.skills.length) {
      this.toast('当前没有可查看的技能。');
      return;
    }
    const active = me.skills.filter(skill => skill.active);
    if (!active.length) {
      this.openText('角色技能', me.skills.map(skill => '「' + skill.name + '」\n' + skill.text).join('\n\n'));
      return;
    }
    this.openPicker({
      title: '角色技能',
      note: '灰色表示当前不能使用',
      items: active.map(skill => ({
        label: skill.name,
        note: skill.usable ? '可以使用' : skill.reason,
        value: skill.index,
        disabled: !skill.usable
      })),
      onPick: index => this.confirmSkill(index)
    });
  }

  confirmSkill(index) {
    const me = this.view.self;
    const skill = (me.skills || []).find(item => item.index === index);
    if (!skill) return;
    wx.showModal({
      title: skill.name,
      content: (skill.hint || '') + '\n\n' + (skill.text || ''),
      confirmText: '使用',
      cancelText: '返回',
      success: result => {
        if (result.confirm) this.collectSkill(skill);
      }
    });
  }

  collectSkill(skill) {
    const prompt = skill.prompt || {};
    const payload = { index: skill.index };
    const me = this.view.self;
    const tasks = [];

    if (prompt.target) {
      tasks.push(next => {
        const list = skillTargets(this.view, prompt.target);
        if (!list.length) {
          this.toast('没有符合条件的目标。');
          return;
        }
        this.openPicker({
          title: '选择目标',
          items: list.map(player => ({
            label: player.name,
            note: (player.role ? player.role.name : '') + ' · 心智 ' + player.mind + ' / ' + player.maxMind,
            value: player.id
          })),
          onPick: value => {
            payload.targetId = value;
            const target = playerById(this.view, value);
            if (prompt.target === 'equipment' && target) {
              const slots = slotsOf(target);
              this.openPicker({
                title: '选择装备栏',
                items: slots.map(slot => ({
                  label: slot === 'offense' ? '进攻装备' : '防守装备',
                  note: target.equipment[slot].name,
                  value: slot
                })),
                onPick: slot => {
                  payload.slot = slot;
                  next();
                }
              });
            } else {
              next();
            }
          }
        });
      });
    }

    if (prompt.mark) {
      tasks.push(next => {
        const marks = markTargets(this.view, prompt.mark);
        if (!marks.length) {
          this.toast('场上没有可选择的论证标记。');
          return;
        }
        this.openPicker({
          title: '选择论证标记',
          items: marks.map(mark => {
            const owner = playerById(this.view, mark.ownerId);
            return {
              label: (owner ? owner.name : '玩家') + ' · ' + (mark.stance || '暗置'),
              value: mark.id
            };
          }),
          onPick: value => {
            payload.markId = value;
            next();
          }
        });
      });
    }

    if (prompt.slot) {
      tasks.push(next => {
        const slots = slotsOf({ equipment: me.equipment });
        if (!slots.length) {
          this.toast('你没有可弃置的装备。');
          return;
        }
        this.openPicker({
          title: '选择自己的装备',
          items: slots.map(slot => ({
            label: slot === 'offense' ? '进攻装备' : '防守装备',
            note: me.equipment[slot].name,
            value: slot
          })),
          onPick: value => {
            payload.slot = value;
            next();
          }
        });
      });
    }

    if (prompt.stance) {
      tasks.push(next => {
        this.openPicker({
          title: '选择立场',
          items: ['赞成', '反对', '悬置'].map(stance => ({ label: stance, value: stance })),
          onPick: value => {
            payload.stance = value;
            next();
          }
        });
      });
    }

    if (prompt.basicType || prompt.trickType || prompt.agendaOrder) {
      tasks.push(next => {
        const choices = skill.choices || [];
        if (!choices.length) {
          this.toast('当前没有可选项。');
          return;
        }
        this.openPicker({
          title: prompt.agendaOrder ? '选择下一张出现的议题' : '选择牌类',
          items: choices.map(choice => ({ label: choice.label, value: choice.value })),
          onPick: value => {
            if (prompt.agendaOrder) payload.agendaId = value;
            else payload.cardId = value;
            next();
          }
        });
      });
    }

    const run = () => {
      const task = tasks.shift();
      if (!task) {
        this.useSkill(payload);
        return;
      }
      task(run);
    };
    run();
  }

  /* ------------------------------ 弹层 ------------------------------ */

  openPicker(options) {
    if (!options.items.length) {
      this.toast(options.emptyText || '当前没有可选项。');
      return;
    }
    this.sheet = {
      title: options.title,
      note: options.note || '',
      items: options.items,
      onPick: options.onPick,
      page: 0
    };
    this.draw();
  }

  openText(title, body) {
    this.sheet = { title, body: String(body || ''), page: 0 };
    this.draw();
  }

  openHand() {
    const me = this.view && this.view.self;
    if (!me) return;
    if (!me.hand.length) {
      this.openText('我的手牌', '当前没有手牌。');
      return;
    }
    const lines = me.hand.map(card => '「' + card.name + '」' + (card.tag || '') + '\n' + card.text);
    this.openText('我的手牌（' + me.hand.length + '）', lines.join('\n\n'));
  }

  openPlayer(player) {    const lines = [];
    lines.push('哲学家：' + (player.role ? player.role.name : '未知'));
    if (player.role) lines.push(player.role.era + ' · ' + player.role.school);
    lines.push('阵营：' + (player.faction || '尚未公开'));
    lines.push('心智：' + player.mind + ' / ' + player.maxMind);
    lines.push('手牌：' + player.handCount + ' 张');
    const equipment = [];
    if (player.equipment.offense) {
      equipment.push('进攻 · ' + player.equipment.offense.name + (player.equipment.offenseDisabled ? '（本议题失效）' : '') +
        '\n' + (player.equipment.offense.text || ''));
    }
    if (player.equipment.defense) {
      equipment.push('防守 · ' + player.equipment.defense.name + (player.equipment.defenseDisabled ? '（本议题失效）' : '') +
        '\n' + (player.equipment.defense.text || ''));
    }
    if (equipment.length) {
      lines.push('装备：');
      equipment.forEach(item => lines.push('· ' + item));
    } else {
      lines.push('装备：无');
    }
    if (player.marks.length) {
      lines.push('论证：' + player.marks.map(mark => (mark.stance || '暗置')).join('、'));
    }
    if (player.contract) lines.push('游士契约：' + player.contract.name + '\n' + player.contract.text);
    if (player.role && player.role.skills) {
      lines.push('');
      lines.push('角色技能');
      player.role.skills.forEach(skill => lines.push('「' + skill.name + '」' + skill.text));
    }
    this.openText(player.name, lines.join('\n'));
  }

  drawSheet() {
    const sheet = this.sheet;
    const width = metrics.width;
    const height = metrics.height;
    const left = 16;
    const boxWidth = width - 32;
    ctx.fillStyle = C.mask;
    ctx.fillRect(0, 0, width, height);

    if (sheet.body !== undefined) {
      const bodyMax = Math.max(57, height - 140 - 152);
      const maxLines = Math.max(3, Math.floor(bodyMax / 19));
      const bodyHeight = Math.min(
        wrapHeight(sheet.body, boxWidth - 28, F.small, null, 19, maxLines),
        maxLines * 19
      );
      const boxHeight = 92 + bodyHeight + 60;
      const top = Math.max(metrics.safeTop + 30, (height - boxHeight) / 2);
      roundRect(left, top, boxWidth, boxHeight, 16, C.paper, C.line);
      text(sheet.title, left + 16, top + 16, { size: F.h1, weight: 'bold', color: C.ink });
      wrap(sheet.body, left + 16, top + 48, boxWidth - 32, 19, maxLines, { size: F.small, color: C.muted });
      button(this, {
        x: left + 16, y: top + boxHeight - 52, w: boxWidth - 32, h: 40, label: '知道了',
        style: 'primary', fixed: true, overlay: true, onTap: () => { this.sheet = null; this.draw(); }
      });
      return;
    }

    const items = sheet.items || [];
    const perPage = Math.min(6, Math.max(2, Math.floor((height - 260) / 50)));
    const pages = Math.max(1, Math.ceil(items.length / perPage));
    sheet.page = Math.max(0, Math.min(pages - 1, sheet.page));
    const shown = items.slice(sheet.page * perPage, sheet.page * perPage + perPage);
    const extra = pages > 1 ? 50 : 0;
    const boxHeight = 88 + shown.length * 50 + extra + 52;
    const top = Math.max(metrics.safeTop + 24, (height - boxHeight) / 2);
    roundRect(left, top, boxWidth, boxHeight, 16, C.paper, C.line);
    text(sheet.title, left + 16, top + 16, { size: F.h1, weight: 'bold', color: C.ink });
    text(pages > 1 ? (sheet.page + 1) + ' / ' + pages : (sheet.note || '点选后继续'), left + boxWidth - 16, top + 20, {
      size: F.tiny, color: C.faint, align: 'right'
    });
    if (sheet.note && pages > 1) {
      text(sheet.note, left + 16, top + 46, { size: F.tiny, color: C.muted });
    }
    let y = top + 64;
    shown.forEach(item => {
      button(this, {
        x: left + 12, y, w: boxWidth - 24, h: 42,
        label: item.label,
        sub: item.note || '',
        style: item.disabled ? 'disabled' : 'secondary',
        align: 'left',
        fixed: true,
        overlay: true,
        disabled: !!item.disabled,
        onTap: () => {
          const onPick = this.sheet.onPick;
          this.sheet = null;
          if (onPick) onPick(item.value, item);
          this.draw();
        }
      });
      y += 50;
    });
    if (pages > 1) {
      const half = (boxWidth - 32) / 2;
      button(this, {
        x: left + 12, y, w: half, h: 38, label: '上一页', size: F.small, style: 'secondary',
        fixed: true, overlay: true, disabled: sheet.page === 0,
        onTap: () => { sheet.page--; this.draw(); }
      });
      button(this, {
        x: left + 20 + half, y, w: half, h: 38, label: '下一页', size: F.small, style: 'secondary',
        fixed: true, overlay: true, disabled: sheet.page >= pages - 1,
        onTap: () => { sheet.page++; this.draw(); }
      });
      y += 46;
    }
    button(this, {
      x: left + 12, y, w: boxWidth - 24, h: 38, label: '取消', size: F.small, style: 'secondary',
      fixed: true, overlay: true,
      onTap: () => { this.sheet = null; this.draw(); }
    });
  }

  /* ------------------------------ 输入 ------------------------------ */

  editText(field, maxLength) {
    if (!wx.showKeyboard) {
      this.toast('当前环境不支持输入，请使用真机。');
      return;
    }
    this.closeKeyboard(false);
    this.input = { field, maxLength };
    const handlers = {
      input: event => {
        if (!this.input || this.input.field !== field) return;
        this.setForm(field, event && event.value);
        this.draw();
      },
      confirm: event => this.closeKeyboard(true, event && event.value),
      complete: event => this.closeKeyboard(false, event && event.value)
    };
    this.keyboardHandlers = handlers;
    if (wx.onKeyboardInput) wx.onKeyboardInput(handlers.input);
    if (wx.onKeyboardConfirm) wx.onKeyboardConfirm(handlers.confirm);
    if (wx.onKeyboardComplete) wx.onKeyboardComplete(handlers.complete);
    try {
      wx.showKeyboard({
        defaultValue: this.form[field] || '',
        maxLength,
        multiple: false,
        confirmHold: false,
        confirmType: 'done',
        success: () => this.draw(),
        fail: error => {
          this.closeKeyboard(false);
          this.toast('输入框打开失败，请重试。');
        }
      });
    } catch (error) {
      this.closeKeyboard(false);
      this.toast('输入框打开失败，请重试。');
    }
  }

  setForm(field, value) {
    const textValue = String(value == null ? '' : value);
    if (field === 'code') {
      this.form.code = textValue.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
    } else {
      this.form[field] = textValue.slice(0, 16);
    }
  }

  closeKeyboard(hide, value) {
    const field = this.input && this.input.field;
    if (!field) return;
    if (value !== undefined && value !== null) this.setForm(field, value);
    this.input = null;
    const handlers = this.keyboardHandlers;
    this.keyboardHandlers = null;
    if (handlers) {
      if (wx.offKeyboardInput) wx.offKeyboardInput(handlers.input);
      if (wx.offKeyboardConfirm) wx.offKeyboardConfirm(handlers.confirm);
      if (wx.offKeyboardComplete) wx.offKeyboardComplete(handlers.complete);
    }
    if (hide && wx.hideKeyboard) wx.hideKeyboard();
    this.draw();
  }

  /* ------------------------------ 提示与房间操作 ------------------------------ */

  toast(message) {
    this.notice = String(message || '');
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      if (this.notice === message) {
        this.notice = '';
        this.draw();
      }
    }, 2600);
    this.draw();
  }

  showProblem(title, error) {
    wx.showModal({
      title: title || '操作失败',
      content: (error && error.message) || String(error || '请稍后重试。'),
      showCancel: false,
      confirmText: '知道了'
    });
  }

  remaining() {
    if (!this.view) return null;
    const room = this.view.room;
    let deadline = room.deadlines ? room.deadlines.phase : 0;
    if (room.pending && room.pending.deadline) deadline = room.pending.deadline;
    if (!deadline) return null;
    const seconds = Math.ceil((deadline - (Date.now() + this.clockSkew)) / 1000);
    return Math.max(0, seconds);
  }

  copyRoom() {
    wx.setClipboardData({
      data: this.roomCode,
      success: () => this.toast('房间号已复制：' + this.roomCode)
    });
  }

  shareRoom() {
    if (!wx.shareAppMessage) {
      this.copyRoom();
      return;
    }
    wx.shareAppMessage({
      title: '《真理未决》房间 ' + this.roomCode + '，来一局阵营推理',
      query: 'room=' + this.roomCode
    });
  }

  leaveRoom() {
    wx.showModal({
      title: '退出房间',
      content: '牌局尚未开始时退出会释放座位；已经开局则只退出本机，随时可以用房间号重新进入。',
      confirmText: '退出',
      cancelText: '取消',
      success: async result => {
        if (!result.confirm) return;
        try {
          await call('leave', { code: this.roomCode });
        } catch (error) {
          // 即使云端失败也允许本地退出
        }
        this.clearSession();
        this.page = 'home';
        this.notice = '已退出房间。';
        this.draw();
      }
    });
  }

  leaveToHome() {
    this.clearSession();
    this.page = 'home';
    this.tab = 'action';
    this.notice = '已返回首页。';
    this.draw();
  }
}
