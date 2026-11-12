'use strict';

/* Real root-page smoke test. Run: node tools/test-slimming-workflow.js
 * Uses a fresh Chrome/Edge profile, a local server and an in-memory workbook.
 * No user profile is opened and collectOnly prevents downloads. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ExcelJS = require('../JS/vendor/exceljs-4.4.0.min.js');
const root = path.resolve(__dirname, '..');
const diagnosticFontFile = process.argv.find(arg=>arg.startsWith('--font-css='))?.slice('--font-css='.length);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const mime = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.ttf':'font/ttf',
  '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

function findBrowser() {
  const candidates = [process.env.BODA_TEST_BROWSER,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
  const browser = candidates.find(file => fs.existsSync(file));
  if (!browser) throw new Error('Chrome/Edge not found; set BODA_TEST_BROWSER.');
  return browser;
}
class CDP {
  constructor(socket) {
    this.socket = socket; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) return (this.handlers.get(message.method) || []).forEach(fn => fn(message.params));
      const call = this.pending.get(message.id); if (!call) return;
      this.pending.delete(message.id); clearTimeout(call.timer);
      if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result);
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true}); socket.addEventListener('error',reject,{once:true}); });
    return new CDP(socket);
  }
  on(name, handler) { if (!this.handlers.has(name)) this.handlers.set(name,[]); this.handlers.get(name).push(handler); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: '+method)); },30000);
      this.pending.set(id,{resolve,reject,timer}); this.socket.send(JSON.stringify({id,method,params}));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); for (const call of this.pending.values()) clearTimeout(call.timer); }
}
async function until(read, title, timeout = 30000) {
  const deadline = Date.now()+timeout;
  do { const value = await read(); if (value) return value; await delay(50); } while (Date.now()<deadline);
  throw new Error('Timed out waiting for '+title);
}
async function workbook() {
  const wb = new ExcelJS.Workbook(), sheet = wb.addWorksheet('Layout_Output');
  sheet.getCell('B1').value = '副區_A-1-1';
  sheet.getCell('B2').value = '促標'; sheet.getCell('C2').value = '測試';
  sheet.getCell('B3').value = '商品'; sheet.getCell('C3').value = 'product.png';
  sheet.getCell('B4').value = '品名'; sheet.getCell('C4').value = '商品';
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const initialReady = `document.readyState==='complete' && window.blocksLoadedForImport===true &&
  !window.importStateRestorePending && (!window.APP_LOADING || !APP_LOADING.active)`;
const dependencyState = `({excel:typeof window.ExcelJS,capture:typeof window.htmlToImage,
  zip:typeof window.JSZip,fonts:typeof window.BN_FONTS_EMBED_CSS,subset:typeof window.BodaExportFonts})`;
const expectedEmpty = {excel:'undefined',capture:'undefined',zip:'undefined',fonts:'undefined',subset:'undefined'};


async function run(origin) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(),'boda-workflow-test-'));
  let browser, browserCDP, page;
  const requests = [], errors = [], downloads = [];
  try {
    browser = spawn(findBrowser(),['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
      '--disable-background-networking','--disable-component-update','--window-size=1366,900',
      '--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'],
    {stdio:'ignore',windowsHide:true});
    let launchError; browser.on('error',error => { launchError=error; });
    const debug = await until(() => {
      if (launchError) throw launchError;
      if (browser.exitCode!==null) throw new Error('Chrome exited: '+browser.exitCode);
      const file = path.join(profile,'DevToolsActivePort');
      return fs.existsSync(file) && fs.readFileSync(file,'utf8').trim().split(/\r?\n/);
    },'Chrome debugger');
    browserCDP = await CDP.connect('ws://127.0.0.1:'+debug[0]+debug[1]);
    browserCDP.on('Browser.downloadWillBegin',event => downloads.push(event.url));
    await browserCDP.send('Browser.setDownloadBehavior',{behavior:'deny',eventsEnabled:true});
    const target = await browserCDP.send('Target.createTarget',{url:'about:blank'});
    const targets = await (await fetch('http://127.0.0.1:'+debug[0]+'/json/list')).json();
    page = await CDP.connect(targets.find(item => item.id===target.targetId).webSocketDebuggerUrl);
    page.on('Runtime.exceptionThrown',event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
    page.on('Runtime.consoleAPICalled',event => {
      const values=event.args.map(arg=>arg.value);
      if(values[0]==='WORKFLOW_STAGE')console.log(values.join(' '));
    });
    page.on('Debugger.paused',event=>{
      console.log('CAPTURE_STACK '+JSON.stringify(event.callFrames.slice(0,12).map(frame=>({name:frame.functionName,url:frame.url,location:frame.location}))));
      page.send('Debugger.resume').catch(()=>{});
    });
    page.on('Network.requestWillBeSent',event => requests.push(event.request.url));
    await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Network.enable');
    if(process.argv.includes('--font-fixture-only')){
      assert.ok(diagnosticFontFile,'--font-fixture-only requires --font-css=...');
      await page.send('Page.navigate',{url:origin+'/__workflow_font.html'});
      await until(()=>page.evaluate(`document.readyState==='complete' && typeof window.htmlToImage==='object'`),'standalone font fixture');
      const result=await page.evaluate(`(async()=>{
        const css=await(await fetch('/__workflow_font.css')).text(),style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
        const weights=[...new Set([...css.matchAll(/font-weight\\s*:\\s*(\\d+)/g)].map(match=>Number(match[1])))];
        const node=document.createElement('div');node.style.cssText='width:400px;height:80px;color:#123abc;font-family:"ShopeeNotoSans (content)";font-size:24px';node.textContent='瘦身測試商品優惠$123 ABC';document.body.appendChild(node);
        const results=[];
        for(const weight of weights){node.style.fontWeight=weight;await document.fonts.load(weight+' 24px "ShopeeNotoSans (content)"',node.textContent);await document.fonts.ready;
          const start=performance.now(),png=await htmlToImage.toPng(node,{width:400,height:80,pixelRatio:1,fontEmbedCSS:css});
          const img=new Image();img.src=png;await img.decode();const c=document.createElement('canvas');c.width=400;c.height=80;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const px=ctx.getImageData(0,0,400,80).data;let visible=0;for(let i=3;i<px.length;i+=4)if(px[i])visible++;
          results.push({weight,elapsedMs:Math.round(performance.now()-start),width:img.naturalWidth,height:img.naturalHeight,visible,png:png.startsWith('data:image/png;base64,')});
        }
        return {cssLength:css.length,results,loadedFaces:Array.from(document.fonts).filter(face=>face.status==='loaded').length};
      })()`);
      assert.ok(result.results.length>0 && result.loadedFaces>=result.results.length);
      for(const item of result.results)assert.ok(item.png&&item.width===400&&item.height===80&&item.visible>100);
      assert.deepEqual(errors,[]);assert.equal(downloads.length,0);
      console.log('PASS standalone actual-font subset PNG '+JSON.stringify(result));return;
    }
    await page.send('Page.navigate',{url:origin+'/index.html#upload'});
    await until(() => page.evaluate(initialReady),'empty upload page');
    assert.equal(await page.evaluate(`document.querySelector('#views > .view.active')?.id`),'view-upload');
    assert.deepEqual(await page.evaluate(dependencyState),expectedEmpty);
    assert.equal(requests.filter(url => /\/(?:exceljs-|html-to-image-|jszip-|fonts-embed\.js|export-font-loader\.js|export-fonts\/)/.test(url)).length,0);
    console.log('PASS actual empty root page does not request or initialize optional heavy dependencies');

    const parsed = await page.evaluate(`(async()=>{
      const bytes=await (await fetch('/__workflow_fixture.xlsx')).arrayBuffer();
      const raw=await parseImportXlsx(bytes,{filename:'workflow-fixture.xlsx'});
      window.__workflowRaw=raw;
      return {count:raw.length,id:rawColumnBlockId(raw[0]),entries:raw[0].entries.map(e=>({label:e.label,value:e.value}))};
    })()`);
    assert.equal(parsed.count,1); assert.equal(parsed.id,'subarea_A_1_1');
    assert.ok(parsed.entries.some(entry => entry.value==='product.png'));
    assert.equal(requests.filter(url => /\/exceljs-4\.4\.0\.min\.js/.test(url)).length,1);
    assert.deepEqual(await page.evaluate(dependencyState),{...expectedEmpty,excel:'object'});
    console.log('PASS first parseImportXlsx loads local ExcelJS once and parses a real Layout_Output XLSX');


    const before = await page.evaluate(`(async()=>{
      beginImportImageLayoutDocument(false); currentImportSource='file';
      const source=document.createElement('canvas'); source.width=120; source.height=100;
      const ctx=source.getContext('2d'); ctx.fillStyle='#f23a21';ctx.fillRect(0,0,60,100);
      ctx.fillStyle='#2477ee';ctx.fillRect(60,0,60,100);ctx.fillStyle='#f8df21';ctx.fillRect(35,20,50,40);
      const cropped=document.createElement('canvas');cropped.width=60;cropped.height=80;
      cropped.getContext('2d').drawImage(source,30,10,60,80,0,0,60,80);
      const data=BNCore.defaultData('subarea_A_1_1');
      Object.assign(data,{productImg:cropped.toDataURL(),promo:'測試',name:'商品',logoImg:''});
      const col={blockId:'subarea_A_1_1',header:'副區 A-1-1',band:1,data};
      currentImportColumns=[col]; showView('import',{skipLoading:true}); renderImportColumns(currentImportColumns);
      const img=document.querySelector('#imp-mount-0 .bn-imggroup[data-field-key="productImg"] img');
      if(!img) throw new Error('Product fixture did not render');
      await img.decode();
      Object.assign(img.dataset,{baseSrc:source.toDataURL(),outputRatio:'0.75',productOnlyRatio:'0.75',
        layoutSourceWidth:'120',layoutSourceHeight:'100',layoutOutputWidth:'60',layoutOutputHeight:'80',
        layoutOffsetX:'-30',layoutOffsetY:'-10'});
      rememberCanvasImageEditorState(col,'productImg',0,canvasImageEditorStateFrom(img,data.productImg,true));
      const key='imp-mount-0::productImg';
      BNImageLayout.setState({weights:{[key]:{0:1.25}},offsets:{[key]:{0:{x:13,y:-8}}}});
      saveImportState(); await getImportSaveQueue().flush();
      const saved=await importIdbGet();
      window.__workflowExpected={data:col.data,layout:currentImportImageLayout(),id:currentImportImageLayoutId};
      const compact={field:saved.columns[0].data.productImg,
        editor:saved.columns[0].data.__canvasImageEditorState['productImg::0'],
        weights:saved.imageZoomWeights,offsets:saved.imageOffsets,id:saved.imageLayoutId};
      localStorage.setItem('__workflowExpected',JSON.stringify(compact));
      localStorage.removeItem(IMPORT_STORAGE_KEY);
      return {columns:saved.columns.length,image:saved.columns[0].data.productImg.length,
        source:compact.editor.baseSrc.length,weight:compact.weights[key][0],offset:compact.offsets[key][0]};
    })()`);
    assert.equal(before.columns,1); assert.equal(before.weight,1.25); assert.deepEqual(before.offset,{x:13,y:-8});
    assert.ok(before.image>100 && before.source>100);
    await page.evaluate('window.__workflowBeforeReload=true');
    await page.send('Page.reload',{ignoreCache:true});
    await until(() => page.evaluate('!window.__workflowBeforeReload && '+initialReady+' && window.currentImportColumns?.length===1').catch(error => {
      if (/context|navigat/i.test(error.message)) return false; throw error;
    }),'IDB activity restore');
    const restored = await page.evaluate(`(async()=>{
      const expected=JSON.parse(localStorage.getItem('__workflowExpected'));
      const col=currentImportColumns[0],state=col.data.__canvasImageEditorState['productImg::0'];
      const data={field:col.data.productImg,editor:state,weights:currentImportImageLayout().weights,
        offsets:currentImportImageLayout().offsets,id:currentImportImageLayoutId};
      const modelMatches=JSON.stringify(data)===JSON.stringify(expected);
      showView('import',{skipLoading:true});renderImportColumns(currentImportColumns);
      const img=document.querySelector('#imp-mount-0 .bn-imggroup[data-field-key="productImg"] img'); await img.decode();
      return {modelMatches,cropWidth:img.naturalWidth,cropHeight:img.naturalHeight,
        baseMatches:img.dataset.baseSrc===expected.editor.baseSrc,outputRatio:img.dataset.outputRatio,
        transform:img.style.transform,dependencies:${dependencyState}};
    })()`);
    assert.equal(restored.modelMatches,true); assert.equal(restored.cropWidth,60); assert.equal(restored.cropHeight,80);
    assert.equal(restored.baseMatches,true); assert.equal(restored.outputRatio,'0.75');
    assert.deepEqual(restored.dependencies,expectedEmpty);
    assert.equal(requests.filter(url => /\/(?:fonts-embed\.js|export-font-loader\.js|export-fonts\/)/.test(url)).length,0);
    console.log('PASS cropped output, original source, editor metadata, zoom and position survive actual IDB-only reload');

    const dependencyRequestsBefore = requests.length;
    const useLegacyFonts=process.argv.includes('--diagnose');
    const fontDependency=useLegacyFonts?'exportFonts':'fontSubset';
    const loaded = await page.evaluate(`(async()=>{
      await requireBodaDependencies(['capture','${fontDependency}','zip']);
      await requireBodaDependencies(['capture','${fontDependency}','zip']);
      return {capture:typeof htmlToImage.toPng,zip:typeof JSZip,
        engine:typeof window.BodaExportFonts?.forNode,legacy:typeof window.BN_FONTS_EMBED_CSS};
    })()`);
    assert.deepEqual(loaded,{capture:'function',zip:'function',engine:useLegacyFonts?'undefined':'function',legacy:useLegacyFonts?'string':'undefined'});
    const optionalRequests = requests.slice(dependencyRequestsBefore);
    for (const pattern of [/html-to-image-1\.11\.13\.min\.js/,useLegacyFonts?/fonts-embed\.js/:/export-font-loader\.js/,/jszip-3\.10\.1\.min\.js/]) {
      assert.equal(optionalRequests.filter(url => pattern.test(url)).length,1);
    }
    console.log('PASS first export use loads capture/font engine/zip once');
    if(process.argv.includes('--skip-capture')){assert.deepEqual(errors,[]);console.log('SKIP PNG capture by explicit test option');return;}

    if(process.argv.includes('--diagnose')){
      if(diagnosticFontFile)await page.evaluate(`(async()=>{window.__workflowDiagnosticFontCss=await(await fetch('/__workflow_font.css')).text();})()`);
      await page.evaluate(`(()=>{const node=document.createElement('div');node.id='workflow-simple';node.style.cssText='width:160px;height:80px;background:#f4df32;color:#222;font-family:"ShopeeNotoSans (content)";font-weight:400';node.textContent='測試';const img=new Image();img.width=30;img.height=40;img.src=currentImportColumns[0].data.productImg;node.appendChild(img);document.body.appendChild(node);})()`);
      if(process.argv.includes('--blob-svg')||process.argv.includes('--base64-svg')){
        const mode=process.argv.includes('--base64-svg')?'base64':'blob';
        console.log('DIAGNOSE actual-font SVG '+mode+' PNG:start');
        const result=await page.evaluate(`(async()=>{
          const start=performance.now(),svg=await htmlToImage.toSvg(document.getElementById('workflow-simple'),{width:160,height:80,fontEmbedCSS:window.__workflowDiagnosticFontCss||BN_FONTS_EMBED_CSS});
          const blob=new Blob([decodeURIComponent(svg.slice(svg.indexOf(',')+1))],{type:'image/svg+xml;charset=utf-8'});
          const url=${mode==='blob'?'URL.createObjectURL(blob)':"await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);})"};
          try{const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;setTimeout(()=>reject(new Error('native image decode >10 seconds')),10000);});
            const canvas=document.createElement('canvas');canvas.width=160;canvas.height=80;canvas.getContext('2d').drawImage(img,0,0);const png=canvas.toDataURL();return {elapsedMs:Math.round(performance.now()-start),length:png.length};
          }finally{if(url.startsWith('blob:'))URL.revokeObjectURL(url);}
        })()`);
        console.log('DIAGNOSE actual-font SVG '+mode+' PNG:done '+JSON.stringify(result));return;
      }
      const cases=[{kind:'empty-font PNG',svg:false,fonts:false},{kind:'actual-font SVG',svg:true,fonts:true},
        {kind:'weight-400 PNG',svg:false,fonts:true,weight:400}];
      if(!process.argv.includes('--single-weight'))cases.push({kind:'actual-font PNG',svg:false,fonts:true});
      for(const item of cases){
        console.log('DIAGNOSE '+item.kind+':start');
        const fontSource='(window.__workflowDiagnosticFontCss||BN_FONTS_EMBED_CSS)';
        const css=item.weight?`${fontSource}.match(/@font-face\\s*\\{[^}]*\\}/g).filter(rule=>/font-weight\\s*:\\s*400/.test(rule)).join('\\n')`:(item.fonts?fontSource:"''");
        const result=await page.evaluate(`(async()=>{const start=performance.now();const css=${css};const url=await htmlToImage.${item.svg?'toSvg':'toPng'}(document.getElementById('workflow-simple'),{width:160,height:80,pixelRatio:1,fontEmbedCSS:css});return {elapsedMs:Math.round(performance.now()-start),length:url.length,cssLength:css.length};})()`);
        console.log('DIAGNOSE '+item.kind+':done '+JSON.stringify(result));
      }
      return;
    }

    const glyphRequestsBefore=requests.length;
    const glyphs=await page.evaluate(`(async()=>{
      const node=document.createElement('div');node.style.cssText='position:fixed;left:0;top:0;width:400px;height:240px;color:#123abc;font-family:"ShopeeNotoSans (content)";font-size:24px';
      for(const weight of [400,500,700]){const row=document.createElement('div');row.style.cssText='height:80px;font-weight:'+weight;row.textContent='瘦身測試商品優惠$123 ABC';node.appendChild(row);}document.body.appendChild(node);
      try{const start=performance.now(),css=await BodaExportFonts.forNode(node);
        const weights=[400,500,700].map(w=>new RegExp('font-weight\\s*:\\s*'+w+'(?:\\s*[;}]|$)').test(css));
        const cacheMatches=css===await BodaExportFonts.forNode(node);
        const png=await htmlToImage.toPng(node,{width:400,height:240,pixelRatio:1,fontEmbedCSS:css,style:{position:'relative',left:'0',top:'0'}}),img=new Image();img.src=png;await img.decode();
        const c=document.createElement('canvas');c.width=400;c.height=240;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,400,240).data,visible=[0,0,0];
        for(let y=0;y<240;y++)for(let x=0;x<400;x++)if(pixels[(y*400+x)*4+3])visible[Math.floor(y/80)]++;
        return {cssLength:css.length,weights,cacheMatches,visible,elapsedMs:Math.round(performance.now()-start),png:png.startsWith('data:image/png;base64,')};
      }finally{node.remove();}
    })()`);
    assert.deepEqual(glyphs.weights,[true,true,true]);assert.equal(glyphs.cacheMatches,true);assert.equal(glyphs.png,true);
    assert.ok(glyphs.cssLength>100 && glyphs.cssLength<5000000);assert.ok(glyphs.visible.every(count=>count>100),JSON.stringify(glyphs));
    const glyphRequests=requests.slice(glyphRequestsBefore).filter(url=>/\/export-fonts\//.test(url));
    assert.ok(glyphRequests.length>1);assert.equal(new Set(glyphRequests).size,glyphRequests.length);
    assert.equal(glyphRequests.filter(url=>/manifest\./.test(url)).length,1);
    console.log('PASS real 400/500/700 Chinese glyph PNG uses only needed font chunks with cache reuse '+JSON.stringify(glyphs));

    await page.send('Page.bringToFront');
    await page.evaluate(`(()=>{
      window.__workflowStages=[];
      for(const name of ['waitForImportExportRender','exportImportPlacementImages']){
        const original=window[name];window[name]=function(){__workflowStages.push(name+':start');console.log('WORKFLOW_STAGE',name+':start');return original.apply(this,arguments).then(v=>{__workflowStages.push(name+':done');console.log('WORKFLOW_STAGE',name+':done');return v;});};
      }
      const original=htmlToImage.toPng;htmlToImage.toPng=function(){__workflowStages.push('toPng:start');console.log('WORKFLOW_STAGE','toPng:start');return original.apply(this,arguments).then(v=>{__workflowStages.push('toPng:done');console.log('WORKFLOW_STAGE','toPng:done');return v;});};
    })()`);
    const monitor=setInterval(()=>page.evaluate(`({stages:window.__workflowStages,visibility:document.visibilityState})`).then(value=>console.log('CAPTURE '+JSON.stringify(value))).catch(()=>{}),15000);
    const diagnose=setTimeout(()=>page.send('Debugger.enable').then(()=>page.send('Debugger.pause')).catch(()=>{}),10000);
    let captured;
    try { captured = await page.evaluate(`(async()=>{
      const defaultResult=await downloadImportImage({collectOnly:true,includeBottom:false,includeComposite:false});
      const result=await downloadImportImage({collectOnly:true,includeBottom:false,includeComposite:true});
      const samples=[];
      for(const file of result.files){
        const img=new Image();img.src=file.dataUrl;await img.decode();
        const c=document.createElement('canvas');c.width=40;c.height=35;
        const ctx=c.getContext('2d');ctx.drawImage(img,0,0,c.width,c.height);
        const pixels=ctx.getImageData(0,0,c.width,c.height).data,colors=new Set();let opaque=0;
        for(let i=0;i<pixels.length;i+=4){if(pixels[i+3])opaque++;colors.add([pixels[i],pixels[i+1],pixels[i+2],pixels[i+3]].join(','));}
        samples.push({name:file.filename,width:img.naturalWidth,height:img.naturalHeight,opaque,colors:colors.size,png:file.dataUrl.startsWith('data:image/png;base64,')});
      }
      return {samples,defaultNames:defaultResult.files.map(file=>file.filename),failures:defaultResult.failures.concat(result.failures),restored:!window.importExportCapturing && !document.getElementById('imp-strip').classList.contains('bn-export-capture')};
    })()`); } finally { clearInterval(monitor); clearTimeout(diagnose); }
    assert.equal(captured.failures.length,0); assert.ok(captured.samples.length>=2);
    assert.equal(captured.defaultNames.length,1);assert.ok(!captured.defaultNames.includes('版位成品.png'));
    for (const sample of captured.samples) assert.ok(sample.png && sample.width>0 && sample.height>0 && sample.opaque>0 && sample.colors>3,JSON.stringify(sample));
    assert.equal(captured.restored,true); assert.equal(downloads.length,0);
    assert.deepEqual(errors,[]);
    assert.equal(requests.filter(url=>/\/fonts-embed\.js/.test(url)).length,0);
    const chunks=requests.filter(url=>/\/export-fonts\//.test(url));assert.equal(new Set(chunks).size,chunks.length);
    console.log('PASS actual placement and composite PNGs are nonblank; collectOnly causes zero downloads and restores capture UI');
    console.log(JSON.stringify({parsed,before,restored:{...restored,transform:restored.transform},glyphs,capture:captured.samples,fontChunkRequests:chunks.length,runtimeErrors:errors.length,downloads:downloads.length},null,2));
  } finally {
    if(browserCDP){try{await browserCDP.send('Browser.close');}catch(_) {}}
    if(page)page.close();if(browserCDP)browserCDP.close();
    if(browser && browser.exitCode===null){await Promise.race([new Promise(resolve=>browser.once('exit',resolve)),delay(3000)]);if(browser.exitCode===null)browser.kill();}
    const resolved=path.resolve(profile),temp=path.resolve(os.tmpdir())+path.sep;
    if(!resolved.startsWith(temp)||!path.basename(resolved).startsWith('boda-workflow-test-'))throw new Error('Unsafe profile cleanup path');
    fs.rmSync(resolved,{recursive:true,force:true,maxRetries:8,retryDelay:250});
  }
}
async function main() {
  const bytes=await workbook();
  const server=http.createServer((req,res)=>{
    const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    if(relative==='__workflow_fixture.xlsx'){res.writeHead(200,{'Content-Type':mime['.xlsx']});res.end(bytes);return;}
    if(relative==='__workflow_font.html'){res.writeHead(200,{'Content-Type':mime['.html']});res.end('<!doctype html><html><head><meta charset="utf-8"><script src="/JS/vendor/html-to-image-1.11.13.min.js"></script></head><body></body></html>');return;}
    if(relative==='__workflow_font.css' && diagnosticFontFile){res.writeHead(200,{'Content-Type':mime['.css']});res.end(fs.readFileSync(diagnosticFontFile));return;}
    const file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run('http://127.0.0.1:'+server.address().port);}finally{await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
