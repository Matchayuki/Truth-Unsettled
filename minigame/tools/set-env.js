/**
 * 切换云开发环境 ID：同时更新客户端与云函数入口。
 *
 *   node tools/set-env.js truth-unsettled-xxxxxxxx
 *
 * 修改后还需要：
 *   1. node tools/build-cloud.js
 *   2. 重新部署 deploy/game 云函数
 *   3. 在新环境创建集合 truth_rooms，并把云函数超时改为 20 秒
 */
const fs = require('node:fs');
const path = require('node:path');

const envId = String(process.argv[2] || '').trim();
if (!/^[a-zA-Z0-9-]{6,64}$/.test(envId)) {
  console.error('用法：node tools/set-env.js <云开发环境ID>');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const files = [
  {
    file: path.join(root, 'game.js'),
    pattern: /env:\s*'[^']*'/,
    replacement: `env: '${envId}'`
  },
  {
    file: path.join(root, 'cloudfunctions', 'game', 'index.js'),
    pattern: /const ENV_ID = '[^']*'/,
    replacement: `const ENV_ID = '${envId}'`
  }
];

files.forEach(item => {
  const source = fs.readFileSync(item.file, 'utf8');
  if (!item.pattern.test(source)) {
    console.error('未找到要替换的环境配置：' + path.relative(root, item.file));
    process.exit(1);
  }
  fs.writeFileSync(item.file, source.replace(item.pattern, item.replacement), 'utf8');
  console.log('已更新 ' + path.relative(root, item.file));
});

console.log('环境已切换为 ' + envId + '。下一步：node tools/build-cloud.js，然后重新部署 deploy/game。');
