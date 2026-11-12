'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('/* Cache metadata trees, sharing immutable image strings.');
const end = html.indexOf('/* 「直接預覽全部版位」的右側工具列', start);
assert.ok(start >= 0 && end > start, 'Missing activity render reuse implementation');
const implementation = html.slice(start, end);
new vm.Script(implementation);

async function main() {
  let playwright;
  try { playwright = require('playwright'); }
  catch (_) { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
  const executablePath = process.env.BODA_TEST_BROWSER || [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium'
  ].filter(Boolean).find(file => fs.existsSync(file));
  const browser = await playwright.chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><div id="import-canvas-tools"></div><div id="import-fields-scroll"></div><div id="import-block-tools"></div><div id="import-preview-list"></div><div id="import-empty2"></div>');
    await page.addScriptTag({ content: `
      window.calls={render:0,bind:0,tools:0,colors:0,save:0,click:0,bottom:0};
      window.defs={one:{width:120,height:80},two:{width:120,height:80}};
      window.columns=[{blockId:'one',band:1,header:'first',file:'one.html',_manualText:{title:true},data:{title:'first',image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z+WQAAAAASUVORK5CYII=',editor:{crop:'saved-crop',transform:'rotate(23deg)',left:'37px'}}},{blockId:'two',band:1,header:'second',data:{title:'second',editor:{crop:'second-crop',transform:'scale(1.7)',left:'81px'}}}];
      window.currentImportColumns=[];window.IMPORT_SYNC={activeIndex:-1,lockedIndex:-1};
      window.importZoom=1;window.importMidBannerAvailable=false;window.importMidBannerRatio=0.2;
      window.importBottomPreviewResult=null;window.latestBottomWorkOrder=null;window.bottomEnabled=false;window.bottomPreviewBridgeReady=false;window.hidden={};window.theme='#fff';
      window.BNCore={getBlock:id=>defs[id],renderInstance(id,data,opts){calls.render++;return '<article><img alt="product" src="'+(data.image||'')+'"><span>'+data.title+'</span></article>';}};
      function prepareImportSelectionContext(){} function importColLockIsActive(){return false} function clearImportColLockState(){}
      function normalizeLocalCircleDefaults(){} function normalizeLogoImageFields(){} function queueImportStateSave(){calls.save++}
      function showImportToolbar(){} function renderedBlockSizeOf(def,col){return {width:def?def.width:120,height:col.data.height||(def?def.height:80)}}
      function importLevelHiddenIndexes(){return hidden} function importLevelHasBottom(){return true} function importHasBottomSource(){return bottomEnabled}
      function importMidBannerSrc(){return 'banner.png'} function applyImportStripBg(){} function lineIcon(){return ''} function esc(v){return v}
      function buildImportColumnTools(col,idx,mode,opts){calls.tools++;var el=document.createElement('div');el.className='import-block-tool';el.dataset.col=idx;opts.actionRail.appendChild(el)}
      function importRenderOpts(){return {editable:true,theme:{canvasBg:theme},nested:{order:[1,2]}}}
      function bindCanvasInteractions(mount,col){calls.bind++;var img=mount.querySelector('img'),editor=col.data.editor||{};img.dataset.crop=editor.crop||'';img.style.transform=editor.transform||'';img.style.left=editor.left||'';img.addEventListener('click',function(){calls.click++})}
      function renderImportColorPanel(){calls.colors++} function markActiveImportCol(){}
      function createImportBottomFinalFrame(top,width,height,url){var el=document.createElement('div');el.className='bottom-result';el.dataset.src=url;return el}
      function bindImportBottomOpenEditor(){} function ensureBottomPreviewLoaded(){calls.bottom++} function sendLatestWorkOrderToBottomPreview(){} function dispatchBottomPreviewForExport(){}
    ` });
    await page.addScriptTag({ content: implementation });
    await page.evaluate(() => {
      renderImportColumns(columns);
      window.firstRoot=document.getElementById('imp-mount-0').firstElementChild;
      window.firstImage=firstRoot.querySelector('img');
      firstImage.dataset.crop='live-edited-crop';firstImage.style.transform='rotate(41deg) scale(1.8)';firstImage.click();
      renderImportColumns(columns,true);firstImage.click();
    });
    assert.deepEqual(await page.evaluate(() => ({same:firstRoot===document.getElementById('imp-mount-0').firstElementChild,render:calls.render,bind:calls.bind,tools:calls.tools,colors:calls.colors,crop:firstImage.dataset.crop,transform:firstImage.style.transform,click:calls.click,src:firstImage.getAttribute('src')===columns[0].data.image})),
      {same:true,render:2,bind:2,tools:4,colors:2,crop:'live-edited-crop',transform:'rotate(41deg) scale(1.8)',click:2,src:true});
    await page.evaluate(() => {columns[1].data.title='changed second';renderImportColumns(columns,true)});
    assert.deepEqual(await page.evaluate(() => ({render:calls.render,bind:calls.bind,same:firstRoot===document.getElementById('imp-mount-0').firstElementChild,title:document.querySelector('#imp-mount-1 span').textContent})), {render:3,bind:3,same:true,title:'changed second'});
    console.log('PASS unchanged activity canvases preserve image identity, live crop/transform and events; only a changed column renders, all tools/colors still update');

    const expectRenderDelta = async (mutation, expected, message) => {
      const before = await page.evaluate(() => calls.render);
      await page.evaluate(mutation);
      await page.evaluate(() => renderImportColumns(columns,true));
      assert.equal((await page.evaluate(() => calls.render))-before,expected,message);
    };
    await expectRenderDelta(() => {columns[1].data.editor.crop='new-crop'},1,'nested editor metadata must invalidate its own column');
    await expectRenderDelta(() => {columns[1].data.image=columns[0].data.image},1,'a changed image source must invalidate its own column');
    await expectRenderDelta(() => {columns[1]._manualText={title:true}},1,'manual text rules must invalidate their column');
    await expectRenderDelta(() => {columns[1].header='new heading'},1,'header changes must invalidate');
    await expectRenderDelta(() => {columns[1].file='replacement.html'},1,'file changes must invalidate');
    await expectRenderDelta(() => {columns[1].sourceKey='new-source-rule'},1,'other binding metadata must invalidate too');
    await expectRenderDelta(() => {columns[1]={...columns[1]}},1,'a replaced column must rebind closures to its new object');
    await expectRenderDelta(() => {defs.two={...defs.two}},1,'a replaced definition must invalidate');
    await expectRenderDelta(() => {document.getElementById('imp-mount-1').innerHTML='<article>external replacement</article>'},1,'external DOM replacement must invalidate');
    await expectRenderDelta(() => {theme='#123456'},2,'complete render option changes must invalidate both canvases');
    assert.equal(await page.evaluate(() => document.querySelector('#imp-mount-1 img').dataset.crop),'new-crop');
    assert.equal(await page.evaluate(() => document.querySelector('#imp-mount-1 img').style.transform),'scale(1.7)');
    console.log('PASS nested data, image source, manual text, all column metadata, object/definition identity, external DOM replacement and options invalidate safely');

    await expectRenderDelta(() => {columns[1].data.height=100},2,'stage height changes require a full strip rebuild');
    await expectRenderDelta(() => {columns[1].band=2},2,'band changes require a full rebuild');
    await expectRenderDelta(() => {columns.reverse()},2,'visible order changes require a full rebuild');
    await expectRenderDelta(() => {hidden={1:true}},1,'visibility changes rebuild all remaining visible columns');
    await expectRenderDelta(() => {hidden={};bottomEnabled=true},2,'adding the bottom region requires a full rebuild');
    await expectRenderDelta(() => {importBottomPreviewResult={width:1200,height:150,dataUrl:'data:image/png;base64,BOTTOM_A'}},2,'a new bottom result must update the strip');
    await expectRenderDelta(() => {importBottomPreviewResult.dataUrl='data:image/png;base64,BOTTOM_B'},2,'changing bottom pixels must invalidate the structure');
    assert.equal(await page.evaluate(() => document.querySelector('.bottom-result').dataset.src),'data:image/png;base64,BOTTOM_B');
    console.log('PASS dimensions, bands, visible order, level visibility and bottom pixels use the full rebuild fallback');

    assert.equal(await page.evaluate(() => {const s='data:image/png;base64,'+'A'.repeat(5000000);const original={image:s,geometry:{x:2}};const copy=importRenderReuseSnapshot(original);original.geometry.x=9;return copy.image===s&&copy.geometry.x===2&&!importRenderReuseEqual(new Array(2),[])}),true);
    assert.doesNotMatch(implementation,/JSON\.stringify/,'reuse detection must not serialize large image strings');
    assert.deepEqual(errors,[]);
    console.log('Activity render reuse regression checks passed.');
  } finally {await browser.close()}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1});
