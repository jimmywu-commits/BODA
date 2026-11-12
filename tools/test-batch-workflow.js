'use strict';
/* Synthetic scale measurement, not a user's original workbook or OS/GPU RAM.
 * node tools/test-batch-workflow.js --images=20 --report=output/performance/batch-20-round2.json */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const ExcelJS = require('../JS/vendor/exceljs-4.4.0.min.js');
const root = path.resolve(__dirname, '..');
const count = Number(process.argv.find(arg => arg.startsWith('--images='))?.slice(9) || 20);
assert.ok([20, 37].includes(count), 'Use --images=20|37');
const reportPath = path.resolve(root, process.argv.find(arg => arg.startsWith('--report='))?.slice(9) || `output/performance/batch-${count}-round2.json`);
assert.ok(reportPath.startsWith(root + path.sep), 'Report must stay in the BODA workspace');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const ready = () => document.readyState === 'complete' && window.blocksLoadedForImport === true &&
  !window.importStateRestorePending && (!window.APP_LOADING || !APP_LOADING.active);
async function main() {
  let playwright;
  try { playwright = require('playwright'); }
  catch (_) { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
  const executablePath = process.env.BODA_TEST_BROWSER || [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(file => fs.existsSync(file));
  assert.ok(executablePath, 'Chrome/Edge required');
  const wb = new ExcelJS.Workbook(), sheet = wb.addWorksheet('Layout_Output');
  sheet.getCell('B1').value = '副區_A-1-1';
  sheet.getCell('B2').value = '促標'; sheet.getCell('C2').value = 'TEST';
  sheet.getCell('B3').value = '商品'; sheet.getCell('C3').value = 'product.png';
  sheet.getCell('B4').value = '品名'; sheet.getCell('C4').value = 'Product';
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  const server = http.createServer((request, response) => {
    let relative;
    try { relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html'; }
    catch (_) { response.writeHead(400); response.end(); return; }
    if (relative === '__batch_fixture.xlsx') { response.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); response.end(bytes); return; }
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const errors = [], downloads = [], failures = [], stages = [], samples = [], requests = [];
  try {
    browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--disable-background-networking', '--disable-component-update'] });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: false });
    const page = await context.newPage(); page.setDefaultTimeout(90000);
    const origin = 'http://127.0.0.1:' + server.address().port;
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin) || /^(data:|blob:|about:)/.test(url)) return route.continue();
      failures.push({ url, reason: 'unexpected external request' }); return route.abort();
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('download', download => downloads.push(download.suggestedFilename()));
    page.on('response', response => { if (response.status() >= 400) failures.push({ url: response.url(), status: response.status() }); });
    page.on('request', request => requests.push(request.url()));
    const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
    async function sample(name) {
      const result = await cdp.send('Performance.getMetrics');
      const values = Object.fromEntries(result.metrics.map(metric => [metric.name, metric.value]));
      samples.push({ stage: name, jsHeapUsedBytes: values.JSHeapUsedSize, nodes: values.Nodes, documents: values.Documents });
    }
    async function stage(name, operation) {
      const start = performance.now(), result = await operation();
      const entry = { name, elapsedMs: Math.round(performance.now() - start), result };
      stages.push(entry); await sample(name);
      console.log('PASS ' + name + ' ' + JSON.stringify(entry, (key, value) => key === 'pixelHashes' ? { verifiedImages: value.length } : value)); return result;
    }
    await stage('empty-homepage', async () => { await page.goto(origin + '/index.html#upload'); await page.waitForFunction(ready); return { ready: true }; });
    const parsed = await stage('first-real-xlsx-parse', () => page.evaluate(async () => {
      const buffer = await (await fetch('/__batch_fixture.xlsx')).arrayBuffer();
      window.__batchRaw = await parseImportXlsx(buffer, { filename: 'synthetic-batch.xlsx' });
      return { count: __batchRaw.length, blockId: rawColumnBlockId(__batchRaw[0]), entries: __batchRaw[0].entries.length };
    }));
    assert.equal(parsed.count, 1); assert.equal(parsed.blockId, 'subarea_A_1_1');
    const created = await stage('render-and-save', () => page.evaluate(async imageCount => {
      beginImportImageLayoutDocument(false); currentImportSource = 'file';
      const raw = __batchRaw[0], id = rawColumnBlockId(raw), definition = BNCore.getBlock(id);
      currentImportColumns = Array.from({ length: imageCount }, (_, index) => {
        const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1000;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = 'hsl(' + index * 137.5 + ' 60% 50%)'; ctx.fillRect(0, 0, 1200, 1000);
        for (let n = 0; n < 180; n++) { ctx.fillStyle = 'hsl(' + (index * 37 + n * 11) + ' 70% 45%)'; ctx.fillRect((n * 97 + index * 19) % 1150, (n * 59 + index * 23) % 950, 50, 50); }
        ctx.fillStyle = '#fff'; ctx.font = '80px sans-serif'; ctx.fillText(String(index + 1), 80, 120);
        return { blockId: id, header: 'Batch ' + (index + 1), band: 1, data: Object.assign({}, BNCore.defaultData(id), smartMapEntriesToFields(raw.entries, definition),
          { productImg: canvas.toDataURL(), promo: 'TEST', name: 'Product' + (index + 1), logoImg: '' }) };
      });
      window.__batchInitialSources = currentImportColumns.map(column => column.data.productImg);
      showView('import', { skipLoading: true }); renderImportColumns(currentImportColumns);
      await Promise.all(Array.from(document.querySelectorAll('#imp-strip img')).filter(image => image.src).map(image => image.decode()));
      saveImportState(); await getImportSaveQueue().flush();
      const saved = await importIdbGet();
      return { columns: saved.columns.length, uniqueImages: new Set(saved.columns.map(column => column.data.productImg)).size,
        totalEncodedImageCharacters: saved.columns.reduce((sum, column) => sum + column.data.productImg.length, 0) };
    }, count));
    assert.equal(created.columns, count); assert.equal(created.uniqueImages, count);
    const reused = await stage('unchanged-render', () => page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('#imp-strip .bn-imggroup img'));
      renderImportColumns(currentImportColumns, true);
      return { before: images.length, reused: images.filter(image => image.isConnected).length };
    }));
    assert.ok(reused.before >= count); assert.equal(reused.reused, reused.before);
    const geometry = await stage('geometry-only-save', () => page.evaluate(async () => {
      const saveStart = performance.now();
      const key = 'imp-mount-0::productImg'; BNImageLayout.setState({ weights: { [key]: { 0: 1.25 } }, offsets: { [key]: { 0: { x: 13, y: -8 } } } });
      saveImportState(); await getImportSaveQueue().flush();
      const saved = await importIdbGet();
      const saveAndReadbackMs = Math.round(performance.now() - saveStart);
      if (!saved.columns.every((column, index) => column.data.productImg === __batchInitialSources[index])) throw new Error('Geometry-only save changed encoded image pixels');
      // Decode each original image and compare full RGBA hashes after reload,
      // rather than assuming equality from only filenames or data lengths.
      const hashes = [];
      for (const column of saved.columns) {
        const image = new Image(); image.src = column.data.productImg; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join(''));
      }
      localStorage.removeItem(IMPORT_STORAGE_KEY);
      return { columns: saved.columns.length, weight: saved.imageZoomWeights[key][0], offset: saved.imageOffsets[key][0], encodedPixelsUnchanged: true,
        saveAndReadbackMs, pixelHashes: hashes };
    }));
    assert.equal(geometry.weight, 1.25); assert.deepEqual(geometry.offset, { x: 13, y: -8 });
    const localBackupKey = await page.evaluate(() => IMPORT_STORAGE_KEY);
    await page.addInitScript(key => { localStorage.removeItem(key); window.__batchLocalBackupClearedBeforeApp = true; }, localBackupKey);
    const restored = await stage('IDB-only-reload', async () => {
      const reloadStart = performance.now();
      await page.reload(); await page.waitForFunction(ready); await page.waitForFunction(expected => window.currentImportColumns?.length === expected, count);
      const reloadReadyMs = Math.round(performance.now() - reloadStart);
      const validated = await page.evaluate(async () => {
        const key = 'imp-mount-0::productImg', layout = currentImportImageLayout(), hashes = [];
        for (const column of currentImportColumns) {
          const image = new Image(); image.src = column.data.productImg; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
          hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, canvas.width, canvas.height).data))).map(value => value.toString(16).padStart(2, '0')).join(''));
        }
        return { columns: currentImportColumns.length, weight: layout.weights[key][0], offset: layout.offsets[key][0], pixelHashes: hashes,
          localStorageBackupClearedBeforeApp: window.__batchLocalBackupClearedBeforeApp === true };
      });
      return { ...validated, reloadReadyMs };
    });
    assert.equal(restored.columns, count); assert.equal(restored.weight, 1.25); assert.deepEqual(restored.offset, { x: 13, y: -8 });
    assert.equal(restored.localStorageBackupClearedBeforeApp, true);
    assert.deepEqual(restored.pixelHashes, geometry.pixelHashes);
    await page.bringToFront();
    const expectedFiles = await page.evaluate(() => importPlacementDownloadJobs(document.getElementById('imp-strip')).length);
    assert.equal(expectedFiles, 1, 'All columns share band 1: export one whole subarea row, not one PNG per product');
    const exported = await stage('individual-resource-export', async () => {
      // No CDP metrics/polling during SVG decoding; console delivers completion.
      const completed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { page.off('console', listener); reject(new Error('Batch PNG export timed out')); }, 120000);
        const listener = message => {
          const text = message.text();
          if (!text.startsWith('BODA_BATCH_DONE ') && !text.startsWith('BODA_BATCH_ERROR ')) return;
          clearTimeout(timer); page.off('console', listener);
          if (text.startsWith('BODA_BATCH_ERROR ')) reject(new Error(text.slice(17))); else resolve(JSON.parse(text.slice(16)));
        };
        page.on('console', listener);
      });
      await page.evaluate(() => {
        (async () => {
          const result = await downloadImportImage({ collectOnly: true, includeBottom: false, includeComposite: false });
          const files = [];
          for (const file of result.files) {
            const image = new Image(); image.src = file.dataUrl; await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 80, 60);
            const pixels = ctx.getImageData(0, 0, 80, 60).data, colors = new Set(); let opaque = 0;
            for (let i = 0; i < pixels.length; i += 4) { if (pixels[i + 3]) opaque++; colors.add([pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]].join(',')); }
            files.push({ filename: file.filename, width: image.naturalWidth, height: image.naturalHeight, bytes: Math.floor(file.dataUrl.split(',')[1].length * 3 / 4), png: file.dataUrl.startsWith('data:image/png;base64,'), opaque, sampledColors: colors.size });
          }
          console.log('BODA_BATCH_DONE ' + JSON.stringify({ files, failures: result.failures, captureRestored: !window.importExportCapturing && !document.getElementById('imp-strip').classList.contains('bn-export-capture') }));
        })().catch(error => console.log('BODA_BATCH_ERROR ' + String(error.stack || error)));
        return true;
      });
      return completed;
    });
    assert.equal(exported.files.length, expectedFiles); assert.equal(exported.failures.length, 0); assert.equal(exported.captureRestored, true);
    for (const file of exported.files) assert.ok(file.png && file.width > 0 && file.height > 0 && file.opaque > 0 && file.sampledColors > 3);
    assert.deepEqual(errors, []); assert.deepEqual(downloads, []); assert.deepEqual(failures, []);
    const report = { generatedAt: new Date().toISOString(), valid: true, imageCount: count,
      conditions: { source: 'local HTTP, fresh Playwright browser context, headless Chrome, no CPU/network throttling',
        fixture: 'synthetic real Layout_Output XLSX plus unique 1200x1000 PNGs; subarea_A_1_1 columns share band 1 and export as one row',
        limitations: ['Not the original user workbook, GitHub transfer timing, or low-end laptop', 'Stage-boundary JS heap samples only; not total RAM, GPU, continuous peak or leak proof',
          'Render-and-save includes synthetic PNG generation; geometry/reload stage totals include full RGBA verification. Separate saveAndReadbackMs and reloadReadyMs exclude pixel hashing',
          'Single run per image count; no before/after RAM percentage can be inferred'] },
      indexSHA256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'index.html'))).digest('hex'), stages, samples,
      sampledMaxJsHeapBytes: Math.max(...samples.map(sample => sample.jsHeapUsedBytes || 0)), runtimeErrors: errors.length, downloads: downloads.length,
      httpOrExternalFailures: failures.length, requestCount: requests.length };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log('PASS synthetic batch report ' + reportPath);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
