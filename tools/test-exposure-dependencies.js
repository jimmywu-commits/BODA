'use strict';
// Actual pinned dependencies and production consumer functions in real Chrome.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const http=require('node:http');
const os=require('node:os');
const root=path.resolve(__dirname,'..'),exposure=path.join(root,'shopee');
const state=fs.readFileSync(path.join(exposure,'js/bn-state-plugin.js'),'utf8');
const workorder=fs.readFileSync(path.join(exposure,'js/bn-workorder-upload-plugin.js'),'utf8');
function actual(source,name){
  const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);
  for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){
    const text=source.slice(start,end+1);try{new vm.Script('('+text+')');return text;}catch(_){}
  }throw Error('Missing function '+name);
}
const script=text=>'<script>'+text.replace(/<\/script/gi,'<\\/script')+'</script>';
const fixture='<!doctype html><meta charset="utf-8"><script src="/js/vendor/browser-loader.js?v=exposure-test"></script>'+
  '<script src="/js/logo-editor-plugin.js"></script><span id="bn-workorder-status"></span><input id="bn-workorder-file"><div id="picker" style="display:none"></div>'+script(`
    var global=window;window.messages=[];window._bnStatePlugin={toast:message=>messages.push(message)};
    var showToast=window._bnStatePlugin.toast;
    function ensureExcelPicker(){return document.getElementById('picker');}
    function bridgeInputs(){} window.banwordEngine={};
    ${actual(state,'ensureXLSX')};window.stateEnsure=ensureXLSX;
    window.actualBanwords=${actual(state,'loadBanwordsExcel')};
    window.workEnsure=${actual(workorder,'ensureXLSX')};
    var ensureXLSX=window.workEnsure;
    var STATUS_ID='bn-workorder-status',INPUT_ID='bn-workorder-file';
    ${actual(workorder,'$')};${actual(workorder,'toast')};${actual(workorder,'setStatus')};
    window.actualWorkorder=${actual(workorder,'handleFile')};
  `);

async function main(){
  for(const file of ['browser-loader.js','xlsx-0.18.5.full.min.js','xlsx-LICENSE.txt','cropper-1.6.2.min.js','cropper-1.6.2.min.css','cropper-LICENSE.txt']){
    const original=fs.readFileSync(path.join(root,'JS/vendor',file)),copy=fs.readFileSync(path.join(exposure,'js/vendor',file));
    assert.ok(original.equals(copy),'Independent exposure asset matches verified original: '+file);
    if(/\.(js|css)$/.test(file))console.log('HASH '+file+' '+crypto.createHash('sha256').update(copy).digest('hex'));
  }
  for(const source of [state,workorder,fs.readFileSync(path.join(exposure,'js/logo-editor-plugin.js'),'utf8')])
    assert.doesNotMatch(source,/https:\/\/(?:cdn\.jsdelivr|cdnjs).*?(?:xlsx|cropper)/,'consumers use the shared local-first loader');
  assert.match(fs.readFileSync(path.join(exposure,'index.html'),'utf8'),/<script src="js\/vendor\/browser-loader\.js\?v=/);
  assert.doesNotMatch(fs.readFileSync(path.join(exposure,'floating.html'),'utf8'),/<script[^>]+https:.*xlsx/);
  let playwright;try{playwright=require('playwright');}catch(_){playwright=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
  const executablePath=process.env.BODA_TEST_BROWSER||[
    process.env.PROGRAMFILES&&path.join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)']&&path.join(process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome','/usr/bin/chromium'
  ].filter(Boolean).find(file=>fs.existsSync(file));
  const server=http.createServer((request,response)=>{
    const pathname=new URL(request.url,'http://localhost').pathname;
    if(pathname==='/fixture'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fixture);return;}
    const file=path.resolve(exposure,'.'+decodeURIComponent(pathname));
    if(!file.startsWith(exposure+path.sep)){response.writeHead(403).end();return;}
    fs.readFile(file,(error,data)=>{if(error){response.writeHead(404).end();return;}
      response.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'application/octet-stream');response.end(data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    browser=await playwright.chromium.launch({executablePath,headless:true});
    const page=await browser.newPage();const urls=[],errors=[];
    page.on('request',request=>urls.push(request.url()));page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    await page.goto(origin+'/fixture');
    assert.equal(urls.filter(url=>/xlsx-|cropper-/.test(url)).length,0,'optional files are first-use only');
    const parsed=await page.evaluate(async()=>{
      const [a,b]=await Promise.all([stateEnsure(),workEnsure(),stateEnsure(),workEnsure()]);
      if(a!==b)throw Error('Different XLSX globals');
      const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['版位','文字'],['HBN','優惠測試']]),'工單總覽');
      return XLSX.utils.sheet_to_json(XLSX.read(XLSX.write(book,{type:'array',bookType:'xlsx'}),{type:'array'}).Sheets['工單總覽'],{header:1});
    });
    assert.deepEqual(parsed,[['版位','文字'],['HBN','優惠測試']]);
    const picture='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="red"/></svg>');
    await page.evaluate(src=>BNLogoMenu.openCropEditor(src,()=>{}),picture);
    await page.waitForSelector('#logoCropModal.open .cropper-container');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.cropper-container')).position),'relative','actual local cropper stylesheet is applied');
    for(const name of ['xlsx-0.18.5.full.min.js','cropper-1.6.2.min.js','cropper-1.6.2.min.css'])
      assert.equal(urls.filter(url=>new URL(url).pathname==='/js/vendor/'+name).length,1,'one shared request for '+name);
    assert.ok(urls.every(url=>url.startsWith(origin)),'successful local load never invokes a CDN or BODA parent');
    assert.deepEqual(errors,[]);await page.close();
    console.log('PASS independent exposure loads SheetJS/Cropper JS+CSS locally on first use; concurrent state/workorder parser shares one actual XLSX round-trip');

    const failed=await browser.newPage();const failureUrls=[];let blockSheet=true;
    await failed.route('**/*',route=>{
      const url=route.request().url();failureUrls.push(url);
      if(!url.startsWith(origin)||url.includes('/cropper-')||(blockSheet&&url.includes('/xlsx-')))return route.abort();
      return route.continue();
    });
    await failed.goto(origin+'/fixture');
    await failed.evaluate(()=>{actualBanwords();actualWorkorder({arrayBuffer(){throw Error('must not read a file without XLSX');}});});
    await failed.waitForFunction(()=>messages.some(message=>message.includes('禁用語規則未能載入'))&&document.getElementById('bn-workorder-status').classList.contains('err'));
    assert.equal(await failed.locator('#picker').evaluate(el=>el.style.display),'block');
    assert.match(await failed.locator('#bn-workorder-status').textContent(),/無法載入 sheet/);
    await failed.evaluate(src=>BNLogoMenu.openCropEditor(src,()=>{}),picture);
    await failed.waitForFunction(()=>messages.some(message=>message.includes('無法開啟裁切工具')));
    assert.equal(await failed.locator('#logoCropModal.open').count(),0,'failed cropper cannot open an unusable editor');
    assert.ok(failureUrls.some(url=>url==='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'));
    assert.ok(failureUrls.filter(url=>!url.startsWith(origin)).every(url=>/xlsx@0\.18\.5|cropperjs@1\.6\.2/.test(url)),'fallback URLs must be pinned');
    blockSheet=false;
    assert.equal(await failed.evaluate(async()=>{const value=await workEnsure();return value.version;}),'0.18.5','retry after failed local+CDN load succeeds');
    await failed.close();
    console.log('PASS local+CDN failure visibly reports banword/workorder/crop errors; parser retry recovers; fallback is exact-version only');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
  console.log('Exposure dependency checks passed.');
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
