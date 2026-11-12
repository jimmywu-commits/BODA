'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function actual(name) {
  const match = new RegExp('\\bfunction\\s+' + name + '\\s*\\(').exec(source);
  assert.ok(match, name);
  for (let end = source.indexOf('}', match.index); end >= 0; end = source.indexOf('}', end + 1)) {
    const candidate = source.slice(match.index, end + 1);
    try { new vm.Script('(' + candidate + ')'); return candidate; } catch (_) {}
  }
  throw new Error('Cannot extract ' + name);
}
const names = ['shouldRenderImportBottomPreview', 'withBottomPreviewExportLease',
  'sendLatestWorkOrderToBottomPreview', 'ensureBottomPreviewLoaded', 'dispatchBottomPreviewForExport',
  'postToBottomPreview', 'settleBottomPreviewWaiters', 'requestBottomPreviewForWorkOrderExport',
  'waitForBottomPreviewBridge', 'requestBottomVariantFiles', 'settleBottomVariantRequest', 'syncBottomLevelPreset'];
const posts = [], timers = new Map();
let timerId = 0, demanded = false, loads = 0, copies = 0, assetReads = 0;
const classList = { contains() { return demanded; }, add() {}, remove() {} };
const frame = { getAttribute() { return this.src; }, removeAttribute() {}, set src(value) { this.url = value; loads++; }, get src() { return this.url; } };
const context = vm.createContext({
  console, Promise, Date, Error, Math,
  setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
  clearTimeout(id) { timers.delete(id); },
  document: { getElementById(id) { return id === 'import-bottom-preview-frame' ? frame : { classList }; } },
  isImportCanvasDemanded() { return demanded; },
  bottomPreviewExportLease: 0, importResourceOmitBottomPreview: 0, bottomPreviewToolLoaded: false, bottomPreviewBridgeReady: true,
  bottomPreviewLastSentVersion: 0, bottomPreviewAssetsSignature: '', bottomPreviewWaiters: [],
  bottomVariantWaiters: {}, bottomVariantSeq: 0, importBottomPreviewResult: null,
  bottomBridgeReady: true, standaloneBottomBridgeReady: true, currentLevelId: 'L',
  latestBottomWorkOrder: { version: 1, name: 'order.xlsx', bottomState: '{}', buffer: { slice() { copies++; return {}; } } },
  bottomWorkOrderNeedsParserAuthority: false,
  getBottomStateForSync() { return '{}'; }, bottomHostImageAssets() { assetReads++; return {}; },
  bottomHostAssetsSignature() { return 'assets'; }, importHasBottomSource() { return true; }, importLevelHasBottom() { return true; },
  bottomVariantFallback(err) { return { files: [], note: err.message }; },
  syncBottomLevelToTarget() { return false; }, // Editor-target demand is covered by test-lazy-child-sync.js.
  postToBottom(message) { posts.push(['generator', message]); },
  postToStandaloneBottom(message) { posts.push(['standalone', message]); },
  postToFrame(id, message) {
    posts.push(['preview', message]);
    if (message.type === 'WORKORDER_FILE') Promise.resolve().then(() => {
      context.importBottomPreviewResult = { dataUrl: 'png', workOrderVersion: 1 };
      context.settleBottomPreviewWaiters(null, context.importBottomPreviewResult);
    });
    if (message.type === 'EXPORT_VARIANTS') Promise.resolve().then(() => {
      assert.ok(context.bottomPreviewExportLease > 0, 'variants response still holds export demand');
      context.settleBottomVariantRequest({ requestId: message.requestId, ok: true, files: [{ filename: 'bottom.png', dataUrl: 'png' }] });
    });
    return true;
  }
});
vm.runInContext(names.map(actual).join('\n'), context);
async function main() {
  context.ensureBottomPreviewLoaded(false);
  assert.equal(loads, 0, 'hidden activity never mounts the preview');
  assert.equal(context.sendLatestWorkOrderToBottomPreview('embedded-state-ready'), false);
  assert.equal(context.dispatchBottomPreviewForExport(), false);
  assert.equal(context.postToBottomPreview({ type: 'IMAGE_ASSETS' }), false);
  assert.equal(copies, 0); assert.equal(assetReads, 0);
  context.syncBottomLevelPreset();
  assert.deepEqual(posts, [], 'Hidden editor level sync is deferred separately from the preview');
  posts.length = 0;
  const preview = await context.requestBottomPreviewForWorkOrderExport();
  assert.equal(preview.dataUrl, 'png');
  assert.equal(loads, 1, 'explicit hidden export can mount');
  assert.equal(context.bottomPreviewExportLease, 0);
  assert.equal(context.bottomPreviewWaiters.length, 0);
  context.importBottomPreviewResult = null;
  const variants = await context.requestBottomVariantFiles();
  assert.equal(variants.files.length, 1);
  assert.equal(context.bottomPreviewExportLease, 0, 'nested export demand releases cleanly');
  assert.equal(timers.size, 0);
  await assert.rejects(context.withBottomPreviewExportLease(() => { throw new Error('failure'); }), /failure/);
  assert.equal(context.bottomPreviewExportLease, 0, 'synchronous failure releases demand');
  context.importBottomPreviewResult = null;
  context.postToFrame = () => true;
  const timeout = context.requestBottomPreviewForWorkOrderExport();
  const timeoutFn = [...timers.values()][0]; timers.clear(); timeoutFn();
  await assert.rejects(timeout, /逾時/);
  assert.equal(context.bottomPreviewWaiters.length, 0, 'timeout removes orphan waiter');
  assert.equal(context.bottomPreviewExportLease, 0, 'timeout releases demand');
  demanded = true; context.bottomPreviewLastSentVersion = 0;
  context.importResourceOmitBottomPreview = 1;
  assert.equal(context.shouldRenderImportBottomPreview(), false, 'Independent placement export omits bottom even with a canvas lease');
  context.ensureBottomPreviewLoaded(false);
  assert.equal(context.sendLatestWorkOrderToBottomPreview('import-canvas'), false);
  await context.withBottomPreviewExportLease(() => {
    assert.equal(context.shouldRenderImportBottomPreview(), true, 'Explicit bottom export overrides omission for its own duration');
  });
  assert.equal(context.shouldRenderImportBottomPreview(), false);
  context.importResourceOmitBottomPreview = 0;
  assert.equal(context.sendLatestWorkOrderToBottomPreview('import-canvas'), true);
  assert.equal(context.sendLatestWorkOrderToBottomPreview('import-canvas'), false, 'activation does not replay equal versions');
  demanded = false;
  assert.equal(context.sendLatestWorkOrderToBottomPreview('state-ready'), false, 'mounted preview stays quiet after leaving activity');
  console.log('PASS lazy bottom preview demand and explicit export leases');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
