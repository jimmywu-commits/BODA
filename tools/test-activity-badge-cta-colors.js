'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function activityRoleColorsEqual');
const end = html.indexOf('/* 曝光資源目前的「自動 CTA 字色」', start);
assert.ok(start >= 0 && end > start, '找不到活動頁圓標／CTA 防同色函式');

function normalize(value) {
  const raw = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(raw) ? raw : '';
}

const context = {
  EXPOSURE_CTA_BRAND_COLOR: '#ee4d2d',
  normalizeSharedHexColor: normalize,
  contrastRatioForDefaultColor() { return 2; },
  importCanvasDeepShade() { return '#17324d'; },
  getExposureSubTextColor() { return '#2540b5'; },
  importLinkedDefaultColors(state) {
    return { badgeBg: state.badgeBg || '#2540b5', promoBg: '#2540b5', ctaBg: state.ctaBg || '#ee4d2d' };
  },
  importCanvasCtaColors(state, linked) {
    const requested = state.ctaBg || linked.ctaBg;
    return requested === '#ffffff'
      ? { bg: '#2540b5', text: '#ffffff', replacedFrom: 'sub' }
      : { bg: requested, text: '#ffffff', replacedFrom: '' };
  }
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

function plain(value) { return JSON.parse(JSON.stringify(value)); }

assert.deepEqual(
  plain(context.resolveActivityBadgeBg('#2540b5', '#ee4d2d', [], '#ffffff')),
  { bg: '#2540b5', replaced: false, from: '' },
  '原本不同色時不可擅自改色'
);

const blueConflict = plain(context.resolveActivityBadgeBg(
  '#2540b5', '#2540b5', ['#2540b5', '#ee4d2d'], '#ffffff'
));
assert.equal(blueConflict.replaced, true);
assert.equal(blueConflict.bg, '#ee4d2d');
assert.notEqual(blueConflict.bg, '#2540b5');

const orangeConflict = plain(context.resolveActivityBadgeBg(
  '#ee4d2d', '#ee4d2d', ['#2540b5'], '#fde8d4'
));
assert.equal(orangeConflict.replaced, true);
assert.equal(orangeConflict.bg, '#2540b5');

const state = { badgeBg: '#ee4d2d', ctaBg: '#ee4d2d' };
const enforced = plain(context.enforceImportBadgeCtaSeparation(state, '#fde8d4'));
assert.equal(enforced.replaced, true);
assert.notEqual(state.badgeBg, state.ctaBg, '手動狀態與舊暫存也必須修成不同色');

const whiteCtaState = { badgeBg: '#2540b5', ctaBg: '#ffffff' };
const whiteCtaEnforced = plain(context.enforceImportBadgeCtaSeparation(whiteCtaState, '#fde8d4'));
assert.equal(whiteCtaEnforced.replaced, true, '必須比較活動頁換色後的實際 CTA，而非換色前的白色');
assert.notEqual(whiteCtaState.badgeBg, '#2540b5', '圓標不可與活動頁實際 CTA 同色');

assert.match(html, /badgeBg:\s*canvasBadge\.bg/, '畫布必須使用防同色後的圓標色');
assert.match(html, /it\.key === 'badgeBg'\) return;/, '最終 theme 不可被原始圓標色蓋回去');
assert.match(html, /var canvasBadge = importCanvasBadgeBg\(\s*colorState,\s*linkedDefaults,\s*canvasCta\.bg,\s*sharedBg\s*\)/,
  '活動頁畫布必須以實際 CTA 色做防撞色');
assert.match(html, /var maintCanvasBadge = importCanvasBadgeBg\(\s*maintTheme,\s*linkedDefaults,\s*maintCanvasCta\.bg,\s*maintBg\s*\)/,
  '維修頁工具列必須以實際 CTA 色做防撞色');
assert.doesNotMatch(html, /(?:colorState|maintTheme)\.ctaBg\s*\|\|\s*(?:canvasCta|maintCanvasCta)\.bg/,
  '不可優先比較換色前的 CTA 原始值');
assert.match(html, /function setImportCtaBg[\s\S]*?enforceImportBadgeCtaSeparation/, 'CTA 改色時必須同步檢查圓標');
assert.match(html, /function setImportBadgeBg[\s\S]*?enforceImportBadgeCtaSeparation/, '圓標手動改色時必須同步檢查 CTA');

console.log('活動頁圓標／CTA 防同色測試通過：自動、手動、實際 CTA 換色與舊暫存皆會分色。');
