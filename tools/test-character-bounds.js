'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plugin = fs.readFileSync(path.join(__dirname, '..', 'jbp', 'js', 'boda-level-plugin.js'), 'utf8');
const start = plugin.indexOf('function clampCharacterRect');
const end = plugin.indexOf('function installCharacterBoundsForFrame', start);
assert.ok(start >= 0 && end > start, '找不到人物圖片邊界函式');

const context = {};
vm.createContext(context);
vm.runInContext(plugin.slice(start, end), context);

function rect(left, top, width, height) { return { left, top, width, height }; }
function plain(value) { return value && JSON.parse(JSON.stringify(value)); }

assert.deepEqual(
  plain(context.clampCharacterRect(rect(20, 30, 80, 100), 300, 240)),
  rect(20, 30, 80, 100),
  '安全區內的人物位置不可被改動'
);
assert.deepEqual(
  plain(context.clampCharacterRect(rect(-25, -40, 80, 100), 300, 240)),
  rect(0, 0, 80, 100),
  '人物不可越過商品區左側或上側進入文字區'
);
assert.deepEqual(
  plain(context.clampCharacterRect(rect(270, 210, 80, 100), 300, 240)),
  rect(220, 140, 80, 100),
  '人物不可越過商品區右側或下側'
);
assert.deepEqual(
  plain(context.clampCharacterRect(rect(-50, 10, 600, 300), 300, 240)),
  rect(0, 10, 300, 150),
  '人物大於安全區時必須等比例縮小後再夾限位置'
);
assert.equal(context.clampCharacterRect(rect(0, 0, 0, 100), 300, 240), null);
assert.match(plugin, /_bnCharacter[^\n]+:not\(\.bn-endorser-box\)/, '一般人物選擇器必須排除代言人');
assert.match(plugin, /bn-layout-snapshot-request/, '邊界修正後必須使用既有快照入口回寫');

console.log('人物圖片邊界測試通過：位置、縮放、舊狀態與代言人排除規則正確。');
