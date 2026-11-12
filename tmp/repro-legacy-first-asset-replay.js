'use strict';
// Read-only diagnostic: execute extracted asset bridge against a legacy edited object.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../shopee/js/bn-editor-plugin.js'),'utf8');
function part(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const messages=[];
const original={id:'wo_product_legacy_0',name:'圖片1.png',src:'data:image/png;base64,cropped-preview',baseSrc:'data:image/png;base64,cropped-base',ratio:.7,layouts:{one:{left:87,top:32,width:111,height:200}},meta:{rotate:25,groundShadow:{enabled:false}}};
const context={console,Map,Promise,window:{_bnProducts:[original],_bnLogos:[],_bnLogoLayouts:{}},
 loadImg:()=>Promise.resolve({naturalWidth:200,naturalHeight:100}),
 endorserWorkorderNeedsApply:()=>false,endorserWorkorderNoteNeedsApply:()=>false,endorserNoteState:()=>({}),
 defaultProductZOrder:i=>i,broadcast:m=>messages.push(m),broadcastZOrder(){},renderLogoList(){},renderProdList(){},markStateDirty(){},
 document:{getElementById:()=>null}};
vm.createContext(context);
vm.runInContext(part("    var _bnWorkorderAssetSignature = '';",'    /* 廣播 z-index 更新 */'),context);
vm.runInContext(part('    window._bnApplyWorkorderAssets = function(payload){','    window._bnRebroadcastProducts'),context);
(async()=>{
 const payload={replaceProducts:true,products:[{name:'圖片1.png',sourceId:'boda:圖片1',sourceRevision:'v1:original',src:'data:image/png;base64,original-shadow',baseSrc:'data:image/png;base64,original',originalSrc:'data:image/png;base64,original'}]};
 await context.window._bnApplyWorkorderAssets(payload);
 const actual=context.window._bnProducts[0];
 const result={retainedObject:actual===original,previousSrc:original.src,currentSrc:actual.src,previousLayouts:original.layouts,currentLayouts:actual.layouts||null,messages:messages.map(m=>m.type)};
 console.log(JSON.stringify(result,null,2));
 assert.equal(result.retainedObject,false,'This diagnostic expects to reproduce the current legacy first-replay replacement');
 assert.ok(result.messages.includes('bn-product-remove'));
})();
