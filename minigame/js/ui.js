import { ctx, metrics } from './render.js';
import { C, F } from './theme.js';

export function setFont(size, weight) {
  ctx.font = (weight || 'normal') + ' ' + Math.round(size) + 'px sans-serif';
}

export function measure(value, size, weight) {
  setFont(size || F.body, weight);
  return ctx.measureText(String(value == null ? '' : value)).width;
}

export function truncate(value, maxWidth, size, weight) {
  const source = String(value == null ? '' : value);
  if (measure(source, size, weight) <= maxWidth) return source;
  let text = source;
  while (text.length > 1 && measure(text + '…', size, weight) > maxWidth) text = text.slice(0, -1);
  return text + '…';
}

export function text(value, x, y, options) {
  const opts = options || {};
  setFont(opts.size || F.body, opts.weight);
  ctx.fillStyle = opts.color || C.ink;
  ctx.textAlign = opts.align || 'left';
  ctx.textBaseline = opts.baseline || 'top';
  ctx.fillText(String(value == null ? '' : value), x, y);
}

export function wrap(value, x, y, maxWidth, lineHeight, maxLines, options) {
  const opts = options || {};
  const size = opts.size || F.body;
  const weight = opts.weight;
  const source = String(value == null ? '' : value);
  const lines = [];
  let line = '';
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '\n') {
      lines.push(line);
      line = '';
      if (lines.length >= maxLines) break;
      continue;
    }
    const next = line + char;
    if (line && measure(next, size, weight) > maxWidth) {
      lines.push(line);
      line = char;
      if (lines.length >= maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  const consumed = lines.join('').length;
  if (consumed < source.length && lines.length) {
    const last = lines.length - 1;
    lines[last] = truncate(lines[last] + '…', maxWidth, size, weight);
  }
  setFont(size, weight);
  ctx.fillStyle = opts.color || C.ink;
  ctx.textAlign = opts.align || 'left';
  ctx.textBaseline = 'top';
  lines.forEach((item, index) => ctx.fillText(item, x, y + index * lineHeight));
  return lines.length * lineHeight;
}

export function wrapHeight(value, maxWidth, size, weight, lineHeight, maxLines) {
  const source = String(value == null ? '' : value);
  let lines = 0;
  let line = '';
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '\n') {
      lines++;
      line = '';
      if (maxLines && lines >= maxLines) return lines * lineHeight;
      continue;
    }
    const next = line + char;
    if (line && measure(next, size, weight) > maxWidth) {
      lines++;
      line = char;
      if (maxLines && lines >= maxLines) return lines * lineHeight;
    } else {
      line = next;
    }
  }
  if (line) lines++;
  return Math.min(maxLines || lines, lines) * lineHeight;
}

export function roundRect(x, y, w, h, radius, fill, stroke, lineWidth) {
  const r = Math.min(radius == null ? 10 : radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth || 1;
    ctx.stroke();
  }
}

export function panel(x, y, w, h, title, subtitle, options) {
  const opts = options || {};
  roundRect(x, y, w, h, opts.radius == null ? 14 : opts.radius, opts.fill || C.paper, opts.stroke || C.line);
  let cursor = y + 13;
  if (title) {
    text(title, x + 14, cursor, { size: opts.titleSize || F.h2, weight: 'bold', color: opts.titleColor || C.ink });
    cursor += (opts.titleSize || F.h2) + 6;
  }
  if (subtitle) {
    cursor += wrap(subtitle, x + 14, cursor, w - 28, 17, opts.subtitleLines || 2, {
      size: opts.subtitleSize || F.small,
      color: opts.subtitleColor || C.muted
    });
  }
  return cursor;
}

export function divider(x, y, w, color) {
  ctx.strokeStyle = color || C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + 0.5);
  ctx.lineTo(x + w, y + 0.5);
  ctx.stroke();
}

export function button(app, options) {
  const opts = options || {};
  const x = opts.x;
  const y = opts.y;
  const w = opts.w;
  const h = opts.h;
  const style = opts.style || 'primary';
  const disabled = !!opts.disabled;
  let fill = C.ink;
  let color = C.white;
  let border = null;

  if (style === 'primary') { fill = C.ink; color = C.white; }
  else if (style === 'secondary') { fill = C.paper; color = C.ink; border = C.line; }
  else if (style === 'gold') { fill = C.gold; color = C.white; }
  else if (style === 'danger') { fill = C.red; color = C.white; }
  else if (style === 'ghost') { fill = 'rgba(255,255,255,0.08)'; color = C.white; }
  else if (style === 'selected') { fill = C.goldPale; color = C.ink; border = C.gold; }
  if (disabled) { fill = '#ddd7ca'; color = '#928a7c'; border = null; }

  roundRect(x, y, w, h, opts.radius == null ? 10 : opts.radius, fill, border);
  const labelSize = opts.size || (h <= 34 ? F.small : F.body);
  if (opts.sub) {
    text(truncate(opts.label, w - 20, labelSize, 'bold'), x + 12, y + h / 2 - labelSize + 1, {
      size: labelSize, weight: 'bold', color, align: opts.align || 'left'
    });
    text(truncate(opts.sub, w - 20, F.tiny), x + 12, y + h / 2 + 2, {
      size: F.tiny, color: disabled ? '#a39a8b' : (style === 'primary' || style === 'gold' || style === 'danger' ? 'rgba(255,255,255,0.72)' : C.muted),
      align: opts.align || 'left'
    });
  } else {
    text(truncate(opts.label, w - 16, labelSize, 'bold'), x + w / 2, y + h / 2 - labelSize / 2, {
      size: labelSize, weight: 'bold', color, align: opts.align || 'center'
    });
  }
  if (!disabled && opts.onTap) {
    app.hits.push({ x, y, w, h, label: opts.label, onTap: opts.onTap, fixed: !!opts.fixed, overlay: !!opts.overlay });
  }
}

export function chip(app, options) {
  const opts = options || {};
  const label = opts.label;
  const size = opts.size || F.small;
  const padding = opts.padding == null ? 10 : opts.padding;
  const w = opts.w || Math.ceil(measure(label, size, 'bold') + padding * 2);
  const h = opts.h || (opts.compact ? 26 : 32);
  const selected = !!opts.selected;
  roundRect(opts.x, opts.y, w, h, h / 2, selected ? C.goldPale : (opts.fill || C.paper), selected ? C.gold : (opts.stroke || C.line));
  text(truncate(label, w - 8, size, 'bold'), opts.x + w / 2, opts.y + h / 2 - size / 2, {
    size, weight: 'bold', color: opts.color || (selected ? C.gold : C.ink), align: 'center'
  });
  if (!opts.disabled && opts.onTap) {
    app.hits.push({ x: opts.x, y: opts.y, w, h, onTap: opts.onTap, fixed: !!opts.fixed, overlay: !!opts.overlay });
  }
  return w;
}

export function hearts(mind, maxMind, x, y, options) {
  const opts = options || {};
  const size = opts.size || 13;
  const total = Math.max(0, maxMind || 0);
  const current = Math.max(0, Math.min(total, mind || 0));
  setFont(size, 'bold');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < total; i++) {
    ctx.fillStyle = i < current ? (opts.color || C.red) : '#d9d2c4';
    ctx.fillText(i < current ? '♥' : '♡', x + i * (size + 2), y);
  }
  return total * (size + 2);
}

export function tag(label, x, y, options) {
  const opts = options || {};
  const size = opts.size || F.tiny;
  const w = Math.ceil(measure(label, size, 'bold') + 12);
  roundRect(x, y, w, 18, 5, opts.fill || C.goldPale, null);
  text(label, x + 6, y + 9 - size / 2, { size, weight: 'bold', color: opts.color || C.gold });
  return w;
}

export function bar(x, y, w, h, ratio, color) {
  roundRect(x, y, w, h, h / 2, '#e7e0d3');
  const width = Math.max(0, Math.min(1, ratio)) * w;
  if (width > 0) roundRect(x, y, width, h, h / 2, color || C.gold);
}

export function emptyState(x, y, w, message, sub) {
  roundRect(x, y, w, 78, 12, '#f8f4ea', C.line);
  text(truncate(message, w - 24, F.body, 'bold'), x + 12, y + 18, { size: F.body, weight: 'bold', color: C.muted, align: 'left' });
  if (sub) wrap(sub, x + 12, y + 40, w - 24, 16, 2, { size: F.tiny, color: C.faint });
}

export function screenTitle(title, subtitle) {
  text(title, 16, metrics.contentTop + 16, { size: F.title, weight: 'bold', color: C.ink });
  if (subtitle) text(subtitle, 16, metrics.contentTop + 44, { size: F.small, color: C.muted });
}

export function scrollbar(app) {
  if (!app || app.maxScroll <= 0) return;
  const areaTop = app.view && app.page === 'game' ? metrics.pageTop : metrics.contentTop;
  const areaHeight = metrics.contentBottom - areaTop;
  const ratio = areaHeight / (areaHeight + app.maxScroll);
  const height = Math.max(30, areaHeight * ratio);
  const y = areaTop + (areaHeight - height) * (app.scroll / app.maxScroll);
  roundRect(metrics.width - 4, y, 3, height, 1.5, 'rgba(31,48,66,0.18)');
}

/** 以 cover 方式绘制图片，保持比例并裁切。 */
export function imageCover(img, x, y, w, h) {
  if (!img) return false;
  const sourceWidth = img.width || img.naturalWidth || 0;
  const sourceHeight = img.height || img.naturalHeight || 0;
  if (!sourceWidth || !sourceHeight) return false;
  const scale = Math.max(w / sourceWidth, h / sourceHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (sourceWidth - sw) / 2;
  const sy = (sourceHeight - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  return true;
}

/** 圆形裁切后以 cover 绘制，用于派系徽章。 */
export function imageCircle(img, cx, cy, radius) {
  if (!img) return false;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  const size = radius * 2;
  imageCover(img, cx - radius, cy - radius, size, size);
  ctx.restore();
  return true;
}
