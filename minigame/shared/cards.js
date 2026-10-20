/**
 * 《真理未决》规则数据源（唯一权威）
 *
 * 本文件同时供：
 *   1. 云函数规则引擎使用（tools/sync-cards.js 会复制到 cloudfunctions/game/rules/cards.js）
 *   2. 本地模拟测试使用
 *
 * 客户端不再保存副本：牌面信息由云端按玩家视角下发，避免两端数据漂移。
 *
 * 字段约定
 *   type        basic | trick | equipment
 *   target      other = 出牌时必须指定另一名存活玩家；none = 无需目标
 *   stance      出牌时需要声明赞成 / 反对
 *   mark        出牌时需要指定场上一枚论证标记
 *   slot        出牌时需要指定目标的装备栏（offense / defense）
 *   reveal      出牌时需要公开一张自己的其他手牌
 *   prediction  出牌时需要预测本轮结果
 *   responseOnly 只能作为响应打出，不能在行动阶段主动使用
 */

const philosophers = [
  {
    id: 'socrates', name: '苏格拉底', latin: 'Socrates', era: '古希腊 · 古典时期', school: '伦理学 / 对话法', hue: '#dba65d',
    insight: '以追问检验定义与信念；历史形象主要经柏拉图等人的对话保存。',
    source: 'https://en.wikipedia.org/wiki/Socrates',
    skills: [
      { name: '反诘', text: '每议题一次：一名玩家打出「论证」后，你可令其弃「反例」；否则移除该论证标记。' },
      { name: '助产术', text: '每议题一次：你的「论证」结算后仍在场，则摸 1 张牌。', auto: true }
    ]
  },
  {
    id: 'plato', name: '柏拉图', latin: 'Plato', era: '古希腊 · 古典时期', school: '理念论 / 政治哲学', hue: '#9e87c9',
    insight: '以对话探讨理念、知识与正义；洞穴寓言呈现感官与认知的落差。',
    source: 'https://en.wikipedia.org/wiki/Plato',
    skills: [
      { name: '理念型', text: '每议题开始查看议题牌堆顶两张，调整顺序。' },
      { name: '洞穴寓言', text: '每局一次：投票计票后、公布结果前，秘密将自己的票改为另一立场；由主持人更新总票。', auto: true }
    ]
  },
  {
    id: 'aristotle', name: '亚里士多德', latin: 'Aristotle', era: '古希腊 · 古典时期', school: '逻辑学 / 自然哲学', hue: '#a57845',
    insight: '系统整理逻辑、自然研究与伦理学；中道强调在具体情境中寻求适当尺度。',
    source: 'https://en.wikipedia.org/wiki/Aristotle',
    skills: [
      { name: '范畴', text: '每议题一次：查看牌堆顶两张，选一张加入手牌，另一张放回牌堆底。' },
      { name: '中道', text: '每议题第一次将失去心智时，改为弃 1 张手牌；没有手牌则照常失去。', auto: true }
    ]
  },
  {
    id: 'confucius', name: '孔子', latin: 'Confucius', era: '中国 · 春秋时期', school: '儒家 / 伦理与礼', hue: '#b87943',
    insight: '重视仁、礼与关系中的责任；名分与行动相符，是其政治伦理的重要主题。',
    source: 'https://en.wikipedia.org/wiki/Confucius',
    skills: [
      { name: '仁者', text: '每议题一次：选择一名其他玩家，使其免受下一次 1 点伤害。' },
      { name: '正名', text: '每议题一次：结算后，若你的投票与命题结果一致，摸 1 张牌。', auto: true }
    ]
  },
  {
    id: 'laozi', name: '老子', latin: 'Laozi', era: '中国 · 先秦思想', school: '道家 / 道与无为', hue: '#6f9a85',
    insight: '《道德经》与道家传统相连；无为强调减少强制干预，让事物循其脉络变化。',
    source: 'https://en.wikipedia.org/wiki/Laozi',
    skills: [
      { name: '无为', text: '每议题一次：被锦囊牌指定时，可弃 1 张牌令该牌对你无效。' },
      { name: '反者道之动', text: '每议题一次：若命题被悬置，你恢复 1 点心智。', auto: true }
    ]
  },
  {
    id: 'zhuangzi', name: '庄子', latin: 'Zhuangzi', era: '中国 · 战国时期', school: '道家 / 观点与变化', hue: '#79a694',
    insight: '《庄子》常借寓言动摇固定视角，讨论差异、变化与判断的限度。',
    source: 'https://en.wikipedia.org/wiki/Zhuangzi',
    skills: [
      { name: '齐物', text: '每议题一次：把场上一枚自己的「论证」标记，从赞成移到反对，或反向移动。' },
      { name: '逍遥游', text: '你的回合开始时，若手牌不超过 1 张，摸 1 张牌。', auto: true }
    ]
  },
  {
    id: 'mozi', name: '墨子', latin: 'Mozi', era: '中国 · 战国时期', school: '墨家 / 兼爱与非攻', hue: '#7b8790',
    insight: '墨家强调兼爱、尚贤与节用；非攻传统也与守城、实用技术相连。',
    source: 'https://en.wikipedia.org/wiki/Mozi',
    skills: [
      { name: '兼爱', text: '每议题一次：你可替一名其他玩家打出「反例」，为其抵消诘问。' },
      { name: '守城', text: '每议题一次：成为「辩论」目标时，可亮出任意一张手牌，视为打出一张「反例」。', auto: true }
    ]
  },
  {
    id: 'mencius', name: '孟子', latin: 'Mencius', era: '中国 · 战国时期', school: '儒家 / 性善与仁政', hue: '#bd8d55',
    insight: '以四端说明道德萌芽的可能，主张通过养护与教育扩展仁义。',
    source: 'https://en.wikipedia.org/wiki/Mencius',
    skills: [
      { name: '四端', text: '每议题一次：任一玩家失去心智后，你可令其恢复 1 点心智（不超过其角色上限）。', auto: true },
      { name: '浩然之气', text: '心智不高于 2 时，你打出的第一张「论证」额外增加 1 票影响。', auto: true }
    ]
  },
  {
    id: 'xunzi', name: '荀子', latin: 'Xunzi', era: '中国 · 战国时期', school: '儒家 / 礼法与学习', hue: '#8a755d',
    insight: '强调学习、礼与人为教化；其性恶论突出制度和实践对道德形成的作用。',
    source: 'https://en.wikipedia.org/wiki/Xunzi',
    skills: [
      { name: '化性起伪', text: '每议题一次：打出「研读」后，可额外弃 1 张牌，再摸 1 张。', auto: true },
      { name: '礼法', text: '每局一次：指定一种基础牌，本议题内每名玩家至多打出一张该牌。' }
    ]
  },
  {
    id: 'hanfei', name: '韩非', latin: 'Han Fei', era: '中国 · 战国末期', school: '法家 / 法、术、势', hue: '#9a6654',
    insight: '法家思想重视成文规范、治理术与权势结构；其著述影响后世政治思想。',
    source: 'https://en.wikipedia.org/wiki/Han_Fei',
    skills: [
      { name: '法不阿贵', text: '每议题一次：取消一件装备刚触发的效果。' },
      { name: '二柄', text: '每议题一次：你的「诘问」成功造成伤害后，摸 1 张牌或令目标再弃 1 张牌。', auto: true }
    ]
  },
  {
    id: 'epicurus', name: '伊壁鸠鲁', latin: 'Epicurus', era: '古希腊 · 希腊化时期', school: '伊壁鸠鲁学派 / 宁静', hue: '#c59b63',
    insight: '将免于身体痛苦与心灵纷扰视为重要目标，并重视友谊与审慎欲望。',
    source: 'https://en.wikipedia.org/wiki/Epicurus',
    skills: [
      { name: '宁静', text: '本议题未对其他玩家造成伤害时，结算阶段恢复 1 点心智。', auto: true },
      { name: '友谊', text: '每议题一次：交给一名玩家 1 张牌；你与其各摸 1 张牌。' }
    ]
  },
  {
    id: 'diogenes', name: '第欧根尼', latin: 'Diogenes of Sinope', era: '古希腊 · 犬儒学派', school: '犬儒主义 / 自足与直言', hue: '#b89061',
    insight: '犬儒传统以简朴、自足和对社会惯例的挑衅式批评闻名。',
    source: 'https://en.wikipedia.org/wiki/Diogenes',
    skills: [
      { name: '不持所有', text: '每议题一次：成为锦囊牌目标时，可弃置自己的装备，令该牌对你无效。' },
      { name: '直言', text: '你的回合一次：一名手牌比你多的玩家须展示手牌，你从中选择其弃 1 张基础牌。' }
    ]
  },
  {
    id: 'hypatia', name: '希帕提娅', latin: 'Hypatia', era: '罗马埃及 · 晚期古代', school: '数学 / 天文学 / 哲学', hue: '#8e9bc4',
    insight: '数学家、天文学家与哲学教师；在亚历山大城从事教学与学术活动。',
    source: 'https://en.wikipedia.org/wiki/Hypatia',
    skills: [
      { name: '星盘', text: '每议题一次：秘密查看一名玩家已放下的投票牌。' },
      { name: '学园讲坛', text: '每议题一次：你打出「研读」时，可展示一张基础牌；若展示，则额外摸 1 张。', auto: true }
    ]
  },
  {
    id: 'avicenna', name: '伊本·西那', latin: 'Avicenna', era: '波斯 · 伊斯兰黄金时代', school: '医学 / 形而上学', hue: '#6496a0',
    insight: '医师与哲学家，著作涵盖医学、逻辑和形而上学，影响跨越多个学术传统。',
    source: 'https://en.wikipedia.org/wiki/Avicenna',
    skills: [
      { name: '医者', text: '每议题一次：令一名玩家恢复 1 点心智，不得超过上限。' },
      { name: '自因', text: '每局一次：心智将降至 0 时，改为保留 1 点，并弃 2 张牌。', auto: true }
    ]
  },
  {
    id: 'ghazali', name: '安萨里', latin: 'Al-Ghazali', era: '波斯 · 伊斯兰思想', school: '神学 / 哲学批判', hue: '#786d98',
    insight: '伊斯兰神学家与思想家；其作品检视哲学论证的范围，并讨论知识与确信。',
    source: 'https://en.wikipedia.org/wiki/Al-Ghazali',
    skills: [
      { name: '怀疑之路', text: '每议题一次：取消场上一枚票数影响标记；若取消的是对手标记，摸 1 张牌。' },
      { name: '确信', text: '每局一次：投票计票后、公布结果前，秘密将自己的票改为悬置；由主持人更新总票。', auto: true }
    ]
  },
  {
    id: 'aquinas', name: '托马斯·阿奎那', latin: 'Thomas Aquinas', era: '中世纪 · 拉丁经院哲学', school: '经院哲学 / 自然法', hue: '#b18b61',
    insight: '经院哲学代表人物之一，尝试在基督教神学框架中吸收亚里士多德哲学。',
    source: 'https://en.wikipedia.org/wiki/Thomas_Aquinas',
    skills: [
      { name: '自然法', text: '每议题一次：令一名玩家免受强制改变投票的效果。' },
      { name: '经院合题', text: '每议题一次：你本回合打出基础牌、锦囊牌、装备牌中的两种类别后，摸 1 张牌。', auto: true }
    ]
  },
  {
    id: 'descartes', name: '笛卡尔', latin: 'René Descartes', era: '欧洲 · 近代早期', school: '理性主义 / 方法怀疑', hue: '#7692aa',
    insight: '通过方法性怀疑追问确定知识，并以思维主体作为哲学出发点。',
    source: 'https://en.wikipedia.org/wiki/Ren%C3%A9_Descartes',
    skills: [
      { name: '方法怀疑', text: '每议题一次：弃 1 张牌，抵消一张指定你的锦囊牌。' },
      { name: '我思', text: '每议题一次：若你打牌后手牌为空，摸 1 张牌。', auto: true }
    ]
  },
  {
    id: 'spinoza', name: '斯宾诺莎', latin: 'Baruch Spinoza', era: '欧洲 · 近代早期', school: '理性主义 / 一元论', hue: '#668d82',
    insight: '以实体一元论和几何式论证构建哲学体系，并系统讨论情感与自由。',
    source: 'https://en.wikipedia.org/wiki/Baruch_Spinoza',
    skills: [
      { name: '单一实体', text: '每议题一次：将受到的 1 点伤害改为弃 1 张手牌。', auto: true },
      { name: '情感几何', text: '你打出「论证」后，若没有人响应反例，摸 1 张牌；每议题一次。', auto: true }
    ]
  },
  {
    id: 'locke', name: '洛克', latin: 'John Locke', era: '英格兰 · 经验主义', school: '经验论 / 政治哲学', hue: '#9eaa81',
    insight: '经验论影响深远；其政治著作讨论自然权利、同意与政府权力。',
    source: 'https://en.wikipedia.org/wiki/John_Locke',
    skills: [
      { name: '白板', text: '开局额外摸 1 张牌。', auto: true },
      { name: '财产权', text: '每议题一次：当你的装备将被弃置时，可弃 1 张牌令其保留。', auto: true }
    ]
  },
  {
    id: 'hume', name: '休谟', latin: 'David Hume', era: '苏格兰 · 启蒙时代', school: '经验论 / 怀疑论', hue: '#799293',
    insight: '经验论与怀疑论的重要人物，质疑我们如何从经验形成因果和必然性的观念。',
    source: 'https://en.wikipedia.org/wiki/David_Hume',
    skills: [
      { name: '经验主义', text: '每议题一次：查看牌堆顶牌；若它与本回合刚打出的牌类别相同，可摸入手牌。', auto: true },
      { name: '因果怀疑', text: '每议题一次：取消刚发生的一项非伤害牌效果。' }
    ]
  },
  {
    id: 'kant', name: '康德', latin: 'Immanuel Kant', era: '普鲁士 · 启蒙时代', school: '批判哲学 / 义务伦理', hue: '#90899f',
    insight: '批判哲学考察知识的条件；定言令式是其伦理学的重要概念。',
    source: 'https://en.wikipedia.org/wiki/Immanuel_Kant',
    skills: [
      { name: '定言令式', text: '每局一次：指定一种锦囊牌，本议题内任何人都不能使用它。' },
      { name: '自律', text: '每议题一次：抵消强制改变你投票立场的效果。', auto: true }
    ]
  },
  {
    id: 'marx', name: '马克思', latin: 'Karl Marx', era: '欧洲 · 19 世纪', school: '历史唯物主义 / 政治经济学', hue: '#a86d58',
    insight: '分析资本主义生产关系、阶级结构与历史变化，并强调集体实践。',
    source: 'https://en.wikipedia.org/wiki/Karl_Marx',
    skills: [
      { name: '阶级分析', text: '每议题一次：查看手牌最多者的手牌；若其有装备，可令其弃一张装备。' },
      { name: '联合行动', text: '你与一名手牌少于你的玩家投同一立场时，各获得 +1 票影响；每议题一次。', auto: true }
    ]
  },
  {
    id: 'nietzsche', name: '尼采', latin: 'Friedrich Nietzsche', era: '欧洲 · 19 世纪', school: '价值批判 / 生命哲学', hue: '#bd7657',
    insight: '批判既定道德价值，倡议重新评估价值；作品主题常以格言和谱系分析呈现。',
    source: 'https://en.wikipedia.org/wiki/Friedrich_Nietzsche',
    skills: [
      { name: '重估价值', text: '每议题一次：弃置自己一件装备，使当前「论证」额外增加 2 票影响。' },
      { name: '强力意志', text: '心智不高于 2 时，你的「诘问」不能被装备抵消。', auto: true }
    ]
  },
  {
    id: 'hegel', name: '黑格尔', latin: 'Georg Wilhelm Friedrich Hegel', era: '普鲁士 · 德国古典哲学', school: '辩证法 / 历史哲学', hue: '#8d879e',
    insight: '德国古典哲学的重要人物，以辩证方法讨论思想、历史与精神的发展。',
    source: 'https://en.wikipedia.org/wiki/Georg_Wilhelm_Friedrich_Hegel',
    skills: [
      { name: '辩证扬弃', text: '每议题一次：辩论阶段中，将场上一枚论证标记移到相反立场；不能改变基础投票。' },
      { name: '精神显现', text: '每议题一次：命题悬置时，你摸 2 张牌，然后弃 1 张牌。', auto: true }
    ]
  },
  {
    id: 'arendt', name: '汉娜·阿伦特', latin: 'Hannah Arendt', era: '德国 / 美国 · 20 世纪', school: '政治哲学 / 公共行动', hue: '#7194a1',
    insight: '关注公共领域、行动与政治判断；共同参与行动是其政治思想的重要主题。',
    source: 'https://en.wikipedia.org/wiki/Hannah_Arendt',
    skills: [
      { name: '公共领域', text: '每局一次：结果结算前发起重新投票；所有存活玩家必须重新投票。' },
      { name: '共同行动', text: '每议题一次：若至少两名其他玩家与你投同一立场，该立场 +1 票影响。', auto: true }
    ]
  }
];

// 心智上限：2 点角色偏强，3 点为常规（0.9.2 起全体下调 1 点，让对局更容易出现淘汰）
const lowerMindRoles = new Set([
  'socrates', 'plato', 'aristotle', 'confucius', 'laozi', 'mozi',
  'mencius', 'hanfei', 'epicurus', 'avicenna', 'spinoza', 'arendt'
]);
philosophers.forEach(role => { role.mind = lowerMindRoles.has(role.id) ? 2 : 3; });

const basics = [
  {
    id: 'argument', name: '论证', count: 12, icon: '⌁', category: '立场',
    text: '出牌时选择赞成或反对，为该立场增加 1 票影响。每人每议题最多保留 2 枚论证标记；被「反例」或指定效果移除。',
    note: '高频核心牌；提供公开施压，也会暴露倾向。',
    target: 'none', stance: true, mark: false
  },
  {
    id: 'challenge', name: '诘问', count: 10, icon: '?', category: '进攻',
    text: '指定一名玩家。其可立即打出「反例」；否则失去 1 点心智，且本议题投票改为悬置。',
    note: '伤害与沉默合一；数量低于论证和防御牌，避免连续压制。',
    target: 'other'
  },
  {
    id: 'counterexample', name: '反例', count: 10, icon: '↶', category: '防御',
    text: '响应「诘问」时抵消该牌；也可在投票前移除场上一枚论证标记。',
    note: '稳定反制；数量与诘问相同，确保有机会防守。',
    target: 'none', mark: true
  },
  {
    id: 'study', name: '研读', count: 8, icon: '▤', category: '补牌',
    text: '摸 2 张牌，然后弃 1 张牌。',
    note: '补充手牌但不净增，避免长期雪球。',
    target: 'none'
  },
  {
    id: 'breathe', name: '调息', count: 8, icon: '◌', category: '恢复',
    text: '恢复 1 点心智，不得超过角色牌标示的心智上限。',
    note: '每局常见伤害为 1 点；8 张提供续航但不会快速回满。',
    target: 'none'
  },
  {
    id: 'citation', name: '引证', count: 4, icon: '❞', category: '强化',
    text: '展示一张手牌，为赞成或反对增加 1 票影响；若展示的是锦囊牌，结算后摸 1 张牌。',
    note: '低张数的高回报牌；要求公开手牌信息。',
    target: 'none', stance: true, reveal: true
  },
  {
    id: 'concede', name: '让步', count: 4, icon: '⇢', category: '转圜',
    text: '将自己本议题的投票改为悬置，并取消对自己的一次诘问或强制改票效果；随后摸 1 张牌。',
    note: '稀有脱身牌，不直接增加任何阵营进度。',
    target: 'none'
  },
  {
    id: 'listen', name: '旁听', count: 4, icon: '◉', category: '选牌',
    text: '查看牌堆顶 2 张牌，选择 1 张加入手牌，另一张放回牌堆底。',
    note: '过滤牌序而非额外摸牌；帮助寻找反制或装备。',
    target: 'none'
  },
  {
    id: 'reflection', name: '反思', count: 4, icon: '↺', category: '转向',
    text: '移除你场上一枚「论证」标记，并将它改为相反立场重新放置。若你没有论证标记，改为摸 1 张牌。',
    note: '同一回合限用一次；可修正公开立场，但不会凭空增加票数。',
    target: 'none'
  },
  {
    id: 'evidence', name: '求证', count: 4, icon: '⌕', category: '选牌',
    text: '查看牌堆顶 3 张牌，选择一张基础牌加入手牌；其余牌以任意顺序放到牌堆底。若其中没有基础牌，摸 1 张牌。',
    note: '四张提供有限的定向找牌，不能直接检索强锦囊或装备。',
    target: 'none'
  },
  {
    id: 'deliberation', name: '共议', count: 4, icon: '⟷', category: '协作',
    text: '选择一名其他玩家。你与其各摸 1 张牌，然后各弃 1 张牌。',
    note: '改善双方手牌质量，不增加净手牌；帮助身份不同的玩家短暂合作。',
    target: 'other'
  }
];

const tricks = [
  {
    id: 'debate', name: '辩论', count: 8, icon: '⚔', category: '对决',
    text: '出牌者指定一名其他玩家。双方轮流弃 1 张「论证」或「反例」，由出牌者先开始。首位无法出牌者失去 1 点心智，并将本议题投票改为悬置。',
    note: '对决型主力锦囊；8 张约占 141 张主牌库的 5.7%，避免每轮都被强制对决。',
    target: 'other'
  },
  {
    id: 'reductio', name: '归谬法', count: 4, icon: '∴', category: '拆解',
    text: '指定一枚论证标记的持有者。其可弃 1 张「反例」保留标记；否则移除该标记并弃 1 张手牌。',
    note: '稀有双重压力，需已有论证标记才可使用。',
    target: 'other', mark: true
  },
  {
    id: 'pact', name: '公意契约', count: 4, icon: '⌘', category: '协议',
    text: '使用前声明赞成或反对。投票后，与你同一立场的玩家各摸 1 张牌；若该立场没有至少两票，本牌使用者弃 1 张牌。',
    note: '鼓励结盟但存在落空代价。',
    target: 'none', stance: true
  },
  {
    id: 'razor', name: '奥卡姆剃刀', count: 4, icon: '✂', category: '拆装',
    text: '弃置场上一件装备。若目标本议题已有另一件装备，目标可弃 1 张手牌保护本装备。',
    note: '装备破坏有防守窗口，不会无条件拆除关键套装。',
    target: 'other', slot: true
  },
  {
    id: 'experiment', name: '思想实验', count: 4, icon: '◇', category: '预测',
    text: '秘密选择本议题结果：通过、否决或悬置。结果揭晓后，猜中摸 2 张牌；猜错弃 1 张牌。',
    note: '读局奖励，不直接操纵结果。',
    target: 'none', prediction: true
  },
  {
    id: 'rewrite', name: '议程改写', count: 3, icon: '⟳', category: '议题',
    text: '投票前使用：弃置当前命题，翻开下一张命题替换；所有论证标记移除。最后一轮不能使用。',
    note: '低张数的大幅改局牌，且最后一轮锁定议题。',
    target: 'none'
  },
  {
    id: 'smokescreen', name: '修辞烟幕', count: 3, icon: '☁', category: '投票',
    text: '投票前指定一名玩家。该玩家先秘密放置投票；其他人依次投票后才公开。其不能再改变投票。',
    note: '制造信息优势，不改变票数。',
    target: 'other'
  },
  {
    id: 'memory', name: '群体记忆', count: 3, icon: '▧', category: '回收',
    text: '从弃牌堆选择一张基础牌加入手牌；若弃牌堆没有基础牌，则摸 1 张牌。',
    note: '通用补给仅 3 张，减少反复循环强牌。',
    target: 'none'
  },
  {
    id: 'chorus', name: '众声合鸣', count: 3, icon: '♫', category: '共鸣',
    text: '投票前声明赞成或反对。若最终至少三名存活玩家投该立场，为其增加 2 票影响；否则使用者失去 1 点心智。',
    note: '多人局威力高，少人局更冒险；须满足三票条件。',
    target: 'none', stance: true
  },
  {
    id: 'paradox', name: '逻辑悖论', count: 3, icon: '⊗', category: '响应',
    text: '响应一张指定你的锦囊牌时使用（「辩论」除外）：取消该牌对你的效果。此牌与被取消的牌一同进入弃牌堆。',
    note: '三张关键反制牌；不能打断「辩论」，避免对决失去威胁。',
    target: 'none', responseOnly: true
  },
  {
    id: 'scrutiny', name: '公开审查', count: 3, icon: '⌖', category: '揭示',
    text: '指定一名玩家。其展示全部手牌，你选择其中一张弃置。若其没有手牌，则改为令其失去 1 点心智。',
    note: '强力但稀有的定点干扰，只有三张；装备与技能仍可抵消指定效果。',
    target: 'other'
  },
  {
    id: 'chain', name: '证据链', count: 3, icon: '∴', category: '拆解',
    text: '指定一名拥有论证标记的玩家。其选择弃 1 张手牌，或移除自己一枚论证标记；没有手牌时必须移除标记。',
    note: '三张条件型压力牌；要求目标已有标记，且由目标选择损失类型。',
    target: 'other', mark: true
  }
];

const equipment = [
  { id: 'staff', name: '诡辩手杖', count: 2, kind: '进攻', icon: '♜', text: '每议题一次：你打出「诘问」时，目标须弃「反例」或弃 2 张手牌（不足则失去 1 点心智）。' },
  { id: 'hammer', name: '尼采之锤', count: 2, kind: '进攻', icon: '⚒', text: '每议题一次：你的伤害结算后，可弃置受伤者一件装备。' },
  { id: 'sword', name: '达摩克利斯之剑', count: 2, kind: '进攻', icon: '⚔', text: '你发起「辩论」时，对方必须先出牌；若对方先无法出牌，本次额外弃 1 张手牌。' },
  { id: 'logic', name: '亚里士多德逻辑尺', count: 2, kind: '进攻', icon: '⟋', text: '你每议题第一枚「论证」标记不能被「反例」移除。' },
  { id: 'lever', name: '阿基米德杠杆', count: 2, kind: '进攻', icon: '⚖', text: '每议题一次：你使用「归谬法」时，目标若不弃反例，须再弃置一张装备或失去 1 点心智。' },
  { id: 'mask', name: '修辞面具', count: 2, kind: '进攻', icon: '◐', text: '每议题一次：你打出的「论证」可在投票揭晓前保持暗置；它仍计入票数。' },
  { id: 'code', name: '汉谟拉比法典', count: 2, kind: '防守', icon: '▤', text: '每议题一次：你受到其他玩家造成的伤害时，令其选择弃 1 张手牌或再失去 1 点心智。' },
  { id: 'mala', name: '佛珠', count: 2, kind: '防守', icon: '◦', text: '每议题一次：弃 1 张手牌，抵消对自己造成的 1 点伤害。' },
  { id: 'bagua', name: '八卦镜', count: 2, kind: '防守', icon: '☯', text: '每议题一次：将指定自己的锦囊牌转移给其使用者；不能转移「辩论」。' },
  { id: 'rosary', name: '玫瑰经念珠', count: 2, kind: '防守', icon: '✧', text: '每议题第一次投悬置后，若你未受伤，恢复 1 点心智。' },
  { id: 'cloak', name: '斯多亚斗篷', count: 2, kind: '防守', icon: '⌂', text: '每议题一次：抵消令你改变投票或失去行动的效果。' },
  { id: 'tasbih', name: '塔斯比念珠', count: 2, kind: '防守', icon: '◦', text: '每议题一次：你投悬置后，可将 1 张手牌交给任意玩家；若其接受，你摸 1 张牌。' }
];

const agendas = [
  {
    id: 'agenda-wealth', name: '城邦是否应限制财富差距？', icon: '⚖', category: '分配正义',
    text: '本议题投票结算后，先比较所有存活玩家的手牌数：手牌最多者各弃 1 张（没有手牌则跳过），手牌最少者各摸 1 张。若同一人同时处于最多与最少，先弃后摸。',
    note: '公开命题并改变本轮手牌资源；平局时同一档玩家都执行。'
  },
  {
    id: 'agenda-law', name: '法律应优先保护自由还是秩序？', icon: '⌘', category: '法与自由',
    text: '本议题中，每名玩家第一次受到强制改票效果时，可以弃 1 张手牌抵消这次改票；每人限一次。',
    note: '给强制改票留出一次个人反制，弃牌成本让选择仍有代价。'
  },
  {
    id: 'agenda-harm', name: '善意能否抵消制度造成的伤害？', icon: '◉', category: '责任伦理',
    text: '本议题中，每名玩家第一次将失去心智时，可以弃 1 张手牌来避免这 1 点损失；每人限一次。',
    note: '提供一次有成本的自保；弃牌后仍可在同一议题再次受伤。'
  },
  {
    id: 'agenda-knowledge', name: '知识来自理性、经验，还是共同生活？', icon: '⌕', category: '知识论',
    text: '本议题中，每名玩家第一次使用「求证」时，改为查看牌堆顶 4 张牌，并选择一张基础牌加入手牌；其余牌以任意顺序放到牌堆底。若其中没有基础牌，改为摸 1 张牌。',
    note: '强化定向找牌，但仍只能找到基础牌，且每人只强化一次。'
  },
  {
    id: 'agenda-minority', name: '多数人可能犯错时，少数能否阻止决定？', icon: '↶', category: '少数权利',
    text: '本议题中，若赞成票与反对票在论证标记等修正后相差恰好 1 票，结果改为悬置。',
    note: '只在票差为 1 时触发；不改变票数，也不偏向任何固定立场。'
  },
  {
    id: 'agenda-happiness', name: '幸福来自欲望满足，还是欲望减少？', icon: '◌', category: '幸福论',
    text: '本议题中，每名玩家第一次使用「调息」时恢复 2 点心智，而非 1 点；不得超过角色的心智上限。',
    note: '提升一次回复的效率；每张调息仍只使用一次，且不能突破上限。'
  },
  {
    id: 'agenda-property', name: '财产权是否应当不可侵犯？', icon: '▤', category: '财产权',
    text: '本议题中，每名玩家第一次有装备将被其他玩家的牌或技能弃置时，可以弃 1 张手牌保住该装备；每人限一次。',
    note: '保护装备需要支付手牌；不阻止自己主动更换装备。'
  },
  {
    id: 'agenda-objection', name: '公民是否有权拒绝服从？', icon: '⇢', category: '公民抗命',
    text: '本议题投票阶段，每名玩家可以弃 1 张手牌，将自己的投票改为悬置；每人限一次。',
    note: '给个人保留退出表决的方式，但会消耗手牌且不改变他人投票。'
  },
  {
    id: 'agenda-countervoice', name: '异议是否应当被保留？', icon: '∴', category: '反例与异议',
    text: '本议题中，「反例」移除一枚论证标记后，该标记的持有者摸 1 张牌。若同一张反例移除多个标记，每名持有者各摸 1 张。',
    note: '让反驳不只是削弱票数；每个被移除的标记至多触发一次摸牌。'
  },
  {
    id: 'agenda-majority', name: '争议是否必须由多数裁决？', icon: '⅔', category: '多数原则',
    text: '本议题的赞成或反对票，须达到存活玩家数的三分之二（向上取整）才算通过或否决；两方都未达到时结果为悬置。',
    note: '提高形成结论的门槛；论证标记计入对应立场的票数。'
  }
];

const contracts = [
  { id: 'contract-guardian', name: '心智守望', icon: '◉', kind: 'survive', text: '游戏结束时，你仍存活且至少有 2 点心智。', note: '个人秘密目标；满足条件并存活即可与任一阵营共胜。' },
  { id: 'contract-archivist', name: '藏书人', icon: '▤', kind: 'survive', text: '游戏结束时，你仍存活且手牌不少于 3 张。', note: '鼓励留牌与调度；不要求特定阵营或议题结果。' },
  { id: 'contract-concord', name: '合议者', icon: '⟷', kind: 'survive', text: '至少在本局已结算议题的一半（向上取整）中，你投票支持了该议题的最终结果；游戏结束时仍存活。悬置议题不计入支持票。', note: '需要观察局势并参与秘密表决；短局最多 3 轮、标准局最多 5 轮，分别至少支持 2 次或 3 次。' },
  { id: 'contract-dissenter', name: '异议者', icon: '↶', kind: 'survive', text: '至少一次，在一个已通过或已否决的议题中，你投票反对最终结果；游戏结束时仍存活。', note: '要求一次真实的逆势选择；悬置议题不计。' },
  { id: 'contract-witness', name: '悬置见证者', icon: '⌖', kind: 'survive', text: '本局至少有一个议题以悬置结算；游戏结束时你仍存活。', note: '目标依赖全局进程，游士可以通过出牌与投票影响是否悬置。' },
  { id: 'contract-rhetor', name: '连环论者', icon: '⌁', kind: 'survive', text: '至少一个自己的辩论回合中，使用两张或更多不同名称的牌；游戏结束时仍存活。', note: '奖励组合出牌；响应牌不算作你的辩论回合出牌。' },
  { id: 'contract-pacifist', name: '不伤者', icon: '✧', kind: 'survive', text: '整局中，你没有造成任何玩家失去心智；游戏结束时你仍存活。', note: '适合偏向防守、调度与议题控制的玩法。' },
  { id: 'contract-curator', name: '器物守护者', icon: '⚖', kind: 'survive', text: '至少装备过一件装备，并在游戏结束时仍存活；当前是否仍装备该牌不作要求。', note: '鼓励使用装备而不要求保住它，避免被对手拆牌后目标无法完成。' },
  { id: 'contract-martyr', name: '殉道者', icon: '✝', kind: 'death', text: '在被其他玩家造成伤害淘汰之前，至少有一个非悬置议题已经结算，且你的投票支持了最终结果（赞成支持通过，反对支持否决）。随后你必须在本局结束前出局。条件达成后，即使你已出局，也可在终局获得个人契约胜利。', note: '先参与一次有效结论，再承担被击倒的风险；自愿弃置或其他非玩家伤害不算完成。' },
  { id: 'contract-counterproof', name: '反证者', icon: '⊗', kind: 'death', text: '在被其他玩家造成伤害淘汰之前，至少有一个议题以悬置结算，且你在该议题投了悬置。随后你必须在本局结束前出局。条件达成后，即使你已出局，也可在终局获得个人契约胜利。', note: '需要推动并亲自投出一次悬置，再承担被击倒的风险；自愿弃置或其他非玩家伤害不算完成。' }
];

// 阵营配置（人数 → 阵营列表）
const factionsByCount = {
  4: ['建构派', '建构派', '怀疑派', '游士'],
  5: ['建构派', '建构派', '建构派', '怀疑派', '游士'],
  6: ['建构派', '建构派', '建构派', '怀疑派', '怀疑派', '游士'],
  7: ['建构派', '建构派', '建构派', '建构派', '怀疑派', '怀疑派', '游士'],
  8: ['建构派', '建构派', '建构派', '建构派', '怀疑派', '怀疑派', '怀疑派', '游士']
};

const rules = {
  minPlayers: 4,
  maxPlayers: 8,
  handSize: 4,
  // 每轮摸牌数：4—5 人局 1 张，6—8 人局 2 张
  drawPerRound(expected) { return expected <= 5 ? 1 : 2; },
  maxRounds(expected) { return expected <= 5 ? 3 : 5; },
  // 计时器（秒）
  timers: { night: 60, turn: 120, vote: 60, ostracism: 30, pending: 30, result: 20 },
  stances: ['赞成', '反对', '悬置']
};

module.exports = {
  philosophers,
  basics,
  tricks,
  equipment,
  agendas,
  contracts,
  factionsByCount,
  rules
};

