'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const plugin = fs.readFileSync(path.join(root, 'jbp', 'js', 'boda-level-plugin.js'), 'utf8');
const shopeeIndex = fs.readFileSync(path.join(root, 'shopee', 'index.html'), 'utf8');
const helperStart = plugin.indexOf('function workorderSlotsOfName');
const helperEnd = plugin.indexOf('/* 工單總覽列出的曝光資源版位', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, '找不到曝光版位名稱與排序函式');

const context = {};
vm.createContext(context);
vm.runInContext(plugin.slice(helperStart, helperEnd), context);

const resources = [
  { key: 'DD Card BN (APP)' },
  { key: 'C2C HBN (PC)' },
  { key: 'Mall HBN' },
  { key: '活動總覽' },
  { key: '首頁LOGO牆' },
  { key: 'FB POST' },
  { key: 'AMS BN 推廣者後臺BN' },
  { key: 'AR' },
  { key: 'LPBN' }
];
const order = Array.from(context.workorderSlotOrder(resources));
assert.deepEqual(order, [
  'ddcard', 'hbn', '活動總覽', 'logowall', 'fbpost', 'ams', 'ar', 'lpbnapp', 'lpbnpc'
], '工單名稱必須依原始列順序轉成版位類別；重複 HBN 類別只留第一次');

const placement = { order };
const layouts = [
  { id: 1, file: 'LPBN_APP方LOGO.html' },
  { id: 2, file: 'LPBN_PC橫LOGO.html' },
  { id: 3, file: 'ddcard方logo.html' },
  { id: 4, file: 'ddcard橫logo.html' },
  { id: 5, file: 'HBN_橫式LOGO.html' },
  { id: 6, file: '活動總覽_橫式LOGO.html' },
  { id: 7, file: '首頁LOGO牆.html' },
  { id: 8, file: 'AR.html' },
  { id: 9, file: 'FB_POST_橫LOGO.html' },
  { id: 10, file: 'AMS BN-橫logo.html' },
  { id: 11, file: 'IG橫logo排版.html' }
];
const sorted = Array.from(context.sortLayoutsForWorkorder(layouts, placement));
assert.deepEqual(sorted.map(function (layout) { return layout.id; }), [
  3, 4, 5, 6, 7, 9, 10, 8, 1, 2, 11
], '曝光畫布必須依工單總覽排序；同版位方／橫變體維持原順序，未列版位接在最後');

const rows = layouts.map(function (layout) { return { slot: '', layout: layout }; });
const sortedRows = Array.from(context.sortPlanRowsForWorkorder(rows, placement));
assert.deepEqual(sortedRows.map(function (row) { return row.layout.id; }), sorted.map(function (layout) { return layout.id; }),
  '左側排版選擇與右側畫布必須使用相同排序');

assert.match(plugin, /writeWorkorderPlacement\(\{\s*importId:\s*importId,\s*slots:\s*slots,\s*order:\s*slotOrder\s*\}\)/,
  '工單順序必須與勾選類別一起保存，曝光頁重載後才不會回到固定順序');
assert.match(plugin, /rows\s*=\s*sortPlanRowsForWorkorder\(rows,\s*workorderPlacement\)/,
  '左側排版選擇必須套用工單順序');
assert.match(shopeeIndex, /_bnSortLayoutsForDisplay\(layouts\)/,
  '右側曝光畫布建立前必須套用同一個工單排序器');

console.log('曝光版位工單排序測試通過：左右清單依工單總覽順序，變體穩定，未列版位置後。');
