/**
 * 把云函数 rules/ 下的多个模块打包成单文件，输出到 deploy/game/。
 *
 *   node tools/build-cloud.js
 *
 * 背景：部分 CloudBase 环境通过 CLI 部署时子目录模块加载不稳定，
 * 单文件入口可以完全避免 “Cannot find module './rules/...'”。
 * 规则源码仍然保留在 cloudfunctions/game/rules/，这里是构建产物。
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const rulesDir = path.join(root, 'cloudfunctions', 'game', 'rules');
const sharedDir = path.join(root, 'shared');
const outputDir = path.join(root, 'deploy', 'game');

const order = ['cards', 'catalog', 'core', 'play', 'skills', 'engine', 'view', 'index'];
const relativeModules = new Set(order);

function resolveModule(specifier, fromName) {
  if (!specifier.startsWith('.')) return null;
  let base = path.basename(specifier, '.js');
  if (base === 'rules') base = 'index';
  if (!relativeModules.has(base)) {
    throw new Error('无法解析 ' + fromName + ' 中的模块：' + specifier);
  }
  return base;
}

function wrapModule(name, source) {
  const rewritten = source.replace(/require\('([^']+)'\)/g, (match, specifier) => {
    const target = resolveModule(specifier, name);
    return target ? `__require('${target}')` : match;
  });
  return `__modules[${JSON.stringify(name)}] = (function () {\n` +
    `  const module = { exports: {} };\n` +
    `  const exports = module.exports;\n` +
    `${rewritten}\n` +
    `  return module.exports;\n` +
    `})();\n`;
}

function readModule(name) {
  if (name === 'cards') {
    return fs.readFileSync(path.join(sharedDir, 'cards.js'), 'utf8');
  }
  if (name === 'index') {
    return fs.readFileSync(path.join(root, 'cloudfunctions', 'game', 'index.js'), 'utf8');
  }
  return fs.readFileSync(path.join(rulesDir, name + '.js'), 'utf8');
}

const parts = [];
parts.push('/* 自动生成，请勿直接修改；源码在 cloudfunctions/game/ 与 shared/，运行 node tools/build-cloud.js 重新生成 */');
parts.push('const __modules = {};');
parts.push('function __require(name) { return __modules[name]; }');
order.forEach(name => {
  parts.push(wrapModule(name, readModule(name)).trim());
});
parts.push('module.exports = __modules.index;');
parts.push('');

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'index.js'), parts.join('\n\n'), 'utf8');
['package.json', 'config.json'].forEach(file => {
  fs.copyFileSync(path.join(root, 'cloudfunctions', 'game', file), path.join(outputDir, file));
});

const size = fs.statSync(path.join(outputDir, 'index.js')).size;
console.log('已生成 ' + path.relative(root, path.join(outputDir, 'index.js')) + '（' + Math.round(size / 1024) + ' KB）');
console.log('部署：微信开发者工具右键 deploy/game，或使用 CLI 的 --paths 指向该目录。');
