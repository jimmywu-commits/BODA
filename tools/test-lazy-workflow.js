'use strict';
/* Real browser integration: canonical import persists before any activity canvas exists. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const ExcelJS = require('../JS/vendor/exceljs-4.4.0.min.js');
const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
async function main() {
  let playwright;
  try { playwright = require('playwright'); } catch (_) { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
  const executablePath = process.env.BODA_TEST_BROWSER || [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(fs.existsSync);
  assert.ok(executablePath, 'Chrome/Edge required');
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Layout_Output');
  sheet.getCell('B1').value = '副區_A-1-1';
  sheet.getCell('B2').value = '促標'; sheet.getCell('C2').value = 'LAZY';
  sheet.getCell('B3').value = '商品'; sheet.getCell('C3').value = 'product.png';
  sheet.getCell('B4').value = '品名'; sheet.getCell('C4').value = 'Lazy product';
  const workbookBytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    if (relative === '__lazy_fixture.xlsx') { response.writeHead(200); response.end(workbookBytes); return; }
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(filename).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const errors = [], external = [], downloads = [];
  try {
    browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-background-networking'] });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: false });
    const origin = 'http://127.0.0.1:' + server.address().port;
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin) || /^(data:|blob:|about:)/.test(url)) return route.continue();
      external.push(url); return route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(90000);
    page.on('pageerror', error => errors.push(error.message)); page.on('download', file => downloads.push(file.suggestedFilename()));
    await page.goto(origin + '/index.html#upload');
    await page.waitForFunction(() => document.readyState === 'complete' && window.blocksLoadedForImport === true && !window.importStateRestorePending && (!window.APP_LOADING || !APP_LOADING.active) && typeof ensureImportResourcesReady === 'function');
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 140;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f33425'; ctx.fillRect(0, 0, 180, 140); ctx.fillStyle = '#fff'; ctx.fillRect(25, 30, 90, 55);
      window.__lazyOriginal = canvas.toDataURL();
      const raw = await parseImportXlsx(await (await fetch('/__lazy_fixture.xlsx')).arrayBuffer(), { filename: 'lazy-fixture.xlsx' });
      window.__lazyRaw = raw; uploadedImages = [{ name: 'product.png', url: __lazyOriginal, baseUrl: __lazyOriginal }];
      currentImportWorkbookName = 'lazy-fixture.xlsx'; afterImportParsed(raw, { source: 'file', hasBottomWorkOrder: false });
    });
    await page.waitForFunction(() => currentImportColumns.length === 1 && importResourceShadowPending && (!window.APP_LOADING || !APP_LOADING.active));
    const hidden = await page.evaluate(async () => {
      const column = currentImportColumns[0], key = 'imp-mount-0::productImg';
      column.data.__canvasImageEditorState = { 'productImg::0': { outputSrc: column.data.productImg, baseSrc: __lazyOriginal, layoutOffsetX: '-12', layoutOutputWidth: '90' } };
      BNImageLayout.setState({ weights: { [key]: { 0: 1.25 } }, offsets: { [key]: { 0: { x: 13, y: -8 } } } });
      saveImportState(); await getImportSaveQueue().flush(); const saved = await importIdbGet(); const backup = await buildImportSnapshot(); appLoadingFinish('test');
      return { mounts: document.querySelectorAll('#imp-strip .imp-slot').length, bottomSources: Array.from(document.querySelectorAll('iframe[src]')).filter(frame => /bottom\//.test(frame.getAttribute('src'))).length,
        matched: column.data.productImg === __lazyOriginal, savedPending: saved.pendingDerivedAssets, savedColumns: saved.columns.length,
        savedCrop: saved.columns[0].data.__canvasImageEditorState['productImg::0'].layoutOffsetX,
        backupCrop: backup.columns[0].data.__canvasImageEditorState['productImg::0'].layoutOutputWidth,
        savedWeight: saved.imageZoomWeights[key][0], active: document.querySelector('#views>.view.active')?.id, hash: location.hash };
    });
    assert.equal(hidden.mounts, 0); assert.equal(hidden.bottomSources, 0); assert.equal(hidden.matched, true); assert.equal(hidden.savedPending, true);
    assert.equal(hidden.savedColumns, 1); assert.equal(hidden.savedCrop, '-12'); assert.equal(hidden.backupCrop, '90'); assert.equal(hidden.savedWeight, 1.25); assert.equal(hidden.active, 'view-upload');
    console.log('PASS hidden real-XLSX import, image matching, IDB save, backup, crop and geometry without mounts');
    const lifecycleFlags = await page.evaluate(async () => {
      // Isolated payload boundary checks: no worker is dispatched while these flags are staged.
      const previous = { pending: importResourceShadowPending, running: importShadowReapplyRunning, queued: importShadowQueuedRequest };
      const results = [];
      try {
        for (const state of [{ pending: true, running: false, queued: null }, { pending: false, running: true, queued: null }, { pending: false, running: false, queued: { testOnly: true } }]) {
          importResourceShadowPending = state.pending; importShadowReapplyRunning = state.running; importShadowQueuedRequest = state.queued;
          saveImportState(); await getImportSaveQueue().flush(); results.push((await importIdbGet()).pendingDerivedAssets);
        }
        importResourceShadowPending = false; importShadowReapplyRunning = false; importShadowQueuedRequest = null;
        results.push(buildImportStateSavePayload().pendingDerivedAssets);
      } finally { importResourceShadowPending = previous.pending; importShadowReapplyRunning = previous.running; importShadowQueuedRequest = previous.queued; saveImportState(); await getImportSaveQueue().flush(); }
      return results;
    });
    assert.deepEqual(lifecycleFlags, [true, true, true, false]);
    console.log('PASS deferred, running and queued derived-work markers persist until idle');
    // Export from upload, before this document has ever opened the activity page.
    const completed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Unseen activity export timed out')), 120000);
      page.on('console', message => {
        const text = message.text();
        if (text.startsWith('BODA_LAZY_DONE ')) { clearTimeout(timer); resolve(JSON.parse(text.slice(15))); }
        if (text.startsWith('BODA_LAZY_ERROR ')) { clearTimeout(timer); reject(new Error(text.slice(16))); }
      });
    });
    await page.evaluate(() => {
      (async () => {
        const before = { view: document.querySelector('#views>.view.active')?.id, hash: location.hash };
        const result = await downloadImportImage({ collectOnly: true, includeBottom: false, includeComposite: false });
        const files = [];
        for (const file of result.files) {
          const img = new Image(); img.src = file.dataUrl; await img.decode();
          const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, 80, 60);
          const pixels = ctx.getImageData(0, 0, 80, 60).data, colors = new Set(); let opaque = 0;
          for (let i = 0; i < pixels.length; i += 4) { if (pixels[i + 3]) opaque++; colors.add(Array.from(pixels.slice(i, i + 4)).join(',')); }
          files.push({ width: img.naturalWidth, height: img.naturalHeight, opaque, colors: colors.size });
        }
        console.log('BODA_LAZY_DONE ' + JSON.stringify({ before, after: { view: document.querySelector('#views>.view.active')?.id, hash: location.hash }, files, failures: result.failures,
          captureRestored: !window.importExportCapturing && !document.getElementById('imp-strip').classList.contains('bn-export-capture') }));
      })().catch(error => console.log('BODA_LAZY_ERROR ' + String(error.stack || error)));
      return true;
    });
    const exported = await completed; assert.deepEqual(exported.after, exported.before); assert.equal(exported.files.length, 1);
    assert.ok(exported.files[0].width > 100 && exported.files[0].height > 100 && exported.files[0].opaque > 0 && exported.files[0].colors > 2); assert.equal(exported.captureRestored, true);
    assert.equal((exported.failures || []).length, 0);
    console.log('PASS unseen collectOnly export prepares nonblank PNG without changing view/hash');
    await page.evaluate(() => {
      window.__lazyTrace = [];
      ['renderImportColumns', 'rerenderCanvasMount', 'refreshImportShadowView', 'syncImportBgFromExposure', 'applyImportTheme', 'scheduleImportShadowReapply', 'runImportShadowReapply'].forEach(name => {
        const original = window[name]; if (typeof original !== 'function') return;
        window[name] = function () { __lazyTrace.push({ name, view: document.querySelector('#views>.view.active')?.id, pending: importResourceRenderPending, shadowPending: importResourceShadowPending, stack: new Error().stack.split('\n').slice(2, 6) }); return original.apply(this, arguments); };
      });
    });
    await page.evaluate(async () => { await showView('import', { skipLoading: true }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); window.__lazyMount = document.getElementById('imp-mount-0'); window.__lazyImage = __lazyMount.querySelector('.bn-imggroup img'); });
    const reentered = await page.evaluate(async () => { await showView('upload', { skipLoading: true }); await showView('import', { skipLoading: true }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return { sameMount: document.getElementById('imp-mount-0') === __lazyMount, sameImage: __lazyImage.isConnected }; });
    console.log('REENTRY ' + JSON.stringify(reentered));
    if (!reentered.sameImage) console.log('REENTRY_TRACE ' + JSON.stringify(await page.evaluate(() => __lazyTrace)));
    assert.equal(reentered.sameMount, true); assert.equal(reentered.sameImage, true);
    console.log('PASS first activity entry and return retain canvas/image identity');
    // Two real import callbacks in one turn: the old yielded callback must not resurrect A.
    await page.evaluate(() => { showView('upload', { skipLoading: true }); const a = structuredClone(__lazyRaw), b = structuredClone(__lazyRaw); a[0].header = 'OLD A'; b[0].header = 'LATEST B'; afterImportParsed(a, { source: 'file' }); afterImportParsed(b, { source: 'file' }); });
    await page.waitForFunction(() => currentImportColumns[0]?.header === 'LATEST B' && (!window.APP_LOADING || !APP_LOADING.active));
    await page.evaluate(async () => { await ensureImportResourcesReady({ canvas: true, reason: 'export' }); saveImportState(); await getImportSaveQueue().flush(); });
    const replaced = await page.evaluate(async () => ({ header: currentImportColumns[0].header, savedHeader: (await importIdbGet()).columns[0].header }));
    assert.equal(replaced.header, 'LATEST B'); assert.equal(replaced.savedHeader, 'LATEST B');
    console.log('PASS pending project replacement keeps latest workbook only');
    const previewState = await page.evaluate(async () => {
      renderPreviewAllStacked(currentImportColumns);
      await showView('upload', { skipLoading: true });
      return { context: activeImportCanvasContext, previewMounts: document.querySelectorAll('[id^="prevall-mount-"]').length, canonicalColumns: currentImportColumns.length };
    });
    assert.equal(previewState.context, 'preview'); assert.ok(previewState.previewMounts > 0); assert.equal(previewState.canonicalColumns, 1);
    const previewCompleted = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { page.off('console', listener); reject(new Error('Preview-to-upload PNG export timed out')); }, 120000);
      const listener = message => {
        const text = message.text();
        if (!text.startsWith('BODA_PREVIEW_DONE ') && !text.startsWith('BODA_PREVIEW_ERROR ')) return;
        clearTimeout(timer); page.off('console', listener);
        if (text.startsWith('BODA_PREVIEW_ERROR ')) reject(new Error(text.slice(19))); else resolve(JSON.parse(text.slice(18)));
      };
      page.on('console', listener);
    });
    await page.evaluate(() => {
      (async () => {
        const before = { view: document.querySelector('#views>.view.active')?.id, hash: location.hash };
        const result = await downloadImportImage({ collectOnly: true, includeBottom: false, includeComposite: false });
        const files = [];
        for (const file of result.files) {
          const image = new Image(); image.src = file.dataUrl; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 80, 60);
          const pixels = ctx.getImageData(0, 0, 80, 60).data, colors = new Set(); let opaque = 0;
          for (let i = 0; i < pixels.length; i += 4) { if (pixels[i + 3]) opaque++; colors.add(Array.from(pixels.slice(i, i + 4)).join(',')); }
          files.push({ width: image.naturalWidth, height: image.naturalHeight, opaque, colors: colors.size });
        }
        console.log('BODA_PREVIEW_DONE ' + JSON.stringify({ before, after: { view: document.querySelector('#views>.view.active')?.id, hash: location.hash }, files, failures: result.failures,
          context: activeImportCanvasContext, canonicalMounts: document.querySelectorAll('#imp-strip [id^="imp-mount-"]').length,
          captureRestored: !window.importExportCapturing && !document.getElementById('imp-strip').classList.contains('bn-export-capture') }));
      })().catch(error => console.log('BODA_PREVIEW_ERROR ' + String(error.stack || error)));
      return true;
    });
    const previewExported = await previewCompleted;
    assert.deepEqual(previewExported.after, previewExported.before); assert.equal(previewExported.before.view, 'view-upload');
    assert.equal(previewExported.files.length, 1); assert.equal((previewExported.failures || []).length, 0);
    assert.equal(previewExported.context, 'import'); assert.equal(previewExported.canonicalMounts, 1); assert.equal(previewExported.captureRestored, true);
    assert.ok(previewExported.files[0].width > 100 && previewExported.files[0].height > 100 && previewExported.files[0].opaque > 0 && previewExported.files[0].colors > 2);
    console.log('PASS preview-to-upload export restores canonical mounts and nonblank PNG without changing view/hash');
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(downloads, []);
    console.log('PASS lazy workflow: no browser errors, external requests or actual downloads');
    await context.close();
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
