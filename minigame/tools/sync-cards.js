/**
 * 把唯一权威的 shared/cards.js 同步到云函数目录。
 *
 * 用法：node tools/sync-cards.js
 * 之后在微信开发者工具中重新“上传并部署”云函数 game。
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'shared', 'cards.js');
const target = path.join(root, 'cloudfunctions', 'game', 'rules', 'cards.js');

const banner = '/* 自动生成，请勿直接修改；编辑 shared/cards.js 后运行 node tools/sync-cards.js */\n';
const body = fs.readFileSync(source, 'utf8');

fs.mkdirSync(path.dirname(target), { recursive: true });
const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
const next = banner + body;
if (previous === next) {
  console.log('规则数据已是最新：' + path.relative(root, target));
} else {
  fs.writeFileSync(target, next, 'utf8');
  console.log('已同步规则数据 -> ' + path.relative(root, target));
}
