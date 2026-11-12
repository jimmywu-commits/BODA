'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Missing shadow implementation: ' + start);
  return html.slice(a, b);
}
const implementation = [
  section('function importShadowSettingsSnapshot()', '/* 標記結尾'),
  section('function importShadowBakedKey(', '/* 原圖的前處理結果快取'),
  section('window.BODAImportShadow = window.BODAImportShadow || {};', '/* ══ 匯入工單畫布的商品'),
  section('function reapplyImportShadowToUploads(', 'function syncImportShadowPanel()'),
  section('/* One immutable revision at a time.', 'function initImportShadowPanel()')
].join('\n');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read) {
  const deadline = Date.now() + 3000;
  while (!read()) { if (Date.now() > deadline) throw new Error('Timed out waiting for shadow batch'); await delay(2); }
}
function harness(options = {}) {
  const counts = { prepared: 0, rendered: [], trimmed: 0, refresh: 0, sync: 0, syncOptions: [], failures: 0, batches: [] };
  const geometry = new Map();
  const assets = ['a', 'b'].map(name => ({ name, baseUrl: name, url: name }));
  const states = { 'productImg::0': { outputSrc: 'a', crop: 'user-crop', transform: 'rotate(23deg)', x: '37', scale: '1.8' } };
  const columns = [{ blockId: 'test', data: { productImg: 'a,b', logoImg: '', __canvasImageEditorState: states } }];
  const context = {
    console, Promise, Set, Map, setTimeout, clearTimeout,
    document: { querySelector(selector) { return selector === '#view-import.active' ? {} : null; } },
    uploadedImages: assets, currentImportColumns: columns, previewAllColumns: [],
    importShadowSettings: { angle: 'left', offsetX: 0, offsetY: 0 },
    background: '#ffffff', importShadowPrepCache: {}, importShadowReapplyStage: '', importShadowPassBackground: '',
    APP_LOADING: { active: false },
    window: { BodaPerf: { begin() { const record = {}; counts.batches.push(record); return info => Object.assign(record, info); } } },
    importShadowActualBackground() { return context.background; }, importShadowColorForBackground(bg) { return bg === '#ffffff' ? '#555555' : '#112233'; },
    importShadowFingerprint(value) { return String(value); }, isImportShadowEngineReady() { return true; },
    importShadowGeometryOf(url) { return geometry.get(url) || null; },
    importShadowActiveColumns() { return context.currentImportColumns; },
    auditImportShadowCanvasAssets() { return { checked: 2, repaired: 0, alreadyShadow: 0, unresolved: 0 }; },
    recoverImportShadowCanvasAssets() { return Promise.resolve(); },
    BNCore: { getBlock() { return { fields: [{ key: 'productImg', type: 'image' }, { key: 'logoImg', type: 'image' }] }; } },
    isImportShadowFieldKey(key) { return key === 'productImg'; }, isImportLogoFieldKey(key) { return key === 'logoImg'; },
    splitImageList(value) { return String(value || '').split(',').filter(Boolean); },
    imageAssetNamesForUrl(url) { return context.uploadedImages.filter(item => item.url === url || item.baseUrl === url).map(item => item.name); },
    importShadowPrepared(base) {
      if (!context.importShadowPrepCache[base]) {
        counts.prepared++;
        context.importShadowPrepCache[base] = Promise.resolve(options.prepare ? options.prepare(base) : null).then(() => ({ trimmed: 'clean-' + base, base, product: {} }));
      }
      return context.importShadowPrepCache[base];
    },
    trimImportImageWhiteBorder(base) { counts.trimmed++; return Promise.resolve('clean-' + base); },
    importShadowRender(prep, settings) {
      counts.rendered.push({ base: prep.base, settings: { ...settings } });
      const url = 'shadow-' + prep.base + '-' + settings.color + '-' + settings.offsetX;
      geometry.set(url, { sourceWidth: 100, sourceHeight: 200, outputWidth: 140, outputHeight: 240, offsetX: 20, offsetY: 10 });
      return url;
    },
    importLogoRefresh() { return Promise.resolve({ swap: {}, changed: false, modeChanged: false }); },
    normalizeLogoImageFields() {}, refreshImportShadowView() { counts.refresh++; }, syncAllChildTools(options) { counts.sync++; counts.syncOptions.push(options); },
    appLoadingStart() { context.APP_LOADING.active = true; }, appLoadingUpdate() {},
    appLoadingFinish() { context.APP_LOADING.active = false; }, appLoadingFail() { counts.failures++; context.APP_LOADING.active = false; },
    appLoadingYield() { return options.yield ? options.yield() : Promise.resolve(); }, setImportShadowStatus() {}, setImportShadowApplyBusy() {},
    importShadowDropCache() { context.importShadowPrepCache = {}; }
  };
  vm.createContext(context); vm.runInContext(implementation, context);
  return { context, counts, assets, states, columns,
    async run(commit = true) { context.scheduleImportShadowReapply(commit); await until(() => !context.importShadowReapplyRunning && !context.importShadowReapplyPending); } };
}

async function normalAndOff() {
  const h = harness(); await h.run();
  assert.equal(h.counts.rendered.length, 2);
  assert.equal(h.counts.refresh, 1, 'All image swaps must publish in one canvas refresh');
  assert.equal(h.counts.sync, 1);
  assert.equal(h.states['productImg::0'].crop, 'user-crop');
  assert.equal(h.states['productImg::0'].transform, 'rotate(23deg)');
  assert.equal(h.states['productImg::0'].x, '37');
  assert.equal(h.states['productImg::0'].scale, '1.8');
  assert.equal(h.states['productImg::0'].layoutOffsetX, '20', 'Output geometry must follow the actual baked product');
  await h.run();
  assert.equal(h.counts.rendered.length, 2, 'Repeated equal input must reuse baked products');
  assert.equal(h.counts.prepared, 2);
  h.context.importShadowSettings.angle = 'off'; await h.run();
  assert.equal(h.counts.prepared, 2, 'Disabling shadows must not run cutout/registration again');
  assert.equal(h.counts.rendered.length, 2);
  assert.equal(h.counts.trimmed, 0, 'Disabling shadows should reuse the cached clean trimmed URLs');
  assert.equal(h.columns[0].data.productImg, 'clean-a,clean-b');
  assert.equal(h.assets[0].shadowGeom, undefined);
  assert.equal(h.states['productImg::0'].layoutOffsetX, undefined);
  assert.equal(h.states['productImg::0'].crop, 'user-crop');
  const offKey = h.context.importShadowBakeKey(h.assets[0]);
  h.context.background = '#aabbcc'; h.context.importShadowSettings.offsetX = 17;
  assert.equal(h.context.importShadowBakeKey(h.assets[0]), offKey, 'Off cache identity must ignore irrelevant color and offset');
  await h.run(); assert.equal(h.counts.trimmed, 0);
  h.assets[0].baseUrl = h.assets[0].url = 'edited-a'; h.columns[0].data.productImg = 'edited-a,clean-b';
  await h.run();
  assert.equal(h.counts.trimmed, 1, 'A new crop source must invalidate only its clean URL cache');
  assert.equal(h.assets[0].url, 'clean-edited-a');
  console.log('PASS cached shadow/clean results avoid repeated cutout and preserve crop, position, scale and geometry');
}

async function supersededAtomicBatch() {
  let releaseB;
  const h = harness({ prepare(base) { if (base === 'b') return new Promise(resolve => { releaseB = resolve; }); } });
  h.context.scheduleImportShadowReapply(true);
  await until(() => !!releaseB);
  assert.equal(h.counts.rendered.length, 1);
  assert.equal(h.assets[0].url, 'a', 'A completed individual bake must stay staged until the revision completes');
  assert.equal(h.columns[0].data.productImg, 'a,b');
  assert.equal(h.counts.refresh, 0);
  h.context.background = '#abcdef'; h.context.importShadowSettings.offsetX = 9;
  h.context.scheduleImportShadowReapply(false);
  h.context.scheduleImportShadowReapply(true);
  releaseB();
  await until(() => !h.context.importShadowReapplyRunning);
  assert.equal(h.counts.refresh, 1, 'Only the latest complete revision may refresh the canvas');
  assert.ok(h.assets.every(asset => asset.url.endsWith('#112233-9')));
  assert.equal(h.counts.rendered.at(-1).settings.background, '#abcdef');
  assert.equal(h.counts.failures, 0, 'Superseded work is cancellation, not an image failure');
  assert.equal(h.counts.sync, 1);
  assert.equal(h.counts.batches.length, 2, 'Equal pending commit requests must coalesce into one latest job');
  assert.equal(h.context.APP_LOADING.active, false);
  console.log('PASS stale work never publishes partial/mixed settings; latest requests coalesce and loading finishes');
}

async function editWhilePreparing() {
  let releaseA;
  const h = harness({ prepare(base) { if (base === 'a') return new Promise(resolve => { releaseA = resolve; }); } });
  h.context.scheduleImportShadowReapply(true); await until(() => !!releaseA);
  h.assets[0].baseUrl = h.assets[0].url = 'user-new-crop';
  h.columns[0].data.productImg = 'user-new-crop,b'; h.states['productImg::0'].outputSrc = 'user-new-crop';
  releaseA(); await until(() => !h.context.importShadowReapplyRunning);
  assert.ok(h.assets[0].url.startsWith('shadow-user-new-crop-'));
  assert.ok(!h.counts.rendered.some(item => item.base === 'a'), 'Outdated original must not be rendered or restore a newer crop');
  assert.equal(h.counts.refresh, 1);
  assert.equal(h.states['productImg::0'].crop, 'user-crop');
  console.log('PASS a new crop during preparation supersedes stale source pixels and is retained');
}

async function commitUpgrade() {
  let release;
  const h = harness({ prepare(base) { if (base === 'a') return new Promise(resolve => { release = resolve; }); } });
  h.context.scheduleImportShadowReapply(false); await until(() => !!release);
  h.context.scheduleImportShadowReapply(true); release();
  await until(() => !h.context.importShadowReapplyRunning);
  assert.equal(h.counts.batches.length, 1, 'Slider change for the same settings should upgrade the existing batch');
  assert.equal(h.counts.sync, 1, 'Commit upgrade must still persist and synchronize the completed edit');
  assert.equal(h.context.importShadowReapplyCommit, false);
  console.log('PASS preview-to-commit upgrade keeps one job and still saves the final edit');
}

async function settingsChangeAfterPublication() {
  let yields = 0, release;
  const h = harness({ yield() { if (++yields === 2) return new Promise(resolve => { release = resolve; }); return Promise.resolve(); } });
  h.context.scheduleImportShadowReapply(true); await until(() => !!release);
  assert.equal(h.counts.refresh, 1, 'The complete first revision may publish before a later user change');
  h.context.importShadowSettings.offsetY = 13;
  h.context.scheduleImportShadowReapply(true); release();
  await until(() => !h.context.importShadowReapplyRunning);
  assert.equal(h.counts.refresh, 2);
  assert.equal(h.counts.sync, 1, 'A superseded post-publication batch must not repeat persistence/synchronization');
  assert.equal(h.context.APP_LOADING.active, false);
  assert.ok(h.counts.rendered.slice(-2).every(item => item.settings.offsetY === 13));
  console.log('PASS settings changed during the post-publication yield finish through the latest revision only');
}

async function singleProductSnapshot() {
  let release;
  const h = harness({ prepare(base) { return new Promise(resolve => { release = resolve; }); } });
  const output = h.context.window.BODAImportShadow.composeProduct('a');
  h.context.background = '#aabbcc'; h.context.importShadowSettings.offsetX = 22;
  release(); await output;
  assert.equal(h.counts.rendered[0].settings.background, '#ffffff');
  assert.equal(h.counts.rendered[0].settings.color, '#555555');
  assert.equal(h.counts.rendered[0].settings.offsetX, 0);
  console.log('PASS a single product edit snapshots background, derived shadow color and offsets before async preparation');
}

async function backgroundBatchIsolation() {
  let release;
  const h = harness({ prepare(base) { if (base === 'a') return new Promise(resolve => { release = resolve; }); } });
  h.context.scheduleImportShadowReapply(true, { exposureAssets: false });
  await until(() => !!release);
  h.context.background = '#abcdef';
  h.context.scheduleImportShadowReapply(true, { exposureAssets: false });
  release();
  await until(() => !h.context.importShadowReapplyRunning);
  assert.equal(h.counts.sync, 1);
  assert.equal(h.counts.syncOptions[0].exposureAssets, false, '背景更新與過期工作重試均不得重送商品原圖');
  const upgraded = harness({ prepare(base) { if (base === 'a') return new Promise(resolve => { release = resolve; }); } });
  release = null;
  upgraded.context.scheduleImportShadowReapply(true, { exposureAssets: false });
  await until(() => !!release);
  upgraded.context.scheduleImportShadowReapply(true);
  upgraded.context.scheduleImportShadowReapply(true, { exposureAssets: false });
  release();
  await until(() => !upgraded.context.importShadowReapplyRunning);
  assert.equal(upgraded.counts.syncOptions[0].exposureAssets, true, '同批真正換素材必須保留同步需求');
  console.log('PASS background-only batches skip original asset replay; explicit material updates still synchronize');
}

(async () => { await normalAndOff(); await supersededAtomicBatch(); await editWhilePreparing(); await commitUpgrade(); await settingsChangeAfterPublication(); await singleProductSnapshot(); await backgroundBatchIsolation(); console.log('Shadow batch regression checks passed.'); })()
  .catch(error => { console.error(error.stack || error); process.exitCode = 1; });
