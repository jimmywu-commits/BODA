'use strict';

// Deterministic integration of the actual parent functions. No production DOM,
// fonts or oversized artwork is loaded; every readiness gate is controlled.
// node tools/test-lazy-exposure-export.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function slice(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Actual source region exists: ' + start);
  return html.slice(a, b);
}
function gate() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function microtasks() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function harness(options = {}) {
  let now = 0, timerId = 0;
  const timers = new Map(), listeners = new Map(), classes = new Set(), events = [];
  const state = { view: 'upload', hash: '#upload', navigations: [], collectCount: 0, staged: !!options.snapshot, src: '', collectorError: null };
  const ready = gate(), materials = gate(), restore = gate(), preparation = gate();
  preparation.resolve(true);
  if (!options.delayReady) ready.resolve(true);
  if (!options.delayMaterials) materials.resolve(true);
  if (!options.delayRestore) restore.resolve(true);
  const setTimer = (callback, delay = 0) => { const id = ++timerId; timers.set(id, { callback, at: now + Number(delay || 0) }); return id; };
  const classList = {
    contains(name) { return name === 'active' ? state.view === 'exposure' : classes.has(name); },
    add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
    toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }
  };
  const childDocument = { title: 'Exposure', readyState: 'complete', addEventListener() {}, removeEventListener() {}, fonts: { ready: Promise.resolve() }, getElementById() { return null; } };
  const child = {
    document: childDocument, _bnStateApplying: false,
    _bnStatePlugin: {
      whenReady() { events.push('state-ready-wait'); return ready.promise; },
      whenIdle() { return Promise.resolve(); },
      flush() { return Promise.resolve(true); },
      getSaveStatus() { return { state: 'saved' }; }
    },
    _bnApplyWorkorderAssets() { events.push('child-assets'); return materials.promise; },
    _bnApplyWorkorderExposureSpec() { events.push('spec'); return true; },
    _bnApplySharedCanvasBg() { events.push('child-background'); },
    _bnApplySharedTextPalette() { events.push('child-palette'); },
    _bnApplyLevel() { events.push('child-level'); },
    bnApplyWorkorderOverviewText() { events.push('child-text'); },
    postMessage(message) { events.push('message:' + message.type); }
  };
  function installCollector() {
    child._bnCollectExportFiles = callback => {
      state.collectCount++;
      events.push('collect');
      if (state.collectorError) callback(state.collectorError);
      else callback(null, [{ name: 'MSBN.png', dataUrl: 'data:image/png;base64,MS' }, { name: 'LPBN.png', dataUrl: 'data:image/png;base64,LP' }], { fail: 0 });
      return true;
    };
  }
  if (!options.delayCollector) installCollector();
  const frame = {
    contentWindow: child, contentDocument: childDocument,
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { if (listeners.has(name)) listeners.get(name).delete(callback); },
    getAttribute(name) { return name === 'src' ? state.src : null; },
    removeAttribute(name) { if (name === 'src') state.src = ''; },
    get src() { return state.src; }, set src(value) { state.src = value; state.navigations.push(value); }
  };
  const wrap = { classList: { add(name) { events.push('wrap-add:' + name); }, remove() {} } };
  const view = { classList }, log = { innerHTML: '' };
  const elements = { 'exposure-frame': frame, 'exposure-wrap': wrap, 'view-exposure': view, 'import-log': log };
  const c = {
    console, Promise, Date: class extends Date { static now() { return now; } },
    location: { hash: state.hash }, document: {
      getElementById(id) { return elements[id] || null; },
      querySelector(selector) { return selector === '#view-exposure.active' && state.view === 'exposure' ? view : null; }
    },
    setTimeout: setTimer, clearTimeout(id) { timers.delete(id); },
    setInterval: setTimer, clearInterval(id) { timers.delete(id); },
    EXPOSURE_SRC: 'local-exposure.html', EXPOSURE_SRC_LOCAL: 'local-exposure.html', EXPOSURE_SRC_REMOTE: 'fallback-exposure.html',
    APP_LOADING: { active: true }, currentImportedWorkOrderSpec: { importId: 'order-1', exhaustive: true, resources: [] },
    currentImportImageLayoutId: 'project-1', currentLevelId: 'L1', importTheme: {}, currentImportWorkbook: {}, uploadedImages: [],
    currentImportColumns: [], importShadowRequestRevision: 1, _exposureOverviewAssetDebounce: null, _exposureOverviewAssetPending: null,
    pendingExposureEndorserColorEditorOpen: false, exposurePaletteMergeReadyAt: 0,
    _deferredExposureAssets: !!options.dirty, _deferredExposureWorkbook: false, _deferredExposurePayload: options.dirty ? { productFiles: 'latest.png' } : null,
    appLoadingStart() { events.push('loading-start'); }, appLoadingUpdate() {}, appLoadingFinish(note) { events.push('loading-finish:' + note); }, appLoadingFail() {},
    appLoadingFinishView(token, note) { events.push('loading-finish-view:' + token + ':' + note); },
    requestExposureEndorserTextColor() {}, scheduleExposureEndorserColorEditorOpen() {},
    resolvedImportBg() { return '#ffffff'; }, colorToHex(value) { return value; },
    pushImportBgToExposure() { events.push('background'); }, pushImportCtaBgToExposure() {}, pushImportCtaTextToExposure() {},
    activeSnapshotTextPaletteLock() { return null; }, readSharedExposureTextPalette() { return null; },
    pushExposureTextPalette() {}, syncCtaTextToColorTool() {}, pushExposureOverviewText() { events.push('text'); },
    readSharedExposureOverviewText() { return { productFiles: 'latest.png' }; },
    syncExposureOverviewAssets() { events.push('ordinary-assets'); }, syncExposureShadowBackgroundSoon() {},
    ensureImportResourcesReady(config) { events.push('prepare:' + config.canvas); return preparation.promise; },
    flushDeferredChildTools(name, config) {
      events.push('flush:' + name + ':' + !!(config && config.force) + ':' + !!(config && config.immediate));
      return materials.promise.then(() => { events.push('materials-applied'); return true; });
    },
    esc(value) { return String(value); }
  };
  c.window = c;
  c.BodaExposureSnapshots = {
    pending() { return state.staged; },
    apply() { events.push('snapshot-start'); return restore.promise.then(() => { state.staged = false; c.__bodaPendingExposureRestore = false; events.push('snapshot-applied'); return true; }); }
  };
  c.__bodaPendingExposureRestore = state.staged;
  vm.createContext(c);
  vm.runInContext(slice('var exposureLoaded = false;', '/* 背景色＝shopee/color/color-tool.html'), c);
  c.scaleExposureLayoutBulkActions = () => {};
  c.bindExposureAdaptiveShadowEvents = () => {};
  async function tick(duration) {
    const until = now + duration;
    for (let i = 0; i < 10000; i++) {
      await microtasks();
      let nextId = null, next;
      for (const [id, item] of timers) if (item.at <= until && (!next || item.at < next.at)) { next = item; nextId = id; }
      if (!next) { now = until; await microtasks(); return; }
      now = next.at; timers.delete(nextId); next.callback();
    }
    throw new Error('Timer loop did not settle');
  }
  async function fire(name) {
    if (typeof frame['on' + name] === 'function') frame['on' + name]({ type: name });
    for (const callback of Array.from(listeners.get(name) || [])) callback({ type: name });
    await microtasks();
  }
  return { c, state, events, ready, materials, restore, preparation, classes, frame, child, elements, tick, fire, installCollector };
}

async function testSharedInitializationWaitsForRealReady() {
  const h = harness({ delayReady: true, delayCollector: true });
  const first = h.c.ensureExposureLoaded({ quiet: true });
  const second = h.c.ensureExposureLoaded({ quiet: true });
  assert.equal(typeof first.then, 'function', 'ensureExposureLoaded must return initialization Promise');
  assert.equal(first, second, 'Concurrent navigation and export must share one initializer');
  assert.equal(h.state.navigations.length, 1);
  let complete = false; first.then(() => { complete = true; });
  await h.fire('load'); await h.tick(1500);
  assert.equal(complete, false, 'load event and old 400ms delay cannot imply child readiness');
  h.installCollector(); await h.tick(100);
  assert.equal(complete, false, 'Collector availability alone must not bypass saved-state readiness');
  h.ready.resolve(); await h.tick(3000); await first;
  assert.equal(complete, true);
}

async function testUnseenHiddenExportWaitsForMaterials() {
  const h = harness({ delayReady: true, delayMaterials: true, dirty: true });
  const task = h.c.requestExposureExportFiles();
  await microtasks();
  assert.equal(h.state.navigations.length, 1, 'Unseen exposure must load on full-package export');
  await h.fire('load'); await h.tick(1500);
  assert.equal(h.state.collectCount, 0);
  h.ready.resolve(); await h.tick(3000);
  assert.equal(h.state.collectCount, 0, 'Hidden export must await latest forced asset application');
  assert.ok(h.events.includes('flush:exposure:true:true'), 'Hidden dirty assets require awaited immediate force mode');
  h.materials.resolve(); await h.tick(100);
  const result = await task;
  assert.equal(result.files.length, 2, 'Unseen MSBN and LPBN must both be present');
  assert.equal(result.note, '');
  assert.equal(h.state.collectCount, 1);
  assert.equal(h.classes.has('bn-offscreen-render'), false);
  assert.equal(h.state.view, 'upload', 'Export cannot switch the user page');
  assert.equal(h.c.location.hash, '#upload');
  assert.ok(h.events.indexOf('materials-applied') < h.events.indexOf('collect'));
}

async function testPendingSnapshotPrecedesCollector() {
  const h = harness({ snapshot: true, delayRestore: true });
  const task = h.c.requestExposureExportFiles();
  await microtasks(); await h.fire('load'); await h.tick(3000);
  assert.ok(h.events.includes('snapshot-start'));
  assert.equal(h.state.collectCount, 0, 'Snapshot restoration must finish before collecting files');
  h.restore.resolve(); await h.tick(3000);
  const result = await task;
  assert.equal(result.files.length, 2);
  assert.ok(h.events.indexOf('snapshot-applied') < h.events.indexOf('collect'));
  assert.equal(h.events.includes('ordinary-assets'), false, 'Startup snapshot path cannot replay original workorder assets');
}

async function testFallbackAndFailureCleanup() {
  const h = harness();
  const task = h.c.requestExposureExportFiles(); await microtasks();
  await h.fire('error');
  assert.equal(h.state.navigations.at(-1), 'fallback-exposure.html');
  await h.fire('load'); await h.tick(3000);
  assert.equal((await task).files.length, 2);
  const failed = harness();
  const failure = failed.c.requestExposureExportFiles(); await microtasks();
  await failed.fire('error'); await failed.fire('error'); await failed.tick(100);
  const result = await failure;
  assert.equal(result.files.length, 0);
  assert.match(result.note, /曝光資源.*(失敗|無法|未輸出)/);
  assert.equal(failed.classes.has('bn-offscreen-render'), false, 'Initialization errors must clean offscreen layout');
  assert.equal(failed.state.collectCount, 0);
}

async function testCaptureErrorCleanup() {
  const h = harness(); h.state.collectorError = new Error('capture failed');
  const task = h.c.requestExposureExportFiles(); await microtasks(); await h.fire('load'); await h.tick(3000);
  const result = await task;
  assert.match(result.note, /capture failed/);
  assert.equal(h.classes.has('bn-offscreen-render'), false);
  assert.equal(h.state.view, 'upload');
}

async function testReadinessTimeoutCleanup() {
  const h = harness({ delayReady: true });
  const task = h.c.requestExposureExportFiles();
  await microtasks(); await h.fire('load'); await h.tick(30000);
  const result = await task;
  assert.equal(result.files.length, 0);
  assert.match(result.note, /readiness timed out|就緒.*逾時/i);
  assert.equal(h.state.collectCount, 0, 'Readiness timeout cannot fall through and collect stale content');
  assert.equal(h.classes.has('bn-offscreen-render'), false);
}

async function testExistingOffscreenOwnership() {
  const h = harness();
  h.classes.add('bn-offscreen-render');
  const task = h.c.requestExposureExportFiles();
  await microtasks(); await h.fire('load'); await h.tick(3000); await task;
  assert.equal(h.classes.has('bn-offscreen-render'), true, 'Export must not remove an offscreen lease owned by another caller');
}

async function testViewLoadingWaitsForReadiness() {
  const h = harness({ delayReady: true, delayMaterials: true });
  const showView = slice('function showView(name, options)', '/* 進到「匯入工單」時');
  const a = showView.indexOf("  if (name === 'exposure') {"), b = showView.indexOf("  if (name === 'color') ensureColorToolLoaded();", a);
  assert.ok(a >= 0 && b > a, 'Exposure view activation branch is found in actual showView');
  vm.runInContext('function runExposureView(viewLoadingToken) { var name = \'exposure\', viewPreparation = null;\n' + showView.slice(a, b) + '\nreturn viewPreparation; }', h.c);
  h.state.view = 'exposure';
  const task = h.c.runExposureView(17);
  await microtasks(); await h.fire('load'); await h.tick(1600);
  assert.equal(h.events.some(event => event.startsWith('loading-finish-view:')), false);
  h.ready.resolve(); await h.tick(3000);
  assert.equal(h.events.some(event => event.startsWith('loading-finish-view:')), false, 'View Loading must also await latest asset application');
  h.materials.resolve(); await h.tick(100); await task;
  assert.ok(h.events.includes('loading-finish-view:17:曝光資源已就緒'));
  const switched = harness({ delayReady: true });
  vm.runInContext('function runExposureView(viewLoadingToken) { var name = \'exposure\', viewPreparation = null;\n' + showView.slice(a, b) + '\nreturn viewPreparation; }', switched.c);
  switched.state.view = 'exposure'; const pending = switched.c.runExposureView(18);
  await microtasks(); await switched.fire('load');
  switched.state.view = 'upload'; switched.ready.resolve(); await switched.tick(3000); await pending;
  assert.equal(switched.events.some(event => event.startsWith('loading-finish-view:')), false, 'Late exposure readiness cannot finish a different active page Loading');
}

async function main() {
  await testSharedInitializationWaitsForRealReady();
  await testUnseenHiddenExportWaitsForMaterials();
  await testPendingSnapshotPrecedesCollector();
  await testFallbackAndFailureCleanup();
  await testCaptureErrorCleanup();
  await testReadinessTimeoutCleanup();
  await testExistingOffscreenOwnership();
  await testViewLoadingWaitsForReadiness();
  console.log('PASS lazy exposure export: shared readiness, unseen/hidden complete export, awaited latest materials, snapshot priority, fallback/error/timeout cleanup, offscreen ownership and view Loading await');
}
const watchdog = setTimeout(() => {
  console.error('FAIL: An exposure test never settled (a missing readiness/fixture gate must not silently pass).');
  process.exitCode = 1;
}, 5000);
main().then(() => { clearTimeout(watchdog); }, error => {
  clearTimeout(watchdog); console.error(error); process.exitCode = 1;
});
