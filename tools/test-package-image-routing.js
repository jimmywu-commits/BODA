'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const helperStart = html.indexOf('function importPackageIsLpbnImage');
const packageStart = html.indexOf('function downloadImportPackageZip', helperStart);
const packageEnd = html.indexOf('/* 各工具頁自己的下載', packageStart);
assert.ok(helperStart >= 0 && packageStart > helperStart && packageEnd > packageStart,
  '找不到整包圖片分類與 ZIP 函式');

const writtenPaths = [];
let generatedZip = null;
function FakeZip() {
  this.file = function (filePath) {
    writtenPaths.push(String(filePath));
    return this;
  };
  this.generateAsync = function () {
    generatedZip = {};
    return Promise.resolve(generatedZip);
  };
}

const anchor = { href: '', download: '', click() {}, remove() {} };
const context = {
  console,
  JSZip: FakeZip,
  Blob,
  Promise,
  importPackageSafeName(value, fallback) { return String(value || fallback || '檔案'); },
  importPackageActivityName() { return '測試活動'; },
  addImportDataUrlToZip(zip, filePath) {
    zip.file(filePath, {});
    return Promise.resolve();
  },
  appLoadingUpdate() {},
  buildImportColorTicketCsv() { return ''; },
  getColorToolCsvString() { return ''; },
  compactImportSnapshotForStorage(value) { return value; },
  importSnapshotJsonBlob(value) { return value; },
  URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
  document: {
    createElement(tag) { assert.equal(tag, 'a'); return anchor; },
    body: { appendChild() {} }
  },
  setTimeout() {}
};
vm.createContext(context);
vm.runInContext(html.slice(helperStart, packageEnd), context);

assert.equal(context.importPackageImageFolder({ filename: 'LPBN_APP.png' }, 'exposure'), '活動頁');
assert.equal(context.importPackageImageFolder({ name: 'lpbn_pc.jpg' }, 'exposure'), '活動頁');
assert.equal(context.importPackageImageFolder({ filename: 'DDCard_方LOGO.png' }, 'exposure'), '曝光資源');
assert.equal(context.importPackageImageFolder({ filename: '副區_01.png' }, 'activity'), '活動頁');

context.downloadImportPackageZip({
  images: [
    { filename: '副區_01.png', dataUrl: 'data:image/png;base64,AA==' },
    { filename: 'MSBN_01.png', dataUrl: 'data:image/png;base64,AA==' },
    { filename: '吸底_01.png', dataUrl: 'data:image/png;base64,AA==' }
  ],
  exposureImages: [
    { filename: 'LPBN_APP.png', dataUrl: 'data:image/png;base64,AA==' },
    { filename: 'LPBN_PC.png', dataUrl: 'data:image/png;base64,AA==' },
    { filename: 'HBN_橫式LOGO.png', dataUrl: 'data:image/png;base64,AA==' }
  ],
  warnings: []
}).then(function (result) {
  assert.equal(result.imageCount, 6);
  assert.equal(result.filename, '測試活動.zip');
  assert.equal(generatedZip !== null, true, 'ZIP 必須完成產生');
  assert.ok(writtenPaths.includes('活動頁/副區_01.png'));
  assert.ok(writtenPaths.includes('活動頁/MSBN_01.png'));
  assert.ok(writtenPaths.includes('活動頁/吸底_01.png'));
  assert.ok(writtenPaths.includes('活動頁/LPBN_APP.png'));
  assert.ok(writtenPaths.includes('活動頁/LPBN_PC.png'));
  assert.ok(writtenPaths.includes('曝光資源/HBN_橫式LOGO.png'));
  assert.equal(writtenPaths.some(function (filePath) { return /^曝光資源\/LPBN/i.test(filePath); }), false,
    '曝光資源資料夾不得含 LPBN');
  console.log('整包圖片分類測試通過：曝光資源排除 LPBN；活動頁包含副區、MSBN、吸底與 LPBN。');
}).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
