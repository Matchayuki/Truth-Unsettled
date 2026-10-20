/**
 * 云函数调用封装与错误文案。
 *
 * 免费版 CloudBase 云函数固定 3 秒超时，冷启动时可能偶发超时。
 * 这里对超时/网络错误自动重试，并给每次写操作带上 opId；
 * 服务端会按 opId 去重，重试不会重复出牌、投票或建房。
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MUTATING = new Set([
  'create', 'join', 'start', 'night', 'play', 'respond', 'skill', 'vote', 'endTurn', 'next'
]);

function friendly(error) {
  const message = String((error && (error.errMsg || error.message)) || error || '');
  const lower = message.toLowerCase();
  if (lower.indexOf('function not found') >= 0 || lower.indexOf('function_not_found') >= 0 ||
    (lower.indexOf('cloud function') >= 0 && lower.indexOf('not exist') >= 0)) {
    return '找不到云函数 game。请重新部署 deploy/game 到 CloudBase 环境。';
  }
  if (lower.indexOf('relation') >= 0 && lower.indexOf('does not exist') >= 0) {
    return '数据库表 truth_rooms 不存在，请先在 CloudBase 的 SQL 编辑器执行建表语句。';
  }
  if (lower.indexOf('permission denied') >= 0) {
    return '数据库表 truth_rooms 权限不足，请执行 GRANT ALL ON TABLE public.truth_rooms TO PUBLIC。';
  }
  if (lower.indexOf('env') >= 0 && (lower.indexOf('invalid') >= 0 || lower.indexOf('not found') >= 0)) {
    return 'CloudBase 环境不可用。请确认 AppID 已关联云环境 truth-unsettled-d5fu693h4e728350。';
  }
  if (lower.indexOf('timeout') >= 0 || lower.indexOf('timed out') >= 0 ||
    lower.indexOf('time limit') >= 0 || lower.indexOf('-504003') >= 0 ||
    lower.indexOf('network') >= 0 || lower.indexOf('fail to fetch') >= 0) {
    return '云函数响应超时（免费版 3 秒限制），已自动重试仍未成功。请再点一次，通常第二次会命中热实例。';
  }
  if (message) return message;
  return '操作没有完成，请稍后重试。';
}

function retryable(error) {
  const message = String((error && (error.errMsg || error.message)) || '').toLowerCase();
  return message.indexOf('timeout') >= 0 || message.indexOf('timed out') >= 0 ||
    message.indexOf('time limit') >= 0 || message.indexOf('-504003') >= 0 ||
    message.indexOf('network') >= 0 || message.indexOf('fail to fetch') >= 0 ||
    message.indexOf('system error') >= 0;
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function makeCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function call(action, payload) {
  if (!wx.cloud || !wx.cloud.callFunction) {
    throw new Error('云开发不可用。请确认 project.config.json 的 AppID 已关联 CloudBase 环境。');
  }
  const data = Object.assign({ action }, payload || {});
  if (MUTATING.has(action)) {
    if (!data.opId) data.opId = makeId();
    // 客户端生成房间号：同一个码重试时服务端可以识别为同一间房。
    if (action === 'create' && !data.code) data.code = makeCode();
  }

  let response = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await wx.cloud.callFunction({ name: 'game', data });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt >= 2 || !retryable(error)) break;
      await delay(300 + attempt * 500);
    }
  }
  if (lastError) throw new Error(friendly(lastError));

  const result = response && response.result;
  if (!result) throw new Error('云函数没有返回数据，请重新部署 game 云函数。');
  if (result.ok === false) {
    const error = new Error(result.error || '云端处理失败。');
    error.code = result.code || 'RULE';
    throw error;
  }
  return result;
}
