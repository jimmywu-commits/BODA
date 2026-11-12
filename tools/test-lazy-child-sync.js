'use strict';

// node tools/test-lazy-child-sync.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function segment(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Source segment exists: ' + start);
  return html.slice(a, b);
}
function harness() {
  const state = { view: 'upload', messages: [], images: 0, signatures: 0, lookups: 0, workbook: 0, gallery: 0, saved: 0, imports: [], source: 'first', frameSrc: 'exposure.html', failPost: false, applyAssets: null };
  const timers = new Map();
  let nextTimer = 0;
  const context = {
    console, window: {}, currentImportWorkbook: {}, currentPaletteTab: 'sticky',
    bottomBridgeReady: true, standaloneBottomBridgeReady: true, bottomPreviewBridgeReady: true,
    bottomPreviewAssetsSignature: '', latestBottomWorkOrder: { version: 1 }, bottomLastAutoSentVersion: 0, standaloneBottomLastSentVersion: 0,
    document: { getElementById(id) {
      if (id.startsWith('view-')) return { classList: { contains() { return id === 'view-' + state.view; } } };
      if (id === 'exposure-frame') return { getAttribute() { return state.frameSrc; }, contentWindow: { _bnApplyWorkorderAssets(payload) { return state.applyAssets(payload); }, postMessage(message) { state.messages.push(['exposure', message]); } } };
      return null;
    } },
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    renderImageGallery() { state.gallery++; }, queueBottomPersist() {}, saveImportState() { state.saved++; },
    readSharedExposureOverviewText() { return { productFiles: state.source + '.png' }; },
    normalizeExposureLogoFileNames(value) { return value ? [value] : []; },
    normalizeExposureAssetFileNames(value) { return value ? [value] : []; },
    storedEndorserFileNames(value) { return value ? [value] : []; },
    exposureEndorserAssets() { return []; },
    exposureAssetsForNames(value) { state.lookups++; return value ? [{ name: value, src: value, baseSrc: value, sourceId: value, sourceRevision: '1', originalSrc: value }] : []; },
    resolvedImportBg() { return '#fff'; }, syncExposureShadowBackgroundSoon() {},
    bottomHostImageAssets() { state.images++; return [{ name: state.source, dataUrl: state.source }]; },
    bottomHostAssetsSignature(images) { state.signatures++; return images[0].dataUrl; },
    getBottomStateForSync() { return 'edited-state'; },
    sendLatestWorkOrderToBottom(reason) { state.imports.push(['generator', reason]); return true; },
    sendLatestWorkOrderToStandaloneBottom(reason) { state.imports.push(['standalone', reason]); return true; },
    postToBottom(message) { if (state.failPost) return false; state.messages.push(['generator', message]); return true; },
    postToStandaloneBottom(message) { if (state.failPost) return false; state.messages.push(['standalone', message]); return true; },
    postToBottomPreview(message) { if (state.failPost) return false; state.messages.push(['preview', message]); return true; }
  };
  context.syncExposureOverviewAssets = data => context.pushExposureOverviewAssets(data || context.readSharedExposureOverviewText());
  context.syncWorkbookOverviewTextToExposure = () => { state.workbook++; return context.syncExposureOverviewAssets(); };
  vm.createContext(context);
  vm.runInContext(segment('function pushExposureOverviewAssets(', 'var _exposureOverviewAssetDebounce = null;') + '\nvar _exposureOverviewAssetDebounce = null; var _exposureOverviewAssetPending = null;', context);
  vm.runInContext(segment('var _syncAllChildToolsTimer = null;', '/* 最左側「整包下載」'), context);
  vm.runInContext(segment('function syncBottomAfterImportAction(', 'function postToFrame('), context);
  function drain() { const pending = Array.from(timers.values()); timers.clear(); pending.forEach(callback => callback()); }
  return { context, state, drain };
}

function testHiddenExposure() {
  const { context: c, state: s, drain } = harness();
  c.pushExposureOverviewAssets({ productFiles: 'old.png' });
  c.pushExposureOverviewAssets({ productFiles: 'latest.png' });
  assert.equal(s.lookups, 0, 'Hidden exposure must not match files, hash originals or build asset messages');
  assert.equal(s.messages.length, 0);
  s.view = 'exposure';
  assert.equal(c.flushDeferredChildTools('exposure'), true);
  drain();
  assert.equal(s.messages.length, 1);
  assert.equal(s.messages[0][1].assets.products[0].name, 'latest.png');
  const lookups = s.lookups;
  c.flushDeferredChildTools('exposure'); drain();
  assert.equal(s.lookups, lookups, 'Ordinary repeat activation must not rebuild source messages');
  c.pushExposureOverviewAssets({ productFiles: 'raced.png' });
  s.view = 'upload'; drain();
  assert.equal(s.messages.length, 1, 'A page hidden during debounce must not receive queued large messages');
  assert.equal(c._exposureOverviewAssetPending, null);
  s.view = 'exposure'; c.flushDeferredChildTools('exposure'); drain();
  assert.equal(s.messages.at(-1)[1].assets.products[0].name, 'raced.png');
  s.view = 'upload'; c.pushExposureOverviewAssets({ productFiles: 'backup.png' });
  c.flushDeferredChildTools('exposure', { force: true }); drain();
  assert.equal(s.messages.at(-1)[1].assets.products[0].name, 'backup.png', 'Explicit hidden export can flush exposure');
}

function testImportSyncDefersWorkbook() {
  const { context: c, state: s, drain } = harness();
  c.syncAllChildTools(); c.syncAllChildTools({ exposureAssets: false }); drain();
  assert.equal(s.workbook, 0);
  assert.equal(s.lookups, 0);
  assert.equal(s.images, 0);
  assert.equal(s.saved, 1, 'Deferring child rendering must never defer persistence');
  s.source = 'newest'; s.view = 'exposure'; c.flushDeferredChildTools('exposure'); drain();
  assert.equal(s.workbook, 1);
  assert.equal(s.messages[0][1].assets.products[0].name, 'newest.png');
  c.flushDeferredChildTools('exposure'); drain();
  assert.equal(s.workbook, 1);
  c.syncAllChildTools({ exposureAssets: false }); drain();
  assert.equal(s.workbook, 1, 'Background-only changes never replay original assets');
}

function testUnloadedAndPendingRestore() {
  const { context: c, state: s, drain } = harness();
  s.view = 'exposure'; s.frameSrc = '';
  c.pushExposureOverviewAssets({ productFiles: 'waiting.png' });
  assert.equal(s.lookups, 0);
  s.frameSrc = 'exposure.html'; c.window.__bodaPendingExposureRestore = true;
  c.flushDeferredChildTools('exposure'); drain();
  assert.equal(s.lookups, 0, 'Never replace pending edited snapshot with original assets');
  c.window.__bodaPendingExposureRestore = false; c.flushDeferredChildTools('exposure'); drain();
  assert.equal(s.messages.length, 1);
}

function testBottomTargetsAndNoReimport() {
  const { context: c, state: s } = harness();
  c.broadcastBottomImageAssets(); c.syncBottomAfterImportAction('import-sync');
  assert.equal(s.images, 0, 'Inactive bottom frames do not enumerate/copy images');
  assert.equal(s.imports.length, 0, 'Inactive bottom frames do not parse/replay workbook');
  s.view = 'bottom'; c.flushDeferredChildTools('bottom');
  assert.equal(s.imports.length, 1);
  assert.equal(s.imports[0][0], 'standalone');
  assert.equal(c.standaloneBottomLastSentVersion, 1, 'Deferred import participates in ordinary version dedupe');
  assert.equal(s.messages.length, 1);
  assert.equal(s.messages[0][0], 'standalone', 'Only active standalone receives assets');
  s.view = 'upload'; s.view = 'bottom'; c.flushDeferredChildTools('bottom');
  assert.equal(s.imports.length, 1, 'Returning to an edited tool never reimports workbook');
  assert.equal(s.messages.length, 1, 'Unchanged assets are not reposted');
  s.source = 'second'; c.broadcastBottomImageAssets();
  assert.equal(s.messages.length, 2);
  s.view = 'upload'; c.flushDeferredChildTools('import', { force: true });
  assert.equal(s.messages.at(-1)[0], 'preview', 'Hidden export force affects only its specified target');
  c.syncBottomAfterImportAction('snapshot-restore');
  assert.equal(s.imports.length, 1);
  s.view = 'generator'; c.flushDeferredChildTools('generator');
  assert.equal(s.imports.at(-1)[1], 'snapshot-restore');
  assert.equal(s.imports.at(-1)[0], 'generator');
  c.flushDeferredChildTools('generator');
  assert.equal(s.imports.length, 2, 'Restore replay is one-shot, not every activation');
}

function testHiddenBottomStateLevelAndStickyActivation() {
  const { context: c, state: s } = harness();
  vm.runInContext(segment('function syncBottomLevelPreset(', 'function sendLatestWorkOrderToStandaloneBottom('), c);
  vm.runInContext(segment('function syncGeneratorToolMode(', '/* 父頁與吸底 iframe'), c);
  vm.runInContext(segment('function acceptBottomStateFromFrame(', "window.addEventListener('message'"), c);
  c.currentLevelId = 'L1'; c.bottomSharedStateJson = 'initial';
  c.bottomStandaloneStateJson = 'initial'; c.bottomGeneratorStateJson = 'initial';
  c.bottomWorkOrderNeedsParserAuthority = false;
  c.shouldRenderImportBottomPreview = () => false;
  c.getBottomStateForSync = () => c.bottomSharedStateJson;
  c.syncBottomLevelPreset(); c.currentLevelId = 'L2'; c.syncBottomLevelPreset();
  c.acceptBottomStateFromFrame('edited-a', 'generator', 'EDIT');
  c.acceptBottomStateFromFrame('edited-latest', 'generator', 'EDIT');
  assert.equal(s.messages.length, 0, 'Hidden loaded editors receive neither level defaults nor shared-state renders');
  assert.equal(s.images, 0);
  assert.equal(c._deferredBottomLevel.standalone.levelId, 'L2');
  assert.equal(c._deferredBottomState.standalone, true);
  s.view = 'bottom'; c.flushDeferredChildTools('bottom');
  const bottom = s.messages.filter(item => item[0] === 'standalone').map(item => item[1]);
  assert.equal(bottom[0].type, 'BOTTOM_LEVEL'); assert.equal(bottom[0].levelId, 'L2');
  assert.equal(bottom[1].type, 'BOTTOM_STATE'); assert.equal(bottom[1].state, 'edited-latest');
  assert.equal(s.imports.length, 0, 'Applying deferred state never reparses an already edited workbook');
  assert.equal(c._deferredBottomLevel.standalone, null); assert.equal(c._deferredBottomState.standalone, false);
  const count = s.messages.length; c.flushDeferredChildTools('bottom'); assert.equal(s.messages.length, count);
  s.view = 'upload'; c.acceptBottomStateFromFrame('standalone-latest', 'standalone', 'EDIT');
  let loads = 0, layouts = 0; const frames = [];
  c.ensureBottomToolLoaded = () => { loads++; }; c.sendBottomHostLayout = () => { layouts++; };
  c.requestAnimationFrame = callback => frames.push(callback);
  c.latestBottomWorkOrder = null;
  c.syncGeneratorToolMode(); assert.equal(loads, 0, 'A remembered sticky palette cannot mount hidden generator');
  s.view = 'generator'; c.currentPaletteTab = 'subarea'; c.syncGeneratorToolMode(); assert.equal(loads, 0);
  c.currentPaletteTab = 'sticky'; c.syncGeneratorToolMode();
  assert.equal(loads, 1); frames.splice(0).forEach(callback => callback());
  assert.equal(layouts, 1);
  const generator = s.messages.filter(item => item[0] === 'generator').map(item => item[1]);
  assert.ok(generator.some(message => message.type === 'BOTTOM_STATE' && message.state === 'standalone-latest'));
  assert.equal(c._deferredBottomState.generator, false);
  c._deferredBottomState.generator = true; s.failPost = true; c.flushDeferredChildTools('generator');
  assert.equal(c._deferredBottomState.generator, true, 'Failed post retains dirty state for retry');
  s.failPost = false; c.flushDeferredChildTools('generator'); assert.equal(c._deferredBottomState.generator, false);
}

function testBottomPostFailureRetries() {
  const { context: c, state: s } = harness();
  s.view = 'bottom'; s.failPost = true;
  assert.equal(c.broadcastBottomImageAssets(), false);
  assert.equal(c.standaloneBottomAssetsSignature, '');
  s.failPost = false;
  assert.equal(c.broadcastBottomImageAssets(), true, 'Failed post must not poison dedupe signature');
  assert.equal(s.messages.length, 1);
}

function testReadyAlreadyImported() {
  const { context: c, state: s } = harness();
  c.syncBottomAfterImportAction('import-sync');
  // READY imports once before a queued activation callback has a chance to run.
  c.standaloneBottomLastSentVersion = 1;
  s.view = 'bottom'; c.flushDeferredChildTools('bottom');
  assert.equal(s.imports.length, 0, 'READY and activation races must never reimport an already edited workbook');
  assert.equal(c._deferredBottomSync.standalone, '');
  s.view = 'upload'; c.syncBottomAfterImportAction('snapshot-restore');
  s.view = 'bottom'; c.flushDeferredChildTools('bottom');
  assert.equal(s.imports.length, 0, 'Same-workbook restore applies saved state rather than reparsing workbook');
  assert.equal(s.messages.at(-1)[1].type, 'BOTTOM_STATE');
  assert.equal(s.messages.at(-1)[1].state, 'edited-state');
}

function testDirectSendersDeferBeforeCopy() {
  const { context: c, state: s } = harness();
  vm.runInContext(segment('function sendLatestWorkOrderToBottom(', 'function showImportBottomPreview('), c);
  vm.runInContext(segment('function sendLatestWorkOrderToStandaloneBottom(', 'function ensureStandaloneBottomLoaded('), c);
  let copies = 0;
  c.currentLevelId = 'L1'; c.bottomWorkOrderNeedsParserAuthority = false;
  c.latestBottomWorkOrder = { version: 2, name: 'new.xlsx', buffer: { slice() { copies++; return 'xlsx-copy'; } } };
  assert.equal(c.sendLatestWorkOrderToBottom('embedded-state-ready'), false);
  assert.equal(c.sendLatestWorkOrderToStandaloneBottom('bridge-ready'), false);
  assert.equal(copies, 0, 'Hidden direct callbacks cannot even clone workbook buffers');
  assert.equal(s.images, 0);
  assert.equal(c._deferredBottomSync.generator, 'embedded-state-ready');
  assert.equal(c._deferredBottomSync.standalone, 'bridge-ready');
  s.view = 'bottom'; c.flushDeferredChildTools('bottom');
  assert.equal(copies, 1);
  assert.equal(c.standaloneBottomLastSentVersion, 2);
  assert.equal(c._deferredBottomSync.standalone, '');
  s.view = 'upload';
  c.sendLatestWorkOrderToBottom('download-all', 'export-1');
  assert.equal(copies, 2, 'Explicit hidden export still receives its workbook');
  c.sendLatestWorkOrderToStandaloneBottom('manual-request');
  assert.equal(copies, 3, 'Explicit user sync request is allowed even during a view transition');
  c.latestBottomWorkOrder.version = 3;
  c._deferredBottomSync.standalone = 'import-sync';
  c.flushDeferredChildTools('bottom', { force: true });
  assert.equal(copies, 4, 'Force flush is passed through to the direct sender');
}

async function testExposureExportWaitsForApply() {
  const { context: c, state: s, drain } = harness();
  c.pushExposureOverviewAssets({ productFiles: 'awaited.png' });
  let release, completed = false, applied;
  s.applyAssets = payload => { applied = payload; return new Promise(resolve => { release = resolve; }); };
  const operation = c.flushDeferredChildTools('exposure', { force: true, immediate: true });
  assert.equal(typeof operation.then, 'function');
  operation.then(() => { completed = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(completed, false, 'Export cannot continue while child asset construction is unfinished');
  assert.equal(applied.products[0].name, 'awaited.png');
  assert.equal(s.messages.length, 0, 'Immediate export does not enqueue a second message');
  release(true); await operation; drain();
  assert.equal(completed, true);
  assert.equal(s.messages.length, 0);
  c.pushExposureOverviewAssets({ productFiles: 'failed.png' });
  s.applyAssets = () => Promise.reject(new Error('apply failed'));
  await assert.rejects(c.flushDeferredChildTools('exposure', { force: true, immediate: true }), /apply failed/);
  assert.equal(c._deferredExposureAssets, true, 'Failed direct application retains its latest source for retry');
}

testHiddenExposure();
testImportSyncDefersWorkbook();
testUnloadedAndPendingRestore();
testBottomTargetsAndNoReimport();
testHiddenBottomStateLevelAndStickyActivation();
testBottomPostFailureRetries();
testReadyAlreadyImported();
testDirectSendersDeferBeforeCopy();
testExposureExportWaitsForApply().then(() => {
  console.log('PASS lazy child sync: hidden no-op, latest-source activation, snapshot guard, targeted export, no replay, failed-post retry, direct sender guards, awaited exposure export');
}).catch(error => { console.error(error); process.exitCode = 1; });
