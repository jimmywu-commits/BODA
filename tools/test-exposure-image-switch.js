'use strict';

/* Run: node tools/test-exposure-image-switch.js
 * Real Chrome/Edge, actual full layout-runtime, actual editor upload/message
 * functions and actual background applyPreset. No CDN or font is loaded.
 * Only panel rendering, storage and background-library network IO are stubbed.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'shopee/js/bn-editor-plugin.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'shopee/js/bn-bg-library-plugin.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'shopee/js/layout-runtime.js'), 'utf8');
function expressionAt(source, start) {
  for (let end = source.indexOf('}', start); end >= 0; end = source.indexOf('}', end + 1)) {
    const candidate = source.slice(start, end + 1);
    try { new vm.Script('(' + candidate + ')'); return candidate; } catch (_) {}
  }
  throw new Error('Cannot extract source function');
}
function actual(source, name) {
  const found = new RegExp('\\bfunction\\s+' + name + '\\s*\\(').exec(source);
  assert.ok(found, 'Actual implementation exists: ' + name);
  return expressionAt(source, found.index);
}
const listenerMarker = "window.addEventListener('message', function(ev){";
const listenerAt = editor.indexOf(listenerMarker);
assert.ok(listenerAt >= 0);
const layoutListener = expressionAt(editor, editor.indexOf('function', listenerAt));
const readyAt = editor.lastIndexOf('window._bnOnIframeReady=function(id){');
assert.ok(readyAt >= 0, 'Actual iframe-ready producer exists');
const readyProducer = expressionAt(editor, editor.indexOf('function', readyAt));
const script = value => '<script>' + value.replace(/<\/script/gi, '<\\/script') + '</script>';
const css = ':root{--canvas-w:800;--canvas-h:400}body{margin:0}#canvas{position:relative;overflow:hidden;width:800px;height:400px}.bg{position:absolute;inset:0;background:#fff}.商品範圍{position:absolute;left:40px;top:60px;width:700px;height:300px}';
const frameHtml = '<!doctype html><meta charset="utf-8"><style>' + css + '</style><div id="stage"><div id="canvas"><div class="bg"></div><div class="商品範圍"></div></div></div><script src="/runtime.js"></script>';
const editorFunctions = ['readFile', 'loadImg', 'sampleCorner', 'autoTrim', 'isLayoutSnapshotUpdate',
  'charSlotSuffix', 'charSlotLabel', 'getCharacterCount', 'hasEndorserImage', 'productLimitActive',
  'getMaxProductsVisible', 'broadcast', 'broadcastTo', 'broadcastCharacter',
  'broadcastCharacterImageUpdate', 'broadcastCharacterVisibility', 'broadcastCharacterPairOrder', 'initCharacterUpload'];
const parentHtml = '<!doctype html><meta charset="utf-8"><style>iframe{width:800px;height:400px;border:0}</style>' +
  '<button id="bn-char-open-btn">人物1</button><input type="file" id="bn-char-inp"><button id="bn-char2-open-btn">人物2</button><input type="file" id="bn-char2-inp">' +
  '<div class="preview-block"><iframe id="iframe-1" src="/html/Fixture.html?bnid=1"></iframe></div>' +
  '<div class="preview-block"><iframe id="iframe-2" src="/html/Fixture.html?bnid=2"></iframe></div>' + script(`
    window.messages=[];window.ready={};window.synced=[];window.dirty=0;window.bgStates={};window.ENDORSER_SLOTS=[];window._layoutSnapshotRequests={};
    window._bnProducts=[{id:'p',layouts:{}}];window._bnCharacter=null;window._bnCharacter2=null;
    addEventListener('message',e=>{messages.push(e.data);if(e.data.type==='bn-iframe-ready')ready[e.data.id]=true});
    function markStateDirty(){dirty++} function renderCharRow(){} function endorserSlotById(){return null}
    function productLayoutSyncEligible(){return true}
    function syncProductLayoutToPairs(product,from,layout){
      synced.push({from,layout}); ['1','2'].filter(id=>id!==String(from)).forEach(id=>{
        product.layouts[id]=layout; document.getElementById('iframe-'+id).contentWindow.postMessage({type:'bn-product-layout-apply',id:product.id,layout},'*');
      });
    }
    function syncCharacterLayoutToPairs(){} function endorserMasterOf(){return ''} function syncEndorserSlotLayout(){}
    var origOnReady=null; function sendEndorserStateTo(){} function requestEndorserMigrationIfNeeded(){}
    function closeModal(){} function imageToDataUrl(src){return Promise.resolve(src)}
    function applySampledCanvasBg(src){window.sampledBackground=src}
    function getLayoutInfoForIframe(frame){return {id:new URL(frame.src).searchParams.get('bnid'),w:800,h:400}}
    function chooseSrcForLayout(info,img,h,v){return h||v}
    function getBgParamsForLibraryLayout(){return {fit:'cover',sizeBasis:'width',scale:100,x:50,y:50}}
    function resolveBgImgUrl(src){return src}
    window._bnSetBgStates=states=>{bgStates=states};
  `) + script(editorFunctions.map(name => actual(editor, name)).join('\n')) +
  script(actual(background, 'applyPreset')) + script('window._bnOnIframeReady='+readyProducer+';') + script(`
    addEventListener('message',${layoutListener});
    initCharacterUpload('_bnCharacter'); initCharacterUpload('_bnCharacter2');
    window.picture=function(color,w=60,h=40){const c=document.createElement('canvas');c.width=w;c.height=h;
      const x=c.getContext('2d');x.fillStyle=color;x.fillRect(5,5,w-10,h-10);return c.toDataURL()};
    window.addProduct=function(id,extra={}){document.getElementById('iframe-'+id).contentWindow.postMessage({
      type:'bn-product-add',id:'p',src:picture('#e02020'),ratio:1.5,index:0,...extra},'*')};
  `);

async function main() {
  let playwright;
  try { playwright = require('playwright'); }
  catch (_) { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
  const executablePath = process.env.BODA_TEST_BROWSER || [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium'
  ].filter(Boolean).find(file => fs.existsSync(file));
  const requests = [], server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost'); requests.push(url.pathname);
    response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    if (url.pathname === '/') response.end(parentHtml);
    else if (url.pathname === '/runtime.js') response.end(runtime);
    else if (url.pathname.endsWith('.css')) response.end(css);
    else if (url.pathname === '/html/Fixture.html') response.end(frameHtml);
    else if (url.pathname === '/favicon.ico') { response.statusCode = 204; response.end(); }
    else { response.statusCode = 404; response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => ready[1] && ready[2]);
    await page.evaluate(() => { addProduct(1); addProduct(2); });
    await page.waitForFunction(() => ['1','2'].every(id => document.getElementById('iframe-'+id).contentDocument.querySelector('.bn-prod-box img')?.complete));
    await page.waitForTimeout(120);
    assert.deepEqual(errors, []);
    const automatic = await page.evaluate(() => messages.filter(m => m.type === 'bn-product-layout-update'));
    assert.ok(automatic.length >= 2, 'Actual auto layout must report each iframe snapshot');
    assert.ok(automatic.every(message => message.snapshotOnly === true), 'Auto layout is a snapshot, never a cross-layout edit');
    assert.equal(await page.evaluate(() => synced.length), 0);
    console.log('PASS actual runtime auto-layout reports snapshotOnly and does not synchronize other layouts');

    // Negative control: the previous false flag enters the actual editor
    // listener's edit branch and contaminates the other layout through its pair
    // synchronizer. The production runtime must never emit this on auto layout.
    await page.evaluate(() => {
      const other=document.getElementById('iframe-2').contentDocument.querySelector('.bn-prod-box');
      other.style.left='7px';other.style.top='8px';other.dataset.manualLayout='1';
      const d=messages.find(m=>m.type==='bn-product-layout-update' && String(m.bnid)==='1');
      dispatchEvent(new MessageEvent('message',{data:{...d,snapshotOnly:false}})); });
    await page.waitForFunction(() => synced.length > 0);
    await page.waitForFunction(() => document.getElementById('iframe-2').contentDocument.querySelector('.bn-prod-box').style.left !== '7px');
    assert.ok(await page.evaluate(() => synced.length > 0), 'The old false flag must reproduce cross-layout synchronization');
    console.log('PASS negative control proves snapshotOnly:false enters actual editor cross-layout synchronization');

    await page.evaluate(() => {
      window.edited={};
      ['1','2'].forEach((id,i)=>{
        const b=document.getElementById('iframe-'+id).contentDocument.querySelector('.bn-prod-box');
        Object.assign(b.style,{left:(71+i*20)+'px',top:(33+i*7)+'px',width:'147px',height:'98px'});
        b.dataset.manualLayout='1';b.dataset.rotate='27';b.dataset.productRect=JSON.stringify({x:2,y:3,w:45,h:30});
        b.querySelector('img').src=picture('#00a030',90,60);b.dataset.crop='user-crop';
        edited[id]={node:b,img:b.querySelector('img'),frame:[b.style.left,b.style.top,b.style.width,b.style.height],src:b.querySelector('img').src};
      });messages.length=0;synced.length=0;
      _bnProducts[0].src=picture('#e02020');_bnProducts[0].ratio=1.5;
      _bnOnIframeReady(1);_bnOnIframeReady(2);
    });
    await page.waitForTimeout(360);
    const checkProducts = () => page.evaluate(() => ['1','2'].map(id => {
      const b=document.getElementById('iframe-'+id).contentDocument.querySelector('.bn-prod-box'),e=edited[id];
      return {same:b===e.node,sameImg:b.querySelector('img')===e.img,frame:[b.style.left,b.style.top,b.style.width,b.style.height],expected:e.frame,
        src:b.querySelector('img').src===e.src,crop:b.dataset.crop,rotate:b.dataset.rotate};
    }));
    for (const result of await checkProducts()) {
      assert.equal(result.same,true,'Repeated ready/product-add must keep the edited product node');
      assert.equal(result.sameImg,true);assert.deepEqual(result.frame,result.expected);assert.equal(result.src,true);
      assert.equal(result.crop,'user-crop');assert.equal(result.rotate,'27');
    }
    console.log('PASS duplicate product-add retains the existing edited node, image, crop, rotation and exact frame');

    await page.evaluate(() => {
      const next=picture('#2090dd',100,70);window.nextProductImage=next;
      ['1','2'].forEach(id=>document.getElementById('iframe-'+id).contentWindow.postMessage({type:'bn-product-add',id:'p',src:next,ratio:100/70,rotate:27},'*'));
    });
    await page.waitForFunction(() => ['1','2'].every(id => document.getElementById('iframe-'+id).contentDocument.querySelector('.bn-prod-box img').src === nextProductImage));
    await page.evaluate(() => { ['1','2'].forEach(id=>{edited[id].src=nextProductImage}); });
    for(const result of await checkProducts()){assert.equal(result.same,true);assert.deepEqual(result.frame,result.expected);assert.equal(result.src,true);}
    console.log('PASS explicit same-ID image replacement updates pixels in place and preserves the exact product frame');

    await page.evaluate(() => { applyPreset({horizontalSrc:picture('#9030e0',80,50),verticalSrc:null}); });
    await page.waitForFunction(() => Object.keys(bgStates).length === 2);
    await page.waitForTimeout(120);
    for (const result of await checkProducts()) { assert.equal(result.same,true);assert.deepEqual(result.frame,result.expected);assert.equal(result.src,true);assert.equal(result.rotate,'27'); }
    assert.equal(await page.evaluate(() => synced.length),0);
    console.log('PASS actual background applyPreset changes both backgrounds without moving, rebuilding or recropping products');

    await page.evaluate(() => {
      const layouts={1:{left:340,top:40,width:110,height:160},2:{left:370,top:50,width:100,height:150}};
      _bnCharacter={id:'character-existing',src:picture('#3030c0',40,70),ratio:40/70,aboveMain:false,layouts};
      broadcastCharacter('_bnCharacter');
    });
    await page.waitForFunction(() => ['1','2'].every(id => document.getElementById('iframe-'+id).contentDocument.querySelector('.bn-char-box')));
    await page.waitForTimeout(120);
    await page.evaluate(() => { window.savedCharacterLayouts=JSON.stringify(_bnCharacter.layouts); window.characters={}; ['1','2'].forEach(id=>{
      const b=document.getElementById('iframe-'+id).contentDocument.querySelector('.bn-char-box');
      characters[id]={node:b,frame:[b.style.left,b.style.top,b.style.width,b.style.height],src:b.querySelector('img').src};
    }); });
    const replacement = await page.evaluate(() => picture('#dd7020',110,45));
    await page.locator('#bn-char-inp').setInputFiles({name:'新人物.png',mimeType:'image/png',buffer:Buffer.from(replacement.split(',')[1],'base64')});
    await page.waitForFunction(() => _bnCharacter.name === '新人物.png');
    await page.waitForTimeout(160);
    assert.equal(await page.evaluate(() => JSON.stringify(_bnCharacter.layouts) === savedCharacterLayouts),true,'Character upload must retain all layout positions');
    assert.equal(await page.evaluate(() => _bnCharacter.id), 'character-existing');
    assert.equal(await page.evaluate(() => _bnCharacter.aboveMain), false);
    const characters = await page.evaluate(() => ['1','2'].map(id=>{const b=document.getElementById('iframe-'+id).contentDocument.querySelector('.bn-char-box'),e=characters[id];
      return {same:b===e.node,frame:[b.style.left,b.style.top,b.style.width,b.style.height],expected:e.frame,newSrc:b.querySelector('img').src!==e.src};}));
    for(const result of characters){assert.equal(result.same,true,'Character replacement must be in place');assert.deepEqual(result.frame,result.expected);assert.equal(result.newSrc,true);}
    for(const result of await checkProducts()){assert.equal(result.same,true);assert.deepEqual(result.frame,result.expected);assert.equal(result.src,true);}
    await page.evaluate(() => {
      messages.length=0;
      ['1','2'].forEach(id=>{
        const win=document.getElementById('iframe-'+id).contentWindow;
        win.postMessage({type:'bn-character-visibility',hasChar:true,visibleIds:[]},'*');
        win.postMessage({type:'bn-layout-snapshot-request',requestId:'hidden-frame'},'*');
      });
    });
    await page.waitForFunction(() => messages.filter(m=>m.type==='bn-product-layout-update' && m.requestId==='hidden-frame').length === 2);
    const hiddenSnapshots=await page.evaluate(() => messages.filter(m=>m.type==='bn-product-layout-update' && m.requestId==='hidden-frame'));
    for(const snapshot of hiddenSnapshots){
      const i=Number(snapshot.bnid)-1;
      assert.equal(snapshot.snapshotOnly,true);
      assert.deepEqual([snapshot.layout.left,snapshot.layout.top,snapshot.layout.width,snapshot.layout.height],[71+i*20,33+i*7,147,98]);
    }
    assert.equal(await page.evaluate(() => synced.length),0,'Hidden snapshots must not propagate a zero frame to other layouts');
    console.log('PASS character visibility hides products without losing their saved design coordinates or dimensions');
    assert.deepEqual(errors,[]);
    assert.ok(requests.every(url=>!(/\.(?:ttf|woff2)$/.test(url))), 'Fixture must not load real fonts');
    console.log('PASS actual initCharacterUpload retains identity/layout/layer and replaces pixels in place without changing products');
  } finally { if(browser)await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
