'use strict';

// Isolated behavioral regression tests; never load the full editor or its fonts.
// Run: node tools/test-exposure-performance.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const exposure = path.join(root, 'shopee');
const index = fs.readFileSync(path.join(exposure, 'index.html'), 'utf8');
const editor = fs.readFileSync(path.join(exposure, 'js/bn-editor-plugin.js'), 'utf8');
const runtime = fs.readFileSync(path.join(exposure, 'js/layout-runtime.js'), 'utf8');
function segment(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Missing testable source section: ' + start);
  return text.slice(a, b);
}
function scriptsCompile() {
  for (const filename of ['index.html', ...fs.readdirSync(path.join(exposure, 'html')).filter(f => f.endsWith('.html')).map(f => 'html/' + f)]) {
    const html = fs.readFileSync(path.join(exposure, filename), 'utf8');
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/type=["']application\//i.test(match[1])) continue;
      new vm.Script(match[2], { filename });
    }
    if (filename !== 'index.html') {
      assert.doesNotMatch(html, /ShopeeNotoSans[^\n]+\.ttf/);
      assert.doesNotMatch(html, /layout-runtime\.js\?t=/);
    }
  }
}

async function assetsTest() {
  const calls = { shadow: 0, ratio: 0, messages: [] };
  const context = {
    console, Map, Promise,
    window: { _bnProducts: [], _bnLogos: [], _bnLogoLayouts: {},
      _bnGroundShadow: { DEFAULT: {}, applyToProduct(draft) { calls.shadow++; draft.src = draft.src + '-shadow'; return Promise.resolve(draft); } } },
    loadImg() { calls.ratio++; return Promise.resolve({ naturalWidth: 200, naturalHeight: 100 }); },
    endorserWorkorderNeedsApply() { return false; }, endorserWorkorderNoteNeedsApply() { return false; },
    endorserNoteState() { return {}; }, defaultProductZOrder(i) { return i; },
    broadcast(message) { calls.messages.push(message); }, broadcastZOrder() {}, renderLogoList() {}, renderProdList() {},
    markStateDirty() {}, document: { getElementById() { return null; } }
  };
  vm.createContext(context);
  vm.runInContext(segment(editor, "    var _bnWorkorderAssetSignature = '';", '    /* 廣播 z-index 更新 */'), context);
  vm.runInContext(segment(editor, '    window._bnApplyWorkorderAssets = function(payload){', '    window._bnRebroadcastProducts'), context);
  const product = (id, revision = 1) => ({ name: id + '.png', sourceId: id, sourceRevision: revision, src: 'data:image/png;base64,' + id + revision, baseSrc: 'data:image/png;base64,base-' + id + revision });
  const payload = { replaceProducts: true, replaceLogos: true, products: [product('a'), product('b')], logos: [product('logo')] };
  const first = context.window._bnApplyWorkorderAssets(payload);
  const concurrent = context.window._bnApplyWorkorderAssets(payload);
  assert.equal(first, concurrent, 'Identical in-flight payloads must share one processing promise');
  assert.equal(await first, true);
  assert.equal(calls.shadow, 2);
  const edited = context.window._bnProducts[0], logo = context.window._bnLogos[0];
  edited.src = 'data:image/png;base64,user-crop-shadow'; edited.baseSrc = 'data:image/png;base64,user-crop';
  edited.layouts = { one: { left: 87, top: 32, width: 111, height: 200 } }; edited.meta.rotate = 25;
  edited.crop = { left: 5 }; edited.sizeScale = 1.7;
  logo.src = 'data:image/png;base64,edited-logo'; logo.baseSrc = logo.src;
  context.window._bnLogoLayouts = { one: { custom: true } };
  const editedSnapshot = JSON.stringify(edited), logoSnapshot = JSON.stringify(logo);
  const previousCalls = { shadow: calls.shadow, ratio: calls.ratio, messages: calls.messages.length };
  assert.equal(await context.window._bnApplyWorkorderAssets(payload), false);
  assert.equal(JSON.stringify(edited), editedSnapshot, 'Repeated source must preserve crop, rotation, scale and geometry');
  assert.equal(JSON.stringify(logo), logoSnapshot, 'Repeated source must preserve edited logo pixels');
  assert.deepEqual({ shadow: calls.shadow, ratio: calls.ratio, messages: calls.messages.length }, previousCalls);
  vm.runInContext("_bnWorkorderAssetSignature = ''", context);
  assert.equal(await context.window._bnApplyWorkorderAssets(payload), false, 'Persisted source metadata must dedupe even after the previous message signature is lost on reload');
  const derived = { ...payload, products: payload.products.map(item => ({ ...item, src: item.src + '-new-shadow' })) };
  assert.equal(await context.window._bnApplyWorkorderAssets(derived), false, 'Derived src changes must not replace the same original/revision');
  const newLogo = { ...payload, logos: payload.logos.concat(product('logo2')) };
  await context.window._bnApplyWorkorderAssets(newLogo);
  assert.equal(context.window._bnProducts[0], edited, 'Changing logos must not rebuild products');
  assert.equal(context.window._bnLogos[0], logo);
  assert.equal(context.window._bnLogoLayouts.one.custom, true);
  assert.equal(calls.shadow, 2);
  const revised = { ...newLogo, products: [product('a'), product('b', 2)] };
  await context.window._bnApplyWorkorderAssets(revised);
  assert.equal(context.window._bnProducts[0], edited, 'Only the revised product may be rebuilt');
  assert.equal(calls.shadow, 3);
  assert.ok(calls.messages.some(message => message.type === 'bn-product-remove'));
  const cleared = { ...revised, products: [], logos: [] };
  await context.window._bnApplyWorkorderAssets(cleared);
  assert.equal(context.window._bnProducts.length, 0);
  await context.window._bnApplyWorkorderAssets(revised);
  assert.equal(context.window._bnProducts.length, 2, 'Cleared state must be rebuilt even with an identical earlier payload');
  let endorserBuilds = 0;
  context.classifyEndorserItems = items => Promise.resolve({ photo: items[0], sign: items[1], method: 'order' });
  context.makeEndorserSlotFromSrc = (key, src, name) => { endorserBuilds++; return Promise.resolve({ src, baseSrc: src, name, layouts: {} }); };
  context.endorserItemsSignature = items => items.map(context.workorderAssetKey).join('||');
  vm.runInContext(segment(editor, '    function buildWorkorderEndorserSlots(payload){', '    /* 暴露給 bn-state-plugin'), context);
  const photo = context.rememberWorkorderSource({ src: 'edited-photo', baseSrc: 'cropped-photo', layouts: { one: { x: 87 } } }, product('photo'));
  context.window._bnEndorserPhoto = photo;
  context.window._bnEndorserSign = context.rememberWorkorderSource({ src: 'edited-sign', baseSrc: 'cropped-sign' }, product('sign'));
  const endorsers = await context.buildWorkorderEndorserSlots({ endorsers: [product('photo'), product('sign', 2)] });
  assert.equal(endorsers.photo, photo, 'Replacing a signature must preserve the edited photo object and layout');
  assert.equal(endorsers.photo.layouts.one.x, 87);
  assert.equal(endorserBuilds, 1, 'Only the changed endorser asset may be decoded and trimmed');
  console.log('PASS source/revision dedupe, in-flight coalescing and changed-only asset application preserve edits');
}

function tagsTest() {
  const candidates = segment(runtime, '    function _bnBuildTagCandidates(color){', '    function _bnTagCacheKey(color){');
  const context = { URL, _bnRuntimeScriptBase: 'https://example.test/BODA/shopee/js/', fname: '',
    _bnNormalizeTagName(value) { return value.toLowerCase().replace(/[_\-\s]/g, ''); } };
  vm.createContext(context); vm.runInContext(candidates, context);
  for (const name of ['HBN_橫式LOGO', 'LPBN_PC', 'SCBN_APP', 'AR', 'Search_Image1logo']) {
    context.fname = name; assert.equal(context._bnBuildTagCandidates('red').length, 0, 'Missing tag families must not generate speculative requests');
  }
  for (const name of ['Coin_pageBN_APP方LOGO', 'ddcard方logo', 'FB_POST_橫LOGO', 'IG方logo排版', 'SBA_APP方LOGO', 'SBA_PC']) {
    context.fname = name;
    for (const color of ['red', 'white']) {
      const [url] = context._bnBuildTagCandidates(color);
      assert.ok(!url.includes('/html/html/'));
      const tag = decodeURIComponent(new URL(url).pathname.split('/').pop());
      assert.ok(fs.existsSync(path.join(exposure, 'html/img/tag', tag)), 'Tag mapping must point to a real bundled asset: ' + tag);
    }
  }
  console.log('PASS exact tag mapping has no speculative or duplicated html/html requests');
}

async function browserTest() {
  let playwright;
  try { playwright = require('playwright'); }
  catch (_) { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
  const executablePath = process.env.BODA_TEST_BROWSER || [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium'
  ].filter(Boolean).find(file => fs.existsSync(file));
  const renderCode = segment(index, 'function renderPreviews() {', '/* iframe 載入完成：');
  const probeCode = segment(index, "var BN_RESOURCE_VERSION =", '/* 從 CSS 文字解析');
  const script = text => '<script>' + text.replace(/<\/script/gi, '<\\/script') + '</script>';
  const fixture = '<!doctype html><style>#preview-area{display:flex;flex-direction:column} .preview-block{height:100px}</style><div id="frontend" class="active"></div><div id="preview-area"><div id="preview-empty"></div></div>' + script(`
    window.items=[{id:1,file:'one.html',name:'one',w:120,h:80,checked:true},{id:2,file:'two.html',name:'two',w:120,h:80,checked:true}];
    window.__loads={}; window.probeRefresh=0;
    function loadLayouts(){return items} function saveLayouts(value){items=value}
    function parseHashKeywords(){return []} function getLayoutCheckedValue(l){return l.checked}
    function esc(value){return value} function bnProductLayoutSyncEligible(){return false}
    function bnRefreshProductLayoutLockUI(){} function bnHidePreviewLoading(){} function bnStartPreviewLoading(){}
    function renderAdmin(){probeRefresh++} function renderChecks(){} function onIframeLoad(){}
    function parseCSSVar(text,name){return Number((text.match(new RegExp(name+':(\\\\d+)'))||[])[1])}
    var PREVIEW_MAX=800;
  `) + script(probeCode) + script(renderCode) + script(`
    addEventListener('message',event=>{if(event.data.ready){__loads[event.data.ready]=(__loads[event.data.ready]||0)+1;bnLazyMarkReady(event.data.ready)}});
    renderPreviews();
  `);
  const urls = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost'); urls.push(url.pathname);
    if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(fixture); }
    else if (url.pathname.endsWith('.html')) {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><div id="product" style="left:37px">product</div><script>parent.postMessage({ready:new URLSearchParams(location.search).get("bnid")},"*")</script>');
    } else if (url.pathname.endsWith('.css')) { response.end(':root{--canvas-w:120;--canvas-h:80;}'); }
    else { response.statusCode = 404; response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => __loads['1'] === 1 && __loads['2'] === 1);
    await page.evaluate(() => {
      window.savedFrame = document.getElementById('iframe-1');
      savedFrame.contentDocument.getElementById('product').style.left = '87px';
      savedFrame.contentDocument.getElementById('product').dataset.crop = 'edited';
      items.reverse(); renderPreviews(); renderPreviews();
    });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => savedFrame === document.getElementById('iframe-1')), true);
    assert.equal(await page.evaluate(() => savedFrame.contentDocument.getElementById('product').style.left), '87px');
    assert.equal(await page.evaluate(() => savedFrame.contentDocument.getElementById('product').dataset.crop), 'edited');
    assert.deepEqual(await page.evaluate(() => __loads), { 1: 1, 2: 1 });
    assert.equal(await page.evaluate(() => document.getElementById('iframe-2').closest('.preview-block').style.order), '0');
    await page.evaluate(() => { items.find(item => item.id === 2).checked = false; renderPreviews(); });
    assert.equal(await page.evaluate(() => savedFrame.contentDocument.getElementById('product').style.left), '87px');
    await page.evaluate(() => {
      items.push({id:3,file:'three.html',name:'three',w:120,h:80,checked:true},{id:4,file:'four.html',name:'four',w:120,h:80,checked:true});
      window._bnExporting=true; renderPreviews();
    });
    assert.equal(await page.evaluate(() => document.querySelectorAll('iframe[data-bn-src]').length), 2);
    await page.evaluate(async () => { window.releaseThree = await _bnPreparePreviewForExport(document.getElementById('iframe-3')); });
    assert.equal(await page.evaluate(() => !!document.getElementById('iframe-4').getAttribute('data-bn-src')), true, 'Export must not activate the other pending preview');
    await page.evaluate(() => releaseThree());
    assert.equal(await page.evaluate(() => document.getElementById('iframe-3').hasAttribute('src')), false, 'Temporary export renderer must be unloaded');
    assert.equal(await page.evaluate(() => savedFrame.contentDocument.getElementById('product').style.left), '87px', 'Existing edited frame must remain intact during export');
    await page.evaluate(() => {
      items.push({id:5,file:'five.html',name:'five',w:0,h:0,checked:false},{id:6,file:'six.html',name:'six',w:0,h:0,checked:false});
      window.probeRefresh=0; return Promise.all([probSize(5),probSize(6)]);
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => probeRefresh), 1, 'Parallel dimension probes must render the UI once');
    assert.equal(await page.evaluate(() => items.find(item => item.id === 5).w), 120);
    assert.equal(await page.evaluate(() => items.find(item => item.id === 6).h), 80);
    assert.equal(await page.evaluate(() => savedFrame.contentDocument.getElementById('product').style.left), '87px');
    assert.deepEqual(errors, []);
    assert.ok(!urls.some(url => /font|layout-runtime/.test(url)), 'Regression fixture must not load heavyweight real assets');
    console.log('PASS real-browser keyed previews retain edited documents; export leases stay sequential and dimension probes batch');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => { scriptsCompile(); await assetsTest(); tagsTest(); await browserTest(); console.log('Exposure performance regression checks passed.'); })()
  .catch(error => { console.error(error.stack || error); process.exitCode = 1; });
