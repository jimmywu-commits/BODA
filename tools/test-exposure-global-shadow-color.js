const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const host = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const plugin = fs.readFileSync(path.join(root, 'jbp', 'js', 'boda-level-plugin.js'), 'utf8');

assert.match(host, /EXPOSURE_SHADOW_COLOR_OVERRIDE_KEY\s*=\s*'bn_global_product_shadow_color_v1'/,
  '父頁必須保存曝光資源的全域影子固定色');
assert.match(host, /function effectiveExposureShadowColor[\s\S]*?readExposureShadowColorOverride\(\)\s*\|\|\s*importShadowColorForBackground/,
  '固定色必須優先於背景自動建議色');
assert.match(host, /shadowApi\.DEFAULT\.color\s*=\s*targetColor/,
  '新上傳商品必須沿用目前全域影子色');
assert.match(host, /window\._bodaApplyExposureShadowColorSetting\s*=\s*function/,
  '曝光 iframe 必須能呼叫父頁的序列重製入口');
assert.match(host, /type:\s*'bn-product-update-image'[\s\S]*?preserveFrame:\s*true/,
  '批次換色必須就地換圖且禁止重算商品框');

assert.match(plugin, /全體商品影子顏色/,
  '曝光資源左欄必須顯示全體商品影子顏色');
assert.match(plugin, /id="boda-global-shadow-apply">套用全部/,
  '全域色票必須提供一次套用全部商品的按鈕');
assert.match(plugin, /id="boda-global-shadow-auto">依背景自動/,
  '全域色票必須可清除固定色並回到背景自動');
assert.match(plugin, /#bn-shadow-modal \.bn-shadow-ctrl>div:has\(input\[data-role="color"\]\)\{display:none!important\}/,
  '單品影子視窗不可再顯示顏色欄');
assert.match(plugin, /originalOpen\.call\(shadowApi, product, onApplied\)[\s\S]*?finally[\s\S]*?previousShadow/,
  '單品編輯器開啟時只暫借全域色，取消不可偷改商品狀態');
assert.match(plugin, /type:\s*'bn-product-update-image'[\s\S]*?preserveFrame:\s*true/,
  '獨立 iframe 後備流程也必須就地換圖且禁止重算商品框');
assert.doesNotMatch(plugin, /_bnRebroadcastProducts\s*\(/,
  '全域影子換色不可 remove/add 全部商品，以免排版跳回預設');

const hostHelperStart = host.indexOf('function normalizedExposureShadowColor');
const hostHelperEnd = host.indexOf('/* 陰影換色只更新既有商品框裡的圖片內容。', hostHelperStart);
assert.ok(hostHelperStart >= 0 && hostHelperEnd > hostHelperStart, '找不到父頁固定／自動影子色函式');
const saved = new Map();
const hostContext = {
  EXPOSURE_SHADOW_COLOR_OVERRIDE_KEY: 'bn_global_product_shadow_color_v1',
  localStorage: {
    getItem(key) { return saved.has(key) ? saved.get(key) : null; },
    setItem(key, value) { saved.set(key, String(value)); },
    removeItem(key) { saved.delete(key); }
  },
  importShadowColorForBackground() { return '#224466'; }
};
vm.createContext(hostContext);
vm.runInContext(host.slice(hostHelperStart, hostHelperEnd), hostContext);
assert.equal(hostContext.effectiveExposureShadowColor('#ffffff'), '#224466', '未固定時必須使用背景建議色');
hostContext.writeExposureShadowColorOverride('#A1B2C3');
assert.equal(hostContext.effectiveExposureShadowColor('#ffffff'), '#a1b2c3', '固定色必須覆蓋背景建議色');
hostContext.writeExposureShadowColorOverride('');
assert.equal(hostContext.effectiveExposureShadowColor('#ffffff'), '#224466', '回到自動時必須清除固定色');

const helperStart = plugin.indexOf('function normalizeBodaShadowColor');
const helperEnd = plugin.indexOf('function sendBodaShadowProductInPlace', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, '找不到全域影子設定合併函式');
const context = {
  window: {},
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
};
vm.createContext(context);
vm.runInContext(plugin.slice(helperStart, helperEnd), context);

const shadowApi = {
  DEFAULT: { enabled: true, angle: 'left', offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, color: '#5a5a5a' },
  normalize(cfg) { return cfg; }
};
const product = {
  meta: {
    groundShadow: {
      enabled: false,
      angle: 'right',
      offsetX: 0.2,
      offsetY: -0.1,
      scaleX: 1.7,
      scaleY: 0.8,
      color: '#111111'
    }
  }
};
const merged = context.bodaShadowConfigForProduct(product, '#a1b2c3', shadowApi);
assert.equal(merged.color, '#a1b2c3');
assert.equal(merged.enabled, false, '批次換色不可打開使用者已關閉的影子');
assert.equal(merged.angle, 'right');
assert.equal(merged.offsetX, 0.2);
assert.equal(merged.offsetY, -0.1);
assert.equal(merged.scaleX, 1.7);
assert.equal(merged.scaleY, 0.8, '批次換色必須保留每件商品的影子幾何設定');

console.log('曝光資源全域商品影子色測試通過：左欄批次套色、固定／自動模式、排版與單品幾何皆受保護。');
