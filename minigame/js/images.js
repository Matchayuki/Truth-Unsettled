/**
 * 本地图片预加载。图片放在 images/ 下，由微信小游戏直接打包。
 * 加载完成后再绘制，避免首屏出现空白。
 */
const SOURCES = {
  banner: 'images/banner.jpg',
  builder: 'images/faction-builder.jpg',
  skeptic: 'images/faction-skeptic.jpg',
  wanderer: 'images/faction-wanderer.jpg'
};

const loaded = {};
let finished = false;
const waiting = [];

export function loadImages(done) {
  if (finished) {
    if (done) done();
    return;
  }
  if (done) waiting.push(done);
  const names = Object.keys(SOURCES);
  let remaining = names.length;
  const settle = () => {
    remaining--;
    if (remaining <= 0) {
      finished = true;
      const callbacks = waiting.splice(0, waiting.length);
      callbacks.forEach(callback => callback());
    }
  };
  names.forEach(name => {
    if (!wx.createImage) {
      settle();
      return;
    }
    const image = wx.createImage();
    image.onload = () => {
      loaded[name] = image;
      settle();
    };
    image.onerror = () => settle();
    image.src = SOURCES[name];
  });
}

export function image(name) {
  return loaded[name] || null;
}

export function imagesReady() {
  return finished;
}
