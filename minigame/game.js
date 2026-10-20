import './js/render.js';
import App from './js/main.js';

if (wx.cloud && wx.cloud.init) {
  wx.cloud.init({ env: 'truth-unsettled-d5fu693h4e728350', traceUser: true });
}

new App();
