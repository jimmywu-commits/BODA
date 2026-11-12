'use strict';

// Actual production snapshot protocol, lazy-preview lifecycle and full runtime.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const http=require('node:http');
const os=require('node:os');
const root=path.resolve(__dirname,'..');
const exposure=path.join(root,'shopee');
const editor=fs.readFileSync(path.join(exposure,'js/bn-editor-plugin.js'),'utf8');
const index=fs.readFileSync(path.join(exposure,'index.html'),'utf8');
const runtime=fs.readFileSync(path.join(exposure,'js/layout-runtime.js'),'utf8');
function segment(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
function expressionAt(source,start){
  for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){
    const code=source.slice(start,end+1);try{new vm.Script('('+code+')');return code;}catch(_){}
  }throw new Error('Missing function');
}
const snapshot=expressionAt(editor,editor.indexOf('function(frame, timeoutMs)',editor.indexOf('window._bnRequestPreviewSnapshot')));
const idFunction=expressionAt(editor,editor.indexOf('function getIframeLayoutId('));
const updateFunction=expressionAt(editor,editor.indexOf('function isLayoutSnapshotUpdate('));

async function protocolTests(){
  const listeners=new Set(),requests=[];
  const source={postMessage(message){requests.push(message);}};
  const frame={src:'http://test/html/Fixture.html?bnid=1',contentWindow:source,isConnected:true,_bnPreviewGeneration:1,getAttribute(name){return name==='src'?this.src:null;}};
  const context={console,Promise,Date,Math,URLSearchParams,setTimeout,clearTimeout,_layoutSnapshotRequests:{},window:{addEventListener(type,fn){listeners.add(fn);},removeEventListener(type,fn){listeners.delete(fn);}}};
  vm.createContext(context);
  vm.runInContext(idFunction+';'+updateFunction+';window.request='+snapshot,context);
  function reply(data,from=source){for(const listener of [...listeners])listener({source:from,data});}
  function complete(request,extra={}){return {...request,type:'bn-layout-snapshot-complete',bnid:1,suspendVersion:1,safeToSuspend:true,...extra};}
  const first=context.window.request(frame,100),request=requests.at(-1);
  reply(complete(request),{});reply(complete(request,{bnid:2}));reply(complete(request,{requestId:'old'}));
  assert.equal(listeners.size,1,'unrelated or stale replies cannot acknowledge');
  assert.equal(context.isLayoutSnapshotUpdate({bnid:2,snapshotOnly:false}),false,'targeted snapshot must not suppress another frame edit');
  reply(complete(request));assert.equal((await first).safeToSuspend,true);assert.equal(listeners.size,0);
  const stale=context.window.request(frame,100),staleRequest=requests.at(-1);frame._bnPreviewGeneration++;
  reply(complete(staleRequest));assert.equal((await stale).reason,'document-changed');
  const old=context.window.request(frame,100);reply(complete(requests.at(-1),{suspendVersion:undefined}));assert.equal((await old).safeToSuspend,false);
  const timeout=await context.window.request(frame,100);assert.equal(timeout.complete,false);assert.equal(timeout.reason,'timeout');assert.equal(listeners.size,0);
  assert.equal(Object.keys(context._layoutSnapshotRequests).length,0);
  console.log('PASS strict snapshot requires exact source/id/request/document; timeout and old runtime retain editors; unrelated edits remain live');
}

async function browserTests(){
  let playwright;try{playwright=require('playwright');}catch(_){playwright=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
  const executablePath=process.env.BODA_TEST_BROWSER||[
    process.env.PROGRAMFILES&&path.join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)']&&path.join(process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome','/usr/bin/chromium'
  ].filter(Boolean).find(file=>fs.existsSync(file));
  const script=code=>'<script>'+code.replace(/<\/script/gi,'<\\/script')+'</script>';
  const lazy=segment(index,'var bnLazyObserver = null;','/* iframe 載入完成：');
  const css=':root{--canvas-w:800;--canvas-h:400}body{margin:0}#canvas{position:relative;width:800px;height:400px;overflow:hidden}.bg{position:absolute;inset:0;background:#fff}.商品範圍{position:absolute;left:40px;top:60px;width:700px;height:300px}';
  const frameHtml='<!doctype html><meta charset="utf-8"><style>'+css+'</style><div id="stage"><div id="canvas"><div class="bg"></div><div class="商品範圍"></div></div></div><script src="/runtime.js"></script>';
  const fixture='<!doctype html><style>body{margin:0}iframe{width:800px;height:400px}.preview-block{height:420px}#preview-area{margin-top:4000px}</style><div id="preview-area">'+Array.from({length:7},(_,i)=>'<div class="preview-block"><div><iframe id="iframe-'+(i+1)+'" src="/html/Fixture.html?bnid='+(i+1)+'"></iframe></div></div>').join('')+'</div>'+script(`
    window.ready={};window.loads={};window.products={};window.layouts={};window._layoutSnapshotRequests={};
    function bnHidePreviewLoading(){} function bnStartPreviewLoading(){}
    ${idFunction};${updateFunction};window._bnRequestPreviewSnapshot=${snapshot};
    addEventListener('message',event=>{
      const data=event.data||{},id=String(data.id||data.bnid||'');
      if(data.type==='bn-product-layout-update'){layouts[String(data.bnid)]=data.layout;return;}
      if(data.type==='bn-iframe-ready'){
        const frame=document.getElementById('iframe-'+id);if(!frame||frame.getAttribute('data-bn-src')||event.source!==frame.contentWindow)return;
        loads[id]=(loads[id]||0)+1;ready[id]=true;bnLazyMarkReady(id);
        const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="red"/></svg>');
        const layout=layouts[id]||{left:31+Number(id),top:44,width:150,height:100};
        frame.contentWindow.postMessage({type:'bn-product-add',id:'p',src:svg,ratio:1.5,layoutById:{[id]:layout}},'*');
      }
    });
  `)+script(lazy);
  const server=http.createServer((request,response)=>{const url=new URL(request.url,'http://localhost');response.setHeader('Content-Type',url.pathname==='/runtime.js'?'text/javascript':'text/html');response.end(url.pathname==='/'?fixture:url.pathname==='/runtime.js'?runtime:frameHtml);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await playwright.chromium.launch({executablePath,headless:true});const page=await browser.newPage({viewport:{width:1000,height:800}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/');
    try{await page.waitForFunction(()=>Object.keys(ready).length===7&&Object.keys(layouts).length===7);}
    catch(error){console.error({errors,state:await page.evaluate(()=>({ready,layouts,loads}))});throw error;}
    await page.waitForTimeout(800);
    // Hidden iframe RAF can be delayed long after its image load event. The
    // decode lease must span the actual geometry callback and layout publish.
    await page.evaluate(()=>{
      window._bnExporting=true;
      const cw=document.getElementById('iframe-1').contentWindow;
      cw.__nativeRAF=cw.requestAnimationFrame;cw.__rafQueue=[];
      cw.requestAnimationFrame=callback=>{cw.__rafQueue.push(callback);return cw.__rafQueue.length;};
      const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="60"><rect width="180" height="60" fill="blue"/></svg>');
      cw.postMessage({type:'bn-product-update-image',id:'p',src:svg,ratio:3,keepScale:true,rotate:21},'*');
    });
    await page.waitForFunction(()=>document.getElementById('iframe-1').contentWindow.__rafQueue.length>=2);
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(async()=>(await _bnRequestPreviewSnapshot(document.getElementById('iframe-1'),1200)).safeToSuspend),false,
      'image decoded but queued geometry RAF must prevent suspension');
    await page.evaluate(()=>{
      const cw=document.getElementById('iframe-1').contentWindow;
      cw.__rafQueue.splice(0).forEach(callback=>callback(cw.performance.now()));
    });
    await page.waitForFunction(()=>layouts['1'].width===225&&layouts['1'].height===75);
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(async()=>(await _bnRequestPreviewSnapshot(document.getElementById('iframe-1'),1200)).safeToSuspend),false,
      'layout is published but final RAF barrier has not run');
    await page.evaluate(()=>{
      const cw=document.getElementById('iframe-1').contentWindow;
      cw.__rafQueue.splice(0).forEach(callback=>callback(cw.performance.now()));
      cw.requestAnimationFrame=cw.__nativeRAF;
    });
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(async()=>(await _bnRequestPreviewSnapshot(document.getElementById('iframe-1'),1200)).safeToSuspend),true);
    await page.evaluate(()=>{window._bnExporting=false;});
    console.log('PASS decoded image remains protected through delayed geometry RAF and layout publication; releases after final RAF barrier');
    const before=await page.evaluate(()=>({layout:layouts['1'],loads:{...loads}}));
    // Trusted editing input permanently pins one off-screen canvas.
    await page.evaluate(()=>{document.querySelector('#iframe-7').parentNode.parentNode.style.position='fixed';document.querySelector('#iframe-7').parentNode.parentNode.style.top='0';});
    await page.locator('#iframe-7').contentFrame().locator('#canvas').click({position:{x:10,y:10}});
    await page.evaluate(()=>{document.querySelector('#iframe-7').parentNode.parentNode.style.position='';document.querySelector('#iframe-7').parentNode.parentNode.style.top='';});
    await page.waitForFunction(()=>document.getElementById('iframe-7')._bnPreviewPinned===true);
    await page.evaluate(async()=>{window._bnExporting=true;await _bnPruneInactivePreviews();});
    assert.equal(await page.locator('iframe[src]').count(),7,'export keeps all live documents');
    await page.evaluate(async()=>{window._bnExporting=false;document.getElementById('iframe-6')._bnExportLease=true;await _bnPruneInactivePreviews();});
    assert.equal(await page.locator('iframe[src]').count(),5,'three cold + edited + lease');
    assert.equal(await page.evaluate(()=>!!document.getElementById('iframe-6').getAttribute('src')),true);
    assert.equal(await page.evaluate(()=>!!document.getElementById('iframe-7').getAttribute('src')),true);
    assert.equal(await page.evaluate(()=>document.getElementById('iframe-1').getAttribute('data-bn-src')!==null),true);
    console.log('PASS live inactive previews shrink 7 to 5 with three cold slots plus edited/export-pinned exceptions');
    await page.evaluate(()=>bnLazyActivate(document.getElementById('iframe-1')));
    await page.waitForFunction(()=>loads['1']===2&&document.getElementById('iframe-1').contentDocument.querySelector('.bn-prod-box'));
    await page.waitForTimeout(150);
    const restored=await page.evaluate(()=>{const box=document.getElementById('iframe-1').contentDocument.querySelector('.bn-prod-box');return [box.style.left,box.style.top,box.style.width,box.style.height];});
    assert.deepEqual(restored,[before.layout.left+'px',before.layout.top+'px',before.layout.width+'px',before.layout.height+'px']);
    console.log('PASS acknowledged parent layout restores exact product frame after untouched preview reload; edited document stays live');
    await page.evaluate(async()=>{window.originalSnapshot=_bnRequestPreviewSnapshot;window._bnRequestPreviewSnapshot=()=>Promise.resolve({complete:false,reason:'timeout'});delete document.getElementById('iframe-6')._bnExportLease;await _bnPruneInactivePreviews();});
    assert.equal(await page.locator('iframe[src]').count(),6,'failed snapshot cannot evict');
    await page.evaluate(async()=>{window._bnRequestPreviewSnapshot=async frame=>{frame._bnPreviewPinned=true;return {complete:true,safeToSuspend:true};};await _bnPruneInactivePreviews();});
    assert.equal(await page.locator('iframe[src]').count(),6,'pin arriving during acknowledgement cannot evict');
    assert.deepEqual(errors,[]);
    console.log('PASS timeout and interaction during snapshot fail closed without document loss');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
(async()=>{await protocolTests();await browserTests();console.log('Exposure preview lifecycle checks passed.');})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
