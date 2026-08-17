(function(){
  'use strict';

  var DEFAULTS={
    targetSelector:'#cf2',
    hintId:'zoom-hint',
    minScale:0.2,
    maxScale:5,
    buttonStep:0.12,
    wheelStep:0.08,
    resetDelay:1800,
    noImageMessage:'請先上傳圖片',
    zoomInTitle:'放大商品圖',
    zoomOutTitle:'縮小商品圖'
  };
  var options=Object.assign({},DEFAULTS);
  var zoomLabelTimer=null;
  var wheelBound=false;
  var cssInjected=false;

  function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }

  function getState(){
    try{ if(typeof S!=='undefined') return S; }catch(e){}
    return null;
  }

  function hasImage(){
    var st=getState();
    return !!(st&&st.proc);
  }

  function getScale(){
    var st=getState();
    return st&&typeof st.imgScale==='number'?st.imgScale:1;
  }

  function setScale(v){
    var st=getState();
    if(st) st.imgScale=clamp(v,options.minScale,options.maxScale);
  }

  function commit(){
    try{ if(typeof push==='function') push(); }catch(e){}
  }

  function redraw(){
    try{ if(typeof draw==='function') draw(); }catch(e){}
  }

  function notify(msg,type){
    try{ if(typeof toast==='function') toast(msg,type||''); }catch(e){}
  }

  function iconSvg(){
    return '<svg width="28" height="38" viewBox="0 0 28 38" fill="none" aria-hidden="true">'+
      '<rect x="4" y="6" width="20" height="28" rx="10" stroke="currentColor" stroke-width="1.8" fill="none"/>'+
      '<rect class="wheel" x="11.5" y="10" width="5" height="9" rx="2.5" fill="currentColor" opacity=".7"/>'+
      '<polyline points="14,2 14,5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'+
      '<polyline points="11,4 14,1 17,4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'+
      '<polyline points="14,36 14,33" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'+
      '<polyline points="11,34 14,37 17,34" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'+
    '</svg>';
  }

  function actionsHtml(){
    return '<div class="zoom-actions" aria-label="商品圖縮放控制">'+
      '<button type="button" class="zoom-btn plus" data-product-zoom="in" title="'+options.zoomInTitle+'"><span>+</span></button>'+
      '<button type="button" class="zoom-btn minus" data-product-zoom="out" title="'+options.zoomOutTitle+'"><span>−</span></button>'+
    '</div>';
  }

  function defaultHtml(){ return iconSvg()+'<span>滾輪<br>縮放</span>'+actionsHtml(); }
  function levelHtml(){
    var pct=Math.round(getScale()*100);
    return iconSvg()+'<span style="font-size:11px;color:rgba(255,255,255,.8);font-weight:700">'+pct+'%</span>'+actionsHtml();
  }

  function injectCSS(){
    if(cssInjected||document.getElementById('product-zoom-plugin-style')) return;
    var style=document.createElement('style');
    style.id='product-zoom-plugin-style';
    style.textContent='\n'+
      '.zoom-hint{position:absolute;top:50%;right:-74px;left:auto;transform:translateY(-50%);background:rgba(13,16,24,.92);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:10px 8px;display:flex;flex-direction:column;align-items:center;gap:5px;color:rgba(255,255,255,.62);font-size:9px;text-align:center;line-height:1.3;pointer-events:auto;user-select:none;white-space:nowrap;z-index:8;animation:zoomHintPulse 1.8s ease-in-out infinite}\n'+
      '.zoom-actions{display:flex;flex-direction:column;align-items:center;gap:7px;margin-top:6px;padding-top:8px;border-top:1px solid rgba(255,255,255,.14);width:100%}\n'+
      '.zoom-btn{width:34px;height:34px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.06);color:#fff;font-size:24px;line-height:1;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;transition:.15s}\n'+
      '.zoom-btn:hover{border-color:var(--ac,#4a90e2);background:rgba(74,144,226,.18);transform:translateY(-1px)}\n'+
      '.zoom-btn:active{transform:translateY(0) scale(.96)}\n'+
      '.zoom-btn span{display:block;transform:translateY(-1px)}\n'+
      '.zoom-btn.minus span{transform:translateY(-3px)}\n'+
      '.zoom-hint svg{opacity:.9}\n'+
      '.zoom-hint .wheel{animation:zoomWheelMove 1.05s ease-in-out infinite;transform-origin:center}\n'+
      '@keyframes zoomWheelMove{0%,100%{transform:translateY(-2px);opacity:.45}50%{transform:translateY(3px);opacity:1}}\n'+
      '@keyframes zoomHintPulse{0%,100%{box-shadow:0 0 0 rgba(74,144,226,0)}50%{box-shadow:0 0 18px rgba(74,144,226,.22)}}\n';
    document.head.appendChild(style);
    cssInjected=true;
  }

  function getTarget(){ return document.querySelector(options.targetSelector); }
  function getHint(){ return document.getElementById(options.hintId); }

  function mount(){
    injectCSS();
    var target=getTarget();
    if(!target) return null;
    var hint=getHint();
    if(!hint){
      hint=document.createElement('div');
      hint.className='zoom-hint';
      hint.id=options.hintId;
      hint.innerHTML=defaultHtml();
      target.appendChild(hint);
    }
    if(!hint.dataset.productZoomBound){
      hint.addEventListener('click',function(e){
        var btn=e.target.closest('[data-product-zoom]');
        if(!btn) return;
        zoomProductImage(btn.dataset.productZoom==='in'?1:-1,e);
      });
      hint.dataset.productZoomBound='1';
    }
    return hint;
  }

  function resetZoomHint(){
    var hint=mount();
    if(hint) hint.innerHTML=defaultHtml();
  }

  function showZoomLevel(){
    var hint=mount();
    if(!hint) return;
    hint.innerHTML=levelHtml();
    clearTimeout(zoomLabelTimer);
    zoomLabelTimer=setTimeout(resetZoomHint,options.resetDelay);
  }

  function zoomProductImage(direction,evt){
    if(evt){ evt.preventDefault(); evt.stopPropagation(); }
    if(!hasImage()){ notify(options.noImageMessage,'wa'); return false; }
    var step=direction>0?options.buttonStep:-options.buttonStep;
    setScale(getScale()+step);
    commit();
    redraw();
    showZoomLevel();
    return false;
  }

  function setupProd2Scroll(){
    var target=getTarget();
    mount();
    if(!target||wheelBound) return;
    target.addEventListener('wheel',function(e){
      if(!hasImage()) return;
      e.preventDefault();
      var delta=e.deltaY>0?-options.wheelStep:options.wheelStep;
      setScale(getScale()+delta);
      commit();
      redraw();
      showZoomLevel();
    },{passive:false});
    wheelBound=true;
  }

  window.ProductZoomPlugin={
    mount:mount,
    setup:setupProd2Scroll,
    zoom:zoomProductImage,
    showZoomLevel:showZoomLevel,
    reset:resetZoomHint,
    configure:function(opts){ options=Object.assign(options,opts||{}); return this; }
  };

  window.setupProd2Scroll=setupProd2Scroll;
  window.zoomProductImage=zoomProductImage;
  window.showZoomLevel=showZoomLevel;
  window.resetZoomHint=resetZoomHint;

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount);
  else mount();
})();
