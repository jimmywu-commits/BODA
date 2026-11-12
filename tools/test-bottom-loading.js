'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'bottom/src/render/fontLoader.js'), 'utf8');
const exporter = fs.readFileSync(path.join(root, 'bottom/src/export/exportBatch.js'), 'utf8');
function fixture(fail = () => false) {
  const requests = [], added = [];
  const window = { LAYOUT: { fontSize: 36 } };
  window.FontFace = class {
    constructor(family, url, options) { this.family = family; this.url = url; this.weight = options.weight; }
    async load() { requests.push(this); await Promise.resolve(); if (fail(this)) throw Error('font unavailable'); return this; }
  };
  const document = { fonts: { add(face) { added.push(face); }, async load() {}, check() { return true; } } };
  vm.runInNewContext(source, {window, document});
  return {window, document, requests, added};
}
async function main() {
  const f = fixture();
  assert.equal(f.requests.length, 0);
  const first = f.window.FontLoader.load();
  assert.equal(first, f.window.FontLoader.load(), 'in-flight load must be shared');
  await first;
  assert.equal(f.window.FontLoader.isReady(), true);
  assert.deepEqual(f.requests.map(face => face.weight), ['500', '700']);
  for (const face of f.requests) {
    assert.match(face.url, /\.\.\/shopee\/fonts\/.*\.woff2/);
    const relative = face.url.match(/url\("([^\"]+)"\)/)[1];
    assert.ok(fs.existsSync(path.resolve(root, 'bottom', decodeURIComponent(relative))));
    assert.equal(face.family, 'ShopeeNotoSansContent');
  }
  await f.window.FontLoader.load();
  assert.equal(f.requests.length, 2, 'ready faces never download again');
  console.log('PASS bottom loads only the two shared WOFF2 weights and coalesces repeated calls');

  const fallback = fixture(face => /\.woff2/.test(face.url));
  await fallback.window.FontLoader.load();
  assert.equal(fallback.added.length, 2);
  assert.ok(fallback.added.every(face => /\.\.\/fonts\/.*\.ttf/.test(face.url)));
  assert.equal(fallback.requests.length, 6, 'each weight falls back separately');
  console.log('PASS missing WOFF2 falls back to the original local TTF without substituting fonts');

  let failBold = true;
  const retry = fixture(face => face.weight === '700' && failBold);
  await assert.rejects(retry.window.FontLoader.load(), /font unavailable/);
  assert.equal(retry.window.FontLoader.isReady(), false);
  failBold = false;
  await retry.window.FontLoader.load();
  assert.equal(retry.requests.filter(face => face.weight === '500').length, 1);
  assert.equal(retry.added.length, 2);
  console.log('PASS failed font load blocks readiness; retry preserves the successful weight');

  const unavailable = fixture();
  unavailable.document.fonts.check = () => false;
  await assert.rejects(unavailable.window.FontLoader.load(), /無法使用該字重/);
  assert.equal(unavailable.window.FontLoader.isReady(), false);
  unavailable.document.fonts.check = () => true;
  await unavailable.window.FontLoader.load();
  assert.equal(unavailable.requests.length, 2, 'readiness retry does not redownload successful faces');
  delete unavailable.window.FontFace;
  const unsupported = fixture(); delete unsupported.window.FontFace;
  await assert.rejects(unsupported.window.FontLoader.load(), /不支援 FontFace/);
  assert.equal(unsupported.window.FontLoader.isReady(), false);
  console.log('PASS browser readiness and FontFace support remain mandatory before drawing/export');

  const index = fs.readFileSync(path.join(root, 'bottom/index.html'), 'utf8');
  assert.doesNotMatch(index, /<script[^>]+(?:jszip|JSZip)/);
  assert.match(index, /\.\.\/JS\/dependency-loader\.js/);
  let loads = 0, generated = 0;
  let resolveZip;
  const waitZip = new Promise(resolve => { resolveZip = resolve; });
  const window = {
    ColorTheme: {},
    BodaDependencies: {ensure(name) { assert.equal(name, 'zip'); loads++; return waitZip; }},
    Selectors: {viewState() { return {slots: []}; }},
    ProjectFile: {FILENAME:'state.json',serialize() { return '{}'; }}
  };
  const document = {createElement() {return {click(){}};},body:{appendChild(){},removeChild(){}}};
  const context = {window,document,URL:{createObjectURL(){return 'blob:zip';},revokeObjectURL(){}},Uint8Array,atob};
  vm.runInNewContext(exporter, context);
  const store = {getState() {return {banners: []};}};
  const one = window.ExportBatch.downloadAsZip([], 'test', store);
  const all = window.ExportBatch.downloadAllBannersAsZip([], 'test', store);
  assert.equal(loads, 2); assert.equal(generated, 0);
  context.JSZip = class {file(){} folder(){return this;} async generateAsync(){generated++; return {};}};
  resolveZip(context.JSZip);
  await Promise.all([one, all]);
  assert.equal(generated, 2);
  console.log('PASS both ZIP exports await the shared local dependency; initial page requests no ZIP library');

  const oldBytes = ['Medium', 'Bold'].reduce((sum,w) => sum + fs.statSync(path.join(root, `fonts/ShopeeNotoSans(content)-${w}.ttf`)).size, 0);
  const newBytes = ['Medium', 'Bold'].reduce((sum,w) => sum + fs.statSync(path.join(root, `shopee/fonts/ShopeeNotoSans(content)-${w}.woff2`)).size, 0);
  console.log(JSON.stringify({oldFontBytes:oldBytes,newFontBytes:newBytes,savedBytes:oldBytes-newBytes,reductionPercent:100*(oldBytes-newBytes)/oldBytes}));
}
// Optional real-browser lossless rendering check: node tools/test-bottom-loading.js --browser
async function browserCheck() {
  const http = require('node:http'), os = require('node:os');
  const {spawn} = require('node:child_process');
  // Reuse this repository's existing CDP/browser helper, without executing its workflow.
  const helper = fs.readFileSync(path.join(__dirname, 'test-slimming-workflow.js'), 'utf8').split('async function workbook()')[0];
  const {CDP,findBrowser,until} = vm.runInNewContext(helper+'\n({CDP,findBrowser,until})', {
    require, process, WebSocket, setTimeout, clearTimeout, __dirname, console
  });
  const server = http.createServer((req,res) => {
    if (req.url === '/__bottom_font.html') {
      res.setHeader('Content-Type','text/html');
      res.end('<!doctype html><meta charset="utf-8"><script>window.LAYOUT={fontSize:35}</script><script src="/JS/vendor/browser-loader.js"></script><script src="/bottom/src/render/fontLoader.js"></script>'); return;
    }
    const file = path.resolve(root, '.'+decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
    fs.readFile(file,(err,data) => {
      if(err){res.writeHead(404).end();return;}
      const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf'};
      res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(data);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'boda-bottom-font-'));
  const browser=spawn(findBrowser(),['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'], {windowsHide:true,stdio:['ignore','ignore','pipe']});
  let stderr='', client, browserClient;
  const runtimeErrors=[],failedRequests=[],requestUrls=new Map();
  browser.stderr.on('data',chunk=>stderr+=chunk);
  try {
    const debug=await until(()=>stderr.match(/DevTools listening on (ws:\/\/[^\r\n]+)/),'debugger');
    browserClient=await CDP.connect(debug[1]);
    const target=await browserClient.send('Target.createTarget',{url:'about:blank'});
    const targets=await(await fetch('http://127.0.0.1:'+new URL(debug[1]).port+'/json/list')).json();
    client=await CDP.connect(targets.find(t=>t.id===target.targetId).webSocketDebuggerUrl);
    const requests=[];
    client.on('Network.requestWillBeSent',event=>{requests.push(event.request.url);requestUrls.set(event.requestId,event.request.url);});
    client.on('Network.loadingFailed',event=>failedRequests.push({url:requestUrls.get(event.requestId),error:event.errorText,canceled:!!event.canceled,type:event.type}));
    client.on('Runtime.exceptionThrown',event=>runtimeErrors.push(event.exceptionDetails.exception?.description||event.exceptionDetails.text));
    await client.send('Runtime.enable');
    await client.send('Network.enable');await client.send('Page.enable');
    await client.send('Page.navigate',{url:origin+'/__bottom_font.html'});
    await until(()=>client.evaluate('typeof FontLoader === "object"'),'font loader');
    await until(()=>client.evaluate('typeof BodaVendor === "object"'),'vendor loader');
    assert.equal(requests.filter(url=>/konva-|xlsx-|cropper-/.test(url)).length,0,'optional vendor modules remain unloaded before ensure');
    const vendors=await client.evaluate(`(async()=>{
      await Promise.all([BodaVendor.ensure('konva'),BodaVendor.ensure('sheet'),BodaVendor.ensure('sheet'),BodaVendor.ensure('cropper'),BodaVendor.ensure('cropper')]);
      const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['工單','測試'],['吸底','優惠']]),'Layout_Output');
      const bytes=XLSX.write(workbook,{type:'array',bookType:'xlsx'}),restored=XLSX.read(bytes,{type:'array'});
      const cells=XLSX.utils.sheet_to_json(restored.Sheets.Layout_Output,{header:1});
      const source=document.createElement('canvas');source.width=20;source.height=20;source.getContext('2d').fillRect(0,0,20,20);
      const image=new Image();image.src=source.toDataURL();await image.decode();document.body.appendChild(image);
      let cropper;await new Promise(resolve=>{cropper=new Cropper(image,{checkCrossOrigin:false,ready:resolve});});
      const png=cropper.getCroppedCanvas().toDataURL('image/png');
      const cssReady=getComputedStyle(document.querySelector('.cropper-container')).position==='relative';cropper.destroy();image.remove();
      return {konva:Konva.version,sheet:XLSX.version,cells,cropPng:png.startsWith('data:image/png;base64,'),cssReady};
    })()`);
    assert.equal(vendors.konva,'9.3.22');assert.equal(vendors.sheet,'0.18.5');
    assert.deepEqual(JSON.parse(JSON.stringify(vendors.cells)),[['工單','測試'],['吸底','優惠']]);assert.ok(vendors.cropPng&&vendors.cssReady);
    assert.equal(requests.filter(url=>url.includes('/xlsx-0.18.5.')).length,1);
    assert.equal(requests.filter(url=>url.includes('/cropper-1.6.2.min.js')).length,1);
    assert.equal(requests.filter(url=>url.includes('/cropper-1.6.2.min.css')).length,1);
    assert.ok(requests.filter(url=>/^https?:/.test(url)).every(url=>url.startsWith(origin)),'local vendor success never contacts a CDN');
    console.log('PASS actual Chrome local pinned Konva, XLSX round-trip, Cropper PNG/style and shared first-use requests '+JSON.stringify(vendors));
    const result=await client.evaluate(`(async()=>{
      await FontLoader.load();
      const initial=Array.from(document.fonts).map(face=>({weight:face.weight,status:face.status}));
      const sample='吸底圖商品優惠測試 ABC 9.9 10.10 $123',comparisons=[];
      for(const [name,weight] of [['Medium','500'],['Bold','700']]){
        const font=new FontFace('Reference'+weight,'url("/fonts/ShopeeNotoSans%28content%29-'+name+'.ttf")',{weight});
        document.fonts.add(font);await font.load();
        const make=family=>{const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=70;const ctx=canvas.getContext('2d');ctx.font=weight+' 35px '+family;ctx.fillText(sample,0,45);return {width:ctx.measureText(sample).width,pixels:Array.from(ctx.getImageData(0,0,1000,70).data)};};
        const shared=make(FontLoader.FONT_FAMILY),original=make('Reference'+weight);
        const difference=shared.pixels.reduce((n,value,i)=>n+(value!==original.pixels[i]?1:0),0);
        if(shared.width!==original.width||difference)throw Error('font mismatch '+weight+' '+difference);
        comparisons.push({weight,width:shared.width,differingPixelChannels:difference,visiblePixels:shared.pixels.filter((value,i)=>i%4===3&&value).length});
      }
      return {ready:FontLoader.isReady(),initial,comparisons};
    })()`);
    const ownFonts=requests.filter(url=>/\/shopee\/fonts\//.test(url));
    assert.equal(ownFonts.length,2);assert.ok(ownFonts.every(url=>url.endsWith('.woff2')));
    assert.ok(result.ready && result.comparisons.every(item=>item.visiblePixels>100));
    console.log('PASS actual Chrome WOFF2 and original TTF have identical text widths and canvas pixels '+JSON.stringify(result));
    await client.send('Page.navigate',{url:origin+'/bottom/index.html'});
    try {
      await until(()=>client.evaluate('!!(window.FontLoader && FontLoader.isReady() && window.BottomViewport && document.querySelector("#konva-container canvas"))'),'complete standalone bottom startup');
    } catch(error) {
      const diagnostic=await client.evaluate(`({url:location.href,readyState:document.readyState,font:window.FontLoader&&FontLoader.getState(),konva:window.Konva&&Konva.version,viewport:!!window.BottomViewport,status:document.getElementById('font-status')?.textContent,warning:document.getElementById('bottom-autosave-warning')?.textContent,scriptSources:Array.from(document.scripts,script=>script.src),ownership:window.BodaStorageOwnership&&BodaStorageOwnership.create('boda-bottom-autosave').status(),fonts:Array.from(document.fonts,face=>({family:face.family,weight:face.weight,status:face.status}))})`);
      throw new Error(error.message+'\nSTARTUP_DIAGNOSTIC '+JSON.stringify({diagnostic,runtimeErrors,failedRequests,recentRequests:requests.slice(-40)}));
    }
    const startup=await client.evaluate('({konva:Konva.version,canvas:!!document.querySelector("#konva-container canvas"),warning:document.getElementById("bottom-autosave-warning")?.textContent||""})');
    assert.ok(startup.canvas);assert.equal(startup.konva,'9.3.22');assert.equal(startup.warning,'');
    console.log('PASS actual standalone bottom mounts its canvas after local Konva, font readiness and protected draft restore');
    await browserClient.send('Browser.close');
  } catch(error) {
    const current=client ? await client.evaluate('({url:location.href,ready:document.readyState,status:document.getElementById("font-status")?.textContent,font:window.FontLoader&&FontLoader.getState()})').catch(()=>null) : null;
    console.error('BROWSER_DIAGNOSTIC '+JSON.stringify({current,runtimeErrors,failedRequests,browserStderr:stderr.slice(-4000)}));
    throw error;
  } finally {
    if(client)client.close();if(browserClient)browserClient.close();browser.kill();
    await new Promise(resolve=>server.close(resolve));
  }
}
async function autosaveChecks() {
  const source = fs.readFileSync(path.join(root,'bottom/src/state/autoSave.js'),'utf8');
  function create({embedded=false,blocked=false}={}) {
    const calls=[],timers=[],notices=new Map();
    let held=false,listener;
    const window={location:{search:embedded?'?embed=generator':''},
      Selectors:{hasContent(){return true;}},
      ProjectFile:{parse(raw){return raw;},applyToStore(){calls.push('apply');},serialize(){calls.push('serialize');return '{"saved":true}';}},
      BodaStorageOwnership:{create(name){assert.equal(name,'boda-bottom-autosave');return {run(operation){return Promise.resolve().then(()=>{if(blocked)throw Error('other tab owns draft');held=true;try{return operation();}finally{held=false;}});}}}}
    };
    window.parent=embedded?{BodaStateAssets:{}}:window;
    const document={getElementById(id){return notices.get(id);},createElement(){return {style:{},setAttribute(){},remove(){notices.delete(this.id);}};},body:{appendChild(node){notices.set(node.id,node);}}};
    const localStorage={getItem(){assert.ok(held);calls.push('read');return '{"prior":true}';},setItem(){assert.ok(held);calls.push('write');},removeItem(){assert.ok(held);calls.push('remove');}};
    const store={beginBatch(){},endBatch(){},getState(){return {library:[]};},subscribe(fn){calls.push('subscribe');listener=fn;}};
    vm.runInNewContext(source,{window,document,URLSearchParams,localStorage,setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){}});
    return {window,store,calls,timers,notices,changed(){listener();}};
  }
  const embedded=create({embedded:true});
  assert.equal(embedded.window.BottomAutoSave.isParentManaged(),true);
  assert.equal(await embedded.window.BottomAutoSave.restore(embedded.store,{}),false);
  embedded.window.BottomAutoSave.mount(embedded.store);await embedded.window.BottomAutoSave.clear();
  assert.deepEqual(embedded.calls,[],'parent-managed iframe must never restore, serialize, subscribe or mutate the standalone backup');
  console.log('PASS embedded bottom delegates to parent IDB with zero duplicate localStorage reads/writes/serialization');

  const standalone=create();
  assert.equal(await standalone.window.BottomAutoSave.restore(standalone.store,{}),true);
  standalone.window.BottomAutoSave.mount(standalone.store);standalone.changed();await standalone.timers.pop()();
  await standalone.window.BottomAutoSave.clear();
  assert.deepEqual(standalone.calls,['read','apply','subscribe','serialize','write','remove']);
  console.log('PASS standalone bottom acquires shared ownership before draft restore/save/clear');

  const blocked=create({blocked:true});
  assert.equal(await blocked.window.BottomAutoSave.restore(blocked.store,{}),false);
  blocked.window.BottomAutoSave.mount(blocked.store);blocked.changed();await blocked.timers.pop()();await blocked.window.BottomAutoSave.clear();
  assert.deepEqual(blocked.calls,['subscribe']);assert.ok(blocked.notices.get('bottom-autosave-warning').textContent.includes('other tab'));
  const missing=create();delete missing.window.BodaStorageOwnership;
  assert.equal(await missing.window.BottomAutoSave.restore(missing.store,{}),false);assert.deepEqual(missing.calls,[]);
  assert.ok(missing.notices.get('bottom-autosave-warning').textContent.includes('下載'));
  console.log('PASS conflicting/unsupported standalone ownership visibly disables persistence without an unsafe fallback');
}
async function vendorChecks() {
  const code=fs.readFileSync(path.join(root,'JS/vendor/browser-loader.js'),'utf8');
  function fixture({failLocal=false,failAll=false,holdCss=false}={}) {
    const requests=[],css=[];
    const window={setTimeout,clearTimeout};
    const document={currentScript:{src:'https://boda.test/JS/vendor/browser-loader.js'},baseURI:'https://boda.test/bottom/index.html',createElement(tag){return {tag,remove(){}};},head:{appendChild(node){
      const url=node.src||node.href;requests.push(url);
      queueMicrotask(()=>{
        if(failAll || failLocal&&url.startsWith('https://boda.test/')){node.onerror();return;}
        if(node.tag==='link' && holdCss){css.push(node);return;}
        if(node.tag==='script') {
          if(/konva/.test(url))window.Konva={Stage:function(){}};
          if(/xlsx/.test(url))window.XLSX={read:function(){}};
          if(/cropper/.test(url))window.Cropper=function(){};
        }
        node.onload();
      });
    }}};
    vm.runInNewContext(code,{window,document,URL,Promise});
    return {window,requests,css};
  }
  const local=fixture();assert.deepEqual(local.requests,[]);
  const a=local.window.BodaVendor.ensure('sheet'),b=local.window.BodaVendor.ensure('sheet');assert.equal(a,b);await a;
  assert.deepEqual(local.requests,['https://boda.test/JS/vendor/xlsx-0.18.5.full.min.js']);
  const fallback=fixture({failLocal:true});await fallback.window.BodaVendor.ensure('konva');
  assert.deepEqual(fallback.requests,['https://boda.test/JS/vendor/konva-9.3.22.min.js','https://unpkg.com/konva@9.3.22/konva.min.js']);
  const styles=fixture({holdCss:true});let ready=false;
  const cropper=styles.window.BodaVendor.ensure('cropper').then(()=>{ready=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(ready,false);styles.css[0].onload();await cropper;assert.equal(ready,true);
  const failed=fixture({failAll:true});await assert.rejects(failed.window.BodaVendor.ensure('sheet'),/無法載入/);
  await assert.rejects(failed.window.BodaVendor.ensure('sheet'),/無法載入/);assert.equal(failed.requests.length,4,'rejected requests can retry local then pinned remote');
  const crypto=require('node:crypto');
  for(const [file,hash] of [
    ['konva-9.3.22.min.js','4655b6cd12d0d2ee5f6d461fa98c3611b1f9979b9106f18221bf0e6a90ab6745'],
    ['xlsx-0.18.5.full.min.js','c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99'],
    ['cropper-1.6.2.min.js','6290a3fa581b17ccf4692cf3ec617a74ae65de88d9140c72d492ae9b47707efb'],
    ['cropper-1.6.2.min.css','23679f552ce73499f817de22b5dcdd9e1e5a1e50cd9d77e34bbd31bf65a85186']
  ])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'JS/vendor',file))).digest('hex'),hash,file);
  console.log('PASS vendor local-first loading, exact CDN fallback, shared requests, CSS readiness, failure retry and pinned SHA-256');
}
main().then(autosaveChecks).then(vendorChecks).then(()=>process.argv.includes('--browser') ? browserCheck() : null).catch(error => { console.error(error); process.exitCode = 1; });
