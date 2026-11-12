/* One writer per document; edits made during a write replace pending work. */
(function (root) {
  'use strict';
  function same(a, b, ignored, depth) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    if (a instanceof ArrayBuffer || b instanceof ArrayBuffer || ArrayBuffer.isView(a) || ArrayBuffer.isView(b) ||
        (root.Blob && (a instanceof root.Blob || b instanceof root.Blob))) return false;
    var ak = Object.keys(a).filter(function (k) { return depth || ignored.indexOf(k) < 0; });
    var bk = Object.keys(b).filter(function (k) { return depth || ignored.indexOf(k) < 0; });
    if (ak.length !== bk.length) return false;
    return ak.every(function (k) { return Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k], ignored, depth + 1); });
  }
  function create(options) {
    var pending = null, active = null, saved = null, timer = null, held = false;
    var failures = 0, generation = 0, waiters = [], idleWaiters = [], status = { state: 'idle', error: '' };
    var ignored = options.ignoreKeys || ['ts', 'savedAt', 'imageLayoutSavedAt'];
    function report(state, error) {
      status = { state: state, error: error ? String(error.message || error) : '',
        noAutomaticRetry: !!(error && error.noAutomaticRetry), errorName: error && error.name || '' };
      if (options.onStatus) options.onStatus(status);
    }
    function settle(error) {
      var list = waiters; waiters = [];
      list.forEach(function (item) { if (error) item.reject(error); else item.resolve(); });
    }
    function later() {
      clearTimeout(timer);
      timer = root.setTimeout(function () { timer = null; run(); }, options.retryDelay || 1200);
    }
    function settledActive() {
      if (active) return;
      var list = idleWaiters; idleWaiters = [];
      list.forEach(function (resolve) { resolve(); });
    }
    function run() {
      if (active || held || timer) return;
      if (!pending) { settle(); return; }
      if (saved && same(pending, saved, ignored, 0)) { pending = null; report('saved'); settle(); return; }
      var state = pending, version = generation; pending = null; active = state;
      report('saving');
      Promise.resolve().then(function () { return options.write(state); }).then(function () {
        active = null;
        if (version === generation) {
          saved = state; failures = 0;
          if (options.onSaved) options.onSaved(state);
          report(pending ? 'pending' : 'saved');
        }
        run();
        settledActive();
      }, function (error) {
        active = null;
        if (version !== generation) { run(); settledActive(); return; }
        if (!pending) pending = state;
        failures++;
        if (!(error && error.noAutomaticRetry) && failures <= (options.maxRetries === undefined ? 2 : options.maxRetries)) {
          report('retrying', error); later();
        } else {
          held = true; report('paused', error); settle(error);
        }
        settledActive();
      });
    }
    return {
      enqueue: function (value) {
        pending = options.freeze ? options.freeze(value) : value;
        if (!held) run();
      },
      baseline: function (value) { saved = options.freeze ? options.freeze(value) : value; },
      refreshPending: function (value) { if (pending) pending = options.freeze ? options.freeze(value) : value; },
      hold: function (error) { held = true; clearTimeout(timer); timer = null; report('paused', error); settle(error || new Error('Storage paused')); },
      resume: function () { held = false; failures = 0; clearTimeout(timer); timer = null; run(); },
      reset: function (settings) { generation++; pending = null; saved = null; held = !!(settings && settings.paused); failures = 0; clearTimeout(timer); timer = null; report('idle'); },
      whenIdle: function () { return active ? new Promise(function (resolve) { idleWaiters.push(resolve); }) : Promise.resolve(); },
      flush: function () {
        if (held) return Promise.reject(new Error(status.error || 'Storage paused'));
        return new Promise(function (resolve, reject) { waiters.push({ resolve: resolve, reject: reject }); run(); });
      },
      getStatus: function () { return { state: status.state, error: status.error, noAutomaticRetry: !!status.noAutomaticRetry,
        errorName: status.errorName || '', pending: !!pending, writing: !!active }; }
    };
  }
  root.BodaSaveQueue = { create: create, equivalent: function (a, b) { return same(a, b, ['ts', 'savedAt', 'imageLayoutSavedAt'], 0); } };
})(window);
