// timer-worker.js — Background-resilient tick source for Pomodoro + Live Study timers.
// Runs inside a Web Worker, so it survives UI-thread suspension on OPPO/Realme/Vivo
// devices with aggressive battery optimisation. Fires every 500 ms (2× per second)
// so at least one tick reaches the main thread even if the browser throttles
// message delivery to 1 Hz.
'use strict';

let _interval = null;
let _tick = 0;

self.onmessage = function (e) {
  const type = (e.data && e.data.type) || e.data;
  if (type === 'start') {
    if (_interval) return; // prevent duplicate start
    _tick = 0;
    _interval = setInterval(function () {
      _tick++;
      self.postMessage({ type: 'tick', n: _tick, ts: Date.now() });
    }, 500);
  } else if (type === 'stop') {
    if (_interval) { clearInterval(_interval); _interval = null; }
  } else if (type === 'ping') {
    self.postMessage({ type: 'pong', ts: Date.now() });
  }
};
