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
const functions = ['isImportCanvasDemanded', 'isImportDerivedResourceDemanded', 'isPreviewAllCanvasActive',
  'refreshImportShadowView', 'renderImportColumns', 'renderPreviewAllStacked', 'ensureImportResourcesReady', 'rerenderCanvasMount', 'applyCanvasThemeToContext'];
let activeView = 'upload', domReads = 0, saved = 0, expanded = 0, reused = 0, renderCalls = 0, remembered = 0;
const previewMount = {};
const panel = { classList: { add() {} }, style: {} };
const canonical = [{ blockId: 'canonical', data: {} }], preview = [{ blockId: 'preview', data: {} }];
const context = vm.createContext({
  Promise, console,
  document: {
    querySelector(selector) {
      if (selector === '[id^="prevall-mount-"]') return previewMount;
      if (selector === '#view-import.active') return activeView === 'import' ? {} : null;
      if (selector === '#view-exposure.active') return activeView === 'exposure' ? {} : null;
      throw new Error('Unexpected DOM selector: ' + selector);
    },
    getElementById(id) { domReads++; if (activeView === 'upload') throw new Error('Hidden refresh must not read mount DOM'); return id.startsWith('prevall-mount-') ? previewMount : panel; },
    querySelectorAll() { domReads++; if (activeView === 'upload') throw new Error('Hidden refresh must not scan DOM'); return []; }
  },
  activeImportCanvasContext: 'preview', currentImportColumns: canonical, previewAllColumns: preview,
  importResourceCanvasLease: 0, importResourcePreparationCount: 0, importResourceCanvasRequested: false,
  importResourcePreparation: null, importResourceCanvasColumns: canonical, importResourceRenderPending: false,
  importResourceShadowPending: false, importResourceShadowCommit: false, importResourceShadowExposure: false,
  importResourceShadowPromise: null, importResourceLastShadowError: null,
  ensureBlocksLoaded(resolve) { resolve(); },
  scheduleImportShadowReapply() { throw new Error('No pending shadow work should be scheduled'); },
  BNCore: { getBlock() { return { name: 'Preview', width: 100, height: 100, fields: [] }; }, renderInstance() { renderCalls++; return ''; } },
  normalizeLocalCircleDefaults() {}, normalizeLogoImageFields() {}, queueImportStateSave() { saved++; },
  canvasCtx(name) { assert.equal(name, 'preview'); return { columns() { return context.previewAllColumns; }, mountId() { return 'prevall-mount-0'; }, renderMode: 'preview' }; },
  importRenderOpts() { return {}; },
  importRenderMountIsCurrent() { reused++; return true; },
  repeatedRowCountForBlock() { return 2; }, renderedBlockSizeOf() { return { width: 100, height: 100 }; },
  prepareImportSelectionContext() {}, hideImportBottomPreview() {}, showImportToolbar() {},
  esc(value) { return String(value); }, rememberImportRenderMount() { remembered++; },
  IMPORT_SYNC: {}, renderPreviewAllTools() {}, renderImportColorPanel() {},
  resizePreviewAllMount() { expanded++; }, bindCanvasInteractions() { expanded++; }
});
vm.runInContext(functions.map(actual).join('\n'), context);
async function main() {
  assert.equal(context.isPreviewAllCanvasActive(), true, 'Previously visited preview still has its logical context and mounts');
  assert.equal(context.isImportDerivedResourceDemanded(), false, 'Hidden visited preview must not demand shadow/derived work');
  context.refreshImportShadowView();
  assert.equal(context.rerenderCanvasMount('preview', 0), null);
  context.applyCanvasThemeToContext('preview');
  assert.equal(domReads, 0, 'Hidden shadow/theme/mount refresh never reads or changes preview DOM');
  assert.equal(context.importResourceRenderPending, true);
  activeView = 'exposure'; assert.equal(context.isImportDerivedResourceDemanded(), true);
  activeView = 'upload';
  const next = [{ blockId: 'new-import', data: { title: 'new' } }];
  assert.equal(context.renderImportColumns(next), false);
  assert.equal(context.currentImportColumns, next);
  assert.equal(context.activeImportCanvasContext, 'import', 'Hidden new work order leaves obsolete preview context');
  assert.equal(context.isPreviewAllCanvasActive(), false);
  assert.equal(domReads, 0); assert.equal(saved, 1);
  // The real first preview render expands repeated rows, remembers mounts and preserves canonical ownership.
  context.currentImportColumns = canonical;
  activeView = 'import';
  context.renderPreviewAllStacked([{ blockId: 'preview', data: {} }, { blockId: 'preview', data: {} }]);
  const expandedPreview = context.previewAllColumns;
  assert.equal(expandedPreview.length, 2, 'Repeated preview expands once after deduplication');
  assert.equal(context.importResourceCanvasColumns, canonical, 'First preview records canonical ownership for later reentry');
  assert.equal(context.importResourceRenderPending, false);
  assert.equal(remembered, 2, 'Every first-render preview mount records reuse metadata');
  assert.equal(renderCalls, 2); assert.equal(expanded, 2);
  context.importResourceRenderPending = true;
  const first = context.ensureImportResourcesReady({ canvas: true, reason: 'view' });
  const concurrent = context.ensureImportResourcesReady({ canvas: true, reason: 'view' });
  assert.equal(first, concurrent, 'Concurrent activation shares a single preparation');
  await first;
  assert.equal(context.activeImportCanvasContext, 'preview', 'Reentry keeps preview as the selected canvas context');
  assert.equal(context.currentImportColumns, canonical);
  assert.equal(context.previewAllColumns, expandedPreview);
  assert.equal(reused, 2, 'Preview entry applies pending theme once and reuses both unchanged mounts');
  assert.equal(expanded, 2, 'Reentry must not expand/rebind preview instances again');
  assert.equal(renderCalls, 2, 'Reentry does not rerender initially rendered preview mounts');
  await context.ensureImportResourcesReady({ canvas: true, reason: 'view' });
  assert.equal(reused, 2, 'Already prepared preview stays idle on subsequent entry');
  assert.equal(context.importResourceRenderPending, false);
  assert.equal(context.importResourceCanvasLease, 0);
  assert.equal(context.importResourcePreparationCount, 0);
  // Exercise the actual canonical renderer when export overrides an existing preview.
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) {
      const value = { style: {}, classList: { add() {} }, contains() { return true; }, appendChild() {}, setAttribute() {} };
      Object.defineProperty(value, 'innerHTML', { set(html) {
        if (id === 'import-preview-list') {
          nodes.delete('imp-strip'); nodes.delete('imp-strip-wrap');
          if (html.includes('id="imp-strip"')) { node('imp-strip'); node('imp-strip-wrap'); }
        }
      } });
      nodes.set(id, value);
    }
    return nodes.get(id);
  }
  Object.assign(context, {
    importZoom: 1, importMidBannerAvailable: false, importBottomPreviewResult: null, latestBottomWorkOrder: null,
    importColLockIsActive() { return false; }, importLevelHiddenIndexes() { return {}; },
    importLevelHasBottom() { return false; }, importHasBottomSource() { return false; },
    buildImportColumnTools() {}, applyImportStripBg() {}, importRenderReuseSnapshot(value) { return value; },
    clearImportColLockState() {}, markActiveImportCol() {}
  });
  const query = context.document.querySelector;
  context.document.querySelector = selector => selector.startsWith('#import-block-tools ') ? null : query(selector);
  context.document.getElementById = id => id === 'imp-strip' || id === 'imp-strip-wrap' ? nodes.get(id) || null : node(id);
  context.document.createElement = () => ({ style: {}, setAttribute() {}, appendChild() {}, innerHTML: '' });
  context.activeImportCanvasContext = 'preview';
  context.importResourceRenderPending = false;
  await context.ensureImportResourcesReady({ canvas: true, reason: 'export' });
  assert.equal(context.activeImportCanvasContext, 'import', 'Export prioritizes canonical work-order context over preview');
  assert.ok(nodes.has('imp-strip') && nodes.has('imp-strip-wrap'), 'Actual canonical renderer creates the required export strip');
  nodes.delete('imp-strip'); nodes.delete('imp-strip-wrap');
  context.activeImportCanvasContext = 'preview';
  const viewRequest = context.ensureImportResourcesReady({ canvas: true, reason: 'view' });
  const exportRequest = context.ensureImportResourcesReady({ canvas: true, reason: 'export' });
  context.ensureImportResourcesReady({ canvas: true, reason: 'view' });
  assert.equal(viewRequest, exportRequest);
  assert.equal(context.importResourceCanvasRequested, 'export', 'A later view request cannot downgrade concurrent export demand');
  await exportRequest;
  assert.equal(context.activeImportCanvasContext, 'import');
  assert.ok(nodes.has('imp-strip'), 'Concurrent view preparation upgraded to export renders real canonical strip');
  assert.equal(context.importResourceCanvasLease, 0); assert.equal(context.importResourcePreparationCount, 0);
  const missing = vm.createContext({ Promise, currentImportColumns: canonical, importResourceCanvasLease: 1,
    window: { htmlToImage: {}, BodaExportFonts: {} }, appLoadingUpdate() {}, document: { getElementById() { return null; } } });
  vm.runInContext(actual('importPlacementDownloadJobs') + '\n' + actual('downloadImportImageNow'), missing);
  assert.throws(() => missing.importPlacementDownloadJobs(null), /畫布尚未建立/);
  await assert.rejects(missing.downloadImportImageNow({}), /畫布尚未建立/);
  missing.currentImportColumns = [];
  assert.equal(missing.importPlacementDownloadJobs(null).length, 0);
  assert.equal((await missing.downloadImportImageNow({})).files.length, 0, 'Genuinely empty projects can still return no files');
  console.log('PASS hidden visited preview stays idle, hidden new imports reset context, and preview reentry reuses expanded mounts');
  console.log('PASS preview export/concurrent upgrades build canonical strip; missing strips fail explicitly for nonempty projects');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
