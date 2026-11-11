'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function updateExposureProductImageInPlace');
const end = html.indexOf('function applyExposureShadowBackground(background)', start);
assert.ok(start >= 0 && end > start, '找不到曝光資源背景隔離函式');
const implementation = html.slice(start, end);

function createHarness(applyToProduct) {
  const messages = [];
  let renderCount = 0;
  let dirtyCount = 0;
  const canvasFrame = {
    contentWindow: {
      postMessage(message) { messages.push(message); }
    }
  };
  const product = {
    id: 'product-1',
    name: '已裁切商品',
    src: 'shadow-before',
    baseSrc: 'edited-crop',
    ratio: 1.25,
    x: 31,
    y: 47,
    width: 188,
    height: 144,
    layout: { left: 31, top: 47, width: 188, height: 144 },
    layouts: { A: { left: 31, top: 47, width: 188, height: 144 } },
    meta: {
      baseSrc: 'edited-crop',
      rotate: 12,
      groundShadow: { enabled: true, color: '#111111', offsetX: 4 },
      productRect: { x: 2, y: 3, w: 80, h: 90 }
    }
  };
  const exposureWindow = {
    _bnProducts: [product],
    _bnGroundShadow: {
      DEFAULT: { enabled: true, color: '#111111' },
      applyToProduct
    },
    _bnRenderProdList() { renderCount++; },
    document: {
      querySelectorAll(selector) {
        assert.equal(selector, '.preview-block iframe');
        return [canvasFrame];
      },
      dispatchEvent() { dirtyCount++; }
    },
    CustomEvent: function CustomEvent(type) { this.type = type; }
  };
  const context = {
    console,
    document: {
      getElementById(id) {
        assert.equal(id, 'exposure-frame');
        return { contentWindow: exposureWindow };
      }
    },
    importShadowColorForBackground() { return '#222222'; },
    effectiveExposureShadowColor() { return '#222222'; },
    readExposureShadowColorOverride() { return ''; },
    normalizedExposureShadowBackground(value) { return value; },
    exposureShadowRequestedBackground: ''
  };
  vm.createContext(context);
  vm.runInContext(implementation, context);
  return {
    context,
    product,
    exposureWindow,
    messages,
    get renderCount() { return renderCount; },
    get dirtyCount() { return dirtyCount; }
  };
}

async function testInPlaceUpdateKeepsLayout() {
  const harness = createHarness(function applyToProduct(draft, cfg) {
    assert.notEqual(draft, harness.product, '陰影必須在副本上合成');
    assert.equal(draft.baseSrc, 'edited-crop', '陰影必須使用目前裁切後的 baseSrc');
    draft.src = 'shadow-after';
    draft.ratio = 1.25;
    draft.meta.baseSrc = draft.baseSrc;
    draft.meta.groundShadow = Object.assign({}, cfg);
    draft.meta.productRect = { x: 2, y: 3, w: 80, h: 90 };
    return Promise.resolve(draft);
  });
  const before = JSON.stringify({
    x: harness.product.x,
    y: harness.product.y,
    width: harness.product.width,
    height: harness.product.height,
    layout: harness.product.layout,
    layouts: harness.product.layouts,
    baseSrc: harness.product.baseSrc
  });

  const changed = await harness.context.applyExposureShadowBackgroundOnce('#ffffff');

  assert.equal(changed, true);
  assert.equal(harness.product.src, 'shadow-after');
  assert.equal(harness.product.baseSrc, 'edited-crop');
  assert.equal(JSON.stringify({
    x: harness.product.x,
    y: harness.product.y,
    width: harness.product.width,
    height: harness.product.height,
    layout: harness.product.layout,
    layouts: harness.product.layouts,
    baseSrc: harness.product.baseSrc
  }), before, '背景切換不得修改商品的位置、大小、版位排版或裁切來源');
  assert.deepEqual(harness.messages.map(message => message.type), ['bn-product-update-image']);
  assert.equal(harness.messages[0].keepScale, true, '影子換色必須保留商品目前縮放與位置');
  assert.equal(harness.renderCount, 1);
  assert.equal(harness.dirtyCount, 1);
}

async function testLateShadowJobCannotOverwriteNewCrop() {
  let finishCompose;
  let draftInFlight;
  const harness = createHarness(function applyToProduct(draft, cfg) {
    draftInFlight = draft;
    return new Promise(resolve => {
      finishCompose = function () {
        draft.src = 'stale-shadow-result';
        draft.meta.groundShadow = Object.assign({}, cfg);
        resolve(draft);
      };
    });
  });

  const pending = harness.context.applyExposureShadowBackgroundOnce('#ffffff');
  await Promise.resolve();
  harness.product.baseSrc = 'newer-crop';
  harness.product.meta.baseSrc = 'newer-crop';
  harness.product.src = 'newer-crop-preview';
  finishCompose();
  const changed = await pending;

  assert.equal(draftInFlight.baseSrc, 'edited-crop');
  assert.equal(changed, false);
  assert.equal(harness.product.baseSrc, 'newer-crop');
  assert.equal(harness.product.src, 'newer-crop-preview');
  assert.equal(harness.messages.length, 0, '過期的陰影結果不得送回畫布');
  assert.equal(harness.context.exposureShadowRequestedBackground, '#ffffff');
}

Promise.resolve()
  .then(testInPlaceUpdateKeepsLayout)
  .then(testLateShadowJobCannotOverwriteNewCrop)
  .then(function () {
    console.log('背景隔離回歸測試通過：商品排版與最新裁切狀態均保留。');
  })
  .catch(function (error) {
    console.error(error);
    process.exitCode = 1;
  });
