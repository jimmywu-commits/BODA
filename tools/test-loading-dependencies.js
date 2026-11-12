'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const implementation = fs.readFileSync(path.join(__dirname, '..', 'JS', 'dependency-loader.js'), 'utf8');
function harness(url = 'https://example.test/BODA/JS/dependency-loader.js?v=test') {
  const scripts = [];
  const root = { setTimeout, clearTimeout };
  const document = {
    baseURI: new URL('../index.html', url).href,
    currentScript: { src: url },
    createElement: () => ({ setAttribute() {}, remove() { this.removed = true; } }),
    head: { appendChild(script) { scripts.push(script); } }
  };
  vm.runInNewContext(implementation, { window: root, document, URL, Promise, Number });
  return { root, scripts, ensure: root.BodaDependencies.ensure };
}

(async function () {
  const app = harness();
  assert.equal(app.scripts.length, 0, 'opening BODA must not load optional dependencies');
  const first = app.ensure('excel');
  const second = app.ensure('excel');
  assert.strictEqual(first, second, 'concurrent callers share one pending load');
  assert.equal(app.scripts.length, 1);
  assert.equal(app.scripts[0].src, 'https://example.test/BODA/JS/vendor/exceljs-4.4.0.min.js?v=20261111-slim1');
  app.root.ExcelJS = { Workbook: function Workbook() {} };
  app.scripts[0].onload();
  assert.strictEqual(await first, app.root.ExcelJS);
  assert.strictEqual(await app.ensure('excel'), app.root.ExcelJS);
  assert.equal(app.scripts.length, 1, 'reuse the available global');

  const failed = app.ensure('capture');
  app.scripts[1].onerror();
  await assert.rejects(failed, error => error.code === 'DEPENDENCY_LOAD');
  assert.equal(app.scripts[1].removed, true);
  const retried = app.ensure('capture');
  assert.equal(app.scripts.length, 3, 'network failure permits retry');
  app.root.htmlToImage = { toPng() {} };
  app.scripts[2].onload();
  assert.strictEqual(await retried, app.root.htmlToImage);

  const invalidZip = app.ensure('zip');
  app.scripts[3].onload();
  await assert.rejects(invalidZip, error => error.code === 'DEPENDENCY_MISSING');
  const validZip = app.ensure('zip');
  assert.ok(app.scripts[4].src.includes('/BODA/JS/vendor/jszip-3.10.1.min.js'), 'ZIP must not depend on the sibling repo');
  app.root.JSZip = function JSZip() {};
  app.scripts[4].onload();
  assert.strictEqual(await validZip, app.root.JSZip);

  const incompleteFonts = app.ensure('exportFonts');
  app.root.BN_FONTS_EMBED_CSS = '@font-face{font-weight:400;src:url(data:font/woff2;base64,fixture)}';
  app.scripts[5].onload();
  await assert.rejects(incompleteFonts, error => error.code === 'DEPENDENCY_MISSING', 'never silently export with missing font weights');
  const fonts = app.ensure('exportFonts');
  app.root.BN_FONTS_EMBED_CSS = [400, 500, 700].map(weight => '@font-face{font-weight:' + weight + ';src:url(data:font/woff2;base64,fixture)}').join('');
  app.scripts[6].onload();
  assert.strictEqual(await fonts, app.root.BN_FONTS_EMBED_CSS);
  await assert.rejects(app.ensure('unknown'), error => error.code === 'DEPENDENCY_UNKNOWN');

  const timeout = harness();
  await assert.rejects(timeout.ensure('excel', { timeoutMs: 5 }), error => error.code === 'DEPENDENCY_TIMEOUT');
  const afterTimeout = timeout.ensure('excel', { timeoutMs: 100 });
  assert.equal(timeout.scripts.length, 2);
  timeout.root.ExcelJS = { Workbook() {} }; timeout.scripts[1].onload(); await afterTimeout;

  const local = harness('file:///E:/GitHub/BODA/JS/dependency-loader.js');
  const localZip = local.ensure('zip');
  assert.equal(local.scripts[0].src, 'file:///E:/GitHub/BODA/JS/vendor/jszip-3.10.1.min.js?v=20261111-slim1');
  local.root.JSZip = function JSZip() {}; local.scripts[0].onload(); await localZip;

  const subsets = harness();
  assert.equal(subsets.scripts.length, 0, 'Opening BODA must not load the export subset loader');
  subsets.root.BodaExportFonts = { forNode: 'invalid initializer' };
  const invalidSubset = subsets.ensure('fontSubset');
  assert.strictEqual(subsets.ensure('fontSubset'), invalidSubset, 'Subset callers share one pending module load');
  assert.equal(subsets.scripts.length, 1);
  assert.equal(subsets.scripts[0].src, 'https://example.test/BODA/JS/export-font-loader.js?v=20261111-slim1');
  assert.ok(!subsets.scripts[0].src.includes('fonts-embed.js'), 'Subsets must not eagerly download the legacy full-font bundle');
  subsets.scripts[0].onload();
  await assert.rejects(invalidSubset, error => error.code === 'DEPENDENCY_MISSING' && error.dependency === 'fontSubset');
  assert.equal(subsets.scripts[0].removed, true);
  const subsetRetry = subsets.ensure('fontSubset');
  assert.equal(subsets.scripts.length, 2, 'An invalid subset initializer must permit retry');
  subsets.root.BodaExportFonts = { forNode() { return Promise.resolve('subset CSS'); } };
  subsets.scripts[1].onload();
  assert.strictEqual(await subsetRetry, subsets.root.BodaExportFonts);
  assert.strictEqual(await subsets.ensure('fontSubset'), subsets.root.BodaExportFonts);
  assert.equal(subsets.scripts.length, 2, 'The ready subset global must be reused');

  const networkSubset = harness();
  const brokenSubset = networkSubset.ensure('fontSubset'); networkSubset.scripts[0].onerror();
  await assert.rejects(brokenSubset, error => error.code === 'DEPENDENCY_LOAD' && error.dependency === 'fontSubset');
  const repairedSubset = networkSubset.ensure('fontSubset');
  networkSubset.root.BodaExportFonts = { forNode() {} }; networkSubset.scripts[1].onload();
  assert.strictEqual(await repairedSubset, networkSubset.root.BodaExportFonts);

  const slowSubset = harness();
  await assert.rejects(slowSubset.ensure('fontSubset', { timeoutMs: 5 }), error => error.code === 'DEPENDENCY_TIMEOUT');
  const subsetAfterTimeout = slowSubset.ensure('fontSubset', { timeoutMs: 100 });
  slowSubset.root.BodaExportFonts = { forNode() {} }; slowSubset.scripts[1].onload(); await subsetAfterTimeout;

  const localSubsets = harness('file:///E:/GitHub/BODA/JS/dependency-loader.js');
  const localSubset = localSubsets.ensure('fontSubset');
  assert.equal(localSubsets.scripts[0].src, 'file:///E:/GitHub/BODA/JS/export-font-loader.js?v=20261111-slim1');
  localSubsets.root.BodaExportFonts = { forNode() {} }; localSubsets.scripts[0].onload(); await localSubset;
  console.log('PASS: zero eager dependencies, shared promises, pinned same-origin paths, global reuse, failure/timeout retry, legacy font-weight validation, subset module validation/retry and file:// URLs');
})().catch(error => { console.error(error); process.exitCode = 1; });
