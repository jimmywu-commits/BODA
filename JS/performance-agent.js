/* BODA opt-in diagnostics. No external services, payloads or image contents. */
(function (root) {
  'use strict';
  if (root.BodaPerf) return;
  var CHANNEL = 'boda-performance-v1';
  var LIMIT = 8000;
  var MAX_CONTEXTS = 96;
  var sourceId = 'boda-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  var sessionId = '';
  var recording = false;
  var recordingGeneration = 0;
  var spanSequence = 0;
  var startedAt = 0;
  var pending = [];
  var contexts = [];
  var cursors = new WeakMap();
  var intervals = [];
  var scanTimer = null;
  var channel = null;
  var metrics;
  var memory = null;
  var frames = { count: 0, sameOrigin: 0, inaccessible: 0, observed: 0, limited: false };
  var noop = function () {};

  function resetMetrics() {
    metrics = { events: 0, dropped: 0, longTasks: 0, longTaskMs: 0, maxLag: 0,
      resources: 0, transferBytes: 0, encodedBytes: 0, decodedBytes: 0,
      resourceZeroTransfer: 0, errors: 0, workflowCount: 0, frames: 0, maxFrames: 0, maxHeap: 0 };
  }
  resetMetrics();

  function safeURL(value, base) {
    try {
      var u = new URL(value, base || root.location.href);
      if (u.protocol === 'data:') return '[data URL]';
      if (u.protocol === 'blob:') return '[blob URL]';
      if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return '[' + u.protocol + ']';
      // Neither queries nor fragments are needed to diagnose static resources.
      return (u.origin === 'null' ? 'file://' : u.origin) + u.pathname;
    } catch (_) { return '[unavailable URL]'; }
  }

  function clean(value, depth) {
    depth = depth || 0;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
    if (typeof value === 'boolean' || value === null) return value;
    if (typeof value === 'string') {
      if (/^(data|blob):/i.test(value)) return '[image data omitted]';
      if (/^(https?:|file:)/i.test(value)) return safeURL(value);
      return value.replace(/[\r\n\t]/g, ' ').slice(0, 180);
    }
    if (depth > 2 || !value || typeof value !== 'object') return undefined;
    if (Array.isArray(value)) return value.slice(0, 10).map(function (v) { return clean(v, depth + 1); });
    var out = {};
    Object.keys(value).slice(0, 24).forEach(function (key) {
      if (/^(src|baseSrc|text|value|content|html|image|workbook|filename|fileName|stack|message|__proto__|constructor)$/i.test(key)) return;
      var v = clean(value[key], depth + 1);
      if (v !== undefined) out[key.slice(0, 60)] = v;
    });
    return out;
  }

  function send(kind, data) {
    if (!channel) return;
    try { channel.postMessage({ type: 'boda-perf', kind: kind, sourceId: sourceId,
      sessionId: sessionId, time: Date.now(), data: data }); } catch (_) {}
  }

  function flush() {
    while (pending.length) send('batch', { events: pending.splice(0, 200) });
  }

  function event(kind, name, detail, duration, frame) {
    if (!recording) return;
    if (kind === 'workflow') metrics.workflowCount++;
    if (kind === 'error') metrics.errors++;
    if (metrics.events >= LIMIT || pending.length >= 400) { metrics.dropped++; return; }
    var entry = { kind: String(kind).slice(0, 40), name: String(name).slice(0, 240),
      time: Date.now(), at: Date.now() - startedAt, detail: clean(detail || {}) };
    if (typeof duration === 'number') entry.duration = Math.round(Math.max(0, duration) * 100) / 100;
    if (frame) entry.frame = safeURL(frame);
    pending.push(entry);
    metrics.events++;
  }

  function begin(name, detail) {
    if (!recording) return noop;
    var generation = recordingGeneration;
    var start = root.performance.now();
    var ended = false;
    var spanId = 'span-' + (++spanSequence);
    event('workflow-start', name, Object.assign({}, detail || {}, { spanId: spanId }));
    return function (extra) {
      if (ended) return;
      ended = true;
      if (!recording || generation !== recordingGeneration) return;
      var combined = Object.assign({}, detail || {}, extra || {}, { spanId: spanId });
      event('workflow', name, combined, root.performance.now() - start, root.location.href);
    };
  }

  function hardware() {
    var nav = root.navigator;
    var conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    return { hardwareConcurrency: nav.hardwareConcurrency || null, deviceMemory: nav.deviceMemory || null,
      userAgent: nav.userAgent, connection: conn ? { effectiveType: conn.effectiveType,
        downlink: conn.downlink, rtt: conn.rtt, saveData: conn.saveData } : null };
  }

  function snapshot() {
    return { recording: recording, startedAt: startedAt, elapsed: startedAt ? Date.now() - startedAt : 0,
      metrics: Object.assign({}, metrics), memory: memory, frames: Object.assign({}, frames),
      eventLimit: LIMIT, pending: pending.length, url: safeURL(root.location.href),
      visibility: root.document.visibilityState,
      capabilities: { performanceObserver: !!root.PerformanceObserver,
        entryTypes: root.PerformanceObserver ? Array.from(root.PerformanceObserver.supportedEntryTypes || []) : [],
        jsHeap: !!root.performance.memory, broadcastChannel: !!channel } };
  }

  function hello() {
    send('hello', { recording: recording, startedAt: startedAt, url: safeURL(root.location.href),
      title: 'BODA', hardware: hardware(), timeOrigin: root.performance.timeOrigin,
      eventLimit: LIMIT, agentVersion: '20261111.1' });
    send('status', snapshot());
  }

  function observe(context, type, callback, buffered) {
    var win = context.win;
    try {
      if (!win.PerformanceObserver || (win.PerformanceObserver.supportedEntryTypes || []).indexOf(type) < 0) return;
      var observer = new win.PerformanceObserver(function (list) {
        if (!recording || !context.active || context.generation !== recordingGeneration) return;
        try { callback(list.getEntries()); } catch (_) {}
      });
      observer.observe({ type: type, buffered: buffered !== false });
      context.cleanup.push(function () { observer.disconnect(); });
    } catch (_) {}
  }

  function listen(context, target, type, handler, capture) {
    target.addEventListener(type, handler, !!capture);
    context.cleanup.push(function () { target.removeEventListener(type, handler, !!capture); });
  }

  function wrap(context, target, key, make) {
    try {
      if (!target || typeof target[key] !== 'function') return;
      var original = target[key];
      var replacement = make(original);
      target[key] = replacement;
      context.cleanup.push(function () { if (target[key] === replacement) target[key] = original; });
    } catch (_) {}
  }

  function instrumentStorageAndCanvas(context) {
    var win = context.win;
    wrap(context, win.Storage && win.Storage.prototype, 'setItem', function (original) {
      return function (key, value) {
        if (!context.active || context.generation !== recordingGeneration) return original.apply(this, arguments);
        var start = win.performance.now(), outcome = 'complete';
        try { return original.apply(this, arguments); }
        catch (error) { outcome = error && error.name || 'Error'; throw error; }
        finally {
          var duration = win.performance.now() - start;
          var chars = typeof value === 'string' ? value.length : 0;
          if (duration >= 8 || chars >= 100000 || outcome !== 'complete')
            event('workflow', 'storage.webStorage.write', { chars: chars, outcome: outcome }, duration, context.url);
        }
      };
    });
    wrap(context, win.IDBDatabase && win.IDBDatabase.prototype, 'transaction', function (original) {
      return function () {
        if (!context.active || context.generation !== recordingGeneration) return original.apply(this, arguments);
        var start = win.performance.now();
        var generation = recordingGeneration;
        var tx = original.apply(this, arguments);
        if (tx.mode === 'readonly') return tx;
        var complete = false;
        function done(ev) {
          if (complete) return;
          complete = true;
          if (!recording || generation !== recordingGeneration) return;
          event('workflow', 'storage.indexedDB.transaction', { mode: tx.mode, outcome: ev.type }, win.performance.now() - start, context.url);
        }
        tx.addEventListener('complete', done, { once: true });
        tx.addEventListener('abort', done, { once: true });
        return tx;
      };
    });
    wrap(context, win.HTMLCanvasElement && win.HTMLCanvasElement.prototype, 'toDataURL', function (original) {
      return function () {
        if (!context.active || context.generation !== recordingGeneration) return original.apply(this, arguments);
        var start = win.performance.now();
        try { return original.apply(this, arguments); }
        finally {
          var duration = win.performance.now() - start;
          if (duration >= 8 || this.width * this.height >= 1000000)
            event('workflow', 'canvas.toDataURL', { width: this.width, height: this.height }, duration, context.url);
        }
      };
    });
    wrap(context, win.HTMLCanvasElement && win.HTMLCanvasElement.prototype, 'toBlob', function (original) {
      return function (callback) {
        if (!context.active || context.generation !== recordingGeneration) return original.apply(this, arguments);
        if (typeof callback !== 'function') return original.apply(this, arguments);
        var generation = recordingGeneration;
        var start = win.performance.now(), width = this.width, height = this.height;
        var args = Array.prototype.slice.call(arguments);
        args[0] = function (blob) {
          if (recording && generation === recordingGeneration)
            event('workflow', 'canvas.toBlob', { width: width, height: height, bytes: blob ? blob.size : 0 }, win.performance.now() - start, context.url);
          return callback.apply(this, arguments);
        };
        return original.apply(this, args);
      };
    });
  }

  function navigation(context) {
    try {
      var n = context.win.performance.getEntriesByType('navigation')[0];
      if (!n) return;
      event('navigation', 'document.navigation', { type: n.type,
        domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd,
        responseStart: n.responseStart, responseEnd: n.responseEnd,
        transferSize: n.transferSize, encodedBodySize: n.encodedBodySize,
        domInteractive: n.domInteractive }, n.duration, context.url);
    } catch (_) {}
  }

  function attach(win, doc) {
    if (contexts.some(function (c) { return c.doc === doc; })) return;
    if (contexts.length >= MAX_CONTEXTS) return;
    var context = { win: win, doc: doc, url: safeURL(win.location.href), cleanup: [], perfStart: win.performance.now(),
      generation: recordingGeneration, active: true };
    contexts.push(context);
    var cursor = cursors.get(doc);
    if (!cursor) { cursor = new Set(); cursors.set(doc, cursor); }
    observe(context, 'resource', function (entries) {
      entries.forEach(function (e) {
        var key = e.startTime + '|' + e.duration + '|' + e.name;
        if (cursor.has(key)) return;
        cursor.add(key);
        if (cursor.size > 5000) cursor.delete(cursor.values().next().value);
        metrics.resources++;
        metrics.transferBytes += e.transferSize || 0;
        metrics.encodedBytes += e.encodedBodySize || 0;
        metrics.decodedBytes += e.decodedBodySize || 0;
        if (!e.transferSize) metrics.resourceZeroTransfer++;
        event('resource', safeURL(e.name, win.location.href), { url: safeURL(e.name, win.location.href),
          initiatorType: e.initiatorType, transferSize: e.transferSize || 0,
          encodedBodySize: e.encodedBodySize || 0, decodedBodySize: e.decodedBodySize || 0,
          responseStatus: e.responseStatus || 0, startTime: e.startTime,
          ttfb: Math.max(0, e.responseStart - e.requestStart),
          downloadMs: Math.max(0, e.responseEnd - e.responseStart),
          buffered: e.startTime < context.perfStart }, e.duration, context.url);
      });
    });
    // Observe long tasks only on the outer document: it includes descendant work;
    // adding each iframe's observer would count the same main-thread task twice.
    if (win === root) observe(context, 'longtask', function (entries) {
      entries.forEach(function (e) {
        if (e.startTime < context.perfStart) return;
        metrics.longTasks++;
        metrics.longTaskMs += e.duration;
        var a = e.attribution && e.attribution[0];
        event('longtask', e.name || 'main-thread', { containerType: a && a.containerType,
          containerSrc: a && a.containerSrc ? safeURL(a.containerSrc) : null }, e.duration, context.url);
      });
    });
    listen(context, win, 'error', function (e) {
      var target = e.target;
      event('error', e.error && e.error.name || (target && target !== win ? 'resource-error' : 'script-error'),
        { url: e.filename ? safeURL(e.filename) : target && (target.src || target.href) ? safeURL(target.src || target.href) : null,
          line: e.lineno || null, column: e.colno || null, tag: target && target.tagName || null }, undefined, context.url);
    }, true);
    listen(context, win, 'unhandledrejection', function (e) {
      event('error', 'unhandled-rejection', { errorType: e.reason && e.reason.name || typeof e.reason }, undefined, context.url);
    });
    listen(context, doc, 'click', function (e) {
      var t = e.target;
      event('interaction', 'click', { tag: t && t.tagName || null, inputType: t && t.type || null }, undefined, context.url);
    }, true);
    listen(context, doc, 'load', function (e) { if (e.target && e.target.tagName === 'IFRAME') scheduleScan(); }, true);
    instrumentStorageAndCanvas(context);
    if (doc.readyState === 'complete') navigation(context);
    else listen(context, win, 'load', function () { root.setTimeout(function () { if (recording) navigation(context); }, 0); });
    event('lifecycle', 'document.attached', { bufferedResources: true }, undefined, context.url);
  }

  function detach(context) {
    context.active = false;
    context.cleanup.forEach(function (fn) { try { fn(); } catch (_) {} });
    context.cleanup.length = 0;
  }

  function scanFrames() {
    if (!recording) return;
    var alive = new Set();
    var stats = { count: 0, sameOrigin: 0, inaccessible: 0, observed: 0, limited: false };
    function visit(win, depth) {
      if (depth > 6 || stats.count > 256) { stats.limited = true; return; }
      var doc;
      try { doc = win.document; if (!doc) throw new Error('No document'); void win.location.href; }
      catch (_) { stats.inaccessible++; return; }
      alive.add(doc);
      if (win !== root) stats.sameOrigin++;
      attach(win, doc);
      var list = doc.querySelectorAll('iframe');
      for (var i = 0; i < list.length; i++) {
        stats.count++;
        try { visit(list[i].contentWindow, depth + 1); } catch (_) { stats.inaccessible++; }
      }
    }
    visit(root, 0);
    contexts = contexts.filter(function (c) { if (alive.has(c.doc)) return true; detach(c); return false; });
    stats.observed = contexts.length;
    if (contexts.length >= MAX_CONTEXTS) stats.limited = true;
    if (stats.count !== frames.count || stats.inaccessible !== frames.inaccessible)
      event('frame', 'frames.changed', stats);
    frames = stats;
    metrics.frames = stats.count;
    metrics.maxFrames = Math.max(metrics.maxFrames, stats.count);
  }

  function scheduleScan() {
    if (scanTimer !== null || !recording) return;
    scanTimer = root.setTimeout(function () { scanTimer = null; scanFrames(); }, 100);
  }

  function sample() {
    if (!recording) return;
    var m = root.performance.memory;
    if (m) {
      memory = { usedJSHeapSize: m.usedJSHeapSize, totalJSHeapSize: m.totalJSHeapSize, jsHeapSizeLimit: m.jsHeapSizeLimit };
      metrics.maxHeap = Math.max(metrics.maxHeap, m.usedJSHeapSize || 0);
      event('memory', 'js-heap.sample', memory);
    }
    flush();
    send('status', snapshot());
  }

  function start(options) {
    options = options || {};
    if (recording) { hello(); return snapshot(); }
    var nextSession = String(options.sessionId || sessionId || ('session-' + Date.now())).slice(0, 100);
    if (nextSession !== sessionId || !startedAt) { resetMetrics(); pending = []; startedAt = Date.now(); memory = null; }
    sessionId = nextSession;
    recording = true;
    recordingGeneration++;
    scanFrames();
    var expected = root.performance.now() + 500;
    var foregroundSince = Date.now();
    var rootContext = contexts.filter(function (c) { return c.win === root; })[0];
    if (rootContext) {
      listen(rootContext, root.document, 'visibilitychange', function () {
        expected = root.performance.now() + 500;
        foregroundSince = Date.now();
        event('lifecycle', 'visibility', { state: root.document.visibilityState });
      });
      listen(rootContext, root, 'pagehide', function (e) {
        event('lifecycle', 'pagehide', { persisted: e.persisted }); flush(); send('status', snapshot());
      });
    }
    intervals.push(root.setInterval(function () {
      var now = root.performance.now();
      var delay = Math.max(0, now - expected);
      expected = now + 500;
      if (root.document.visibilityState !== 'visible' || Date.now() - foregroundSince < 1000) return;
      metrics.maxLag = Math.max(metrics.maxLag, delay);
      if (delay >= 100) event('lag', 'event-loop.delay', { interval: 500 }, delay);
    }, 500));
    intervals.push(root.setInterval(flush, 1000));
    intervals.push(root.setInterval(sample, 5000));
    intervals.push(root.setInterval(scanFrames, 5000));
    event('lifecycle', 'recording.started', { resumed: startedAt < Date.now() - 100 });
    hello(); sample();
    return snapshot();
  }

  function stop() {
    if (!recording) { hello(); return snapshot(); }
    event('lifecycle', 'recording.stopped');
    flush();
    recording = false;
    recordingGeneration++;
    intervals.forEach(function (id) { root.clearInterval(id); }); intervals = [];
    if (scanTimer !== null) root.clearTimeout(scanTimer); scanTimer = null;
    contexts.forEach(detach); contexts = [];
    send('status', snapshot());
    return snapshot();
  }

  root.BodaPerf = { begin: begin, event: event, start: start, stop: stop, snapshot: snapshot,
    recording: function () { return recording; }, version: '20261111.1' };
  try {
    channel = new root.BroadcastChannel(CHANNEL);
    channel.onmessage = function (message) {
      var command = message.data;
      if (!command || command.type !== 'boda-perf-control') return;
      if (command.targetSourceId && command.targetSourceId !== sourceId) return;
      if (command.action === 'start') {
        if (recording && command.sessionId && command.sessionId !== sessionId) return;
        start({ sessionId: command.sessionId });
      } else if (command.action === 'snapshot') {
        if (!command.sessionId || !sessionId || command.sessionId === sessionId) {
          if (recording) { scanFrames(); sample(); }
          else flush();
          hello();
        }
      } else if (command.sessionId && command.sessionId === sessionId) {
        if (command.action === 'stop') stop();
        if (command.action === 'clear') {
          var resume = recording;
          if (resume) stop();
          resetMetrics(); pending = []; startedAt = Date.now(); memory = null;
          if (resume) start({ sessionId: sessionId });
          else send('status', snapshot());
        }
        if (command.action === 'mark') {
          var allowed = ['upload', 'exposure', 'background', 'shadow', 'activity', 'export', 'other'];
          if (allowed.indexOf(command.name) >= 0) { event('mark', command.name); flush(); }
        }
      }
    };
  } catch (_) {}
  try {
    var params = new URL(root.location.href).searchParams;
    if (params.get('bodaPerf') === '1') start({ sessionId: params.get('bodaPerfSession') || undefined });
  } catch (_) {}
})(window);
