'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const runtime = fs.readFileSync(path.join(__dirname, '..', 'shopee', 'js', 'layout-runtime.js'), 'utf8');
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
  assert.equal(harness.messages[0].preserveFrame, true, '背景換色必須使用不重算商品框的專用模式');
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

function testCanvasPreserveFrameMode() {
  const handlerStart = runtime.indexOf("if (e.data.type === 'bn-product-update-image')");
  const handlerEnd = runtime.indexOf('/* z-index 順序更新', handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, '找不到版位端商品圖片更新處理器');

  let fitCount = 0;
  let layoutPostCount = 0;
  const image = {
    naturalWidth: 640,
    naturalHeight: 480,
    src: 'shadow-before',
    style: { transform: 'rotate(7deg)' }
  };
  const box = {
    dataset: {
      id: 'product-1',
      rotate: '12',
      manualLayout: '1',
      productRect: JSON.stringify({ x: 2, y: 3, w: 80, h: 90 })
    },
    style: { left: '31px', top: '47px', width: '188px', height: '144px' },
    querySelector(selector) {
      assert.equal(selector, 'img');
      return image;
    }
  };
  const zone = {
    querySelector(selector) {
      assert.equal(selector, '.bn-prod-box[data-id="product-1"]');
      return box;
    }
  };
  const beforeFrame = JSON.stringify({
    left: box.style.left,
    top: box.style.top,
    width: box.style.width,
    height: box.style.height,
    manualLayout: box.dataset.manualLayout,
    transform: image.style.transform
  });
  const context = {
    console,
    getProductZone() { return zone; },
    bnProductImgLoaded(img) {
      assert.equal(img, image);
      fitCount++;
    },
    postProductLayout() { layoutPostCount++; },
    Image: function Image() {
      throw new Error('preserveFrame 不得進入旋轉用的圖片預載與商品框重算流程');
    },
    window: {}
  };
  vm.createContext(context);
  const handler = vm.runInContext('(function(e){' + runtime.slice(handlerStart, handlerEnd) + '})', context);
  handler({ data: {
    type: 'bn-product-update-image',
    id: 'product-1',
    src: 'shadow-after',
    ratio: 1.25,
    keepScale: true,
    preserveFrame: true,
    rotate: 12,
    productRect: { x: 2, y: 3, w: 80, h: 90 }
  } });

  assert.equal(image.src, 'shadow-after');
  assert.equal(typeof image.onload, 'function');
  image.onload();
  assert.equal(fitCount, 1, '新影像載入後仍須更新框內的 productRect 對齊');
  assert.equal(layoutPostCount, 0, '只換背景不得回寫或重算商品排版');
  assert.equal(JSON.stringify({
    left: box.style.left,
    top: box.style.top,
    width: box.style.width,
    height: box.style.height,
    manualLayout: box.dataset.manualLayout,
    transform: image.style.transform
  }), beforeFrame, '版位端必須逐項保留商品框位置、大小、手動排版與當前預覽狀態');
}

function testSlabMarkerDoesNotChangeBoxModel() {
  const slabStart = runtime.indexOf('function _bnMarkSlabZone');
  const slabEnd = runtime.indexOf('/* SLAB 底圖對齊用的', slabStart);
  assert.ok(slabStart >= 0 && slabEnd > slabStart, '找不到 SLAB 商品區標示函式');
  const slabImplementation = runtime.slice(slabStart, slabEnd);
  assert.match(slabImplementation, /style\.outline\s*=/, 'SLAB 標示必須使用 outline');
  assert.doesNotMatch(slabImplementation, /style\.border\s*=\s*['"]2px/, 'SLAB 標示不得再用會改變盒模型的 border');
}

Promise.resolve()
  .then(testCanvasPreserveFrameMode)
  .then(testSlabMarkerDoesNotChangeBoxModel)
  .then(testInPlaceUpdateKeepsLayout)
  .then(testLateShadowJobCannotOverwriteNewCrop)
  .then(function () {
    console.log('背景隔離回歸測試通過：商品排版與最新裁切狀態均保留。');
  })
  .catch(function (error) {
    console.error(error);
    process.exitCode = 1;
  });
