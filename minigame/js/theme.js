export const C = {
  bg: '#f2eee4',
  paper: '#fffdf8',
  ink: '#1f3042',
  deep: '#16222f',
  gold: '#b98b4a',
  goldSoft: '#e6d2a8',
  goldPale: '#f4ead4',
  line: '#ded4c2',
  muted: '#7a7164',
  faint: '#a89d8c',
  green: '#4f7d63',
  red: '#a3453a',
  purple: '#6b5b7d',
  blue: '#45657f',
  white: '#ffffff',
  mask: 'rgba(22,34,47,0.72)',
  shadow: 'rgba(31,48,66,0.10)'
};

export const F = {
  display: 28,
  title: 21,
  h1: 18,
  h2: 16,
  body: 13.5,
  small: 12,
  tiny: 10.5
};

export const PHASE = {
  lobby: '等待玩家',
  night: '秘密夜间行动',
  action: '自由行动',
  vote: '秘密投票',
  result: '本轮结算',
  finished: '游戏结束'
};

export const PHASE_HINT = {
  lobby: '等待所有玩家加入',
  night: '怀疑派秘密选择目标，其余玩家等待',
  action: '按顺序行动，可以连续打出多张牌',
  vote: '所有存活玩家同时秘密投票',
  result: '公布票数，检查阵营与契约',
  finished: '本局已经结束'
};

export const FACTION_COLOR = {
  建构派: C.blue,
  怀疑派: C.purple,
  游士: C.gold
};

export const FACTION_DESC = {
  建构派: '让过半命题通过，或淘汰全部怀疑派',
  怀疑派: '让过半命题被否决或悬置，或人数追平其他存活玩家',
  游士: '完成自己的秘密契约，可与其他阵营共胜'
};
