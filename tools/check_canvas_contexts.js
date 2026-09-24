/* 靜態檢查三種可編輯畫布是否仍共用同一套 context 與重畫入口。
   用法：node tools/check_canvas_contexts.js */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const imageLayout = fs.readFileSync(path.join(ROOT, 'JS', 'image-layout.js'), 'utf8');
const failures = [];

function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures.push(label);
}

const previewFn = (/function renderPreviewAllStacked\(columns\) \{([\s\S]*?)\nfunction colorToHex/.exec(html) || [])[1] || '';
const canvasCtx = (/var CANVAS_CTX = \{([\s\S]*?)\n\};\nfunction canvasCtx/.exec(html) || [])[1] || '';

check('正式匯入 context 使用 imp-mount', /import:[\s\S]*?imp-mount-/.test(canvasCtx));
check('維修 context 使用 mnt-mount', /maint:[\s\S]*?mnt-mount-/.test(canvasCtx));
check('全部預覽 context 使用 prevall-mount', /preview:[\s\S]*?prevall-mount-/.test(canvasCtx));
check('三種畫布共用 rerenderCanvasMount', /function rerenderCanvasMount\(ctxName, idx\)/.test(html));
check('全部預覽綁定 preview context', /bindCanvasInteractions\(mount, col, idx, 'preview'\)/.test(previewFn));
check('全部預覽不覆蓋正式匯入資料', !/currentImportColumns\s*=\s*columns/.test(previewFn));
check('文字規則包含 preview context', /ctxName === 'preview'/.test((/function canvasTextRulesEnabled[\s\S]*?\n\}/.exec(html) || [''])[0]));
check('自動暫存包含動態列', /dynamicRowRows:\s*Array\.isArray\(c\._dynamicRowRows\)/.test(html));
check('自動暫存包含 XLSX 綁定', /xlsxBindings:\s*Array\.isArray\(c\._xlsxBindings\)/.test(html));
check('圖片邊界辨識全部預覽', /imp\|mnt\|prevall/.test(imageLayout));

if (failures.length) {
  console.error(`\n${failures.length} 項畫布同步檢查失敗。`);
  process.exit(1);
}
console.log('\n畫布 context 同步檢查全部通過。');
