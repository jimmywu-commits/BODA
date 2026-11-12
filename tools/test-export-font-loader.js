'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../JS/export-font-loader.js'), 'utf8');
const FAMILY = 'ShopeeNotoSans (content)';
function element(text, weight = '400', attributes = {}) {
  const result = {nodeType:1,tagName:'SPAN',style:{fontFamily:FAMILY,fontWeight:weight,display:'block',visibility:'visible'},childNodes:[],...attributes};
  if (text) result.childNodes.push({nodeType:3,nodeValue:text,parentElement:result});
  return result;
}
function fixture({failOnce, timeoutOnce, url = 'https://boda.test/JS/export-font-loader.js'} = {}) {
  const requests = [], attempts = {}, callbacks = {}, chunks = {}, pages = {};
  let inflight = 0, peak = 0;
  const manifest = {family:FAMILY,version:'test',chunkSize:256,weights:{}};
  for (const weight of [400,500,700]) {
    const common = {id:`${weight}-base`,file:`${weight}-base.js`,ranges:[[32,126]]};
    const weightPages = {};
    for (let first = 0x4e00; first < 0x4e00+12*256; first += 256) {
      const key = 'u'+first.toString(16), id = `${weight}-${key}`;
      weightPages[key] = {id,file:id+'.js',ranges:[[first,first+255]]};
      chunks[id+'.js'] = () => context.BodaExportFonts.registerChunk(id,`face:${id}`);
    }
    chunks[common.file] = () => context.BodaExportFonts.registerChunk(common.id,`face:${common.id}`);
    manifest.weights[weight] = {common,pages:weightPages};
  }
  const context = {Promise,URL,Set,WeakMap,Array,Object,String,Math,Number,Error,parseFloat,isFinite,setTimeout,clearTimeout,
    BODA_EXPORT_FONT_TIMEOUT_MS:30};
  const head = {appendChild(script) {
    script.parentNode = head; requests.push(script.src);
    const name = new URL(script.src).pathname.split('/').pop();
    attempts[name] = (attempts[name]||0)+1;
    inflight++;peak=Math.max(peak,inflight);
    const complete = () => {
      inflight--;
      if (!script.onload) return;
      if (name===failOnce&&attempts[name]===1) {script.onerror();return}
      if (name==='manifest.js') context.BodaExportFonts.registerManifest(manifest);
      else chunks[name]();
      script.onload();
    };
    if (name===timeoutOnce&&attempts[name]===1) setTimeout(complete,100);
    else setTimeout(complete,2);
  },removeChild(script){script.parentNode=null}};
  context.getComputedStyle = (el,pseudo) => pseudo ? el.pseudo?.[pseudo] || {...el.style,content:'none'} : el.style;
  context.document = {currentScript:{src:url},baseURI:url,head,createElement(){return{}},defaultView:context};
  context.window = context;vm.createContext(context);vm.runInContext(source,context);
  return {context,requests,attempts,manifest,get peak(){return peak}};
}
async function main() {
  const h = fixture();
  assert.equal(h.requests.length,0,'loading the module must not load any font assets');
  assert.equal(await h.context.BodaExportFonts.forNode(element('system text','400',{style:{fontFamily:'Arial',fontWeight:'400'}})), '');
  assert.equal(h.requests.length,0,'other font families need no manifest');
  const root = element('ABC');root.childNodes.push(element('中','500'));
  root.childNodes[1].parentElement=root;
  const [a,b] = await Promise.all([h.context.BodaExportFonts.forNode(root),h.context.BodaExportFonts.forNode(root)]);
  assert.equal(a,b);assert.match(a,/400-base/);assert.match(a,/500-u4e00/);
  assert.equal(h.requests.length,3,'same in-flight requests share one manifest and each selected chunk');
  await h.context.BodaExportFonts.forNode(root);assert.equal(h.requests.length,3,'cached requests never reload scripts');
  for (const weight of ['450','501','550','600','800']) {
    const css = await h.context.BodaExportFonts.forNode(element('ABC',weight));
    assert.equal(css,`face:${weight==='450'?500:700}-base`,'CSS font fallback must preserve preview weight '+weight);
  }
  console.log('PASS startup stays empty, computed weights follow CSS matching, glyph chunks and in-flight/completed requests deduplicate');

  const all = element(Array.from({length:12},(_,i)=>String.fromCodePoint(0x4e00+i*256)).join(''));
  await h.context.BodaExportFonts.forNode(all);
  assert.ok(h.peak<=6,'font script loads must stay bounded to six in flight');
  const hidden = element('中','700',{style:{fontFamily:FAMILY,fontWeight:'700',display:'none',visibility:'visible'}});
  const before = h.requests.length;await h.context.BodaExportFonts.forNode(hidden);assert.equal(h.requests.length,before);
  const pseudo = element('');pseudo.pseudo={'::before':{...pseudo.style,content:'"中"'}};
  assert.match(await h.context.BodaExportFonts.forNode(pseudo),/400-u4e00/);
  const input = element('','500',{tagName:'INPUT',value:'A'});
  assert.equal(await h.context.BodaExportFonts.forNode(input),'face:500-base');
  const missing = element('😀');assert.equal(await h.context.BodaExportFonts.forNode(missing),'','characters absent from the original font keep browser fallback');
  console.log('PASS bounded concurrency, hidden content, pseudo-element text, form values and original-font fallback');

  const error = fixture({failOnce:'400-base.js'});
  await assert.rejects(error.context.BodaExportFonts.forNode(element('A')),/unavailable/);
  assert.equal(await error.context.BodaExportFonts.forNode(element('A')),'face:400-base');
  assert.equal(error.attempts['400-base.js'],2,'failed font scripts must be retryable');
  const timeout = fixture({timeoutOnce:'400-base.js'});
  await assert.rejects(timeout.context.BodaExportFonts.forNode(element('A')),/timed out/);
  assert.equal(await timeout.context.BodaExportFonts.forNode(element('A')),'face:400-base');
  const local = fixture({url:'file:///E:/GitHub/BODA/JS/export-font-loader.js'});
  await local.context.BodaExportFonts.forNode(element('ABC'));
  assert.ok(local.requests.every(url=>url.startsWith('file:///E:/GitHub/BODA/JS/export-fonts/')),'file:// uses local scripts, with no binary fetch');
  console.log('PASS error/timeout retry and file:// asset loading');
  console.log('Export font loader regression checks passed.');
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1});
