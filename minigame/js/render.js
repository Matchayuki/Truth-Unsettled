/**
 * Canvas 与屏幕度量。
 * 使用设备像素比绘制，逻辑坐标统一为 CSS 像素。
 */
const canvas = wx.createCanvas();
GameGlobal.canvas = canvas;

const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();

const width = windowInfo.windowWidth || windowInfo.screenWidth || 375;
const height = windowInfo.windowHeight || windowInfo.screenHeight || 667;
const dpr = Math.min(3, Math.max(1, windowInfo.pixelRatio || 2));
const safeArea = windowInfo.safeArea;
const safeTop = Math.round((safeArea && safeArea.top) || windowInfo.statusBarHeight || 0);
const safeBottom = safeArea ? Math.max(0, Math.round(height - safeArea.bottom)) : 0;

const metrics = {
  width,
  height,
  dpr,
  safeTop,
  safeBottom,
  headerHeight: 58,
  tabsHeight: 44,
  footerHeight: 28,
  get contentTop() { return safeTop + this.headerHeight; },
  get pageTop() { return safeTop + this.headerHeight + this.tabsHeight; },
  get contentBottom() { return height - safeBottom - this.footerHeight; }
};

const ctx = canvas.getContext('2d');

function applySize() {
  canvas.width = Math.round(metrics.width * metrics.dpr);
  canvas.height = Math.round(metrics.height * metrics.dpr);
  if (typeof ctx.setTransform === 'function') {
    ctx.setTransform(metrics.dpr, 0, 0, metrics.dpr, 0, 0);
  } else {
    ctx.scale(metrics.dpr, metrics.dpr);
  }
  ctx.textBaseline = 'top';
}

applySize();

if (wx.onWindowResize) {
  wx.onWindowResize(res => {
    const size = res && res.size ? res.size : {};
    metrics.width = size.windowWidth || metrics.width;
    metrics.height = size.windowHeight || metrics.height;
    applySize();
    if (GameGlobal.truthApp) GameGlobal.truthApp.draw(true);
  });
}

export { canvas, ctx, metrics };
export const SCREEN_WIDTH = width;
export const SCREEN_HEIGHT = height;
