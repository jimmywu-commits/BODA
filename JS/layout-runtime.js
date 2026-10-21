/*!
 * layout-runtime.js
 * 所有排版版位共用的執行邏輯
 * 由各版位 HTML 載入：<script src="../js/layout-runtime.js"></script>
 */
(function(){

(function () {
  var urlId = parseInt(new URLSearchParams(location.search).get('bnid')) || 0;
  var fname = decodeURIComponent(location.pathname.split('/').pop().replace(/\.html$/i, ''));

  /* 這個版位（依檔名判斷）只能顯示「目前最上層（z-index最高）」的一張商品圖，
     人物圖完全不顯示——不管人物圖數量或商品可見度規則怎麼變，都要蓋掉。
     統一在這裡（layout-runtime.js）判斷，不用各版位自己攔截商品/人物相關
     訊息，行為才會一致、也才不會漏掉哪個訊息類型沒攔到。 */
  var _bnSingleProductOnlyTemplate = /searchicon_product/i.test(fname || '');
  var _bnSingleLogoTemplate = /^(ar_logo|首頁logo牆)$/i.test(fname || '');
  var _bnHomepageLogoWallTemplate = /^首頁logo牆$/i.test(fname || '');
  var _bnSearchIconLogoTemplate = /^searchicon_logo$/i.test(fname || '');
  var _bnSearchIconProductTemplate = /^searchicon_product$/i.test(fname || '');
  var _bnSingleProductForLogoWallTemplate = /首頁logo牆/i.test(fname || '');
  var _bnDdcardTemplate = /^ddcard/i.test(fname || '');
  /* SearchICON／首頁 LOGO 牆都不接受背景圖片；只有首頁 LOGO 牆固定白底（整張）。
     SearchICON_LOGO / PRODUCT / TEXT：圓底（.背景色）跟著父頁選取的背景色，
     但圓底之下的畫布（#canvas）固定白色，不跟著背景色跑。 */
  var _bnNoImageBackgroundTemplate = /^(searchicon_(logo|product|text|120)|首頁logo牆)$/i.test(fname || '');
  var _bnFixedWhiteBackgroundTemplate = _bnHomepageLogoWallTemplate;
  var _bnWhiteCanvasUnderCircleTemplate = /^searchicon_(logo|product|text)$/i.test(fname || '');
  var _bnCurrentCanvasBg = '';

  /* 可編輯文字不得使用近黑／近白；CTA 底色允許近白，但禁用近黑與灰色。
     父頁會先正規化一次；這裡是版型端最後防線，連寫死在 CSS 的預設色也會攔截。 */
  var _bnRestrictedColorFallbacks={
    brandText:'#2b79c4',mainText:'#2b79c4',subText:'#2540b5',dateText:'#2b79c4',
    ctaBg:'#2540b5',searchImageCtaBg:'#2540b5'
  };
  var _bnCtaBackgroundColorKeys=['ctaBg','searchImageCtaBg'];
  var _bnCtaExtendedGrayColors=['#2d3748','#4a5568','#718096'];
  var _bnRestrictedColorKeys=['brandText','mainText','subText','dateText','ctaBg','searchImageCtaBg'];
  function _bnRestrictedColorRgb(value){
    var text=String(value||'').trim().toLowerCase();
    if(text==='black') return [0,0,0];
    if(text==='white') return [255,255,255];
    var short=text.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
    if(short) return short.slice(1).map(function(x){return parseInt(x+x,16);});
    var full=text.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if(full) return full.slice(1).map(function(x){return parseInt(x,16);});
    var rgb=text.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*([\d.]+))?\s*\)$/i);
    if(rgb){
      if(rgb[4]!==undefined&&Number(rgb[4])===0) return null;
      return [Number(rgb[1]),Number(rgb[2]),Number(rgb[3])];
    }
    return null;
  }
  function _bnLum(rgb){
    var f=function(v){v=Math.max(0,Math.min(255,Number(v)||0))/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
    return 0.2126*f(rgb[0])+0.7152*f(rgb[1])+0.0722*f(rgb[2]);
  }
  function _bnContrast(a,b){
    var la=_bnLum(a),lb=_bnLum(b);
    return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05);
  }
  function _bnRgbToHex(rgb){
    return '#'+rgb.map(function(v){var n=Math.round(Math.max(0,Math.min(255,v)));return ('0'+n.toString(16)).slice(-2);}).join('');
  }
  /* CTA 字色（比照 color-tool 吃色邏輯）：預設白字；白字對 CTA 底 CR < 3 才改深色字
     （淺底試主標色、深底試底色→主標色，需 CR ≥ 4.5，否則黑字）。 */
  function _bnCtaForegroundForBg(value,mainText,canvasBg){
    var rgb=_bnRestrictedColorRgb(value);
    if(!rgb) return '#ffffff';
    if(_bnContrast([255,255,255],rgb)>=3) return '#ffffff';
    var mainRgb=_bnRestrictedColorRgb(mainText);
    var bgRgb=_bnRestrictedColorRgb(canvasBg);
    var tries=[];
    if(bgRgb&&mainRgb){
      var bgLight=_bnContrast([0,0,0],bgRgb)>=_bnContrast([255,255,255],bgRgb);
      tries=bgLight?[mainRgb]:[bgRgb,mainRgb];
    }else if(mainRgb){ tries=[mainRgb]; }
    for(var i=0;i<tries.length;i++){ if(_bnContrast(tries[i],rgb)>=4.5) return _bnRgbToHex(tries[i]); }
    return '#000000';
  }
  function _bnIsBlackOrWhiteColor(value){
    var rgb=_bnRestrictedColorRgb(value);
    if(!rgb) return false;
    return Math.max.apply(Math,rgb)<=32||Math.min.apply(Math,rgb)>=245;
  }
  function _bnIsGrayColor(value){
    var text=String(value||'').trim().toLowerCase();
    if(_bnCtaExtendedGrayColors.indexOf(text)>=0) return true;
    if(/(?:gray|grey)$/.test(text)||text==='silver'||text==='gainsboro') return true;
    var rgb=_bnRestrictedColorRgb(value);
    if(!rgb) return false;
    return Math.max.apply(Math,rgb)-Math.min.apply(Math,rgb)<=24;
  }
  function _bnIsRestrictedColorForKey(key,value){
    if(_bnCtaBackgroundColorKeys.indexOf(key)>=0){
      var rgb=_bnRestrictedColorRgb(value);
      if(rgb&&Math.min.apply(Math,rgb)>=245) return false;
      if(rgb&&Math.max.apply(Math,rgb)<=32) return true;
      return _bnIsGrayColor(value);
    }
    return _bnIsBlackOrWhiteColor(value);
  }
  /* 父層最後一次廣播、已做過禁色與吃色檢查的顏色；禁色替代時優先用它，而不是固定藍。 */
  var _bnLastSafeColors={};
  function _bnFallbackColorFor(key){
    var v=_bnLastSafeColors&&_bnLastSafeColors[key];
    if(v&&_bnRestrictedColorRgb(v)&&!_bnIsRestrictedColorForKey(key,v)) return v;
    return _bnRestrictedColorFallbacks[key];
  }
  function _bnSafeRestrictedColor(key,value){
    return _bnRestrictedColorKeys.indexOf(key)>=0&&_bnIsRestrictedColorForKey(key,value)
      ?_bnFallbackColorFor(key)
      :value;
  }
  function _bnEnforceRestrictedColors(canvas){
    if(!canvas) return;
    function enforce(selector,property,key){
      canvas.querySelectorAll(selector).forEach(function(el){
        var value=window.getComputedStyle(el).getPropertyValue(property);
        if(_bnIsRestrictedColorForKey(key,value)) el.style.setProperty(property,_bnFallbackColorFor(key),'important');
      });
    }
    enforce('.品牌名,.主標,.日期,.ICON獨立文案','color','mainText');
    enforce('.副標,.副標案型七字內,.六字內','color','subText');
    enforce('.逛逛去按鈕,.cta底,.逛逛去底','background-color','ctaBg');
    enforce('.cta圓底','background-color','searchImageCtaBg');
  }
  var _bnRestrictedColorObserver=null,_bnRestrictedColorTimer=0;
  function _bnSetupRestrictedColorGuard(canvas){
    _bnEnforceRestrictedColors(canvas);
    if(!window.MutationObserver||_bnRestrictedColorObserver) return;
    _bnRestrictedColorObserver=new window.MutationObserver(function(){
      clearTimeout(_bnRestrictedColorTimer);
      _bnRestrictedColorTimer=setTimeout(function(){_bnEnforceRestrictedColors(canvas);},0);
    });
    _bnRestrictedColorObserver.observe(canvas,{
      subtree:true,childList:true,attributes:true,attributeFilter:['style','class']
    });
  }

  function loadCSS(href, cb) {
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    l.onload = cb || function(){};
    l.onerror = function(){ if(cb) cb(); };
    document.head.appendChild(l);
  }
  var loaded = 0;
  function onBothLoaded() {
    loaded++;
    if (loaded < 2) return;
    /* CSS 兩個都載完後，等字型也載完再 init
       document.fonts.ready 在字型下載完成後 resolve，
       保證 scrollWidth / getComputedStyle 拿到的是正確字型的量測值 */
    waitFontsAndInit();
  }

  function waitFontsAndInit() {
    /* 統一入口：CSS 載入完成或 window load fallback 都必須等字型 ready。
       避免慢速電腦先用 fallback 字型完成排版，造成畫布文字位置/寬度錯誤。 */
    function doInit() {
      requestAnimationFrame(function(){ requestAnimationFrame(init); });
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(doInit).catch(doInit);
    } else {
      setTimeout(doInit, 300);
    }
  }

  loadCSS(fname + '.css',        onBothLoaded);
  loadCSS(fname + '.config.css', onBothLoaded);
  window.addEventListener('load', function(){ setTimeout(waitFontsAndInit, 600); });
  var inited = false;

  function init() {
    if (inited) return;
    inited = true;
    var root = getComputedStyle(document.documentElement);
    var canvas = document.getElementById('canvas');
    var W = parseFloat(root.getPropertyValue('--canvas-w')) || parseFloat(document.body.dataset.fw) || 900;
    var H = parseFloat(root.getPropertyValue('--canvas-h')) || parseFloat(document.body.dataset.fh) || 600;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    var bgRaw = root.getPropertyValue('--bg-img').trim();
    if (bgRaw && bgRaw !== 'none' && bgRaw !== '') {
      var bsrc = bgRaw.replace(/^url\(["']?/,'').replace(/["']?\)$/,'').trim();
      var bimg = document.getElementById('底圖');
      if (bimg) { bimg.src = bsrc; bimg.style.display = 'block'; }
    }

    var ctaRaw = root.getPropertyValue('--cta-classes').trim().replace(/^["']/,'').replace(/["']$/,'');
    var ctaSet = {};
    if (ctaRaw) ctaRaw.split(',').forEach(function(s){ var k=s.trim(); if(k) ctaSet[k]=true; });

    var layersRaw = root.getPropertyValue('--layers').trim().replace(/^["']/,'').replace(/["']$/,'');
    if (layersRaw) {
      layersRaw.split(',').forEach(function(s) {
        s = s.trim(); if (!s) return;
        var parts = s.split('|'), cls = parts[0].trim(), txt = parts.length>1 ? parts[1].trim() : '';
        if (!cls) return;
        var el = document.createElement('div');
        el.className = cls;
        if (ctaSet[cls]) {
          var s1 = document.createElement('span'); s1.className = 'cta-text'; if(txt) s1.textContent = txt;
          var s2 = document.createElement('span'); s2.className = 'cta-arrow';
          el.appendChild(s1); el.appendChild(s2);
        } else { if(txt) el.textContent = txt; }
        canvas.appendChild(el);
      });

      /* IG logo card：固定壓在背景色/背景圖/保護色塊上方，但低於主要文字與 logo */
      var bgLayer = canvas.querySelector('.bg');
      var isIGLayout = /^IG/i.test(fname);
      if (isIGLayout && bgLayer) {
        var card = document.getElementById('ig-shopee-logo-card');
        if (!card) {
          card = document.createElement('img');
          card.id = 'ig-shopee-logo-card';
          card.alt = '';
          card.src = 'img/ig-shopee-logo-card.png';
        }
        card.style.cssText =
          'position:absolute;left:0;top:0;width:100%;height:100%;' +
          'object-fit:cover;pointer-events:none;z-index:4;';
        bgLayer.insertAdjacentElement('afterend', card);
      }

      /* CTA（色塊／文字／三角標）必須永遠疊在整個版面最上層，不可被商品圖／
         人物圖／LOGO 蓋住。PS 匯出的 CSS z-index 不保證比商品範圍/logo範圍高
         （商品範圍/logo範圍本身的 z-index 常常比 cta底 還高），這裡明確把
         CTA 相關圖層固定拉到最上面，跟商品/人物/logo 的疊放順序完全脫鉤，
         彼此之間的相對前後順序（色塊在下、文字居中、三角在上）維持不變。 */
      var CTA_TOP_CLASSES = [
        'cta底','逛逛去底','cta圓底',                 /* CTA 色塊（背景），這組最底 */
        'cta白線',                                     /* 裝飾線 */
        '放心買_安心退','逛逛去','cta符號',            /* CTA 文字／符號 */
        'cta三角標','cta三角箭頭','逛逛去三角標'        /* 三角標，這組最上面 */
      ];
      CTA_TOP_CLASSES.forEach(function(cls, i){
        canvas.querySelectorAll('.'+cls).forEach(function(el){
          el.style.zIndex = String(9000 + i);
        });
      });
    }

    /* ── 讀 --canvas-bg 套用初始背景色（--layers DOM 建立後才做，.bg/.背景色 已存在）
          init 時就設好，不依賴父層 bn-color；
          避免 iframe reload 後背景色消失，或父層重新同步時閃回預設顏色。
          父層之後發 bn-color 仍可覆蓋（同為 inline style）。── */
    var canvasBgRaw = root.getPropertyValue('--canvas-bg').trim();
    if (canvasBgRaw && canvasBgRaw !== 'none' && canvasBgRaw !== '') {
      var _bgEl = canvas.querySelector('.背景色') || canvas.querySelector('.bg') || canvas.querySelector('.底色');
      if (_bgEl) {
        _bgEl.style.backgroundColor = canvasBgRaw;
      } else {
        canvas.style.background = canvasBgRaw;
      }
    }

    function fit() {
      if (window.parent !== window) {
        canvas.style.transform = 'none';
        var st = document.getElementById('stage');
        if (st) { st.style.width = W+'px'; st.style.height = H+'px'; }
        return;
      }
      var sc = Math.min(window.innerWidth/W, window.innerHeight/H);
      var st = document.getElementById('stage');
      canvas.style.transform = 'scale('+sc+')';
      st.style.width  = (W*sc)+'px';
      st.style.height = (H*sc)+'px';
    }
    window.addEventListener('resize', fit);
    fit();
    if (window.parent !== window && urlId)
      window.parent.postMessage({type:'bn-iframe-ready',id:urlId,w:W,h:H},'*');

    /* 掛標：自動依目前版位檔名讀 html/img/tag/版位名_r 或 _w，預設紅色。
       修正版：同時建立紅/白兩張疊圖，切換時只控制 display，避免 iframe postMessage 時機與瀏覽器快取造成不切換。 */
    var _bnTagColor = 'red';
    var _bnTagWrap = null;
    var _bnTagImgs = { red: null, white: null };
    var _bnTagSrcs = { red: '', white: '' };
    var _bnTagSeq = 0;

    function _bnDecodeSharpU(str){
      return String(str || '').replace(/#U([0-9a-fA-F]{4,6})/g, function(_, hex){
        try { return String.fromCodePoint(parseInt(hex, 16)); } catch(e) { return _; }
      });
    }
    function _bnUnique(arr){
      var out = [];
      arr.forEach(function(v){
        v = String(v || '').trim();
        if(v && out.indexOf(v) === -1) out.push(v);
      });
      return out;
    }
    function _bnNormalizeTagName(str){
      return _bnDecodeSharpU(String(str || ''))
        .toLowerCase()
        .replace(/\.html$/i, '')
        .replace(/[_\-\s]/g, '')
        .replace(/(方logo|橫logo|方式logo|橫式logo|方標|橫標|方版|橫版|排版|logo)/g, '');
    }
    function _bnPushTagBase(arr, v){
      v = String(v || '').trim();
      if(!v) return;
      arr.push(v);
      try { arr.push(_bnDecodeSharpU(v)); } catch(_) {}
      try { arr.push(encodeURIComponent(v)); } catch(_) {}
      try { arr.push(v.replace(/ /g, '%20')); } catch(_) {}
      arr.push(v.toLowerCase());
    }
    function _bnTagBases(){
      var base = fname || '';
      var decodedPath = '';
      try { decodedPath = decodeURIComponent(location.pathname.split('/').pop().replace(/\.html$/i, '')); } catch(_) {}
      var zhBase = _bnDecodeSharpU(base);
      var zhPath = _bnDecodeSharpU(decodedPath || base);
      var norm = _bnNormalizeTagName(zhPath || zhBase || base);

      // 已知的固定命名別名優先嘗試（img/tag 資料夾裡實際存在的檔名多是這種命名），
      // 這樣通常第 1～2 次就能找到圖，不會浪費一堆請求去試不存在的檔名組合。
      var aliases = [];
      if(/coin/i.test(norm)) aliases.push('Coinpage','coinpage','Coin_pageBN_APP','Coin_pageBN');
      if(/ddcard/i.test(norm)) aliases.push('ddcard','DDCard','DD Card');
      if(/hbn/i.test(norm)) aliases.push('HBN','hbn');
      if(/fbpost|facebook|^fb/i.test(norm)) aliases.push('fbpost','FB_POST','FB','facebook');
      if(/ig|instagram/i.test(norm)) aliases.push('IG','ig','instagram');
      if(/lpbnapp/i.test(norm)) aliases.push('LPBN_APP','lpbn_app');
      if(/lpbnpc/i.test(norm)) aliases.push('LPBN_PC','lpbn_pc');
      if(/scbn/i.test(norm)) aliases.push('SCBN_APP','SCBN','scbn');
      if(/sbapc|sba_pc/i.test(norm)) aliases.push('SBA_PC','sba_pc');
      else if(/sba/i.test(norm)) aliases.push('SBA_APP','SBA','sba');
      if(/searchimage1/i.test(norm)) aliases.push('Search_Image1logo','Search_Image1','searchimage1');
      if(/searchimage2/i.test(norm)) aliases.push('Search_Image2logo','Search_Image2','searchimage2');
      if(/searchimage3/i.test(norm)) aliases.push('Search_Image3logo','Search_Image3','searchimage3');

      var arr = [];
      aliases.forEach(function(v){ _bnPushTagBase(arr, v); });
      [base, decodedPath, zhBase, zhPath, norm].forEach(function(v){ _bnPushTagBase(arr, v); });
      return _bnUnique(arr);
    }
    function _bnBuildTagCandidates(color){
      var suffix = color === 'white' ? 'w' : 'r';
      var candidates = [];
      // 只嘗試實際會用到的副檔名（png 為主，jpg/webp 備用），避免每個檔名都要試 6 種副檔名
      // 造成組合爆炸（過多無效請求容易被 GitHub Pages 判定為 429 太多請求）。
      ['png','jpg','webp'].forEach(function(ext){
        _bnTagBases().forEach(function(base){
          candidates.push('img/tag/' + base + '_' + suffix + '.' + ext);
          candidates.push('html/img/tag/' + base + '_' + suffix + '.' + ext);
        });
      });
      // 安全上限：最多只嘗試前 40 個候選網址，找不到就放棄，不繼續往下試。
      return _bnUnique(candidates).slice(0, 40);
    }
    function _bnTagCacheKey(color){
      return 'bnTag:' + (fname || '') + ':' + color;
    }
    function _bnFindFirstImage(srcs, cb){
      var idx = 0;
      function next(){
        if(idx >= srcs.length){ cb(''); return; }
        var src = srcs[idx++];
        var probe = new Image();
        probe.onload = function(){ cb(src); };
        probe.onerror = next;
        // 探測階段不加時間戳記，讓瀏覽器對重複探測的失敗結果保有快取的機會，
        // 避免同一批候選網址在多個 iframe / 多次重新排版時被重複打好幾次。
        probe.src = src;
      }
      next();
    }

    function _bnEnsureTagLayers(){
      if(!_bnTagWrap){
        _bnTagWrap = document.getElementById('bn-auto-tag-wrap');
      }
      if(!_bnTagWrap){
        _bnTagWrap = document.createElement('div');
        _bnTagWrap.id = 'bn-auto-tag-wrap';
      }
      _bnTagWrap.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:9998;display:none;';

      ['red','white'].forEach(function(color){
        var img = _bnTagImgs[color] || document.getElementById('bn-auto-tag-' + color);
        if(!img){
          img = document.createElement('img');
          img.id = 'bn-auto-tag-' + color;
          img.alt = '';
        }
        img.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:fill;pointer-events:none;display:none;';
        if(img.parentNode !== _bnTagWrap) _bnTagWrap.appendChild(img);
        _bnTagImgs[color] = img;
      });

      if(_bnTagWrap.parentNode !== canvas){
        var bgLayer = canvas.querySelector('.bg') || canvas.querySelector('.背景色') || canvas.querySelector('.底色');
        if(bgLayer && bgLayer.parentNode === canvas) bgLayer.insertAdjacentElement('afterend', _bnTagWrap);
        else canvas.appendChild(_bnTagWrap);
      }
      return _bnTagWrap;
    }
    function _bnRefreshTagVisibility(){
      _bnEnsureTagLayers();
      var visible = false;
      ['red','white'].forEach(function(color){
        var img = _bnTagImgs[color];
        var show = color === _bnTagColor && !!_bnTagSrcs[color];
        if(img) img.style.display = show ? 'block' : 'none';
        if(show) visible = true;
      });
      _bnTagWrap.style.display = visible ? 'block' : 'none';
    }
    function _bnLoadTagLayers(){
      var seq = ++_bnTagSeq;
      _bnEnsureTagLayers();
      ['red','white'].forEach(function(color){
        var cacheKey = _bnTagCacheKey(color);
        var cached = null;
        try { cached = window.sessionStorage.getItem(cacheKey); } catch(_) {}
        if(cached !== null){
          // 曾經探測過的結果（找到的網址，或空字串代表確認找不到），直接沿用，不用再打一輪請求。
          if(seq !== _bnTagSeq) return;
          _bnTagSrcs[color] = cached || '';
          var cimg = _bnTagImgs[color];
          if(cached && cimg){
            cimg.onload = function(){ _bnRefreshTagVisibility(); };
            cimg.onerror = function(){ _bnTagSrcs[color] = ''; _bnRefreshTagVisibility(); };
            cimg.src = cached + (cached.indexOf('?') === -1 ? '?v=' : '&v=') + Date.now();
          }
          _bnRefreshTagVisibility();
          return;
        }
        _bnFindFirstImage(_bnBuildTagCandidates(color), function(src){
          try { window.sessionStorage.setItem(cacheKey, src || ''); } catch(_) {}
          if(seq !== _bnTagSeq) return;
          _bnTagSrcs[color] = src || '';
          var img = _bnTagImgs[color];
          if(src && img){
            img.onload = function(){ _bnRefreshTagVisibility(); };
            img.onerror = function(){ _bnTagSrcs[color] = ''; _bnRefreshTagVisibility(); };
            img.src = src + (src.indexOf('?') === -1 ? '?v=' : '&v=') + Date.now();
          }
          _bnRefreshTagVisibility();
        });
      });
    }
    function _bnSetTagColor(color){
      _bnTagColor = (color === 'white') ? 'white' : 'red';
      _bnRefreshTagVisibility();
      if(!_bnSkipTag && !_bnTagSrcs.red && !_bnTagSrcs.white) _bnLoadTagLayers();
    }
    window._bnSetTagColor = _bnSetTagColor;
    window._bnApplyTag = function(){ if(!_bnSkipTag) _bnLoadTagLayers(); };
    var _bnSkipTag = false;
    if(/ddcard/i.test(fname)){
      try { _bnSkipTag = !/^#ddcard$/i.test(parent.location.hash.trim()); } catch(_){}
    }
    if(!_bnSkipTag) _bnLoadTagLayers();


    /* Search_Image：動態置中 */
    if(fname.toLowerCase().indexOf('search_image') !== -1){
      /* Search_Image2：兩個 logo 各自垂直置中，水平位置由 PS CSS 決定 */
      if(fname.toLowerCase().indexOf('search_image2') !== -1 || fname.toLowerCase().indexOf('search_image3') !== -1){
        var _si23H = H;
        /* 所有 logo 範圍垂直置中 */
        ['logo範圍_左','logo範圍_中','logo範圍_右'].forEach(function(cls){
          var el = canvas.querySelector('.'+cls);
          if(!el) return;
          var elH = parseFloat(window.getComputedStyle(el).height) || 121;
          el.style.top = ((_si23H - elH) / 2) + 'px';
        });
        /* 間隔線垂直置中（支援單名和左右命名）*/
        ['.logo間隔直線','.logo間隔直線_左','.logo間隔直線_右'].forEach(function(sel){
          var el = canvas.querySelector(sel);
          if(!el) return;
          var elH = parseFloat(window.getComputedStyle(el).height) || 55;
          el.style.top = ((_si23H - elH) / 2) + 'px';
        });
        return;
      }
      var _siLogo = canvas.querySelector('.logo範圍');
      var _siText = canvas.querySelector('.副標案型七字內');
      if(_siLogo && _siText){
        var _siCanvasH = H;
        /* 文案區：紅底右邊緣 ~ CTA 左邊緣 */
        var _siRedEl  = canvas.querySelector('.蝦皮商城logo紅底');
        var _siCtaEl  = canvas.querySelector('.cta圓底');
        var _siAreaLeft  = _siRedEl  ?
          parseFloat(window.getComputedStyle(_siRedEl).left) + parseFloat(window.getComputedStyle(_siRedEl).width) : 299;
        var _siAreaRight = _siCtaEl  ?
          parseFloat(window.getComputedStyle(_siCtaEl).left) : 1007;
        var _siAreaCenter = (_siAreaLeft + _siAreaRight) / 2;

        /* logo 固定尺寸（從 CSS 讀，之後不變）*/
        var _siLogoW = parseFloat(window.getComputedStyle(_siLogo).width)  || 120;
        var _siLogoH = parseFloat(window.getComputedStyle(_siLogo).height) || 121;

        function siLayout(){
          /* canvas 縮放比例（用於把 getBoundingClientRect 轉回原始座標）*/
          var m = canvas.style.transform && canvas.style.transform.match(/scale\(([\d.]+)\)/);
          var scale = m ? parseFloat(m[1]) : 1;

          /* 副標實際視覺寬高（原始座標）
             getBoundingClientRect 回傳的是螢幕像素，除以 scale 得原始大小
             但文字有 matrix transform，用 scrollWidth 更準確 */
          var textW = _siText.scrollWidth;
          /* matrix scale 也會影響視覺寬度 */
          var matStyle = window.getComputedStyle(_siText).transform;
          var matM = matStyle && matStyle.match(/matrix\(([^,]+)/);
          var matScale = matM ? parseFloat(matM[1]) : 1;
          var visTextW = textW * matScale;

          var visTextH = parseFloat(window.getComputedStyle(_siText).fontSize) * matScale;

          /* 整體寬度：logo + 26px 間距 + 副標視覺寬 */
          var totalW = _siLogoW + 26 + visTextW;

          /* 左右置中在文案區 */
          var startX = _siAreaCenter - totalW / 2;
          _siLogo.style.left = startX + 'px';
          _siText.style.left = (startX + _siLogoW + 26) + 'px';

          /* 上下置中。
             ★ 2026-08 修正（第二版）：文字改用「墨水實測置中」。
             第一版拿字級當視覺高度 → CJK 墨水偏下，整行低 16px；
             改回 CSS top 又發現那個值是配 PS matrix 調的，現在樣式已被
             覆寫（transform:none / 等效字級），基準對不上 → 偏高 12px。
             不再依賴任何寫死的 top：
             1. 零尺寸探針量出瀏覽器把 baseline 放在元素內的哪個 y
                （負半行距等怪癖全都如實反映）。
             2. measureText 的 actualBoundingBox 量出「這串字」真實墨水
                的上下緣 → 墨水中心相對元素頂端的偏移。
             3. top = 畫布中心 - 墨水中心偏移 → 墨水中心永遠 = 畫布中心。
             改字、改字級、換字型全都自動成立，預覽即所得，
             下載端點陣化畫的是同一個位置，兩邊永遠一致。 */
          _siLogo.style.top = ((_siCanvasH - _siLogoH) / 2) + 'px';
          try {
            var _pb = document.createElement('span');
            _pb.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;';
            _siText.appendChild(_pb);
            var _baseOff = _pb.offsetTop;           /* baseline 在元素內的 y */
            _siText.removeChild(_pb);
            var _tcs = window.getComputedStyle(_siText);
            var _mctx = document.createElement('canvas').getContext('2d');
            _mctx.font = _tcs.fontStyle + ' ' + _tcs.fontWeight + ' ' + parseFloat(_tcs.fontSize) + 'px ' + _tcs.fontFamily;
            var _tm = _mctx.measureText((_siText.textContent || '').trim());
            if(_tm.actualBoundingBoxAscent !== undefined && _baseOff > 0){
              /* 墨水中心（相對元素頂端）= baseline + (descent - ascent)/2，
                 若元素帶 matrix 縮放要等比換算 */
              var _inkMid = (_baseOff + (_tm.actualBoundingBoxDescent - _tm.actualBoundingBoxAscent) / 2) * matScale;
              _siText.style.top = (_siCanvasH / 2 - _inkMid) + 'px';
            } else {
              _siText.style.top = ''; /* 量不到就退回 CSS 預設 */
            }
          } catch(e) {
            _siText.style.top = '';
          }
        }

        /* 等字型載完再算位置，避免 fallback 字型造成 scrollWidth 偏差 */
        window._siRelayout = siLayout;
        function runSiLayout() {
          if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function() {
              siLayout();
            });
          } else {
            /* 不支援 document.fonts：延遲兩幀保守等待 */
            requestAnimationFrame(function(){
              requestAnimationFrame(siLayout);
            });
          }
        }
        runSiLayout();
      }
    } /* end search_image */


    /* 啟用畫布文字直接編輯 */
    attachEditableToAll();
    _bnSetupRestrictedColorGuard(canvas);
  }

  /* 主／副標關鍵字的非阻擋式內容提醒：畫布只在編輯預覽顯示橘框與提示，
     messages 由父層獨立傳入，不會改寫 .日期 的實際文字。 */
  function ensureContentWarningStyle(){
    if(document.getElementById('_bn_content_warning_style')) return;
    var st=document.createElement('style');
    st.id='_bn_content_warning_style';
    st.textContent=''
      +'.bn-content-warning-target{outline:3px solid #f59e0b !important;'
      +'background:rgba(245,158,11,.14) !important;border-radius:2px;}'
      +'.bn-content-warning-tip{position:absolute;z-index:20050;box-sizing:border-box;'
      +'padding:7px 9px;border:2px solid #f59e0b;border-radius:6px;'
      +'background:rgba(30,22,4,.94);color:#fbbf24;font-family:Arial,"Noto Sans TC",sans-serif;'
      +'font-weight:700;line-height:1.45;box-shadow:0 4px 14px rgba(0,0,0,.28);'
      +'pointer-events:none;white-space:normal;text-align:left;}'
      +'.bn-content-warning-tip div+div{margin-top:4px;padding-top:4px;'
      +'border-top:1px solid rgba(245,158,11,.35);}';
    (document.head||document.documentElement).appendChild(st);
  }
  function applyContentWarnings(messages){
    messages=Array.isArray(messages)?messages.filter(function(m){return typeof m==='string'&&m;}):[];
    window.__bnContentWarningMessages=messages.slice();
    ensureContentWarningStyle();

    document.querySelectorAll('.bn-content-warning-target').forEach(function(el){
      el.classList.remove('bn-content-warning-target');
    });
    document.querySelectorAll('.bn-content-warning-tip').forEach(function(el){el.remove();});
    if(!messages.length) return;

    var cv=document.getElementById('canvas');
    if(!cv) return;
    var cr=cv.getBoundingClientRect();
    var cw=cv.offsetWidth||parseFloat(cv.style.width)||cr.width||0;
    var ch=cv.offsetHeight||parseFloat(cv.style.height)||cr.height||0;
    document.querySelectorAll('.日期').forEach(function(dateEl){
      if(!cv.contains(dateEl)) return;
      dateEl.classList.add('bn-content-warning-target');
      var tip=document.createElement('div');
      tip.className='bn-content-warning-tip';
      tip.dataset.bnPreviewWarning='1';
      tip.style.maxWidth=Math.max(100,Math.min(460,cw-12))+'px';
      tip.style.fontSize=(cw<300?8:(cw<700?11:14))+'px';
      var copy=document.createElement('div');
      copy.className='bn-content-warning-copy';
      messages.forEach(function(msg){
        var line=document.createElement('div');
        line.className='bn-content-warning-line';
        line.textContent='⚠ '+msg;
        copy.appendChild(line);
      });
      tip.appendChild(copy);
      (document.getElementById('stage')||cv.parentElement||document.body).appendChild(tip);

      var dr=dateEl.getBoundingClientRect();
      var left=dr.left-cr.left;
      var top=dr.bottom-cr.top+6;
      left=Math.max(4,Math.min(left,Math.max(4,cw-tip.offsetWidth-4)));
      if(top+tip.offsetHeight>ch-4) top=dr.top-cr.top-tip.offsetHeight-6;
      top=Math.max(4,Math.min(top,Math.max(4,ch-tip.offsetHeight-4)));
      tip.style.left=left+'px';
      tip.style.top=top+'px';
    });
  }

  /* 橘色提示的「最佳可視最小字」：依父層 iframe 的實際縮放比例反算，
     讓螢幕上看到的字至少約 13px；原始畫布字級本身也不低於 18px。 */
  var BN_CONTENT_WARNING_MIN_VISIBLE_FONT=13;
  var BN_CONTENT_WARNING_MIN_CANVAS_FONT=18;
  var _bnApplyContentWarningsBase=applyContentWarnings;
  applyContentWarnings=function(messages){
    _bnApplyContentWarningsBase(messages);
    var cv=document.getElementById('canvas');
    if(!cv) return;
    var cw=cv.offsetWidth||parseFloat(cv.style.width)||0;
    var ch=cv.offsetHeight||parseFloat(cv.style.height)||0;
    var previewScale=1;
    try{
      var frame=window.frameElement;
      if(frame){
        var layoutWidth=frame.offsetWidth||parseFloat(frame.style.width)||cw;
        var visibleWidth=frame.getBoundingClientRect().width;
        if(layoutWidth>0&&visibleWidth>0) previewScale=visibleWidth/layoutWidth;
      }
    }catch(_){}
    previewScale=Math.max(.1,Math.min(1,previewScale||1));
    var fontPx=Math.max(BN_CONTENT_WARNING_MIN_CANVAS_FONT,
      Math.ceil(BN_CONTENT_WARNING_MIN_VISIBLE_FONT/previewScale));
    fontPx=Math.min(30,fontPx);

    var cr=cv.getBoundingClientRect();
    var targets=Array.prototype.slice.call(cv.querySelectorAll('.bn-content-warning-target'));
    var tips=Array.prototype.slice.call(document.querySelectorAll('.bn-content-warning-tip'));
    tips.forEach(function(tip,index){
      tip.style.setProperty('font-size',fontPx+'px','important');
      var dateEl=targets[index];
      if(!dateEl) return;
      var dr=dateEl.getBoundingClientRect();
      var left=dr.left-cr.left;
      var top=dr.bottom-cr.top+6;
      left=Math.max(4,Math.min(left,Math.max(4,cw-tip.offsetWidth-4)));
      if(top+tip.offsetHeight>ch-4) top=dr.top-cr.top-tip.offsetHeight-6;
      top=Math.max(4,Math.min(top,Math.max(4,ch-tip.offsetHeight-4)));
      tip.style.left=left+'px';
      tip.style.top=top+'px';
    });
  };

  /* 最終定位規則：提示固定在日期／警語下方，不因空間判斷翻到上方，
     避免覆蓋副標；加寬提示框以減少大字級造成的換行高度。 */
  var _bnApplyContentWarningsSizedBase=applyContentWarnings;
  applyContentWarnings=function(messages){
    _bnApplyContentWarningsSizedBase(messages);
    var cv=document.getElementById('canvas');
    if(!cv) return;
    var cr=cv.getBoundingClientRect();
    var cw=cv.offsetWidth||parseFloat(cv.style.width)||0;
    var targets=Array.prototype.slice.call(cv.querySelectorAll('.bn-content-warning-target'));
    var tips=Array.prototype.slice.call(document.querySelectorAll('.bn-content-warning-tip'));
    tips.forEach(function(tip,index){
      var dateEl=targets[index];
      if(!dateEl) return;
      tip.style.maxWidth=Math.max(100,Math.min(720,cw-12))+'px';
      var dr=dateEl.getBoundingClientRect();
      var left=dr.left-cr.left;
      var top=dr.bottom-cr.top+6;
      left=Math.max(4,Math.min(left,Math.max(4,cw-tip.offsetWidth-4)));
      tip.style.left=left+'px';
      tip.style.top=top+'px';
    });
  };

  /* 深色底橘字＋「我已了解/已補充▶」：按鈕只控制編輯預覽，點擊後先在目前畫布
     立即隱藏，再通知父層同步隱藏其他畫布與左側提醒。 */
  function ensureContentWarningActionStyle(){
    if(document.getElementById('_bn_content_warning_action_style')) return;
    var st=document.createElement('style');
    st.id='_bn_content_warning_action_style';
    st.textContent=''
      +'html.bn-content-warning-active,html.bn-content-warning-active body{overflow:visible !important;}'
      +'html.bn-content-warning-active body{align-items:flex-start !important;'
      +'justify-content:flex-start !important;}'
      +'html.bn-content-warning-active #stage{overflow:visible !important;}'
      +'.bn-content-warning-tip{display:inline-block;vertical-align:middle;'
      +'width:max-content;max-width:760px;padding:.5em .65em !important;'
      +'background:rgba(17,24,39,.96) !important;border:2px solid #f59e0b !important;'
      +'border-radius:.45em !important;color:#fbbf24 !important;pointer-events:auto !important;'
      +'box-shadow:0 5px 16px rgba(0,0,0,.34) !important;text-shadow:none;}'
      +'.bn-content-warning-copy{display:inline;}'
      +'.bn-content-warning-line{display:inline;margin:0 !important;padding:0 !important;'
      +'border:0 !important;white-space:normal;word-break:normal;overflow-wrap:break-word;line-break:strict;}'
      +'.bn-content-warning-line+.bn-content-warning-line::before{content:"\\A";white-space:pre;}'
      +'.bn-content-warning-dismiss{display:inline-flex;align-items:center;justify-content:center;'
      +'vertical-align:middle;margin:0 0 0 .5em;padding:.42em .72em;min-height:1.9em;'
      +'border:2px solid #f59e0b;border-radius:999px;background:#f59e0b;color:#241600;'
      +'font:700 .88em/1 Arial,"Noto Sans TC",sans-serif;white-space:nowrap;cursor:pointer;'
      +'pointer-events:auto;box-shadow:0 2px 7px rgba(0,0,0,.18);}'
      +'.bn-content-warning-dismiss:hover{background:#fbbf24;border-color:#fbbf24;}';
    (document.head||document.documentElement).appendChild(st);
  }
  ensureContentWarningActionStyle();
  var _bnApplyContentWarningsActionBase=applyContentWarnings;
  applyContentWarnings=function(messages){
    _bnApplyContentWarningsActionBase(messages);
    var cv=document.getElementById('canvas');
    if(!cv || !Array.isArray(messages) || !messages.length) return;
    var cr=cv.getBoundingClientRect();
    var cw=cv.offsetWidth||parseFloat(cv.style.width)||0;
    var targets=Array.prototype.slice.call(cv.querySelectorAll('.bn-content-warning-target'));
    var tips=Array.prototype.slice.call(document.querySelectorAll('.bn-content-warning-tip'));
    tips.forEach(function(tip,index){
      if(!tip.querySelector('.bn-content-warning-dismiss')){
        var btn=document.createElement('button');
        btn.type='button';
        btn.className='bn-content-warning-dismiss';
        btn.textContent='我已了解/已補充▶';
        btn.addEventListener('click',function(ev){
          ev.preventDefault(); ev.stopPropagation();
          applyContentWarnings([]);
          try{ window.parent.postMessage({type:'bn-content-warning-dismiss'},'*'); }catch(_){}
        });
        tip.appendChild(btn);
      }
      var dateEl=targets[index];
      if(!dateEl) return;
      var dr=dateEl.getBoundingClientRect();
      var left=Math.max(4,Math.min(dr.left-cr.left,Math.max(4,cw-tip.offsetWidth-4)));
      tip.style.left=left+'px';
      tip.style.top=(dr.bottom-cr.top+6)+'px';
    });
  };

  /* 依每個版型的日期、文字、Logo 與圖片區域，自動選擇重疊最少的位置。
     超出版型右側／下方的代價刻意設得很低，寧可延伸預覽範圍，也不遮內容。 */
  function bnContentWarningOverlapArea(a,b){
    var left=Math.max(a.left,b.left), top=Math.max(a.top,b.top);
    var right=Math.min(a.left+a.width,b.left+b.width);
    var bottom=Math.min(a.top+a.height,b.top+b.height);
    return Math.max(0,right-left)*Math.max(0,bottom-top);
  }

  function bnChooseContentWarningPlacement(dateRect,tipSize,canvasSize,obstacles){
    var cw=Math.max(1,canvasSize.width||0), ch=Math.max(1,canvasSize.height||0);
    var tw=Math.max(1,tipSize.width||0), th=Math.max(1,tipSize.height||0);
    var dx=dateRect.left||0, dy=dateRect.top||0;
    var dw=dateRect.width||0, dh=dateRect.height||0;
    var gap=7, candidates=[];
    function add(name,left,top,preference){
      candidates.push({
        name:name,
        left:Math.max(0,Math.round(left)),
        top:Math.max(0,Math.round(top)),
        preference:preference||0
      });
    }

    add('below-left',dx,dy+dh+gap,0);
    add('below-right',dx+dw-tw,dy+dh+gap,1);
    add('right',dx+dw+gap,dy+(dh-th)/2,2);
    add('above-left',dx,dy-th-gap,3);
    add('above-right',dx+dw-tw,dy-th-gap,4);
    add('inside-bottom-left',6,ch-th-6,6);
    add('inside-bottom-right',cw-tw-6,ch-th-6,7);
    add('inside-top-left',6,6,8);
    add('inside-top-right',cw-tw-6,6,9);
    add('outside-bottom',Math.min(Math.max(0,dx),Math.max(0,cw-tw)),ch+gap,10);
    add('outside-right',cw+gap,Math.min(Math.max(0,dy),Math.max(0,ch-th)),11);

    var canvasRect={left:0,top:0,width:cw,height:ch};
    var tipArea=tw*th;
    var anchorX=dx+dw/2, anchorY=dy+dh/2;
    obstacles=Array.isArray(obstacles)?obstacles:[];
    candidates.forEach(function(candidate){
      var rect={left:candidate.left,top:candidate.top,width:tw,height:th};
      var occupied=0;
      obstacles.forEach(function(obstacle){
        occupied+=bnContentWarningOverlapArea(rect,obstacle)*(obstacle.weight||1);
      });
      var inside=bnContentWarningOverlapArea(rect,canvasRect);
      var outside=Math.max(0,tipArea-inside);
      var centerX=rect.left+tw/2, centerY=rect.top+th/2;
      var distance=Math.abs(centerX-anchorX)+Math.abs(centerY-anchorY);
      candidate.score=occupied*16+outside*.06+distance*.08+candidate.preference*30;
    });
    candidates.sort(function(a,b){return a.score-b.score;});
    return candidates[0];
  }
  window.__bnChooseContentWarningPlacement=bnChooseContentWarningPlacement;

  function bnCollectContentWarningObstacles(cv,canvasRect,dateEl){
    var selectors=[
      '.品牌名','.主標','.副標','.日期','.副標案型七字內','.ICON獨立文案',
      '[class*="logo範圍"]','[class*="商品範圍"]','[class*="商品圖範圍"]',
      '[class*="cta"]','[class*="CTA"]','.bn-prod-box','.bn-char-box','img:not(#底圖)'
    ].join(',');
    var cw=cv.offsetWidth||canvasRect.width||0;
    var ch=cv.offsetHeight||canvasRect.height||0;
    var seen=[], obstacles=[];
    cv.querySelectorAll(selectors).forEach(function(el){
      if(seen.indexOf(el)>=0 || el.closest('.bn-content-warning-tip')) return;
      seen.push(el);
      var style=window.getComputedStyle(el);
      if(style.display==='none'||style.visibility==='hidden'||parseFloat(style.opacity||'1')===0) return;
      var r=el.getBoundingClientRect();
      var left=Math.max(0,r.left-canvasRect.left);
      var top=Math.max(0,r.top-canvasRect.top);
      var right=Math.min(cw,r.right-canvasRect.left);
      var bottom=Math.min(ch,r.bottom-canvasRect.top);
      var width=Math.max(0,right-left), height=Math.max(0,bottom-top);
      if(width<2||height<2) return;
      if(width*height>cw*ch*.92 && el!==dateEl) return;
      var isText=el===dateEl||el.matches('.品牌名,.主標,.副標,.日期,.副標案型七字內,.ICON獨立文案');
      obstacles.push({
        left:left,top:top,width:width,height:height,
        weight:el===dateEl?8:(isText?4:2)
      });
    });
    return obstacles;
  }

  function bnPostContentWarningBounds(width,height){
    if(window.parent===window||!urlId) return;
    try{
      window.parent.postMessage({
        type:'bn-content-warning-bounds',id:urlId,
        w:Math.max(1,Math.ceil(width||0)),h:Math.max(1,Math.ceil(height||0))
      },'*');
    }catch(_){}
  }

  var _bnContentWarningRelayoutTimer=0;
  var _bnContentWarningObservedCanvas=null;
  var _bnContentWarningObserver=null;
  function bnScheduleContentWarningRelayout(){
    if(window.__bnContentWarningCaptureActive) return;
    if(!window.__bnContentWarningMessages||!window.__bnContentWarningMessages.length) return;
    clearTimeout(_bnContentWarningRelayoutTimer);
    _bnContentWarningRelayoutTimer=setTimeout(function(){
      applyContentWarnings(window.__bnContentWarningMessages||[]);
    },45);
  }
  function bnEnsureContentWarningRelayoutObserver(cv){
    if(_bnContentWarningObservedCanvas===cv) return;
    _bnContentWarningObservedCanvas=cv;
    if(window.MutationObserver){
      _bnContentWarningObserver=new window.MutationObserver(bnScheduleContentWarningRelayout);
      _bnContentWarningObserver.observe(cv,{
        subtree:true,childList:true,characterData:true,attributes:true,
        attributeFilter:['style','src']
      });
    }
    cv.addEventListener('load',bnScheduleContentWarningRelayout,true);
    window.addEventListener('resize',bnScheduleContentWarningRelayout);
  }

  var _bnApplyContentWarningsAdaptiveBase=applyContentWarnings;
  applyContentWarnings=function(messages){
    _bnApplyContentWarningsAdaptiveBase(messages);
    var cv=document.getElementById('canvas');
    if(!cv) return;
    bnEnsureContentWarningRelayoutObserver(cv);
    var active=Array.isArray(messages)&&messages.length>0;
    document.documentElement.classList.toggle('bn-content-warning-active',active);
    var cw=cv.offsetWidth||parseFloat(cv.style.width)||0;
    var ch=cv.offsetHeight||parseFloat(cv.style.height)||0;
    if(!active){
      bnPostContentWarningBounds(cw,ch);
      return;
    }

    var cr=cv.getBoundingClientRect();
    var targets=Array.prototype.slice.call(cv.querySelectorAll('.bn-content-warning-target'));
    var tips=Array.prototype.slice.call(document.querySelectorAll('.bn-content-warning-tip'));
    var extentW=cw, extentH=ch;
    tips.forEach(function(tip,index){
      var dateEl=targets[index];
      if(!dateEl) return;
      tip.style.width='max-content';
      tip.style.maxWidth='760px';
      tip.style.left='0px';
      tip.style.top='0px';
      var tr=tip.getBoundingClientRect();
      var tw=Math.ceil(tr.width||tip.offsetWidth||1);
      var th=Math.ceil(tr.height||tip.offsetHeight||1);
      var dr=dateEl.getBoundingClientRect();
      var dateRect={
        left:dr.left-cr.left,top:dr.top-cr.top,
        width:dr.width,height:dr.height
      };
      var placement=bnChooseContentWarningPlacement(
        dateRect,{width:tw,height:th},{width:cw,height:ch},
        bnCollectContentWarningObstacles(cv,cr,dateEl)
      );
      tip.style.left=placement.left+'px';
      tip.style.top=placement.top+'px';
      tip.dataset.bnPlacement=placement.name;
      extentW=Math.max(extentW,placement.left+tw+8);
      extentH=Math.max(extentH,placement.top+th+8);
    });
    bnPostContentWarningBounds(extentW,extentH);
  };

  /* 最終呈現統一為畫板外下方的同寬警語列：完全不遮擋版型內容，
     只增加預覽高度；文字與按鈕仍使用行內流動排版。 */
  var _bnApplyContentWarningsBoardBottomBase=applyContentWarnings;
  applyContentWarnings=function(messages){
    _bnApplyContentWarningsBoardBottomBase(messages);
    var cv=document.getElementById('canvas');
    if(!cv||!Array.isArray(messages)||!messages.length) return;
    var cw=cv.offsetWidth||parseFloat(cv.style.width)||0;
    var ch=cv.offsetHeight||parseFloat(cv.style.height)||0;
    var gap=8;
    var extentH=ch;
    document.querySelectorAll('.bn-content-warning-tip').forEach(function(tip){
      tip.style.width=cw+'px';
      tip.style.maxWidth=cw+'px';
      tip.style.left='0px';
      tip.style.top=(ch+gap)+'px';
      tip.dataset.bnPlacement='board-bottom';
      extentH=Math.max(extentH,ch+gap+tip.offsetHeight+8);
    });
    bnPostContentWarningBounds(cw,extentH);
  };

  /* 商品框 = 商品本體（不含影子）的範圍。完整圖片（含影子）以百分比定位放大，
     讓商品本體剛好對齊框；框外的影子因 overflow:visible 仍會顯示，圖片不被裁切。 */
  /* 只依框的寬度算一個倍率，寬高都用同一倍率的像素值，圖片比例永遠不會被拉伸。 */
  function bnLayoutProductImg(img){
    var f = img._bnFit, box = img.parentNode;
    if(!f || !box) return;
    var pw = f.pr.w || f.nw;
    var bw = box.offsetWidth || parseFloat(box.style.width) || 1;
    var k = bw / pw;
    img.style.position = 'absolute';
    img.style.width = (f.nw * k) + 'px';
    img.style.height = (f.nh * k) + 'px';
    img.style.left = (-(f.pr.x || 0) * k) + 'px';
    img.style.top = (-(f.pr.y || 0) * k) + 'px';
    img.style.objectFit = 'fill';
    img.style.clipPath = '';
  }
  function bnFitProductImg(img, pr, nw, nh){
    img._bnFit = {pr: pr, nw: nw, nh: nh};
    bnLayoutProductImg(img);
    var box = img.parentNode;
    if(box && window.ResizeObserver && !box._bnRO){
      box._bnRO = new ResizeObserver(function(){ bnLayoutProductImg(img); });
      box._bnRO.observe(box);
    }
  }
  /* 沒有 productRect 時回到 object-fit:contain 模式 */
  function bnResetProductImg(img){
    img._bnFit = null;
    img.style.position = ''; img.style.left = ''; img.style.top = '';
    img.style.width = '100%'; img.style.height = '100%';
    img.style.objectFit = 'contain'; img.style.clipPath = '';
  }
  /* 圖片載入完成的唯一處理：永遠讀「框上目前的 productRect」，不用閉包鎖住舊值。
     （之前旋轉換圖後，新增時留下的 onload 還拿著舊範圍去算新圖，圖片就爆大。） */
  function bnProductImgLoaded(img){
    var box = img.parentNode; if(!box) return;
    var pr = null;
    try{ pr = JSON.parse(box.dataset.productRect || 'null'); }catch(_){ pr = null; }
    if(pr && pr.w && pr.h){
      bnFitProductImg(img, pr, img.naturalWidth || img.width || 1, img.naturalHeight || img.height || 1);
    }else{
      bnResetProductImg(img);
    }
  }
  /* 框的高度永遠由寬度與商品範圍比例決定；沒有 productRect 時回傳 null（沿用原高）。 */
  function bnBoxHeightFor(box, w){
    var pr = null;
    try{ pr = JSON.parse(box.dataset.productRect || 'null'); }catch(_){ pr = null; }
    if(pr && pr.w && pr.h) return w * pr.h / pr.w;
    return null;
  }
  /* 程式改完框尺寸後立刻重排圖片，不只靠 ResizeObserver（它要等下一次 render，
     畫面被隱藏或緊接著截圖時可能來不及）。 */
  function bnRelayoutProductBox(box){
    var img = box && box.querySelector('img');
    if(img && img._bnFit) bnLayoutProductImg(img);
  }
  window.addEventListener('message', function(e) {
    if (!e.data) return;

    if(e.data.type==='bn-content-warning'){
      applyContentWarnings(e.data.messages||[]);
      return;
    }

    if (e.data.type === 'bn-text') {
      var d = e.data.data||{};
      ['品牌名','主標','副標','日期'].forEach(function(cls) {
        if (d[cls]===undefined) return;
        document.querySelectorAll('.'+cls).forEach(function(el) {
          var ct = el.querySelector('.cta-text');
          if(ct) ct.textContent = d[cls];
          else if(!el.children.length) el.textContent = d[cls];
        });
        /* Search_Image：副標案型七字內 連動副標（雙向同步）*/
        if(cls === '副標'){
          var siEl = document.querySelector('.副標案型七字內');
          if(siEl && !siEl.children.length) {
            siEl.textContent = d[cls];
            if(typeof window._siRelayout === 'function'){
              if(document.fonts && document.fonts.ready){
                document.fonts.ready.then(function(){ window._siRelayout(); });
              } else {
                setTimeout(window._siRelayout, 150);
              }
            }
          }
        }
        if(cls === '副標案型七字內'){
          var subEl = document.querySelector('.副標');
          /* 副標案型七字內 編輯時不反向同步到其他版位的 .副標，由 bn-text-update 統一處理 */
        }
        /* AR：六字內 預設連動副標文字；使用者在 AR 畫布內手動編輯過後（bnManualText），
           不再被之後的副標變更覆蓋──編輯結果保持獨立，不反串連回副標欄位。 */
        if(cls === '副標'){
          var arEl = document.querySelector('.六字內');
          if(arEl && !arEl.children.length && arEl.dataset.bnManualText !== '1'){
            arEl.textContent = d[cls];
          }
        }
      });
      setTimeout(function(){ try{ refreshOverflowAll(); }catch(_){} }, 0);
      setTimeout(function(){ applyContentWarnings(window.__bnContentWarningMessages||[]); },0);
    }

    /* 畫布直接編輯完成後，父層轉換好再推回來 */
    if (e.data.type === 'bn-text-set') {
      var cls = e.data.field;
      var val = e.data.value;
      if(!cls) return;
      document.querySelectorAll('.'+cls).forEach(function(el) {
        var ct = el.querySelector('.cta-text');
        /* 編輯中不更新，避免跟 contenteditable 衝突 */
        if(el.contentEditable === 'true') return;
        if(ct) ct.textContent = val;
        else if(!el.children.length) el.textContent = val;
      });
      setTimeout(function(){ try{ refreshOverflowAll(); }catch(_){} }, 0);
      setTimeout(function(){ applyContentWarnings(window.__bnContentWarningMessages||[]); },0);
    }

    if (e.data.type === 'bn-overflow-check') {
      try{ refreshOverflowAll(); }catch(_){}
    }

    if (e.data.type === 'bn-color') {
      var c = Object.assign({},e.data.data||{}), cv = document.getElementById('canvas');
      if((_bnFixedWhiteBackgroundTemplate || _bnWhiteCanvasUnderCircleTemplate) && cv){
        cv.style.setProperty('background', '#fff', 'important');
      }
      _bnRestrictedColorKeys.forEach(function(key){
        if(c[key]!==undefined) c[key]=_bnSafeRestrictedColor(key,c[key]);
      });
      _bnLastSafeColors=Object.assign({},_bnLastSafeColors,c);
      if (c.canvasBg) {
        _bnCurrentCanvasBg = c.canvasBg;
        /* 只有首頁 LOGO 牆固定白底；SearchICON 的圓底（.背景色）仍吃目前選取的背景色，
           圓底之下的 #canvas 已在上面鎖白，這裡不要再把顏色寫到 #canvas。 */
        var canvasBgForLayout = _bnFixedWhiteBackgroundTemplate ? '#fff' : c.canvasBg;
        /* 支援 .背景色 和 .bg 兩種 class 名稱 */
        var bg = cv.querySelector('.背景色') || cv.querySelector('.bg') || cv.querySelector('.底色');
        if(bg) bg.style.setProperty('background-color', canvasBgForLayout, 'important');
        else if(!_bnWhiteCanvasUnderCircleTemplate) cv.style.setProperty('background', canvasBgForLayout, 'important');
        /* 漸層顏色跟著背景色同步（讀 CSS --grad-dir 變數）*/
        /* 漸層顏色同步：transparent → rgba(r,g,b,0) 避免截圖變黑 */
        function _toRgba0rt(color){
          var m=color.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
          if(m) return 'rgba('+m[1]+','+m[2]+','+m[3]+',0)';
          var h=color.replace('#','');
          if(h.length===3) h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
          if(h.length===6) return 'rgba('+parseInt(h.slice(0,2),16)+','+parseInt(h.slice(2,4),16)+','+parseInt(h.slice(4,6),16)+',0)';
          return 'rgba(0,0,0,0)';
        }
        var _dirsRt = {'漸層左':'to right','漸層右':'to left','漸層上':'to bottom','漸層下':'to top'};
        ['漸層左','漸層右','漸層上','漸層下'].forEach(function(cls){
          var gel = cv.querySelector('.'+cls);
          if(!gel) return;
          var dir = _dirsRt[cls] || window.getComputedStyle(gel).getPropertyValue('--grad-dir').trim();
          if(dir){
            /* ────────── 漸層 1px 接縫修正 ──────────
               症狀：漸層區塊的「最後 1 像素列/行」會整條變成不透明的畫布底色，
                     在底圖上看起來就是一條橫線／直線。只有部分使用者會遇到。
               主因：background-image 預設 background-repeat: repeat。
                     當漸層 tile 的尺寸換算成裝置像素出現小數（畫布 scale 為
                     任意小數、或 Windows 顯示縮放 125%/150% 使 devicePixelRatio
                     非整數）時，元素最後一列會取樣到「下一塊 tile 的 0%」，
                     也就是完全不透明的底色 → 出現色帶。
                     這裡原本用 background 簡寫，簡寫會把 background-repeat
                     重設回 repeat，就算 CSS 有寫 no-repeat 也會被蓋掉。
               修正 1：改用 backgroundImage，並明確指定 no-repeat。
               修正 2：漸層的 alpha 提早在邊緣前 GRAD_SAFE_PX 就歸零，
                     讓元素邊緣是純透明，抗鋸齒也不會有殘影。
               ──────────────────────────────────── */
            var GRAD_SAFE_PX = 8;
            var _vert = (dir === 'to bottom' || dir === 'to top');
            var _size = _vert ? gel.offsetHeight : gel.offsetWidth;
            var _stop = (_size > GRAD_SAFE_PX)
                        ? (((_size - GRAD_SAFE_PX) / _size) * 100).toFixed(3)
                        : 100;
            var _c0 = _toRgba0rt(canvasBgForLayout);
            gel.style.backgroundColor  = 'transparent';
            gel.style.backgroundImage  = 'linear-gradient(' + dir + ', ' + canvasBgForLayout + ' 0%, '
                                         + _c0 + ' ' + _stop + '%, ' + _c0 + ' 100%)';
            gel.style.backgroundRepeat = 'no-repeat';
            gel.style.backgroundSize   = '100% 100%';
          }
        });
        /* 所有保護色塊跟著背景色同步 */
        ['.文案保護','.右側保護','.左側保護','.上方保護','.下方保護','.上保護','.下保護','.底色'].forEach(function(sel){
          var el = cv.querySelector(sel);
          if(el) el.style.setProperty('background', canvasBgForLayout, 'important');
        });
        /* .bg 純色塊也同步（Coin 等版位） */
        var bgEl2 = cv.querySelector('.bg');
        if(bgEl2 && !cv.querySelector('.背景色')) bgEl2.style.setProperty('background-color', canvasBgForLayout, 'important');
      }
      /* 背景色更新後，人物專用漸層也要重新讀取目前版型的漸層顏色。 */
      syncAllCharGradientOverlays();
      function ac(cls,col){ if(!col)return; document.querySelectorAll('.'+cls).forEach(function(el){ if(!el.querySelector('.cta-text')) el.style.setProperty('color',col,'important'); }); }
      ac('主標',c.mainText); ac('副標',c.subText); ac('日期',c.dateText); ac('品牌名',c.brandText);
      /* Search_Image：副標案型七字內 顏色跟著副標文字色連動 */
      document.querySelectorAll('.副標案型七字內').forEach(function(el){ if(c.subText) el.style.setProperty('color', c.subText, 'important'); });
      /* AR：六字內 顏色固定跟著副標文字色連動（僅文字內容獨立，顏色仍預設連動） */
      document.querySelectorAll('.六字內').forEach(function(el){ if(c.subText) el.style.setProperty('color', c.subText, 'important'); });
      var normalCtaText = c.ctaTextAuto === false && c.ctaText
        ? c.ctaText
        : _bnCtaForegroundForBg(c.ctaBg, c.mainText, c.canvasBg);
      var searchImageCtaText = c.searchImageCtaText || (c.ctaTextAuto === false && c.ctaText
        ? c.ctaText
        : _bnCtaForegroundForBg(c.searchImageCtaBg, c.mainText, c.canvasBg));
      document.querySelectorAll('.cta-text').forEach(function(el){ el.style.setProperty('color',normalCtaText,'important'); });
      document.querySelectorAll('.cta-arrow').forEach(function(el){ el.style.setProperty('border-left-color',normalCtaText,'important'); });
      /* CTA 底色：.逛逛去按鈕 / .cta底 / .逛逛去底 */
      document.querySelectorAll('.逛逛去按鈕,.cta底,.逛逛去底').forEach(function(el){ if(c.ctaBg) el.style.setProperty('background-color',c.ctaBg,'important'); });
      /* Search Image CTA 底色：只影響 Search_Image 版型的圓形 CTA */
      document.querySelectorAll('.cta圓底').forEach(function(el){ if(c.searchImageCtaBg) el.style.setProperty('background-color', c.searchImageCtaBg, 'important'); });
      if(c.tagColor){
        if(typeof window._bnSetTagColor === 'function') window._bnSetTagColor(c.tagColor);
        else {
          _bnTagColor = (c.tagColor === 'white') ? 'white' : 'red';
          if(typeof window._bnApplyTag === 'function') window._bnApplyTag();
        }
      }
      /* CTA 文字色：.放心買_安心退 / .逛逛去 */
      document.querySelectorAll('.放心買_安心退,.逛逛去,.cta符號').forEach(function(el){ el.style.setProperty('color',normalCtaText,'important'); });
      /* CTA 三角色：.cta三角標 / .逛逛去三角標 */
      document.querySelectorAll('.cta三角標').forEach(function(el){ el.style.setProperty('border-left-color',normalCtaText,'important'); });
      document.querySelectorAll('.逛逛去三角標').forEach(function(el){ el.style.setProperty('border-left-color',normalCtaText,'important'); });
      document.querySelectorAll('.cta三角箭頭').forEach(function(el){ el.style.setProperty('border-left-color',searchImageCtaText,'important'); });
      _bnEnforceRestrictedColors(cv);
    }

    if (e.data.type === 'bn-logo' || e.data.type === 'bn-logos') {
      var zone = null;
      /* Search_Image2：依 logo index 分左右 zone */
      var _fname2 = decodeURIComponent(location.pathname.split('/').pop()).toLowerCase();
      if(_fname2.indexOf('search_image2') !== -1 || _fname2.indexOf('search_image3') !== -1){
        var logos2 = Array.isArray(e.data.logos) ? e.data.logos :
                     (e.data.src ? [e.data] : []);
        var _is3 = _fname2.indexOf('search_image3') !== -1;
        /* 2logo：左/右；3logo：左/中/右 */
        var _zoneNames = _is3
          ? ['logo範圍_左','logo範圍_中','logo範圍_右']
          : ['logo範圍_左','logo範圍_右'];
        function _siPlaceLogo(zn, lg){
          if(!zn||!lg) return;
          Array.from(zn.querySelectorAll('img.bn-logo-img')).forEach(function(i){i.remove();});
          zn.style.background = 'transparent'; zn.style.opacity = '1'; zn.style.overflow = 'hidden';
          zn.style.display = 'flex'; zn.style.alignItems = 'center'; zn.style.justifyContent = 'center';
          var img = new Image(); img.className = 'bn-logo-img';
          img.style.cssText = 'max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;pointer-events:none;display:block;';
          if(lg.round) img.style.borderRadius = '10px';
          img.src = lg.src;
          zn.appendChild(img);
        }
        _zoneNames.forEach(function(cls, i){
          var zn = document.querySelector('.'+cls);
          if(logos2[i]) _siPlaceLogo(zn, logos2[i]);
        });
        return;
      }
      ['logo範圍','LOGO範圍'].forEach(function(n){ if(!zone){ var z=document.querySelector('.'+n); if(z) zone=z; } });
      if (!zone) return;

      Array.from(zone.querySelectorAll('img.bn-logo-img')).forEach(function(i){i.remove();});
      /* 還原 display 避免舊設定殘留 */
      zone.style.display = ''; zone.style.alignItems = '';

      var fn = decodeURIComponent(location.pathname.split('/').pop());
      var fnLow = fn.toLowerCase();
      var _logoZone = document.querySelector('.logo範圍') || document.querySelector('.LOGO範圍');
      var _logoIsWide = _logoZone &&
        (parseFloat(window.getComputedStyle(_logoZone).width) >
         parseFloat(window.getComputedStyle(_logoZone).height) * 1.5);
      /* HBN：檔名含 hbn，或已知左對齊版位 → 左對齊 absolute 並排 */
      var _leftAlignNames = ['hbn','coin','fb_post','lpbn','ams','sba','活動總覽'];
      var _isLeftAlign = _leftAlignNames.some(function(n){ return fnLow.indexOf(n) !== -1; });
      var isHBN = _isLeftAlign;
      /* 多張置中：logo範圍是橫條 且 不是左對齊版位 → flex 置中並排（ddcard橫、IG橫等）*/
      var isMultiCenter = !isHBN && !!_logoIsWide;
      /* IG方/ddcard方/Search_Image/SearchICON 系列：單張 contain 置中。
         SearchICON_LOGO、SearchICON_120 這類小圓形 ICON 版位只有一個小圖示位，
         不管上傳幾張 LOGO，都只能放進第一張，不然多張擠在一起會裁切、看不清楚。 */
      var isIGSquare = !isHBN && !isMultiCenter &&
        (fn.indexOf('方') !== -1 || fnLow.indexOf('search_image') !== -1 || fnLow.indexOf('searchicon') !== -1);
      /* ddcard：檔名含 ddcard */
      var isDDCard = fnLow.indexOf('ddcard') !== -1;
      /* 方 Logo 系列：不依「橫 Logo」文字判斷，而是針對實際上傳圖片比例做 fit。 */
      var isSquareLogoLayout = (fn.indexOf('方') !== -1);

      var logos = [];
      if (e.data.type === 'bn-logos') logos = e.data.logos || [];
      else if (e.data.dataUrl) logos = [{id:'single', src:e.data.dataUrl}];

      if (!logos.length) {
        zone.style.opacity='';
        zone.style.background = _bnSearchIconLogoTemplate ? '#fff' : '';
        if(_bnSearchIconLogoTemplate) zone.style.setProperty('background-color','#fff','important');
        return;
      }

      /* IG方 / 方 Logo 系列：只取第一張，避免方版 logo 區多張擠壓或裁切。 */
      if (isIGSquare || isSquareLogoLayout) logos = logos.slice(0, 1);
      /* AR_LOGO / 首頁LOGO牆：固定只顯示第一個 LOGO */
      if (_bnSingleLogoTemplate) logos = logos.slice(0, 1);
      /* ddcard橫：isMultiCenter → 多張，不限制；ddcard方（isIGSquare）→ 單張 */

      /* 首頁LOGO牆的 logo範圍是白色圓角卡片（CSS 設計的一部分），不是上傳前的
         提示色塊，所以放入 LOGO 後仍要維持白底，不能跟其他版位一樣被清成透明。 */
      zone.style.background = (_bnSingleProductForLogoWallTemplate || _bnSearchIconLogoTemplate) ? '#fff' : 'transparent';
      if(_bnSearchIconLogoTemplate) zone.style.setProperty('background-color','#fff','important');
      zone.style.opacity    = '1';
      /* 不覆蓋 position，保持 CSS 的 absolute 定位 */
      zone.style.overflow   = 'hidden';

      function _fitHorizontalLogos(logosToPlace, alignMode){
        var gap = 15;
        var zoneW = parseFloat(window.getComputedStyle(zone).width) || 490;
        var zoneH = parseFloat(window.getComputedStyle(zone).height) || 50;
        var maxTotal = Math.min(490, zoneW);
        var imgs = [];
        /* 不要把 CSS 的 position:absolute 覆蓋成 relative。
           ddcard 橫 logo 的 .logo範圍 原本靠 CSS absolute 定位；
           工單匯入後 iframe 會重建並重新套 logo，如果這裡改成 relative，
           logo 區會掉回正常文件流，造成畫布上的 logo 往下偏移。 */
        var _zonePos = window.getComputedStyle(zone).position;
        if(!_zonePos || _zonePos === 'static') zone.style.position = 'relative';
        zone.style.overflow = 'visible';
        zone.style.display = 'block';
        zone.style.alignItems = '';
        zone.style.justifyContent = '';
        zone.style.gap = '';
        zone.style.transformOrigin = '';
        function relayout(){
          var widths = imgs.map(function(img){
            var ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
            return Math.min(200, Math.max(1, Math.round(zoneH * ratio)));
          });
          var total = widths.reduce(function(a,b){ return a + b; }, 0) + gap * Math.max(0, widths.length - 1);
          var scale = total > maxTotal ? (maxTotal - gap * Math.max(0, widths.length - 1)) / Math.max(1, widths.reduce(function(a,b){ return a + b; }, 0)) : 1;
          if(scale < 0) scale = maxTotal / Math.max(1, total);
          widths = widths.map(function(w){ return Math.max(1, Math.floor(w * Math.min(1, scale))); });
          total = widths.reduce(function(a,b){ return a + b; }, 0) + gap * Math.max(0, widths.length - 1);
          var x = alignMode === 'center' ? Math.max(0, (zoneW - total) / 2) : 0;
          imgs.forEach(function(img, i){
            if(img.dataset.manualLayout === '1'){ x += widths[i] + gap; return; }
            img.style.position = 'absolute';
            img.style.left = Math.round(x) + 'px';
            img.style.top = '50%';
            img.style.transform = 'translateY(-50%)';
            img.style.width = widths[i] + 'px';
            img.style.height = 'auto';
            img.style.maxWidth = '200px';
            img.style.maxHeight = '100%';
            img.style.objectFit = 'contain';
            img.style.objectPosition = alignMode === 'center' ? 'center center' : 'left center';
            img.style.pointerEvents = 'none';
            img.style.display = 'block';
            x += widths[i] + gap;
          });
        }
        logosToPlace.forEach(function(lg){
          var img = new Image(); img.className = 'bn-logo-img';
          if(lg.round) img.style.borderRadius = '10px';
          img.onload = relayout;
          img.src = lg.src;
          imgs.push(img);
          zone.appendChild(img);
        });
        relayout();
      }

      /* HBN：absolute 多張；IG方/ddcard方：單張 contain 正方；IG橫/ddcard橫：受限並排 */
      if(isSquareLogoLayout){
        /* 方 Logo 系列：若上傳的是橫向 logo，改以寬度為主、高度 auto，並上下左右置中，避免被裁切。 */
        zone.style.display = 'flex';
        zone.style.alignItems = 'center';
        zone.style.justifyContent = 'center';
        zone.style.gap = '';
        zone.style.transformOrigin = '';
        var sqLg = logos[0];
        var sqImg = new Image(); sqImg.className = 'bn-logo-img';
        var sqRoundCss = sqLg.round ? 'border-radius:10px;' : '';
        sqImg.style.cssText = 'max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;object-position:center center;pointer-events:none;display:block;flex-shrink:1;'+sqRoundCss;
        sqImg.onload = function(){
          var isWideLogo = sqImg.naturalWidth > sqImg.naturalHeight;
          if(isWideLogo){
            sqImg.style.width = '100%';
            sqImg.style.height = 'auto';
            sqImg.style.maxWidth = '100%';
            sqImg.style.maxHeight = '100%';
          }else{
            sqImg.style.width = 'auto';
            sqImg.style.height = 'auto';
            sqImg.style.maxWidth = '100%';
            sqImg.style.maxHeight = '100%';
          }
          if(typeof window._siRelayout === 'function'){
            if(document.fonts && document.fonts.ready){
              document.fonts.ready.then(function(){ window._siRelayout(); });
            } else {
              setTimeout(window._siRelayout, 150);
            }
          }
        };
        sqImg.src = sqLg.src;
        zone.appendChild(sqImg);
      } else if(isHBN){
        /* 橫式左齊：單張最多 200px；多 LOGO 含 15px 間距總寬最多 490px，且不超過 logo 範圍，避免裁切。 */
        _fitHorizontalLogos(logos, 'left');
      } else if(isMultiCenter){
        /* 橫式置中：單張最多 200px；多 LOGO 含 15px 間距總寬最多 490px，且不超過 logo 範圍，避免裁切。 */
        _fitHorizontalLogos(logos, 'center');
      } else if(isIGSquare){
        /* IG方：單張，依較大邊 contain 縮放，置中不裁切 */
        zone.style.display = 'flex';
        zone.style.alignItems = 'center';
        zone.style.justifyContent = 'center';
        zone.style.transformOrigin = '';
        var lg0 = logos[0];
        var img0 = new Image(); img0.className = 'bn-logo-img';
        var roundCss0 = lg0.round ? 'border-radius:10px;' : '';
        /* max-width/max-height 100% + width/height auto = contain 效果，不裁切 */
        img0.style.cssText = 'max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;pointer-events:none;display:block;'+roundCss0;
        img0.src = lg0.src;
        img0.onload = function(){
          if(typeof window._siRelayout === 'function'){
              if(document.fonts && document.fonts.ready){
                document.fonts.ready.then(function(){ window._siRelayout(); });
              } else {
                setTimeout(window._siRelayout, 150);
              }
            }
        };
        zone.appendChild(img0);
      } else {
        /* 其他橫式：單張最多 200px；多 LOGO 含 15px 間距總寬最多 490px，且不超過 logo 範圍，避免裁切。 */
        _fitHorizontalLogos(logos, 'center');
      }

      if(_bnSingleLogoTemplate){
        /* _fitHorizontalLogos()／isIGSquare 分支都會把 zone.style.overflow
           設回 'visible'（避免初始排版誤裁切），但首頁LOGO牆／AR_LOGO 這類
           單張 LOGO 版位滾輪放大時是靠拿掉 max-width/height 限制、直接放大
           img 尺寸做到「持續放大」，因此這裡要強制蓋回 hidden，讓放大後超出
           logo範圍的部分被遮色裁掉，而不是整張圖片一起放大跑出版位外。 */
        zone.style.overflow = 'hidden';

        /* 滾輪縮放／左鍵拖曳都改成「設計座標」（除掉畫布顯示縮放），並在每次
           調整後把位置大小回報給外層（bn-searchicon-logo-layout-update 是
           外層記錄單張 LOGO 版面的通用訊息）。下載時外層會重送 bn-logos 讓
           iframe 重建，沒有回報＋還原的話，LOGO 就會回到預設大小與位置。 */
        var _logoWallScale = function(){
          var dw = zone.offsetWidth || 1;
          return (zone.getBoundingClientRect().width / dw) || 1;
        };
        var _logoWallTakeOver = function(img){
          if(img.dataset.manualLayout === '1') return;
          var S = _logoWallScale();
          var zr = zone.getBoundingClientRect();
          var ir = img.getBoundingClientRect();
          var w = ir.width / S, h = ir.height / S;
          img.dataset.manualLayout = '1';
          img.dataset.ratio = (w && h) ? w / h : 1;
          img.style.position = 'absolute';
          img.style.transform = 'none';
          img.style.width = w + 'px';
          img.style.height = h + 'px';
          img.style.maxWidth = 'none';
          img.style.maxHeight = 'none';
          img.style.left = ((ir.left - zr.left) / S) + 'px';
          img.style.top = ((ir.top - zr.top) / S) + 'px';
        };
        var _logoWallPostLayout = function(img){
          try{
            window.parent.postMessage({
              type:'bn-searchicon-logo-layout-update',
              bnid:getCurrentBnId(),
              layout:{
                left: parseFloat(img.style.left) || 0, top: parseFloat(img.style.top) || 0,
                width: parseFloat(img.style.width) || 0, height: parseFloat(img.style.height) || 0
              }
            }, '*');
          }catch(_){}
        };

        /* 外層重送 LOGO 時帶回先前存的版面：還原位置與大小。寬度沿用、高度交給
           圖片比例，避免換成不同比例的新 LOGO 時被拉伸。 */
        var _savedLogoLayout = e.data.logoLayoutById && e.data.logoLayoutById[getCurrentBnId()];
        var _logoImgNow = zone.querySelector('img.bn-logo-img');
        if(_savedLogoLayout && _logoImgNow && _savedLogoLayout.width > 0
           && isFinite(_savedLogoLayout.left) && isFinite(_savedLogoLayout.top)){
          _logoImgNow.dataset.manualLayout = '1';
          _logoImgNow.dataset.ratio = _savedLogoLayout.height > 0 ? _savedLogoLayout.width / _savedLogoLayout.height : 1;
          _logoImgNow.style.position = 'absolute';
          _logoImgNow.style.transform = 'none';
          _logoImgNow.style.width = _savedLogoLayout.width + 'px';
          _logoImgNow.style.height = 'auto';
          _logoImgNow.style.maxWidth = 'none';
          _logoImgNow.style.maxHeight = 'none';
          _logoImgNow.style.left = _savedLogoLayout.left + 'px';
          _logoImgNow.style.top = _savedLogoLayout.top + 'px';
        }

        /* 這個 if 區塊在每次收到 bn-logo／bn-logos 訊息時都會重新執行一次
           （同一個 zone 元素不會被移除重建），如果每次都 addEventListener
           會疊加出多個監聽器，同一次滾輪就會被放大好幾次（越用越暴衝）。
           用 dataset 記一個旗標，確保整個版位存活期間只綁定一次。 */
        if(!zone.dataset.bnWheelBound){
          zone.dataset.bnWheelBound = '1';
          zone.style.cursor = 'move';
          zone.addEventListener('wheel', function(e){
            e.preventDefault();
            var img = zone.querySelector('img.bn-logo-img');
            if(!img) return;
            _logoWallTakeOver(img);
            var sc = e.deltaY < 0 ? 1.08 : .93;
            var r = parseFloat(img.dataset.ratio) || 1;
            var curW = parseFloat(img.style.width) || img.offsetWidth;
            var curH = parseFloat(img.style.height) || img.offsetHeight;
            var w = Math.max(10, curW * sc);
            var ih = w / r;
            /* 以縮放前的中心點為基準，從中心放大／縮小 */
            var cx = (parseFloat(img.style.left) || 0) + curW / 2;
            var cy = (parseFloat(img.style.top) || 0) + curH / 2;
            img.style.width = w + 'px';
            img.style.height = ih + 'px';
            img.style.left = (cx - w/2) + 'px';
            img.style.top = (cy - ih/2) + 'px';
            _logoWallPostLayout(img);
          }, {passive: false});
          zone.addEventListener('mousedown', function(e){
            if(e.button !== 0) return;
            var img = zone.querySelector('img.bn-logo-img');
            if(!img) return;
            e.preventDefault();
            _logoWallTakeOver(img);
            var S = _logoWallScale();
            var startX = e.clientX, startY = e.clientY;
            var startLeft = parseFloat(img.style.left) || 0, startTop = parseFloat(img.style.top) || 0;
            function onMove(ev){
              img.style.left = (startLeft + (ev.clientX - startX) / S) + 'px';
              img.style.top = (startTop + (ev.clientY - startY) / S) + 'px';
            }
            function onUp(){
              window.removeEventListener('mousemove', onMove, true);
              window.removeEventListener('mouseup', onUp, true);
              _logoWallPostLayout(img);
            }
            window.addEventListener('mousemove', onMove, true);
            window.addEventListener('mouseup', onUp, true);
          });
        }
      }
    }

    /* 商品新增 */
    if (e.data.type === 'bn-product-add') {
      var pzone = getProductZone(); if(!pzone) return;
      var oldBox = pzone.querySelector('.bn-prod-box[data-id="'+e.data.id+'"]');
      if(oldBox) oldBox.remove();
      pzone.style.background = 'transparent'; pzone.style.backgroundColor = 'transparent'; pzone.style.opacity = '1';
      if(_bnSearchIconProductTemplate){
        /* 圓形商品圖遮色區維持白底，不透出 SearchICON 的背景色。 */
        pzone.style.setProperty('background-color','#fff','important');
        pzone.style.setProperty('background-image','none','important');
      }
      pzone.style.overflow = 'visible'; pzone.style.position = 'relative';
      var box = document.createElement('div');
      box.className = 'bn-prod-box'; box.dataset.id = e.data.id;
      /* 若有 productRect（商品本身不含影子），用它計算框的比例；
         否則建立一個臨時的（與完整圖片相同，稍後 update-image 會更新） */
      var productRect = e.data.productRect;
      var boxRatio = e.data.ratio||1;
      if(productRect){
        boxRatio = productRect.w / Math.max(1, productRect.h);
        box.dataset.productRect = JSON.stringify(productRect);
      }
      box.dataset.ratio = boxRatio;
      box.dataset.imageRatio = e.data.ratio||1; /* 完整圖片的比例（含影子）*/
      box.dataset.sizeScale = e.data.sizeScale||1;
      box.dataset.position  = e.data.position !== undefined ? e.data.position : e.data.index || 0;
      if(e.data.layoutById || e.data.layout){
        var __bnid = getCurrentBnId();
        var __lay = (e.data.layoutById && (__bnid in e.data.layoutById) ? e.data.layoutById[__bnid] : null) || e.data.layout || null;
        if(__lay){
          box.dataset.savedLayout = JSON.stringify(__lay);
          box.dataset.manualLayout = '1';
        }
      }
      /* 先依傳來的 zOrder 給一個暫時的 z-index（zOrder 小 = 上層），讓新加入的商品
         在 bn-product-zorder 送到之前就跟工具列的上下順序一致，不會先以 DOM 順序
         （後加的蓋前面的）閃一下；之後 bn-product-zorder 會再統一覆寫。 */
      if(e.data.zOrder !== undefined && e.data.zOrder !== null){
        box.style.zIndex = String(Math.max(11, 200 - (parseInt(e.data.zOrder, 10) || 0)));
      }
      var pimg = document.createElement('img'); pimg.src = e.data.src;
      pimg.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none;display:block;';
      /* 載入後依框上的 productRect 把商品本體對齊框（影子露在框外）；
         之後換圖也走同一個 handler，不會拿到舊範圍。 */
      pimg.onload = function(){ bnProductImgLoaded(pimg); };
      box.appendChild(pimg);
      box.dataset.rotate = String(Number(e.data.rotate) || 0);
      /* 旋轉把手：框正上方一條短桿接一顆圓鈕，拖曳繞框中心旋轉（Canva／Figma 慣例）。
         角度不在這裡烘進圖片，只做即時 CSS 預覽；放開後把增量送回父頁，由父頁
         走 baseSrc → 旋轉 → 影子 的管線重算，再用 bn-product-update-image 換圖。 */
      var rh = document.createElement('div'); rh.dataset.rotateHandle = '1';
      rh.title = '拖曳旋轉（Shift：每 15°；雙擊：回到 0°）';
      rh.style.cssText = 'position:absolute;left:50%;top:-34px;width:20px;height:34px;margin-left:-10px;z-index:6;cursor:grab;touch-action:none;';
      rh.innerHTML = '<div style="position:absolute;left:50%;top:18px;width:2px;height:16px;margin-left:-1px;background:#4a90e2;"></div>'
        + '<div style="position:absolute;left:50%;top:0;width:18px;height:18px;margin-left:-9px;border-radius:50%;background:#fff;border:2px solid #4a90e2;box-sizing:border-box;color:#4a90e2;font:bold 11px/14px sans-serif;text-align:center;">&#8635;</div>';
      box.appendChild(rh);
      var rb = document.createElement('div'); rb.dataset.rotateBadge = '1';
      rb.style.cssText = 'position:absolute;left:50%;top:-58px;transform:translateX(-50%);display:none;padding:2px 7px;border-radius:10px;background:rgba(20,24,33,.9);color:#fff;font:600 11px/16px sans-serif;white-space:nowrap;pointer-events:none;z-index:7;';
      box.appendChild(rb);
      ['nw','ne','sw','se'].forEach(function(c){
        var h = document.createElement('div'); h.dataset.corner = c;
        h.style.cssText = 'position:absolute;width:14px;height:14px;border-radius:50%;background:#4a90e2;border:2px solid #fff;z-index:5;'
          +(c==='nw'?'left:-7px;top:-7px;cursor:nwse-resize;':'')
          +(c==='ne'?'right:-7px;top:-7px;cursor:nesw-resize;':'')
          +(c==='sw'?'left:-7px;bottom:-7px;cursor:nesw-resize;':'')
          +(c==='se'?'right:-7px;bottom:-7px;cursor:nwse-resize;':'');
        box.appendChild(h);
      });
      pzone.appendChild(box);
      setupProdDrag(box, pzone);
      layoutProducts(pzone);
      applyCharacterZ();
      applySingleProductOnlyIfNeeded(pzone);
    }

    if (e.data.type === 'bn-product-remove') {
      var pzone = getProductZone(); if(!pzone) return;
      var el = pzone.querySelector('.bn-prod-box[data-id="'+e.data.id+'"]');
      if(el){ if(el._bnRO){ try{ el._bnRO.disconnect(); }catch(_){ } } el.remove(); }
      var remaining = pzone.querySelectorAll('.bn-prod-box');
      /* 商品全部移除時，只有「人物圖也沒有」才把提示色還原成預設淡紅；
         如果還有人物圖存在，代表這個範圍其實還有內容，不能還原成淡紅提示色。 */
      if(!remaining.length && !pzone.querySelector('.bn-char-box')) { pzone.style.background=''; pzone.style.opacity=''; }
      else if(remaining.length) layoutProducts(pzone);
      if(_bnSearchIconProductTemplate){
        pzone.style.setProperty('background-color','#fff','important');
        pzone.style.setProperty('background-image','none','important');
      }
      applyCharacterZ();
      applySingleProductOnlyIfNeeded(pzone);
    }

    /* 只換圖片內容（去背/裁切/擦除/影子外掛編輯器完成後用），完全不動商品目前的
       位置/大小/上下層——跟 bn-character-update-image 是同一套邏輯，避免像
       bn-product-remove+bn-product-add 那樣整個重建造成畫面閃跳、跳回預設位置。
       ★ 這是修補「編輯去背/影子後，畫面沒有變、下載卻是對的」這個問題的關鍵：
       bn-editor-plugin.js 編輯完成後只會發這則訊息，過去這裡完全沒有處理，
       畫面上的圖片永遠不會更新，只有下載時透過 bn-product-add 重新整批送一次
       商品資料，才會不小心把正確結果帶出來。 */
    if (e.data.type === 'bn-product-update-image') {
      var pzoneU = getProductZone(); if(!pzoneU) return;
      var boxU = pzoneU.querySelector('.bn-prod-box[data-id="'+e.data.id+'"]');
      if(boxU){
        if(e.data.rotate !== undefined && e.data.rotate !== null) boxU.dataset.rotate = String(Number(e.data.rotate) || 0);
        /* 先保存舊的商品範圍，用來換算目前的顯示倍率（覆寫前要先取） */
        var oldPRU = null;
        try{ oldPRU = JSON.parse(boxU.dataset.productRect || 'null'); }catch(_){ oldPRU = null; }
        var prectU0 = e.data.productRect || null;
        /* 更新 productRect（商品範圍不含影子）和 imageRatio（完整圖片含影子） */
        if(e.data.productRect){
          boxU.dataset.productRect = JSON.stringify(e.data.productRect);
          boxU.dataset.ratio = String(e.data.productRect.w / Math.max(1, e.data.productRect.h));
        }
        if(e.data.ratio !== undefined) boxU.dataset.imageRatio = String(e.data.ratio);
        var imgU = boxU.querySelector('img');
        if(imgU && e.data.src){
          if(e.data.keepScale && imgU.naturalWidth && imgU.naturalHeight){
            /* 旋轉後換圖：新圖外接矩形變大，若框維持原尺寸、object-fit:contain 會把商品
               看起來縮小。這裡以「舊圖實際顯示倍率」等比換算新框，並以原中心點定位，
               商品視覺大小不變，只是框跟著外接矩形長大／縮小。 */
            var owU = imgU.naturalWidth, ohU = imgU.naturalHeight;
            var bwU = parseFloat(boxU.style.width) || boxU.offsetWidth || 1;
            var bhU = parseFloat(boxU.style.height) || boxU.offsetHeight || 1;
            var blU = parseFloat(boxU.style.left) || 0, btU = parseFloat(boxU.style.top) || 0;
            /* 目前的顯示倍率（畫面 px ÷ 圖片 px）：
               框 = 商品本體時，框寬 = 舊商品寬 × 倍率，所以倍率 = 框寬 ÷ 舊商品寬；
               舊商品寬取「圖片目前實際套用的範圍」，不受 dataset 更新時序影響。
               沒有 productRect（contain 模式）才退回 min(框/圖)。 */
            var fitOld = imgU._bnFit && imgU._bnFit.pr;
            var prOldW = (fitOld && fitOld.w) || (oldPRU && oldPRU.w) || 0;
            var sU = (imgU._bnFit && prOldW > 0) ? bwU / prOldW : Math.min(bwU/owU, bhU/ohU);
            var newSrcU = e.data.src;
            var tmpU = new Image();
            tmpU.onload = function(){
              var prNew = e.data.productRect;
              var nw = prNew ? prNew.w * sU : tmpU.naturalWidth * sU;
              var nh = prNew ? prNew.h * sU : tmpU.naturalHeight * sU;
              if(nw > 0 && nh > 0){
                var csU = window.getComputedStyle(pzoneU);
                var zwU = parseFloat(csU.width) || pzoneU.offsetWidth || 1;
                var zhU = parseFloat(csU.height) || pzoneU.offsetHeight || 1;
                var rN = nw / nh;
                if(nw > zwU){ nw = zwU; nh = nw / rN; }
                if(nh > zhU){ nh = zhU; nw = nh * rN; }
                var cxU = blU + bwU/2, cyU = btU + bhU/2;
                var lU = Math.max(0, Math.min(zwU - nw, cxU - nw/2));
                var tU = Math.max(0, Math.min(zhU - nh, cyU - nh/2));
                boxU.dataset.manualLayout = '1';
                boxU.style.left = lU + 'px'; boxU.style.top = tU + 'px';
                boxU.style.width = nw + 'px'; boxU.style.height = nh + 'px';
                boxU.dataset.ratio = String(rN);
              }else if(e.data.ratio && !prNew){ boxU.dataset.ratio = e.data.ratio; }
              imgU.style.transform = '';
              /* 有 productRect 時，先用新圖尺寸把商品本體對齊框（換圖瞬間不閃）；
                 沒有就回到 contain 模式。onload 一定要換成讀取目前範圍的版本，
                 否則新增時留下的舊 onload 會用舊範圍重算新圖。 */
              var prectU = e.data.productRect;
              if(prectU && tmpU.naturalWidth && tmpU.naturalHeight){
                bnFitProductImg(imgU, prectU, tmpU.naturalWidth, tmpU.naturalHeight);
              }else{
                bnResetProductImg(imgU);
              }
              imgU.onload = function(){ bnProductImgLoaded(imgU); };
              imgU.src = newSrcU;
              postProductLayout(boxU);
            };
            tmpU.onerror = function(){ imgU.style.transform = ''; imgU.onload = function(){ bnProductImgLoaded(imgU); }; imgU.src = newSrcU; };
            tmpU.src = newSrcU;
          }else{
            /* 框比例以商品範圍為準（上面已設）；只有沒有 productRect 時才退回完整圖片比例，
               否則角落縮放／滾輪會用含影子的比例算框高，框比商品高、下方空一截。 */
            if(e.data.ratio && !prectU0) boxU.dataset.ratio = e.data.ratio;
            /* 商品範圍比例變了（例如去背後），框寬不動、高度依新比例重算，避免圖片變形 */
            if(prectU0 && prectU0.w && prectU0.h){
              var bwK = parseFloat(boxU.style.width) || boxU.offsetWidth || 1;
              boxU.style.height = (bwK * prectU0.h / prectU0.w) + 'px';
            }
            imgU.style.transform = '';
            /* 設定新圖片時，依 productRect 對齊商品本體 */
            imgU.onload = function(){ bnProductImgLoaded(imgU); };
            imgU.src = e.data.src;
          }
        }
      }
    }

    /* z-index 順序更新：order[0] = 最上層（z 最高） */
    if (e.data.type === 'bn-product-zorder') {
      var pzone = getProductZone(); if(!pzone) return;
      var order = e.data.order || [];
      var total = order.length;
      order.forEach(function(id, i){
        var box = pzone.querySelector('.bn-prod-box[data-id="'+id+'"]');
        if(box) box.style.zIndex = String(total - i + 10);
      });
      applyCharacterZ();
      applySingleProductOnlyIfNeeded(pzone);
    }

    /* ════════════════════════════════════════════════════
       人物圖（bn-character-*）：
       跟商品共用同一個 .商品範圍/.商品圖範圍 zone，但每個人物是獨立、
       可以超出商品範圍甚至超出畫布的單張圖（不受 zone 的 overflow 影響），
       用 .bn-char-box + data-slot（'_bnCharacter' 人物1 / '_bnCharacter2' 人物2）
       跟商品的 .bn-prod-box 區分。
       z-index 規則（詳見 applyCharacterZ()）：
       - 只有 0~1 個人物：該人物跟「目前最上層的商品」比前後，由人物自己的
         aboveMain 決定（true=蓋住商品，false=被商品蓋住）。
       - 2 個人物都存在：商品此時已被 bn-character-visibility 隱藏，兩個人物
         改成只跟彼此比前後，由 bn-character-pair-order 的 pairFirst 決定。
       ★ _bnSingleProductOnlyTemplate（例如 SearchICON_PRODUCT）與首頁 LOGO 牆
       都完全不顯示人物圖，不管全域人物圖狀態如何，一律忽略 bn-character-add。 ════════════════════════════════════════════════════ */
    if (e.data.type === 'bn-character-add') {
      if(_bnSingleProductOnlyTemplate || _bnHomepageLogoWallTemplate){
        var ignoredCharZone = getProductZone();
        if(ignoredCharZone) applySingleProductOnlyIfNeeded(ignoredCharZone);
        return; /* SearchICON_PRODUCT／首頁 LOGO 牆固定不顯示人物圖 */
      }
      var czone = getProductZone(); if(!czone) return;
      var slotKey = e.data.slot;
      if(slotKey !== '_bnCharacter' && slotKey !== '_bnCharacter2') return;
      czone.style.background = 'transparent'; czone.style.opacity = '1';
      if(!czone.style.position) czone.style.position = 'relative';
      var cbox = createCharBox(slotKey, e.data, czone);
      var appliedSaved = false;
      if(e.data.layoutById){
        var __cbnid = getCurrentBnId();
        var __clay = (__cbnid in e.data.layoutById) ? e.data.layoutById[__cbnid] : null;
        if(__clay) appliedSaved = applySavedCharLayout(cbox, czone, __clay);
      }
      if(appliedSaved) cbox.dataset.manualLayout = '1';
      else applyDefaultCharLayout(cbox, czone);
      syncCharGradientOverlay(cbox);
      setupCharDrag(cbox, czone);
      applyCharacterZ();
      setTimeout(function(){ postCharacterLayout(cbox); }, 0);
      return;
    }

    if (e.data.type === 'bn-character-remove') {
      var czone2 = getProductZone(); if(!czone2) return;
      var existing2 = czone2.querySelector('.bn-char-box[data-slot="'+e.data.slot+'"]');
      if(existing2) existing2.remove();
      if(!czone2.querySelector('.bn-char-box') && !czone2.querySelector('.bn-prod-box')){
        czone2.style.background=''; czone2.style.opacity='';
      }
      applyCharacterZ();
      return;
    }

    /* 只換圖片內容（去背/裁切/擦除/影子編輯完成後），完全不動人物圖目前的位置/大小。 */
    if (e.data.type === 'bn-character-update-image') {
      var czone3 = getProductZone(); if(!czone3) return;
      var box3 = czone3.querySelector('.bn-char-box[data-slot="'+e.data.slot+'"]');
      if(box3){
        if(e.data.ratio) box3.dataset.ratio = e.data.ratio;
        var img3 = box3.querySelector('img');
        if(img3 && e.data.src){
          img3.src = e.data.src;
          img3.addEventListener('load', function(){ syncCharGradientOverlay(box3); }, {once:true});
          syncCharGradientOverlay(box3);
        }
      }
      return;
    }

    /* 有人物圖時，商品最多只顯示「目前最上層」的幾件，其餘隱藏（不是移除，
       只是 display:none，移除人物圖後可以直接復原，不用重新排版）。
       _bnSingleProductOnlyTemplate／首頁 LOGO 牆的版位無視這則訊息帶來的可見度規則，
       固定套用自己的「只留指定商品、人物圖完全不顯示」規則。 */
    if (e.data.type === 'bn-character-visibility') {
      var czone4 = getProductZone(); if(!czone4) return;
      if(_bnSingleProductOnlyTemplate || _bnHomepageLogoWallTemplate){ applySingleProductOnlyIfNeeded(czone4); return; }
      var visibleIds = e.data.visibleIds;
      var hasChar = !!e.data.hasChar;
      czone4.querySelectorAll('.bn-prod-box').forEach(function(b){
        if(!hasChar || !visibleIds){ b.style.display = ''; return; }
        b.style.display = (visibleIds.indexOf(b.dataset.id) !== -1) ? '' : 'none';
      });
      /* 誰是「目前最上層可見商品」可能因這次可見度變化而改變，
         人物的 z-index 要重新算一次，不然會停留在舊的最上層商品基準上。 */
      applyCharacterZ();
      return;
    }

    /* 兩個人物都存在時，誰蓋住誰。 */
    if (e.data.type === 'bn-character-pair-order') {
      var czone5 = getProductZone(); if(!czone5) return;
      czone5.dataset.charPairFirst = e.data.pairFirst || '_bnCharacter';
      applyCharacterZ();
      return;
    }

    /* 方/橫配對版位同步人物圖位置——跟商品的 bn-product-layout-apply 一樣，
       唯一差異是「不做邊界 clamp」，因為人物圖本來就可以超出範圍/畫布。 */
    if (e.data.type === 'bn-character-layout-apply') {
      var czone6 = getProductZone(); if(!czone6) return;
      var box6 = czone6.querySelector('.bn-char-box[data-id="'+e.data.id+'"]');
      if(box6 && e.data.layout){
        applySavedCharLayout(box6, czone6, e.data.layout);
        box6.dataset.manualLayout = '1';
        syncCharGradientOverlay(box6);
      }
      return;
    }

    /* 背景圖：放到 .背景色（如有）或畫布底層 */
    if (e.data.type === 'bn-bg') {
      /* 若之前套用過 SLAB 底圖，改套一般背景時要還原商品範圍的提示色塊 */
      _bnMarkSlabZone(getProductZone(), false);
      /* 支援 .背景色 和 .bg 兩種 class 名稱 */
      var bgContainer = document.querySelector('.背景色') || document.querySelector('.bg');
      var bimg2 = document.getElementById('底圖');
      var bgSrc   = e.data.src   || null;
      var bgFit   = e.data.fit   || 'cover';
      var bgScale = e.data.scale !== undefined ? e.data.scale : 100;
      var bgX     = e.data.x     !== undefined ? e.data.x     : 50;
      var bgY     = e.data.y     !== undefined ? e.data.y     : 50;

      /* SearchICON_LOGO / PRODUCT / TEXT 與首頁 LOGO 牆都不接受背景圖片；
         SearchICON 的圓底跟著目前選取的背景色、圓底之下的畫布固定白色，
         首頁 LOGO 牆則整張固定白色。 */
      if(_bnNoImageBackgroundTemplate){
        var cvSearchIcon = document.getElementById('canvas');
        var noImageBg = _bnFixedWhiteBackgroundTemplate ? '#fff' : _bnCurrentCanvasBg;
        if(!noImageBg){
          noImageBg = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#fff';
        }
        if(cvSearchIcon) cvSearchIcon.style.setProperty('background', _bnWhiteCanvasUnderCircleTemplate ? '#fff' : noImageBg, 'important');
        if(bgContainer){
          bgContainer.style.setProperty('background-color', noImageBg, 'important');
          bgContainer.style.setProperty('background-image', 'none', 'important');
        }
        if(bimg2){ bimg2.src=''; bimg2.style.display='none'; bimg2.style.transform=''; }
        return;
      }

      /* background-size 根據模式計算 */
      var bgSize, bgPos;
      if(bgFit === 'cover'){
        bgSize = 'cover';
        bgPos  = bgX + '% ' + bgY + '%';
      } else if(bgFit === 'contain'){
        bgSize = 'contain';
        bgPos  = bgX + '% ' + bgY + '%';
      } else if(bgFit === 'height100'){
        /* 橫版畫布預設：背景圖高度放滿，寬度等比例 auto */
        bgSize = 'auto ' + bgScale + '%';
        var offsetXH = bgX - 50;
        var offsetYH = bgY - 50;
        bgPos = 'calc(50% + ' + offsetXH + '%) calc(50% + ' + offsetYH + '%)';
      } else if(bgFit === 'width100'){
        /* 直版/方版畫布預設：背景圖寬度放滿，高度等比例 auto */
        bgSize = bgScale + '% auto';
        var offsetXW = bgX - 50;
        var offsetYW = bgY - 50;
        bgPos = 'calc(50% + ' + offsetXW + '%) calc(50% + ' + offsetYW + '%)';
      } else {
        /* 原尺寸（auto）：用 background-size 百分比，從中心縮放
           技巧：position 設 50% 50%，size 設 scale%，
           這樣圖片中心固定在容器中心，往外放大 */
        bgSize = bgScale + '%';
        /* 以中心為基準：position 固定在 50% 50%，
           再用 background-position-x/y 微調偏移 */
        var offsetX = bgX - 50;  /* -50~+50 */
        var offsetY = bgY - 50;
        bgPos = 'calc(50% + ' + offsetX + '%) calc(50% + ' + offsetY + '%)';
      }

      if(bgSrc){
        if(bgContainer){
          bgContainer.style.backgroundImage    = 'url(' + bgSrc + ')';
          bgContainer.style.backgroundSize     = bgSize;
          bgContainer.style.backgroundPosition = bgPos;
          bgContainer.style.backgroundRepeat   = 'no-repeat';
        } else {
          if(bimg2){
            bimg2.src = bgSrc;
            bimg2.style.display = 'block';
            bimg2.style.objectFit = (bgFit === 'auto' || bgFit === 'height100' || bgFit === 'width100') ? 'none' : bgFit;
            bimg2.style.objectPosition = bgPos;
            if(bgFit === 'auto') bimg2.style.transform = 'scale(' + bgScale/100 + ')';
          }
        }
      } else {
        if(bgContainer) bgContainer.style.backgroundImage = '';
        if(bimg2){ bimg2.src=''; bimg2.style.display='none'; bimg2.style.transform=''; }
      }
      return;
    }

    /* SLAB 底圖：以「建議範圍框.PNG」(1200x1200) 內的紅框 DRED 為基準，
       將上傳圖片依本版位「商品範圍/商品圖範圍」高度等比縮放、置中對齊，
       套用後商品範圍原本的 40% 提示色塊改成同色的 40% 線框。 */
    if (e.data.type === 'bn-bg-slab') {
      if(!_bnNoImageBackgroundTemplate){
        applyBnBgSlab(e.data.src || null, {scale:e.data.scale, x:e.data.x, y:e.data.y});
      }
      return;
    }

    /* 中文數字豁免旗標由左側輸入框右鍵切換時，同步到畫布上對應欄位，
       這樣之後在畫布上編輯文字回傳給父層時才不會把豁免狀態洗掉。 */
    if (e.data.type === 'bn-numeral-exempt') {
      var neClasses = e.data.field ? [e.data.field] : EDITABLE_CLASSES;
      neClasses.forEach(function(cls){
        document.querySelectorAll('.' + cls).forEach(function(el){
          _setNumeralExempt(el, !!e.data.on);
        });
      });
      return;
    }

    /* 底圖核對：疊加半透明底圖 */
    if (e.data.type === 'bn-bg-overlay') {
      var overlay = document.getElementById('_bn_bg_overlay');
      if(!overlay){
        overlay = document.createElement('img');
        overlay.id = '_bn_bg_overlay';
        overlay.style.cssText = [
          'position:absolute;top:0;left:0;',
          'width:100%;height:100%;',
          'object-fit:contain;object-position:top left;',
          'z-index:9999;pointer-events:none;',
          'opacity:0.5;',
        ].join('');
        document.getElementById('canvas').appendChild(overlay);
      }
      if(e.data.src){
        overlay.style.display = 'none'; /* 先隱藏，load 成功再顯示 */
        overlay.onerror = function(){ overlay.style.display = 'none'; };
        overlay.onload  = function(){ overlay.style.display = 'block'; };
        overlay.src = e.data.src;
      } else {
        overlay.style.display = 'none';
        overlay.src = '';
      }
      return;
    }

    if (e.data.type === 'bn-layout-snapshot-request') {
      postAllProductLayouts();
      postAllCharacterLayouts();
      /* 讓同一頁其他專用 listener（例如 SearchICON_LOGO）先回傳自己的位置，
         再通知父層此 iframe 已完成快照。 */
      setTimeout(function(){
        try{
          window.parent && window.parent.postMessage({
            type:'bn-layout-snapshot-complete',
            requestId:e.data.requestId,
            bnid:getCurrentBnId()
          }, '*');
        }catch(_){ }
      }, 0);
    }

    if (e.data.type === 'bn-product-layout-request') {
      postAllProductLayouts();
    }

    if (e.data.type === 'bn-product-layout-apply') {
      var pzoneApply = getProductZone(); if(!pzoneApply) return;
      var boxApply = pzoneApply.querySelector('.bn-prod-box[data-id="'+e.data.id+'"]');
      var lay = e.data.layout || {};
      if(boxApply){
        var csApply = window.getComputedStyle(pzoneApply);
        var zwApply = parseFloat(csApply.width) || pzoneApply.offsetWidth || 1;
        var zhApply = parseFloat(csApply.height) || pzoneApply.offsetHeight || 1;
        var l = lay.leftPct !== undefined ? lay.leftPct * zwApply : lay.left;
        var t = lay.topPct !== undefined ? lay.topPct * zhApply : lay.top;
        var w = lay.widthPct !== undefined ? lay.widthPct * zwApply : lay.width;
        var h = lay.heightPct !== undefined ? lay.heightPct * zhApply : lay.height;
        if(isFinite(l) && isFinite(t) && isFinite(w) && isFinite(h) && w > 0 && h > 0){
          w = Math.max(1, Math.min(w, zwApply));
          /* 框高由框寬 × 商品範圍比例決定（同 layoutProducts） */
          var hFit = bnBoxHeightFor(boxApply, w);
          if(hFit){
            h = hFit;
            if(h > zhApply){ w = Math.max(1, w * zhApply / h); h = zhApply; }
          }else{
            h = Math.max(1, Math.min(h, zhApply));
          }
          l = Math.max(0, Math.min(zwApply - w, l));
          t = Math.max(0, Math.min(zhApply - h, t));
          boxApply.dataset.manualLayout = '1';
          boxApply.style.left = l + 'px';
          boxApply.style.top = t + 'px';
          boxApply.style.width = w + 'px';
          boxApply.style.height = h + 'px';
          bnRelayoutProductBox(boxApply);
        }
      }
      return;
    }

    if (e.data.type === 'bn-capture') {
      var _cv = document.getElementById('canvas');

      /* 保險：截圖前先拿掉超字紅框，避免紅框被畫進圖裡 */
      var _overEls = [];
      if(_cv){
        _cv.querySelectorAll('.bn-over-limit').forEach(function(el){
          _overEls.push(el); el.classList.remove('bn-over-limit');
        });
        setTimeout(function(){
          _overEls.forEach(function(el){ el.classList.add('bn-over-limit'); });
        }, 3000);
      }

      /* 橘色內容提醒只屬於編輯預覽：截圖期間移除框線並隱藏提示文字。 */
      window.__bnContentWarningCaptureActive=true;
      var _contentWarningCaptureEls=[];
      if(_cv){
        _cv.querySelectorAll('.bn-content-warning-target').forEach(function(el){
          _contentWarningCaptureEls.push({el:el,target:true});
          el.classList.remove('bn-content-warning-target');
        });
        document.querySelectorAll('.bn-content-warning-tip').forEach(function(el){
          _contentWarningCaptureEls.push({el:el,target:false,display:el.style.display});
          el.style.display='none';
        });
      }

      /* 隱藏所有編輯用控制元素（縮放點等），截完再還原 */
      var _editEls = [];
      if(_cv){
        _cv.querySelectorAll('[data-corner],[data-rotate-handle],[data-rotate-badge]').forEach(function(h){
          _editEls.push({el:h, disp:h.style.display});
          h.style.display = 'none';
        });
      }

      /* Search_Image1 下載補償：
         只保留副標下載補償。左側紅底共用區（官方旗艦店/橫線/商城logo）
         改為完全所見即所得，不再於下載時針對 1/2/3 做不同位移。
      */
      /* ★ 2026-08：+14px 補償已停用（設為 0）。
         副標位置改由下方「文字點陣化」機制鎖死（跟 SearchICON_TEXT 同一套），
         下載 = 預覽，不再需要用固定位移去猜 html2canvas 的誤差；
         繼續留著 +14 反而會讓下載結果偏下（使用者回報的「有時往下掉」）。 */
      var SEARCH_IMAGE1_SUBTITLE_OFFSET = 0;
      var _captureAdjustEls = [];
      var _fnameLower = (fname || '').toLowerCase();
      var _isSearchImage1 = _fnameLower.indexOf('search_image1') !== -1;

      if(SEARCH_IMAGE1_SUBTITLE_OFFSET && _isSearchImage1 && _cv){
        _cv.querySelectorAll('.副標案型七字內').forEach(function(el){
          var oldTop = el.style.top || '';
          var oldPriority = el.style.getPropertyPriority('top') || '';
          var currentTop = parseFloat(window.getComputedStyle(el).top) || 0;
          _captureAdjustEls.push({el:el, top:oldTop, priority:oldPriority});
          el.style.setProperty('top', (currentTop + SEARCH_IMAGE1_SUBTITLE_OFFSET) + 'px', 'important');
        });
      }

      /* CTA 文字（放心買_安心退／逛逛去）下載補償：
         這兩個文字都是「position:absolute + line-height:1」直接定位，沒有用
         flex 或固定高度置中，html2canvas 計算文字行框內上下留白比例，跟瀏覽器
         即時渲染不一致，導致下載出來文字位置偏移、看起來不是上下置中。

         ★ 這個係數是「用系統預設字型」量出來的估計值。實際字型（ShopeeNotoSans）
         的行高/基準線量測方式跟預設字型不一定一樣，所以下面這個數字很可能還
         需要再微調——如果下載出來文字還是偏下，把 CTA_TEXT_OFFSET_RATIO 調大；
         如果變成偏上（跑過頭），把它調小；抓到剛好置中為止。抓到之後同一個
         數字對其他版位、其他字級應該都適用（是按字級比例算的，不是固定px）。
         暫時先給一個保守的小值，避免像剛才 0.10 那樣跑過頭。 */
      /* ★ 2026-08 修正：此補償已停用（設為 0）。
         原因：這個係數當初是「用系統預設字型」估出來的，實際字型
         ShopeeNotoSans 載入後 html2canvas 的基準線算法並不需要補償，
         繼續套用等於平白把 CTA 文字往上推 fontSize×3%（SCBN_APP、
         Coin_pageBN、HBN 的「逛逛去」下載後偏上就是這個造成的）。
         若日後真的又出現偏移，再調整這個數字即可：偏下調大、偏上調小；
         設為 0 時完全不會動到 top，畫布與下載結果一致。 */
      var CTA_TEXT_OFFSET_RATIO = 0;
      if(_cv && CTA_TEXT_OFFSET_RATIO){
        _cv.querySelectorAll('.放心買_安心退, .逛逛去').forEach(function(el){
          var oldTop = el.style.top || '';
          var oldPriority = el.style.getPropertyPriority('top') || '';
          var cs = window.getComputedStyle(el);
          var currentTop = parseFloat(cs.top) || 0;
          var fontSize = parseFloat(cs.fontSize) || 0;
          if(!fontSize) return;
          _captureAdjustEls.push({el:el, top:oldTop, priority:oldPriority});
          el.style.setProperty('top', (currentTop - fontSize * CTA_TEXT_OFFSET_RATIO) + 'px', 'important');
        });
      }

      /* SearchICON_TEXT（.ICON獨立文案）下載補償：
         這裡用 line-height（固定90px，見 .css 註解）置中，不是絕對 top 定位，
         所以補償方式改用 transform:translateY，不影響原本的置中計算。
         實測（使用者真實環境截圖量出來）：往上偏移約字級的 22%，這裡用同樣
         比例往下位移抵銷。這組是照真實下載結果量的，理論上比 CTA 文字那組
         （只能先用系統字型估）準；如果實際測試後還有落差，調整
         ICON_TEXT_OFFSET_RATIO 這個數字即可：往上跑就調大、往下跑過頭就調小。 */
      /* ★ 2026-08 修正：此補償已停用（設為 0）。
         .ICON獨立文案 是用 line-height:90px 做垂直置中，畫布上本來就是正的；
         這裡再往下推 fontSize×22%（字級 50px → 11px），下載出來就會整段偏下。
         實測 120x120 的輸出，文字中心比畫布中心低約 13px，量級與此補償相符。
         設為 0 時完全不會寫入 transform，也不會蓋掉 config.css 的
         transform:none !important。 */
      var ICON_TEXT_OFFSET_RATIO = 0;
      var _transformAdjustEls = [];
      if(_cv && ICON_TEXT_OFFSET_RATIO){
        _cv.querySelectorAll('.ICON獨立文案').forEach(function(el){
          var oldTransform = el.style.transform || '';
          var oldPriority = el.style.getPropertyPriority('transform') || '';
          var cs = window.getComputedStyle(el);
          var fontSize = parseFloat(cs.fontSize) || 0;
          if(!fontSize) return;
          _transformAdjustEls.push({el:el, transform:oldTransform, priority:oldPriority});
          el.style.setProperty('transform', 'translateY(' + (fontSize * ICON_TEXT_OFFSET_RATIO) + 'px)', 'important');
        });
      }

      /* ★ 文字位置寫死（2026-08）：SearchICON_TEXT、Search_Image 副標
         不再用「猜偏移量」補償 html2canvas 的文字基準線誤差——那個誤差跟
         字型載入狀態、版本、字級都有關，怎麼調都會在環境間漂移。
         改成截圖前把文字「畫成 canvas 點陣圖」蓋在原文字上：
         1. 先用「零尺寸 inline-block 探針」量出瀏覽器實際把基準線放在
            元素內的哪個 y（探針底部貼齊 baseline，offsetTop 就是答案），
            所以畫出來的位置 = 螢幕預覽位置，所見即所得。
         2. 用同字型同字級畫進 2x canvas（防糊），原文字暫設 color:transparent。
         3. html2canvas 對 canvas 是像素複製，沒有字型/基準線計算空間
            → 下載結果永遠等於預覽。
         4. 截圖完成後移除 canvas、還原文字色，畫布預覽不受影響。 */
      var _iconRasterEls = [];
      if(_cv){
        /* .官方旗艦店（2026-08 加入）：字級 29.63px 配 line-height 30px，
           字型內容高度 43.85px > 行框 → 負半行距約 -7px。html2canvas 處理
           負半行距的行為不穩定，實測下載會整行往上跳 8px（預覽正常），
           造成跟左右橫白線對不齊。納入點陣化後下載 = 預覽，橫線本身是
           靜態色塊本來就不會漂，兩者就永遠對齊。 */
        _cv.querySelectorAll('.ICON獨立文案, .副標案型七字內, .官方旗艦店').forEach(function(el){
          var txt = (el.textContent || '').trim();
          if(!txt) return;
          var w = el.offsetWidth, h = el.offsetHeight;
          if(!w || !h) return;
          var cs = window.getComputedStyle(el);
          var fontSize = parseFloat(cs.fontSize) || 50;

          /* 基準線探針：inline-block 的下緣對齊文字 baseline */
          var probe = document.createElement('span');
          probe.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;';
          el.appendChild(probe);
          var baseY = probe.offsetTop;
          el.removeChild(probe);
          if(!baseY || baseY <= 0 || baseY > h * 2){
            /* 探針失敗就退回字型比例估算，不中斷截圖 */
            baseY = h / 2 + fontSize * 0.38;
          }

          var RES = 2;
          var cnv = document.createElement('canvas');
          cnv.width = w * RES; cnv.height = h * RES;
          cnv.style.cssText = 'position:absolute;left:0;top:0;width:' + w + 'px;height:' + h + 'px;pointer-events:none;';
          var ctx = cnv.getContext('2d');
          ctx.scale(RES, RES);
          ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + fontSize + 'px ' + cs.fontFamily;
          if(cs.letterSpacing && cs.letterSpacing !== 'normal' && 'letterSpacing' in ctx){
            ctx.letterSpacing = cs.letterSpacing;
          }
          ctx.fillStyle = cs.color;
          ctx.textBaseline = 'alphabetic';
          var padL = parseFloat(cs.paddingLeft) || 0;
          var padR = parseFloat(cs.paddingRight) || 0;
          if(cs.textAlign === 'center'){
            ctx.textAlign = 'center';
            ctx.fillText(txt, padL + (w - padL - padR) / 2, baseY);
          } else if(cs.textAlign === 'right' || cs.textAlign === 'end'){
            ctx.textAlign = 'right';
            ctx.fillText(txt, w - padR, baseY);
          } else {
            ctx.textAlign = 'left';
            ctx.fillText(txt, padL, baseY);
          }
          _iconRasterEls.push({el: el, color: el.style.color || '', priority: el.style.getPropertyPriority('color') || '', cnv: cnv});
          el.style.setProperty('color', 'transparent', 'important');
          el.appendChild(cnv);
        });
      }

      /* ★ 漸層點陣化（2026-08）：漸層藍線的最終解。
         歷程：某些使用者下載的圖，在漸層元素上會多一條藍/暗線。
         第一輪：background-repeat 預設 repeat，元素尺寸換算成裝置像素有
                 小數時，最後 1px 會取樣到下一塊 tile 的不透明起始色
                 → 加 no-repeat 解掉「元素邊緣」的線。
         第二輪：線移到了「alpha 歸零的停點」（實測 x=680 = 611+70）。
                 原因：CSS 關鍵字 transparent 的計算值是 rgba(0,0,0,0)
                 「透明黑」。瀏覽器預覽用 premultiplied 插值看不出來，
                 但 html2canvas 自己重畫漸層時往黑色插值，在停點處硬切，
                 亮底（氣球）上就是一條明顯的暗線 → 預覽正常、下載有線。
         治本：跟文字一樣，不讓 html2canvas 畫漸層。截圖前用 2D canvas
         把漸層畫成點陣圖蓋上去（我們控制色標：透明端用同 RGB 的
         rgba(r,g,b,0)，插值路徑顏色恆定），html2canvas 只能像素複製。
         截圖完成後移除、還原，預覽不受影響。 */
      var _gradRasterEls = [];
      if(_cv){
        _cv.querySelectorAll('.漸層左, .漸層右, .漸層上, .漸層下').forEach(function(gel){
          var w = gel.offsetWidth, h = gel.offsetHeight;
          if(!w || !h) return; /* display:none（未使用的漸層）直接跳過 */
          var cs = window.getComputedStyle(gel);
          if(cs.display === 'none' || cs.visibility === 'hidden') return;
          var bgi = cs.backgroundImage || '';
          if(bgi.indexOf('linear-gradient') === -1) return;

          /* 從計算樣式抓「第一個不透明色」與「alpha 歸零停點」 */
          var colorM = bgi.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)\s*0%/);
          if(!colorM) colorM = bgi.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          if(!colorM) return;
          var r = colorM[1], g = colorM[2], b = colorM[3];
          var stopM = bgi.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*0\)\s*([\d.]+)%/);
          var stop = stopM ? parseFloat(stopM[1]) / 100 : 1;

          var dir = (window.getComputedStyle(gel).getPropertyValue('--grad-dir') || '').trim();
          if(!dir){
            var _dirs = {'漸層左':'to right','漸層右':'to left','漸層上':'to bottom','漸層下':'to top'};
            for(var cls in _dirs){ if(gel.classList.contains(cls)){ dir = _dirs[cls]; break; } }
          }
          if(!dir) dir = 'to right';

          var cnv = document.createElement('canvas');
          cnv.width = w; cnv.height = h; /* 漸層平滑，1x 就夠、也最不會有縮放取樣差 */
          cnv.style.cssText = 'position:absolute;left:0;top:0;width:' + w + 'px;height:' + h + 'px;pointer-events:none;';
          var ctx = cnv.getContext('2d');
          var coords = {'to right':[0,0,w,0],'to left':[w,0,0,0],'to bottom':[0,0,0,h],'to top':[0,h,0,0]}[dir];
          var grad = ctx.createLinearGradient(coords[0], coords[1], coords[2], coords[3]);
          var solid = 'rgb(' + r + ',' + g + ',' + b + ')';
          var clear = 'rgba(' + r + ',' + g + ',' + b + ',0)';
          grad.addColorStop(0, solid);
          grad.addColorStop(Math.min(1, stop), clear);
          grad.addColorStop(1, clear);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, w, h);

          _gradRasterEls.push({el: gel, background: gel.style.background || '', priority: gel.style.getPropertyPriority('background') || '', cnv: cnv});
          gel.style.setProperty('background', 'none', 'important');
          gel.appendChild(cnv);
        });
      }

      /* LOGO / 商品範圍：若尚未上傳任何圖片，畫布上會顯示淡紅色提示範圍（方便編輯時定位）。
         下載截圖時，若該範圍仍是空的（沒有 logo 圖 / 沒有商品圖），
         暫時把提示色改成透明再截圖，讓下載出來的圖片不會帶有這塊淡紅色；
         截圖完成後立刻還原，畫面上的編輯提示不受影響。
         LOGO 範圍與商品範圍套用同一套邏輯，行為一致。 */
      var _emptyZoneEls = [];
      function _bnHideEmptyPlaceholder(selector, hasContentSelector){
        document.querySelectorAll(selector).forEach(function(zn){
          if(!zn) return;
          var hasContent = zn.querySelector(hasContentSelector);
          if(!hasContent){
            _emptyZoneEls.push({el:zn, bg:zn.style.background, op:zn.style.opacity, bd:zn.style.border});
            zn.style.background = 'transparent';
            zn.style.opacity = '1';
            zn.style.border = 'none';
          }
        });
      }
      _bnHideEmptyPlaceholder('.logo範圍, .LOGO範圍, .logo範圍_左, .logo範圍_中, .logo範圍_右', 'img.bn-logo-img');
      _bnHideEmptyPlaceholder('.商品範圍, .商品圖範圍', '.bn-prod-box, .bn-char-box');

      /* object-fit:contain 下載補償：
         html2canvas 不支援 <img> 的 object-fit:contain——不管圖片比例跟外框
         比例是否一致，畫面上瀏覽器會正確「等比縮小、置中、露出底色」，
         但 html2canvas 會整張圖硬拉伸去塞滿外框，造成圖片變形、被拉滿。
         最常見的情況：使用者換了一張比例不同的圖，但外框沿用了「上一張圖」
         儲存下來的大小（LOGO / 商品圖 都有「記住使用者上次調整過的大小」
         這個機制），外框比例就會跟新圖片對不上，露餡在下載這一刻。
         修法：截圖前，用「圖片真實比例＋目前外框大小」手動算出等比縮放後
         應該有的實際寬高與置中位置，直接把這個結果寫死成 <img> 的
         width/height/position/left/top（不再依賴 object-fit)，
         html2canvas 就只是照著這組已經算好的絕對數字截圖，不會拉伸。
         截圖完成後全部還原，畫面上的即時編輯行為完全不受影響。 */
      var _objectFitAdjustEls = [];
      function _bnFixObjectFitForCapture(selector){
        document.querySelectorAll(selector).forEach(function(img){
          if(!img || img.tagName !== 'IMG') return;
          /* 商品圖已用 productRect 以絕對 px 定位（影子露在框外），不是 contain 模式；
             這裡若再按 contain 重算，會把含影子的整張圖縮回框內，下載的商品就變小。
             只確保定位是最新的，然後跳過。 */
          if(img._bnFit){ bnLayoutProductImg(img); return; }
          var box = img.parentElement;
          if(!box) return;
          var bw = box.clientWidth, bh = box.clientHeight;
          var nw = img.naturalWidth, nh = img.naturalHeight;
          if(!bw || !bh || !nw || !nh) return;
          var boxRatio = bw / bh, imgRatio = nw / nh;
          var dispW, dispH;
          if(imgRatio > boxRatio){ dispW = bw; dispH = bw / imgRatio; }
          else { dispH = bh; dispW = bh * imgRatio; }
          /* 比例已經吻合（差距在1px內），不用特別處理，減少不必要的 style 改動 */
          if(Math.abs(dispW - bw) < 1 && Math.abs(dispH - bh) < 1) return;
          _objectFitAdjustEls.push({
            el: img, width: img.style.width, height: img.style.height,
            left: img.style.left, top: img.style.top, position: img.style.position,
            maxWidth: img.style.maxWidth, maxHeight: img.style.maxHeight
          });
          img.style.position = 'absolute';
          img.style.width  = dispW + 'px';
          img.style.height = dispH + 'px';
          img.style.maxWidth  = 'none';
          img.style.maxHeight = 'none';
          img.style.left = Math.round((bw - dispW) / 2) + 'px';
          img.style.top  = Math.round((bh - dispH) / 2) + 'px';
        });
      }
      _bnFixObjectFitForCapture('.bn-logo-box img, .bn-prod-box img, .bn-char-box img, .logo範圍_左 img.bn-logo-img, .logo範圍_中 img.bn-logo-img, .logo範圍_右 img.bn-logo-img');

      /* 首頁LOGO牆截圖補償：html2canvas 1.4.1 會把圓角元素的外陰影
         （box-shadow rgba(0,0,0,.14)）誤畫在元素內部，白色膠囊疊上去就變成
         #dbdbdb 灰底（實測：拿掉陰影即純白）。截圖時暫時移除陰影並鎖定白底。 */
      var _logoWallCaptureEls = [];
      window.__bnLogoWallShadowSpecs = [];
      if(_bnFixedWhiteBackgroundTemplate){
        document.querySelectorAll('.logo範圍').forEach(function(zn){
          var _cs = window.getComputedStyle(zn);
          if(_cs.boxShadow && _cs.boxShadow !== 'none'){
            window.__bnLogoWallShadowSpecs.push({el:zn, shadow:_cs.boxShadow, radius:_cs.borderTopLeftRadius});
          }
          _logoWallCaptureEls.push({el:zn,
            prevBg: zn.style.getPropertyValue('background-color'),
            prevBgPri: zn.style.getPropertyPriority('background-color'),
            prevShadow: zn.style.getPropertyValue('box-shadow'),
            prevShadowPri: zn.style.getPropertyPriority('box-shadow')});
          zn.style.setProperty('background-color','#ffffff','important');
          zn.style.setProperty('box-shadow','none','important');
        });
      }

      var _wantLayers = !!e.data.layers;
      captureCanvas(function(dataUrl, bgUrl, fgUrl){
        window.__bnContentWarningCaptureActive=false;
        _contentWarningCaptureEls.forEach(function(o){
          if(!o.el || !o.el.isConnected) return;
          if(o.target) o.el.classList.add('bn-content-warning-target');
          else o.el.style.display=o.display;
        });
        _editEls.forEach(function(o){ o.el.style.display = o.disp; });
        _captureAdjustEls.forEach(function(o){ o.el.style.setProperty('top', o.top, o.priority || ''); });
        _emptyZoneEls.forEach(function(o){ o.el.style.background = o.bg; o.el.style.opacity = o.op; o.el.style.border = o.bd; });
        _objectFitAdjustEls.forEach(function(o){
          o.el.style.position = o.position; o.el.style.width = o.width; o.el.style.height = o.height;
          o.el.style.left = o.left; o.el.style.top = o.top;
          o.el.style.maxWidth = o.maxWidth; o.el.style.maxHeight = o.maxHeight;
        });
        _transformAdjustEls.forEach(function(o){ o.el.style.setProperty('transform', o.transform, o.priority || ''); });
        _iconRasterEls.forEach(function(o){ o.el.style.setProperty('color', o.color, o.priority || ''); if(o.cnv.parentNode) o.cnv.parentNode.removeChild(o.cnv); });
        _gradRasterEls.forEach(function(o){ o.el.style.setProperty('background', o.background, o.priority || ''); if(o.cnv.parentNode) o.cnv.parentNode.removeChild(o.cnv); });
        _logoWallCaptureEls.forEach(function(o){
          o.el.style.removeProperty('background-color');
          if(o.prevBg) o.el.style.setProperty('background-color', o.prevBg, o.prevBgPri||'');
          o.el.style.removeProperty('box-shadow');
          if(o.prevShadow) o.el.style.setProperty('box-shadow', o.prevShadow, o.prevShadowPri||'');
        });
        window.__bnLogoWallShadowSpecs = null;
        window.parent.postMessage({type:'bn-snapshot',msgId:e.data.msgId,dataUrl:dataUrl,bgUrl:bgUrl||null,fgUrl:fgUrl||null},'*');
      }, _wantLayers);
    }
  });

  function getCurrentBnId(){
    try{ return String(new URLSearchParams(location.search||'').get('bnid') || ''); }
    catch(_){ return ''; }
  }

  function postProductLayout(box){
    try{
      var zone = getProductZone(); if(!zone || !box) return;
      var zr = zone.getBoundingClientRect();
      var br = box.getBoundingClientRect();
      var zw = zr.width || parseFloat(window.getComputedStyle(zone).width) || 1;
      var zh = zr.height || parseFloat(window.getComputedStyle(zone).height) || 1;
      var data = {
        type:'bn-product-layout-update',
        bnid:getCurrentBnId(),
        id:box.dataset.id,
        layout:{
          left: br.left - zr.left,
          top: br.top - zr.top,
          width: br.width,
          height: br.height,
          leftPct: (br.left - zr.left) / zw,
          topPct: (br.top - zr.top) / zh,
          widthPct: br.width / zw,
          heightPct: br.height / zh
        }
      };
      window.parent && window.parent.postMessage(data, '*');
    }catch(_){ }
  }

  function postAllProductLayouts(){
    try{
      var zone = getProductZone(); if(!zone) return;
      Array.from(zone.querySelectorAll('.bn-prod-box')).forEach(postProductLayout);
    }catch(_){ }
  }

  function postAllCharacterLayouts(){
    try{
      var zone = getProductZone(); if(!zone) return;
      Array.from(zone.querySelectorAll('.bn-char-box')).forEach(postCharacterLayout);
    }catch(_){ }
  }

  /* 正三角排品（仿 freelyapp 邏輯）
     主品（第0張）居中最大，左配品（第1張）次之，右配品（第2張）最小
     底部對齊，所有尺寸以商品範圍 px 為單位，不超出邊界 */
  function layoutProducts(pzone) {
    var allBoxes = Array.from(pzone.querySelectorAll('.bn-prod-box'));
    var n = allBoxes.length; if(!n) return;

    /* 依 position 排序：0=主品，1=左配，2=右配 */
    var boxes = allBoxes.slice().sort(function(a,b){
      return (parseInt(a.dataset.position)||0) - (parseInt(b.dataset.position)||0);
    });

    /* 從 CSS 直接讀取 zone 的 width/height（不受 iframe 縮放影響） */
    var cs   = window.getComputedStyle(pzone);
    var zw   = parseFloat(cs.width)  || pzone.offsetWidth  || 400;
    var zh   = parseFloat(cs.height) || pzone.offsetHeight || 300;
    var PAD = 6;

    /* 寬高比 */
    var ratios = boxes.map(function(b){ return Math.max(0.1, parseFloat(b.dataset.ratio)||0.75); });

    /* 大小比例：主品1.0，左0.85，右0.72 */
    var wsMap = [1.0, 0.85, 0.72];
    var ov = 0;   /* 不重疊 */

    var r0 = ratios[0];
    var r1 = n>=2 ? ratios[1] : 0;
    var r2 = n>=3 ? ratios[2] : 0;
    var ws1 = n>=2 ? wsMap[1] : 0;
    var ws2 = n>=3 ? wsMap[2] : 0;

    /* 主品最大高度：預設 88%，若版位有 .cta底 則不超過 CTA 頂部 */
    var maxH0 = Math.floor(zh * 0.88);
    var ctaEl = document.querySelector('.cta底');
    if(ctaEl){
      var ctaTop    = parseFloat(window.getComputedStyle(ctaEl).top)   || 0;
      var pzoneTop  = parseFloat(window.getComputedStyle(pzone).top)   || 0;
      var ctaRelTop = ctaTop - pzoneTop - 8; /* 8px 間距 */
      if(ctaRelTop > 0 && ctaRelTop < zh){
        maxH0 = Math.min(maxH0, Math.floor(ctaRelTop * 0.96));
      }
    }

    /* 算主品寬度：讓三張總寬不超出可用寬（留 PAD*2） */
    /* 主品寬 w0，左品寬 w1=ws1*h0*r1，右品寬 w2=ws2*h0*r2 */
    /* h0 = w0/r0；總寬 = w0 + w1 + w2 = w0(1 + ws1*r1/r0 + ws2*r2/r0) */
    var spanFactor = 1 + ws1*r1/r0 + ws2*r2/r0;
    var GAP = n > 1 ? 8 : 0;
    var avail = zw - PAD*2 - GAP*(n-1);
    var w0 = Math.min(avail / spanFactor, maxH0 * r0);
    var h0 = w0 / r0;
    /* 再檢查高度上限 */
    if(h0 > maxH0){ h0 = maxH0; w0 = h0 * r0; }

    var w1 = n>=2 ? Math.round(ws1*h0*r1) : 0;
    var h1 = n>=2 ? Math.round(ws1*h0)    : 0;
    var w2 = n>=3 ? Math.round(ws2*h0*r2) : 0;
    var h2 = n>=3 ? Math.round(ws2*h0)    : 0;

    w0 = Math.round(w0); h0 = Math.round(h0);

    /* 底部 y 位置：優先使用 CTA 頂部上方，否則用 zone 底部 */
    var zoneBottom = zh - 4;
    if(ctaEl){
      var ctaTop2   = parseFloat(window.getComputedStyle(ctaEl).top)  || 0;
      var pzoneTop2 = parseFloat(window.getComputedStyle(pzone).top)  || 0;
      var ctaRel2   = ctaTop2 - pzoneTop2 - 8;
      if(ctaRel2 > 0 && ctaRel2 < zh) zoneBottom = ctaRel2;
    }

    /* 垂直置中：讓最高的商品（主品 h0）在商品範圍垂直置中
       配品底部跟主品底部對齊（維持底部齊） */
    var zoneTop = 4; /* 上邊界留 4px */
    var zoneH   = zoneBottom - zoneTop;
    /* 主品置中後的底部位置 */
    var centeredBot = zoneTop + Math.floor((zoneH + h0) / 2);
    /* 不超出 zoneBottom */
    var bot0 = Math.min(centeredBot, zoneBottom);
    var bot1 = bot0;
    var bot2 = bot0;

    /* 水平：主品居中，左品在左，右品在右 */
    var totalW = w0 + (n>=2 ? w1+GAP : 0) + (n>=3 ? w2+GAP : 0);
    var startX = Math.max(PAD, Math.floor((zw - totalW) / 2));

    /* 排列順序：左品、主品、右品（視覺上中間最大） */
    var positions = [];
    if(n===1){
      positions = [{box:boxes[0], x:startX, y:bot0-h0, w:w0, h:h0}];
    } else if(n===2){
      /* 左=小，右=主 or 左=主，右=小 → 左配+主 */
      positions = [
        {box:boxes[1], x:startX,          y:bot1-h1, w:w1, h:h1},  /* 左：第1張 */
        {box:boxes[0], x:startX+w1+GAP,   y:bot0-h0, w:w0, h:h0},  /* 右：主品 */
      ];
    } else {
      positions = [
        {box:boxes[1], x:startX,              y:bot1-h1, w:w1, h:h1},  /* 左 */
        {box:boxes[0], x:startX+w1+GAP,       y:bot0-h0, w:w0, h:h0},  /* 中（主品） */
        {box:boxes[2], x:startX+w1+GAP+w0+GAP, y:bot2-h2, w:w2, h:h2},  /* 右 */
      ];
    }

    positions.forEach(function(p, i){
      var saved = null;
      if(p.box.dataset.savedLayout){
        try{ saved = JSON.parse(p.box.dataset.savedLayout); }catch(_){ saved = null; }
        delete p.box.dataset.savedLayout;
      } else if(p.box.dataset.manualLayout === '1') {
        /* 已套用過手動/暫存位置的商品，後續新增其他商品時不可再被自動排版覆蓋。 */
        var curL = parseFloat(p.box.style.left);
        var curT = parseFloat(p.box.style.top);
        var curW = parseFloat(p.box.style.width);
        var curH = parseFloat(p.box.style.height);
        if(isFinite(curL) && isFinite(curT) && isFinite(curW) && isFinite(curH) && curW > 0 && curH > 0){
          saved = {left:curL, top:curT, width:curW, height:curH};
        }
      }
      if(saved){
        var sx = saved.leftPct !== undefined ? saved.leftPct * zw : saved.left;
        var sy = saved.topPct !== undefined ? saved.topPct * zh : saved.top;
        var sw = saved.widthPct !== undefined ? saved.widthPct * zw : saved.width;
        var sh = saved.heightPct !== undefined ? saved.heightPct * zh : saved.height;
        if(isFinite(sx) && isFinite(sy) && isFinite(sw) && isFinite(sh) && sw > 0 && sh > 0){
          /* 框高一律由框寬 × 商品範圍比例決定；舊版儲存的高度（含影子的框）不再沿用，
             否則框會比商品高。 */
          var shFit = bnBoxHeightFor(p.box, sw);
          if(shFit){
            sh = shFit;
            if(sh > zh){ sw = sw * zh / sh; sh = zh; }
          }
          p.x = Math.max(0, Math.min(zw - sw, sx));
          p.y = Math.max(0, Math.min(zh - sh, sy));
          p.w = Math.max(1, sw);
          p.h = Math.max(1, sh);
          p.box.dataset.manualLayout = '1';
        }
      }
      p.box.style.cssText = [
        'position:absolute;',
        'left:'+p.x+'px;top:'+p.y+'px;',
        'width:'+p.w+'px;height:'+p.h+'px;',
        'cursor:move;box-sizing:border-box;',
        'outline:2px solid transparent;',
        'z-index:'+(15-i)+';',
      ].join('');
      bnRelayoutProductBox(p.box);
    });
    setTimeout(postAllProductLayouts, 0);
  }

  function getProductZone(){
    var names=['商品範圍','商品圖範圍'];
    for(var i=0;i<names.length;i++){ var z=document.querySelector('.'+names[i]); if(z)return z; }
    return null;
  }

  /* SLAB 底圖：DRED = 建議範圍框.PNG（1200x1200）內紅框的像素範圍，
     由 Python 對該 PNG 逐 pixel 分析 alpha 通道量測得出（無反鋸齒，
     alpha 只有 0 或 128 兩種值），非目測估計。 */
  var _BN_DRED_REF = {imgSize:1200, left:324, top:372, width:550, height:457};
  function _bnMarkSlabZone(zone, on){
    if(!zone) return;
    if(on){
      zone.style.background = 'transparent';
      zone.style.opacity = '1';
      zone.style.border = '2px solid rgba(235,104,119,0.4)';
      zone.style.boxSizing = 'border-box';
      zone.dataset.bnSlabApplied = '1';
    } else if(zone.dataset.bnSlabApplied){
      zone.style.background = '';
      zone.style.opacity = '';
      zone.style.border = '';
      zone.style.boxSizing = '';
      zone.dataset.bnSlabApplied = '';
    }
  }
  /* SLAB 底圖對齊用的「有效商品範圍」：
     有些版位的 .商品範圍 並不是整段都能真的擺商品，DRED 紅框要對齊的是
     實際可用的那一段，不然 SLAB 商品會超出底色或被其他圖層蓋住。
     一律用實際量到的 rect 動態計算，不寫死像素值。

     SCBN_APP：商品範圍（top:15,height:175）比背景色色塊（top:46,height:154）
       更早開始，上緣那一小段（15~46）其實是露在背景色之外的透明區。取兩者
       交集（46~190）當基準，SLAB 才不會超出底色，下緣也不會被裁掉。
     HBN_*、活動總覽_*：CTA 色塊（.cta底 top:290,height:44）正好壓在商品範圍
       （34~334）的下緣，兩者座標完全相同（同一套 PS 模板衍生出來的版位）。
       把 CTA 高度扣掉（34~290），SLAB 的商品範圍才不會被 CTA 蓋住。 */
  function _bnEffectiveSlabZoneRect(zone){
    var zRect = zone.getBoundingClientRect();
    var top = zRect.top, bottom = zRect.bottom;

    if(/^SCBN_APP$/i.test(fname || '')){
      var bgEl = document.querySelector('.背景色') || document.querySelector('.bg');
      var bgRect = bgEl && bgEl.getBoundingClientRect();
      if(bgRect && bgRect.height > 0){
        top = Math.max(top, bgRect.top);
        bottom = Math.min(bottom, bgRect.bottom);
      }
    }

    if(/^HBN_/i.test(fname || '') || /^活動總覽_/i.test(fname || '')){
      var ctaEl = document.querySelector('.cta底') || document.querySelector('.逛逛去底') || document.querySelector('.cta圓底');
      var ctaRect = ctaEl && ctaEl.getBoundingClientRect();
      if(ctaRect && ctaRect.height > 0 && ctaRect.top > top && ctaRect.top < bottom){
        bottom = ctaRect.top;
      }
    }

    /* 交集算出來不合理（量不到／被蓋光）就退回原本的商品範圍 */
    if(!(bottom - top > 1)) return zRect;

    return {left:zRect.left, top:top, right:zRect.right, bottom:bottom,
      width:zRect.width, height:bottom - top};
  }
  /* 記住上一張 SLAB 圖的原始尺寸：拖「背景圖調整」滑桿時會連續重送，
     同一張圖不需要每次都重新等 Image onload。 */
  var _slabNaturalCache = {src:'', w:0, h:0};

  /* opts = {scale, x, y}：對應「背景圖調整」面板。
     scale=100 / x=50 / y=50 就是純 DRED 對齊的基準位置；
     縮放以 DRED（也就是商品範圍）中心為軸，位移單位是畫布寬高的百分比。 */
  function applyBnBgSlab(src, opts){
    var zone = getProductZone(); if(!zone || !src) return;
    var canvasEl = document.getElementById('canvas'); if(!canvasEl) return;
    var bgContainer = document.querySelector('.背景色') || document.querySelector('.bg');
    var bimg2 = document.getElementById('底圖');
    if(!bgContainer && !bimg2) return;

    function place(nw, nh){
      if(!nw || !nh) return;
      var ref = _BN_DRED_REF;
      var dredLeftPx = ref.left/ref.imgSize*nw, dredTopPx = ref.top/ref.imgSize*nh;
      var dredWPx = ref.width/ref.imgSize*nw, dredHPx = ref.height/ref.imgSize*nh;
      var cRect = canvasEl.getBoundingClientRect(), zRect = _bnEffectiveSlabZoneRect(zone);
      var zoneW = zRect.width || 1, zoneH = zRect.height || 1;
      var scale = zoneH / dredHPx;
      var scaledDredLeft = dredLeftPx*scale, scaledDredTop = dredTopPx*scale;
      var scaledDredW = dredWPx*scale, scaledDredH = dredHPx*scale;
      var zoneLeftRel = zRect.left - cRect.left, zoneTopRel = zRect.top - cRect.top;
      /* DRED 貼齊有效商品範圍後的基準位置 */
      var baseLeft = zoneLeftRel + zoneW/2 - (scaledDredLeft + scaledDredW/2);
      var baseTop  = zoneTopRel - scaledDredTop;
      /* DRED 中心（縮放軸心）*/
      var anchorX = baseLeft + scaledDredLeft + scaledDredW/2;
      var anchorY = baseTop  + scaledDredTop  + scaledDredH/2;

      var z = (opts && isFinite(opts.scale) ? Number(opts.scale) : 100) / 100;
      if(!(z > 0)) z = 1;
      var offX = ((opts && isFinite(opts.x) ? Number(opts.x) : 50) - 50) / 100;
      var offY = ((opts && isFinite(opts.y) ? Number(opts.y) : 50) - 50) / 100;

      /* 這裡以前是 zMax = Math.min(1, zMaxW)，也就是「紅框不得超出曝品範圍」，
         等於把每個版位都夾在 100%。但各版位的預設構圖（SCBN 127%、其餘 120%）
         本來就是刻意讓商品比曝品範圍再大一點、是手拉量出來的值，被這個上限
         夾掉之後 100% 以上的預設全部失效（面板顯示 127% 但畫面其實是 100%）。
         現在只保留上面那行「z 必須為正」，放大與否交給預設值和滑桿決定。 */

      var newW = nw*scale*z, newH = nh*scale*z;
      var imgLeft = anchorX - (scaledDredLeft + scaledDredW/2)*z + offX*(cRect.width || 1);
      var imgTop  = anchorY - (scaledDredTop  + scaledDredH/2)*z + offY*(cRect.height || 1);

      /* 位移夾限：把飄出曝品範圍的紅框推回來。
         但這只有在紅框「塞得進」該軸時才成立——z > 100% 時紅框本來就比曝品
         範圍大，兩邊同時超出，上下都夾的結果會變成硬貼齊某一邊，把預設的
         x/y（例如 SCBN 的 47/29）整個蓋掉。所以改成逐軸判斷：塞得進的軸才夾，
         塞不進的軸就尊重預設／滑桿給的位移。 */
      var dredL = imgLeft + scaledDredLeft*z, dredT = imgTop + scaledDredTop*z;
      var dredW = scaledDredW*z, dredH = scaledDredH*z;
      var zoneL = zoneLeftRel, zoneT = zoneTopRel;
      if(dredW <= zoneW + 0.5){
        if(dredL < zoneL) imgLeft += zoneL - dredL;
        else if(dredL + dredW > zoneL + zoneW) imgLeft -= (dredL + dredW) - (zoneL + zoneW);
      }
      if(dredH <= zoneH + 0.5){
        if(dredT < zoneT) imgTop += zoneT - dredT;
        else if(dredT + dredH > zoneT + zoneH) imgTop -= (dredT + dredH) - (zoneT + zoneH);
      }

      if(bgContainer){
        bgContainer.style.backgroundImage = 'url(' + src + ')';
        bgContainer.style.backgroundRepeat = 'no-repeat';
        bgContainer.style.backgroundSize = newW + 'px ' + newH + 'px';
        bgContainer.style.backgroundPosition = imgLeft + 'px ' + imgTop + 'px';
      } else if(bimg2){
        bimg2.src = src;
        bimg2.style.display = 'block';
        bimg2.style.position = 'absolute';
        bimg2.style.objectFit = 'none';
        bimg2.style.objectPosition = '0 0';
        bimg2.style.transform = '';
        bimg2.style.width = newW + 'px';
        bimg2.style.height = newH + 'px';
        bimg2.style.left = imgLeft + 'px';
        bimg2.style.top = imgTop + 'px';
      }
      _bnMarkSlabZone(zone, true);
    }

    if(_slabNaturalCache.src === src && _slabNaturalCache.w){
      place(_slabNaturalCache.w, _slabNaturalCache.h);
      return;
    }
    var img = new Image();
    img.onload = function(){
      _slabNaturalCache = {src:src, w:img.naturalWidth, h:img.naturalHeight};
      place(img.naturalWidth, img.naturalHeight);
    };
    img.src = src;
  }

  function scheduleProductLayoutPost(box){
    if(!box) return;
    if(box._bnPostTimer) cancelAnimationFrame(box._bnPostTimer);
    box._bnPostTimer = requestAnimationFrame(function(){
      box._bnPostTimer = null;
      postProductLayout(box);
    });
  }

  function setupProdDrag(box,zone){
    var drag=null;
    var rotHandle = box.querySelector('[data-rotate-handle]');
    var rotBadge = box.querySelector('[data-rotate-badge]');
    if(rotHandle){
      var rot = null;
      function fmtDeg(d){ return (Math.round(d*10)/10).toFixed(d % 1 ? 1 : 0).replace(/\.0$/,'') + '°'; }
      function normDeg(d){ d = ((d % 360) + 360) % 360; return d > 180 ? d - 360 : d; }
      rotHandle.addEventListener('pointerdown', function(e){
        if(e.button !== 0) return;
        e.stopPropagation(); e.preventDefault();
        var br = box.getBoundingClientRect();
        var cx = br.left + br.width/2, cy = br.top + br.height/2;
        rot = {
          cx:cx, cy:cy,
          start: Math.atan2(e.clientY - cy, e.clientX - cx),
          base: parseFloat(box.dataset.rotate) || 0,
          delta: 0
        };
        rotHandle.setPointerCapture(e.pointerId);
        rotHandle.style.cursor = 'grabbing';
        box.style.outline = '2px solid #4a90e2';
        if(rotBadge){ rotBadge.textContent = fmtDeg(rot.base); rotBadge.style.display = 'block'; }
      });
      rotHandle.addEventListener('pointermove', function(e){
        if(!rot) return;
        var a = Math.atan2(e.clientY - rot.cy, e.clientX - rot.cx);
        var delta = (a - rot.start) * 180 / Math.PI;
        var total = normDeg(rot.base + delta);
        if(e.shiftKey){ total = Math.round(total / 15) * 15; }
        else{
          /* 接近 0／90／180／270 時自動吸附，方便擺正 */
          var near = Math.round(total / 90) * 90;
          if(Math.abs(total - near) < 3) total = near;
        }
        total = normDeg(total);
        rot.delta = normDeg(total - rot.base);
        var img = box.querySelector('img');
        /* 旋轉中心 = 商品框中心（框即商品本體）。圖片含影子時比框大，要換算成圖片內的座標 */
        if(img){
          img.style.transformOrigin = (box.offsetWidth/2 - img.offsetLeft) + 'px ' + (box.offsetHeight/2 - img.offsetTop) + 'px';
          img.style.transform = 'rotate(' + rot.delta + 'deg)';
        }
        if(rotBadge) rotBadge.textContent = fmtDeg(total);
      });
      function rotEnd(){
        if(!rot) return;
        var delta = rot.delta; rot = null;
        rotHandle.style.cursor = 'grab';
        box.style.outline = '2px solid transparent';
        if(rotBadge) rotBadge.style.display = 'none';
        var img = box.querySelector('img');
        if(Math.abs(delta) < 0.5){ if(img) img.style.transform = ''; return; }
        /* CSS 預覽先留著，等父頁重算完以 bn-product-update-image 換圖時一併清掉，畫面不會閃回 */
        try{
          window.parent && window.parent.postMessage({type:'bn-product-rotate', bnid:getCurrentBnId(), id:box.dataset.id, delta:delta}, '*');
        }catch(_){ if(img) img.style.transform = ''; }
      }
      rotHandle.addEventListener('pointerup', rotEnd);
      rotHandle.addEventListener('pointercancel', rotEnd);
      rotHandle.addEventListener('lostpointercapture', rotEnd);
      rotHandle.addEventListener('dblclick', function(e){
        e.stopPropagation(); e.preventDefault();
        if(!(parseFloat(box.dataset.rotate) || 0)) return;
        try{ window.parent && window.parent.postMessage({type:'bn-product-rotate', bnid:getCurrentBnId(), id:box.dataset.id, rotate:0, absolute:true}, '*'); }catch(_){ }
      });
    }
    box.addEventListener('pointerdown',function(e){
      if(e.target.dataset.corner) return;
      if(e.target.closest && e.target.closest('[data-rotate-handle]')) return;
      e.stopPropagation();
      var zr=zone.getBoundingClientRect(),br=box.getBoundingClientRect();
      drag={type:'move',sx:e.clientX,sy:e.clientY,l:br.left-zr.left,t:br.top-zr.top,w:br.width,h:br.height,zw:zr.width,zh:zr.height};
      box.setPointerCapture(e.pointerId); box.style.outline='2px solid #4a90e2';
    });
    box.querySelectorAll('[data-corner]').forEach(function(h){
      h.addEventListener('pointerdown',function(e){
        e.stopPropagation();
        var zr=zone.getBoundingClientRect(),br=box.getBoundingClientRect();
        drag={type:'resize',corner:h.dataset.corner,sx:e.clientX,sy:e.clientY,l:br.left-zr.left,t:br.top-zr.top,w:br.width,h:br.height,zw:zr.width,zh:zr.height,ratio:parseFloat(box.dataset.ratio)||1};
        h.setPointerCapture(e.pointerId); box.style.outline='2px solid #4a90e2'; e.preventDefault();
      });
      h.addEventListener('pointermove',function(e){
        if(!drag||drag.type!=='resize') return;
        var dx=e.clientX-drag.sx,dy=e.clientY-drag.sy,c=drag.corner,r=drag.ratio;
        var sX=c.includes('w')?-1:1,sY=c.includes('n')?-1:1;
        var delta=Math.abs(dx)>Math.abs(dy)?dx*sX:dy*sY*r;
        var w=Math.max(40,drag.w+delta),bh=w/r;
        if(bh<30){bh=30;w=bh*r;}
        var l=drag.l,t=drag.t;
        if(c.includes('w')) l=drag.l+(drag.w-w);
        if(c.includes('n')) t=drag.t+(drag.h-bh);
        l=Math.max(0,Math.min(drag.zw-w,l)); t=Math.max(0,Math.min(drag.zh-bh,t));
        box.dataset.manualLayout = '1';
        box.style.left=l+'px'; box.style.top=t+'px'; box.style.width=w+'px'; box.style.height=bh+'px';
        bnRelayoutProductBox(box);
        scheduleProductLayoutPost(box);
      });
      h.addEventListener('pointerup',function(){ postProductLayout(box); drag=null; });
      h.addEventListener('pointercancel',function(){ postProductLayout(box); drag=null; });
      h.addEventListener('lostpointercapture',function(){ postProductLayout(box); drag=null; });
    });
    box.addEventListener('pointermove',function(e){
      if(!drag||drag.type!=='move') return;
      box.dataset.manualLayout = '1';
      box.style.left=Math.max(0,Math.min(drag.zw-drag.w,drag.l+e.clientX-drag.sx))+'px';
      box.style.top =Math.max(0,Math.min(drag.zh-drag.h,drag.t+e.clientY-drag.sy))+'px';
      scheduleProductLayoutPost(box);
    });
    box.addEventListener('pointerup',function(){ postProductLayout(box); drag=null; box.style.outline='2px solid transparent'; });
    box.addEventListener('pointercancel',function(){ postProductLayout(box); drag=null; box.style.outline='2px solid transparent'; });
    box.addEventListener('lostpointercapture',function(){ postProductLayout(box); drag=null; box.style.outline='2px solid transparent'; });
    box.addEventListener('wheel',function(e){
      e.preventDefault();
      var zr=zone.getBoundingClientRect(),br=box.getBoundingClientRect();
      var sc=e.deltaY<0?1.08:.93,r=parseFloat(box.dataset.ratio)||1;
      var w=Math.max(40,Math.min(br.width*sc,zr.width*.95)),bh=w/r;
      if(bh<30){bh=30;w=bh*r;} if(bh>zr.height*.95){bh=zr.height*.95;w=bh*r;}
      var cx=(br.left-zr.left)+br.width/2,cy=(br.top-zr.top)+br.height/2;
      box.dataset.manualLayout = '1';
      box.style.left=Math.max(0,Math.min(cx-w/2,zr.width-w))+'px';
      box.style.top =Math.max(0,Math.min(cy-bh/2,zr.height-bh))+'px';
      box.style.width=w+'px'; box.style.height=bh+'px';
      bnRelayoutProductBox(box);
      postProductLayout(box);
    },{passive:false});
  }

  /* ════════════════════════════════════════════════════
     人物圖（.bn-char-box）輔助函式，跟商品的 .bn-prod-box 共用同一個 zone，
     但不參與 layoutProducts() 的三角排版計算，也不受它的邊界 clamp 限制。
     ════════════════════════════════════════════════════ */
  var CHAR_Z_BASE = 400; /* 人物 z-index 基準，跟商品(11~一百多內)清楚分層，不會互相打架 */

  var CHAR_GRADIENT_CLASSES = ['漸層左','漸層右','漸層上','漸層下'];
  var CHAR_DDCARD_PROTECTION_CLASSES = ['下保護'];

  /* 人物專用漸層：原本的漸層仍留在畫布原本的位置與 z-index；
     這裡複製目前版型已啟用的漸層樣式，放進人物 box 內，並用人物
     原圖的 alpha 當 mask。人物仍維持原本跟商品的前後關係，漸層只會
     壓在人物本身。首頁 LOGO 牆目前沒有漸層 class，因此不會憑空新增
     未定義的首頁漸層。 */
  function getCharGradientSources(){
    var canvas = document.getElementById('canvas');
    if(!canvas) return [];
    var sourceClasses = CHAR_GRADIENT_CLASSES.slice();
    if(_bnDdcardTemplate) sourceClasses = sourceClasses.concat(CHAR_DDCARD_PROTECTION_CLASSES);
    return sourceClasses.map(function(cls){
      return canvas.querySelector('.' + cls);
    }).filter(function(el){
      if(!el) return false;
      var cs = window.getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0;
    });
  }

  function ensureCharGradientMask(box){
    if(!box) return null;
    var mask = box.querySelector('.bn-char-gradient-mask');
    if(mask) return mask;
    mask = document.createElement('canvas');
    mask.className = 'bn-char-gradient-mask';
    mask.style.cssText = [
      'position:absolute;left:0;top:0;width:100%;height:100%;',
      'pointer-events:none;z-index:2;display:none;'
    ].join('');
    var img = box.querySelector('img');
    if(img) img.insertAdjacentElement('afterend', mask);
    else box.insertBefore(mask, box.firstChild || null);
    return mask;
  }

  function parseCharGradient(ctx, backgroundImage, direction, width, height){
    var text = String(backgroundImage || '');
    if(text.indexOf('linear-gradient') === -1) return null;
    var colorM = text.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)\s*0%/i);
    if(!colorM) colorM = text.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if(!colorM) return null;
    var stopM = text.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)\s*([\d.]+)%/i);
    var stop = stopM ? Math.min(1, parseFloat(stopM[1]) / 100) : 1;
    var dir = String(direction || 'to right').trim().toLowerCase();
    var coords = {
      'to right':[0,0,width,0],
      'to left':[width,0,0,0],
      'to bottom':[0,0,0,height],
      'to top':[0,height,0,0]
    }[dir] || [0,0,width,0];
    var grad = ctx.createLinearGradient(coords[0], coords[1], coords[2], coords[3]);
    var solid = 'rgb(' + colorM[1] + ',' + colorM[2] + ',' + colorM[3] + ')';
    var clear = 'rgba(' + colorM[1] + ',' + colorM[2] + ',' + colorM[3] + ',0)';
    grad.addColorStop(0, solid);
    grad.addColorStop(stop, clear);
    grad.addColorStop(1, clear);
    return grad;
  }

  function syncCharGradientOverlay(box){
    if(!box) return;
    var mask = ensureCharGradientMask(box);
    var img = box.querySelector('img');
    var canvas = document.getElementById('canvas');
    if(!mask || !img || !canvas) return;
    var boxWidth = box.offsetWidth || parseFloat(window.getComputedStyle(box).width) || 0;
    var boxHeight = box.offsetHeight || parseFloat(window.getComputedStyle(box).height) || 0;
    var naturalW = img.naturalWidth || 0;
    var naturalH = img.naturalHeight || 0;
    if(!boxWidth || !boxHeight || !naturalW || !naturalH){
      mask.style.display = 'none';
      return;
    }

    mask.width = Math.max(1, Math.round(boxWidth));
    mask.height = Math.max(1, Math.round(boxHeight));
    mask.style.display = '';
    var ctx = mask.getContext('2d');
    if(!ctx) return;
    ctx.clearRect(0, 0, mask.width, mask.height);

    var boxRect = box.getBoundingClientRect();
    var canvasRect = canvas.getBoundingClientRect();
    var canvasCssW = canvas.offsetWidth || parseFloat(window.getComputedStyle(canvas).width) || canvasRect.width || 1;
    var canvasScale = (canvasRect.width || canvasCssW) / canvasCssW || 1;
    var sources = getCharGradientSources();
    if(!sources.length){
      ctx.clearRect(0, 0, mask.width, mask.height);
      mask.style.display = 'none';
      return;
    }

    var fullProtectionSources = [];
    sources.forEach(function(source){
      var sourceRect = source.getBoundingClientRect();
      var cs = window.getComputedStyle(source);
      var direction = cs.getPropertyValue('--grad-dir').trim();
      if(!direction){
        for(var i=0;i<CHAR_GRADIENT_CLASSES.length;i++){
          if(source.classList.contains(CHAR_GRADIENT_CLASSES[i])){
            direction = ({'漸層左':'to right','漸層右':'to left','漸層上':'to bottom','漸層下':'to top'})[CHAR_GRADIENT_CLASSES[i]];
            break;
          }
        }
      }
      var left = (sourceRect.left - boxRect.left) / canvasScale;
      var top = (sourceRect.top - boxRect.top) / canvasScale;
      var width = sourceRect.width / canvasScale;
      var height = sourceRect.height / canvasScale;
      var grad = parseCharGradient(ctx, cs.backgroundImage, direction, width, height);
      var solid = (!grad && cs.backgroundImage === 'none' && cs.backgroundColor && cs.backgroundColor !== 'transparent' && cs.backgroundColor !== 'rgba(0, 0, 0, 0)')
        ? cs.backgroundColor : null;
      if((!grad && !solid) || width <= 0 || height <= 0) return;
      if(_bnDdcardTemplate && source.classList.contains('下保護') && solid){
        fullProtectionSources.push({left:left, top:top, width:width, height:height, color:solid});
      }
      ctx.save();
      ctx.translate(left, top);
      ctx.fillStyle = grad || solid;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    });

    /* 以人物圖的實際 alpha 遮罩漸層，讓透明背景區不會被染色。 */
    var imageRatio = naturalW / naturalH;
    var drawW = boxWidth, drawH = boxWidth / imageRatio;
    if(drawH > boxHeight){ drawH = boxHeight; drawW = boxHeight * imageRatio; }
    var drawX = (boxWidth - drawW) / 2;
    var drawY = (boxHeight - drawH) / 2;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    ctx.globalCompositeOperation = 'source-over';

    /* ddcard 的最下方「下保護」是背景色實體色塊，不應再受人物 alpha
       鏤空影響；最後用完整矩形壓上，才能把人物外框完全蓋住。 */
    fullProtectionSources.forEach(function(protection){
      ctx.fillStyle = protection.color;
      ctx.fillRect(protection.left, protection.top, protection.width, protection.height);
    });
  }

  function syncAllCharGradientOverlays(){
    var canvas = document.getElementById('canvas');
    if(!canvas) return;
    canvas.querySelectorAll('.bn-char-box').forEach(syncCharGradientOverlay);
  }

  function createCharBox(slotKey, data, zone){
    var old = zone.querySelector('.bn-char-box[data-slot="'+slotKey+'"]');
    if(old) old.remove();
    var box = document.createElement('div');
    box.className = 'bn-char-box';
    box.dataset.slot = slotKey;
    box.dataset.id = data.id;
    box.dataset.ratio = data.ratio || 1;
    box.dataset.aboveMain = (data.aboveMain !== false) ? '1' : '0';
    var img = document.createElement('img');
    img.src = data.src;
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none;display:block;';
    img.addEventListener('load', function(){ syncCharGradientOverlay(box); });
    box.appendChild(img);
    ['nw','ne','sw','se'].forEach(function(c){
      var h = document.createElement('div'); h.dataset.corner = c;
      h.style.cssText = 'position:absolute;width:14px;height:14px;border-radius:50%;background:#e2874a;border:2px solid #fff;z-index:5;'
        +(c==='nw'?'left:-7px;top:-7px;cursor:nwse-resize;':'')
        +(c==='ne'?'right:-7px;top:-7px;cursor:nesw-resize;':'')
        +(c==='sw'?'left:-7px;bottom:-7px;cursor:nesw-resize;':'')
        +(c==='se'?'right:-7px;bottom:-7px;cursor:nwse-resize;':'');
      box.appendChild(h);
    });
    box.style.position = 'absolute';
    box.style.cursor = 'move';
    box.style.boxSizing = 'border-box';
    box.style.outline = '2px solid transparent';
    zone.appendChild(box);
    return box;
  }

  /* 新上傳、沒有已存位置可還原時的預設大小：置中、約 zone 較短邊的 90%，維持原比例。 */
  function applyDefaultCharLayout(box, zone){
    var cs = window.getComputedStyle(zone);
    var zw = parseFloat(cs.width)  || zone.offsetWidth  || 300;
    var zh = parseFloat(cs.height) || zone.offsetHeight || 300;
    var ratio = Math.max(0.1, parseFloat(box.dataset.ratio) || 0.75);
    var target = Math.floor(Math.min(zw, zh) * 0.9);
    var w, h;
    if(ratio >= 1){ w = target; h = Math.round(target / ratio); }
    else { h = target; w = Math.round(target * ratio); }
    box.style.left = Math.round((zw - w) / 2) + 'px';
    box.style.top  = Math.round((zh - h) / 2) + 'px';
    box.style.width  = w + 'px';
    box.style.height = h + 'px';
  }

  /* 套用已存的位置/大小（暫存還原、方橫配對同步）。刻意不做邊界 clamp——
     人物圖本來就可以超出商品範圍，甚至超出畫布邊緣。 */
  function applySavedCharLayout(box, zone, layout){
    if(!layout) return false;
    var cs = window.getComputedStyle(zone);
    var zw = parseFloat(cs.width)  || zone.offsetWidth  || 1;
    var zh = parseFloat(cs.height) || zone.offsetHeight || 1;
    var l = layout.leftPct   !== undefined ? layout.leftPct   * zw : layout.left;
    var t = layout.topPct    !== undefined ? layout.topPct    * zh : layout.top;
    var w = layout.widthPct  !== undefined ? layout.widthPct  * zw : layout.width;
    var h = layout.heightPct !== undefined ? layout.heightPct * zh : layout.height;
    if(!isFinite(l) || !isFinite(t) || !isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return false;
    box.style.left = l + 'px'; box.style.top = t + 'px';
    box.style.width = w + 'px'; box.style.height = h + 'px';
    return true;
  }

  function postCharacterLayout(box){
    try{
      var zone = getProductZone(); if(!zone || !box) return;
      var zr = zone.getBoundingClientRect();
      var br = box.getBoundingClientRect();
      var zw = zr.width || parseFloat(window.getComputedStyle(zone).width) || 1;
      var zh = zr.height || parseFloat(window.getComputedStyle(zone).height) || 1;
      var data = {
        type:'bn-character-layout-update',
        bnid:getCurrentBnId(),
        id:box.dataset.id,
        layout:{
          left: br.left - zr.left,
          top: br.top - zr.top,
          width: br.width,
          height: br.height,
          leftPct: (br.left - zr.left) / zw,
          topPct: (br.top - zr.top) / zh,
          widthPct: br.width / zw,
          heightPct: br.height / zh
        }
      };
      window.parent && window.parent.postMessage(data, '*');
    }catch(_){ }
  }

  function scheduleCharLayoutPost(box){
    if(!box) return;
    if(box._bnPostTimer) cancelAnimationFrame(box._bnPostTimer);
    box._bnPostTimer = requestAnimationFrame(function(){
      box._bnPostTimer = null;
      postCharacterLayout(box);
    });
  }

  /* 跟 setupProdDrag 幾乎一樣，唯一差異：完全不做邊界 clamp，
     人物圖可以自由拖到商品範圍外、甚至畫布外。 */
  function setupCharDrag(box, zone){
    var drag = null;
    box.addEventListener('pointerdown', function(e){
      if(e.target.dataset.corner) return;
      e.stopPropagation();
      drag = {type:'move', sx:e.clientX, sy:e.clientY, l:box.offsetLeft, t:box.offsetTop};
      box.setPointerCapture(e.pointerId); box.style.outline = '2px solid #e2874a';
    });
    box.querySelectorAll('[data-corner]').forEach(function(h){
      h.addEventListener('pointerdown', function(e){
        e.stopPropagation();
        var br = box.getBoundingClientRect();
        drag = {type:'resize', corner:h.dataset.corner, sx:e.clientX, sy:e.clientY,
          l:box.offsetLeft, t:box.offsetTop, w:br.width, h:br.height, ratio:parseFloat(box.dataset.ratio)||1};
        h.setPointerCapture(e.pointerId); box.style.outline = '2px solid #e2874a'; e.preventDefault();
      });
      h.addEventListener('pointermove', function(e){
        if(!drag || drag.type !== 'resize') return;
        var dx=e.clientX-drag.sx, dy=e.clientY-drag.sy, c=drag.corner, r=drag.ratio;
        var sX = c.indexOf('w')!==-1 ? -1 : 1, sY = c.indexOf('n')!==-1 ? -1 : 1;
        var delta = Math.abs(dx) > Math.abs(dy) ? dx*sX : dy*sY*r;
        var w = Math.max(30, drag.w+delta), bh = w/r;
        if(bh < 24){ bh = 24; w = bh*r; }
        var l = drag.l, t = drag.t;
        if(c.indexOf('w') !== -1) l = drag.l + (drag.w - w);
        if(c.indexOf('n') !== -1) t = drag.t + (drag.h - bh);
        box.dataset.manualLayout = '1';
        box.style.left=l+'px'; box.style.top=t+'px'; box.style.width=w+'px'; box.style.height=bh+'px';
        syncCharGradientOverlay(box);
        scheduleCharLayoutPost(box);
      });
      h.addEventListener('pointerup', function(){ postCharacterLayout(box); drag=null; });
      h.addEventListener('pointercancel', function(){ postCharacterLayout(box); drag=null; });
      h.addEventListener('lostpointercapture', function(){ postCharacterLayout(box); drag=null; });
    });
    box.addEventListener('pointermove', function(e){
      if(!drag || drag.type !== 'move') return;
      box.dataset.manualLayout = '1';
      box.style.left = (drag.l + e.clientX - drag.sx) + 'px';
      box.style.top  = (drag.t + e.clientY - drag.sy) + 'px';
      syncCharGradientOverlay(box);
      scheduleCharLayoutPost(box);
    });
    box.addEventListener('pointerup', function(){ postCharacterLayout(box); drag=null; box.style.outline='2px solid transparent'; });
    box.addEventListener('pointercancel', function(){ postCharacterLayout(box); drag=null; box.style.outline='2px solid transparent'; });
    box.addEventListener('lostpointercapture', function(){ postCharacterLayout(box); drag=null; box.style.outline='2px solid transparent'; });
    box.addEventListener('wheel', function(e){
      e.preventDefault();
      var br = box.getBoundingClientRect();
      var sc = e.deltaY < 0 ? 1.08 : .93, r = parseFloat(box.dataset.ratio) || 1;
      var w = Math.max(30, br.width*sc), bh = w/r;
      if(bh < 24){ bh = 24; w = bh*r; }
      var cx = box.offsetLeft + br.width/2, cy = box.offsetTop + br.height/2;
      box.dataset.manualLayout = '1';
      box.style.left = (cx - w/2) + 'px'; box.style.top = (cy - bh/2) + 'px';
      box.style.width = w + 'px'; box.style.height = bh + 'px';
      syncCharGradientOverlay(box);
      postCharacterLayout(box);
    }, {passive:false});
  }

  /* 取得目前畫面上「還顯示著」的商品裡，z-index 最大的那個(=最上層)。
     bn-character-visibility 隱藏掉的商品(display:none)不列入計算。 */
  function getTopVisibleProductZ(zone){
    var boxes = Array.prototype.slice.call(zone.querySelectorAll('.bn-prod-box')).filter(function(b){
      return b.style.display !== 'none';
    });
    var maxZ = 10;
    boxes.forEach(function(b){
      var z = parseInt(b.style.zIndex, 10) || 0;
      if(z > maxZ) maxZ = z;
    });
    return maxZ;
  }

  /* 重新計算並套用兩個人物欄位的 z-index：
     - 兩個人物都存在 → 商品此時已完全隱藏，兩個人物只跟彼此比前後
       （由 bn-character-pair-order 廣播的 pairFirst 決定，存在 zone.dataset.charPairFirst）。
     - 0~1 個人物 → 每個人物依自己的 aboveMain，跟「目前最上層商品」比前後。 */
  function applyCharacterZ(){
    var zone = getProductZone(); if(!zone) return;
    var box1 = zone.querySelector('.bn-char-box[data-slot="_bnCharacter"]');
    var box2 = zone.querySelector('.bn-char-box[data-slot="_bnCharacter2"]');
    if(box1 && box2){
      var pairFirst = zone.dataset.charPairFirst || '_bnCharacter';
      if(pairFirst === '_bnCharacter'){ box1.style.zIndex = String(CHAR_Z_BASE+2); box2.style.zIndex = String(CHAR_Z_BASE+1); }
      else { box2.style.zIndex = String(CHAR_Z_BASE+2); box1.style.zIndex = String(CHAR_Z_BASE+1); }
      return;
    }
    var topZ = getTopVisibleProductZ(zone);
    [box1, box2].forEach(function(box){
      if(!box) return;
      var above = box.dataset.aboveMain !== '0';
      box.style.zIndex = above ? String(topZ + 5) : String(Math.max(1, topZ - 5));
    });
  }

  /* 部分版位（目前是 SearchICON_PRODUCT，依檔名判斷，見 _bnSingleProductOnlyTemplate）
     不管全域人物圖/商品狀態如何，固定套用「人物圖完全不顯示、商品只顯示『主品』
     （position===0，主品（中），跟左配品/右配品區分）那一張」的規則。
     用 display:none 隱藏，不用 remove() 整個刪掉——之後如果使用者把主品換掉、
     或重新上傳，隱藏的商品可以立刻恢復，不會憑空消失。
     如果目前根本沒有主品（例如只上傳了左配品/右配品，或主品被移除），
     這個版位就固定不顯示任何商品，不會拿配品頂替。 */
  function applySingleProductOnlyIfNeeded(zone){
    if(!zone) return;
    var boxes = Array.prototype.slice.call(zone.querySelectorAll('.bn-prod-box'));
    if(_bnHomepageLogoWallTemplate){
      /* 首頁 LOGO 牆：只允許商品圖第 1 張，人物圖與其他商品全部隱藏。 */
      zone.querySelectorAll('.bn-char-box').forEach(function(b){ b.style.display = 'none'; });
      boxes.forEach(function(b, i){ b.style.display = (i === 0) ? '' : 'none'; });
      return;
    }
    if(!boxes.length) return;

    if(_bnSingleProductOnlyTemplate){
      zone.querySelectorAll('.bn-char-box').forEach(function(b){ b.style.display = 'none'; });
      var main = boxes.filter(function(b){ return (b.dataset.position || '0') === '0'; })[0] || null;
      boxes.forEach(function(b){ b.style.display = (b === main) ? '' : 'none'; });
    }
  }

  /* ── 畫布文字直接點擊編輯 ── */
  var EDITABLE_CLASSES = ['主標','副標','副標案型七字內','日期','品牌名','ICON獨立文案','六字內'];
  var _dollarExemptSet = {};   /* {className: true} */

  /* ── 字數計算（中文1字，英數0.5字） ── */
  var CHAR_LIMITS = { '品牌名':9, '主標':8, '副標':7, '日期':14, 'ICON獨立文案':2 };

  function calcUnits(text){
    var units = 0;
    for(var i=0; i<text.length; i++){
      var c = text.charCodeAt(i);
      /* 中文、全形等 CJK 算 1，其餘算 0.5 */
      units += (c > 0x2E7F) ? 1 : 0.5;
    }
    return Math.round(units * 10) / 10;
  }

  function updateCharCounter(el, cls){
    var limit = CHAR_LIMITS[cls];
    if(!limit) return;
    var counter = document.getElementById('_bn_counter_'+cls);
    if(!counter) return;
    var text = el.textContent;
    var used = calcUnits(text);
    counter.textContent = used.toFixed(1) + ' / ' + limit + ' 字';
    counter.style.color = used > limit ? '#ef4444' : used > limit * 0.85 ? '#f59e0b' : '#687090';
  }

  function ensureCounter(el, cls){ /* 字數提示已移至左側工具列，此處為空 */ }

  function showCounter(el, cls){
    /* 通知父層（BN編輯器）更新字數顯示 */
    if(window.parent !== window){
      var limit = CHAR_LIMITS[cls] || 0;
      var used  = calcUnits(el.textContent);
      window.parent.postMessage({
        type:'bn-char-count', field:cls, used:used, limit:limit
      }, '*');
    }
  }

  function hideCounter(cls){
    if(window.parent !== window){
      window.parent.postMessage({type:'bn-char-count', field:cls, used:null}, '*');
    }
  }

  function trimToLimit(text, limit){
    var out = '';
    var sum = 0;
    text = String(text || '');
    for(var i=0; i<text.length; i++){
      var c = text.charCodeAt(i);
      var w = (c > 0x2E7F) ? 1 : 0.5;
      if(sum + w > limit) break;
      out += text[i];
      sum += w;
    }
    return out;
  }

  function enforceLimit(el, cls){
    var limit = CHAR_LIMITS[cls];
    if(!limit) return;
    if(el.__fmtOver) return;   /* 系統補 $／千分位造成的超字：保留原文 */
    var text = el.textContent;
    var units = calcUnits(text);
    if(units <= limit) return;
    var out = trimToLimit(text, limit);
    var sel = window.getSelection();
    el.textContent = out;
    var r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function getEditableSelectionOffsets(el){
    var sel = window.getSelection();
    var len = el.textContent.length;
    if(!sel || sel.rangeCount === 0) return {start:len,end:len};
    var range = sel.getRangeAt(0);
    if(!el.contains(range.startContainer) || !el.contains(range.endContainer)) return {start:len,end:len};
    var pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    var start = pre.toString().length;
    var preEnd = document.createRange();
    preEnd.selectNodeContents(el);
    preEnd.setEnd(range.endContainer, range.endOffset);
    var end = preEnd.toString().length;
    if(start > end){ var t=start; start=end; end=t; }
    return {start:start,end:end};
  }

  function wouldExceedLimit(el, cls, insertText){
    var limit = CHAR_LIMITS[cls];
    if(!limit) return false;
    var text = el.textContent || '';
    var pos = getEditableSelectionOffsets(el);
    var next = text.slice(0,pos.start) + String(insertText || '') + text.slice(pos.end);
    return calcUnits(next) > limit;
  }

  /* ── 系統補 $／千分位造成的超字：不截斷，改用紅框常駐 ── */
  function ensureOverflowStyle(){
    if(document.getElementById('_bn_overflow_style')) return;
    var st=document.createElement('style');
    st.id='_bn_overflow_style';
    st.textContent='.bn-over-limit{outline:3px solid #ff4d4f !important;'
      +'background:rgba(255,77,79,.14) !important;border-radius:2px;}';
    (document.head||document.documentElement).appendChild(st);
  }
  function isOverLimit(el, cls){
    var limit = CHAR_LIMITS[cls];
    if(!limit) return false;
    return calcUnits(el.textContent) > limit + 0.001;
  }
  function markOverflow(el, cls){
    if(!CHAR_LIMITS[cls]) return false;
    ensureOverflowStyle();
    var over = isOverLimit(el, cls);
    el.classList.toggle('bn-over-limit', over);
    if(!over) el.__fmtOver = false;
    return over;
  }
  /* 父層把格式化後的文字推回畫布時呼叫：標記成「系統造成的超字」 */
  function refreshOverflowAll(){
    EDITABLE_CLASSES.forEach(function(cls){
      if(!CHAR_LIMITS[cls]) return;
      document.querySelectorAll('.'+cls).forEach(function(el){
        if(el.children.length) return;
        if(markOverflow(el, cls)) el.__fmtOver = true;
      });
    });
  }
  window.__bnRefreshOverflow = refreshOverflowAll;

  function flashEditLimit(el){
    el.style.outline = '1.5px solid #ef4444';
    clearTimeout(el._bnLimitTimer);
    el._bnLimitTimer = setTimeout(function(){
      el.style.outline = '1.5px solid rgba(74,144,226,.55)';
    }, 400);
  }

  /* ── makeEditable ── */
  function makeEditable(el, cls){
    if(el.dataset.bnEditBound === '1') return;
    el.dataset.bnEditBound = '1';
    el.style.cursor = 'text';

    var _editing = false;
    var _rightClickPending = false;  /* 右鍵選單開啟中，阻止 blur 關閉編輯 */

    function startEditing(clientX, clientY){
      if(_editing) return;
      _editing = true;
      el.contentEditable = 'true';
      el.style.outline = '1.5px solid rgba(74,144,226,.55)';
      el.style.borderRadius = '2px';
      requestAnimationFrame(function(){
        if(typeof clientX === 'number' && document.caretRangeFromPoint){
          var rng = document.caretRangeFromPoint(clientX, clientY);
          if(rng){ var s=window.getSelection(); s.removeAllRanges(); s.addRange(rng); }
        }
        showCounter(el, cls);
      });
    }

    function commitEdit(){
      _editing = false;
      el.contentEditable = 'false';
      el.style.outline = 'none';
      hideCounter(cls);
      markOverflow(el, cls);
      /* AR：六字內 一旦在畫布內手動編輯過，標記獨立，之後副標變更不再覆蓋 */
      if(cls === '六字內') el.dataset.bnManualText = '1';
      _sendUpdate(el, cls);
    }

    el.addEventListener('mousedown', function(e){
      if(e.button === 2) return; /* 右鍵由 contextmenu 處理 */
      e.stopPropagation();
      startEditing(e.clientX, e.clientY);
    });

    el.addEventListener('beforeinput', function(e){
      if(e.inputType && e.inputType.indexOf('delete') === 0) return;
      if(e.isComposing) return;
      var insert = e.data || '';
      if(!insert && e.inputType !== 'insertText') return;
      if(wouldExceedLimit(el, cls, insert)){
        e.preventDefault();
        flashEditLimit(el);
        showCounter(el, cls);
      }
    });

    el.addEventListener('paste', function(e){
      var text = (e.clipboardData || window.clipboardData).getData('text') || '';
      if(!wouldExceedLimit(el, cls, text)) return;
      /* 貼上後會超過上限：整段擋掉，不做截斷 */
      e.preventDefault();
      flashEditLimit(el);
      updateCharCounter(el, cls);
      showCounter(el, cls);
    });

    el.addEventListener('input', function(){
      updateCharCounter(el, cls);
      /* 不截斷文字：超過上限一律保留原文，改用紅框常駐＋擋下載 */
      var over = markOverflow(el, cls);
      if(over) el.style.outline = '2px solid #ef4444';
      else if(_editing) el.style.outline = '1.5px solid rgba(74,144,226,.55)';
      showCounter(el, cls);
    });

    el.addEventListener('blur', function(){
      if(_rightClickPending) return; /* 右鍵選單開啟中，不關閉編輯 */
      if(_editing) commitEdit();
    });

    el.addEventListener('keydown', function(e){
      if(e.key === 'Enter'){ e.preventDefault(); commitEdit(); }
      if(e.key === 'Escape'){
        _editing = false;
        el.contentEditable = 'false';
        el.style.outline = 'none';
        hideCounter(cls);
        if(window.parent !== window){
          window.parent.postMessage({type:'bn-text-cancel', field:cls}, '*');
        }
      }
    });

    el.addEventListener('contextmenu', function(e){
      e.preventDefault(); e.stopPropagation();

      /* 確保進入編輯模式 */
      if(!_editing) startEditing(e.clientX, e.clientY);

      /* 立刻把選取的文字和位置存下來 */
      var savedSelText = '';
      var savedStart = -1;
      var savedEnd   = -1;
      var sel = window.getSelection();
      if(sel && sel.rangeCount > 0 && !sel.isCollapsed){
        savedSelText = sel.toString();
        var range = sel.getRangeAt(0);
        var preRange = document.createRange();
        preRange.selectNodeContents(el);
        preRange.setEnd(range.startContainer, range.startOffset);
        savedStart = preRange.toString().length;
        savedEnd   = savedStart + savedSelText.length;
      }

      _rightClickPending = true;
      showCanvasTextMenu(e, el, cls, savedSelText, savedStart, savedEnd, function onMenuClose(){
        _rightClickPending = false;
      });
    });
  }

  /* sba.html 同款：工具函式 */
  function _cleanNum(t){ return t.replace(/[$,]/g,'').trim(); }
  function _isNumeric(t){ var c=_cleanNum(t); return /^\d+$/.test(c) && c.length>0; }
  function _addThousands(d){ return String(d).replace(/\B(?=(\d{3})+(?!\d))/g,','); }
  function _fmtDollar(n){ return '$'+(n.length>=4?_addThousands(n):n); }
  function _getExempt(el){ try{ return JSON.parse(el.dataset.dollarExempt||'[]'); }catch(_){ return []; } }
  function _setExempt(el, list){
    if(list.length) el.dataset.dollarExempt = JSON.stringify(list);
    else el.removeAttribute('data-dollar-exempt');
  }
  /* 中文數字（一～十）豁免：banwords.xlsx 有「一→1」…「十→10」這幾條
     自動改字規則，勾了豁免就跟著 $／千分位一起跳過。旗標存在元素上，
     每次 _sendUpdate 都會帶給父層，否則下一次編輯又會被改回阿拉伯數字。 */
  /* 阿拉伯數字 ⇄ 中文數字：逐字對應 0～9。
     轉中文時會一併去掉 $ 與千分位逗號（「$5」→「五」）。
     多位數是逐字轉（「50」→「五零」），不會轉成「五十」這種讀法。 */
  var _CN_DIGITS = ['零','一','二','三','四','五','六','七','八','九'];
  function _digitsToCn(t){
    return String(t || '')
      .replace(/\$/g, '')
      .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
      .replace(/[0-9]/g, function(d){ return _CN_DIGITS[Number(d)]; });
  }
  function _cnToDigits(t){
    return String(t || '').replace(/[零一二三四五六七八九]/g, function(c){
      return String(_CN_DIGITS.indexOf(c));
    });
  }
  function _getNumeralExempt(el){ return el.dataset.numeralExempt === '1'; }
  function _setNumeralExempt(el, on){
    if(on) el.dataset.numeralExempt = '1';
    else el.removeAttribute('data-numeral-exempt');
  }
  function _replaceSelText(savedRange, text){
    var sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(savedRange);
    try{ document.execCommand('insertText', false, text); }
    catch(_){
      savedRange.deleteContents();
      var node = document.createTextNode(text);
      savedRange.insertNode(node);
      sel.removeAllRanges(); sel.collapse(node, node.length);
    }
  }

  function _sendUpdate(el, cls){
    var text = el.textContent.trim();
    /* 把豁免清單一起送出，父層用這個清單跳過對應數字的 $ 格式化 */
    var exemptList = _getExempt(el);
    if(window.parent !== window){
      window.parent.postMessage({
        type:'bn-text-update', field:cls, value:text,
        dollarExempt: exemptList.length > 0 ? exemptList : false,
        numeralExempt: _getNumeralExempt(el)
      }, '*');
    }
  }

  function showCanvasTextMenu(e, el, cls, savedSelText, savedStart, savedEnd, onMenuClose){
    var existing = document.getElementById('_bn_canvas_ctx');
    if(existing) existing.remove();

    /* 只有選取的是純數字才顯示選單（同 sba.html） */
    var savedRange = null;
    var sel = window.getSelection();
    if(sel && sel.rangeCount > 0 && !sel.isCollapsed){
      savedRange = sel.getRangeAt(0).cloneRange();
    }

    var cleanSel  = _cleanNum(savedSelText);
    var isNumSel  = _isNumeric(savedSelText);
    var hasDollar = savedSelText.indexOf('$') !== -1;
    var exemptList = _getExempt(el);
    var alreadyExempt = exemptList.indexOf(cleanSel) !== -1;

    /* 如果沒有選取數字，不顯示選單 */
    if(!savedSelText){ return; }

    var menu = document.createElement('div');
    menu.id = '_bn_canvas_ctx';
    menu.style.cssText=[
      'position:fixed;z-index:999999;',
      'background:#1a1d2a;border:1px solid #2e3347;',
      'border-radius:10px;padding:8px;',
      'box-shadow:0 8px 24px rgba(0,0,0,.5);',
      'min-width:200px;font-size:13px;',
    ].join('');

    /* 選項改成按鈕造型（獨立圓角色塊＋邊框），字級 13px→20px，
       方便在畫布上快速辨識、點擊。 */
    function menuBtn(label, handler){
      var btn = document.createElement('div');
      btn.textContent = label;
      btn.style.cssText = 'margin:0 0 6px;padding:9px 16px;border:1px solid #3a4160;border-radius:8px;background:#242942;cursor:pointer;color:#dde3f0;white-space:nowrap;font-size:20px;font-weight:600;text-align:center;transition:background .15s,border-color .15s;';
      btn.addEventListener('mouseenter', function(){ btn.style.background='#333b5c'; btn.style.borderColor='#4a5480'; });
      btn.addEventListener('mouseleave', function(){ btn.style.background='#242942'; btn.style.borderColor='#3a4160'; });
      btn.addEventListener('mousedown', function(ev){
        ev.preventDefault();
        menu.remove();
        if(typeof onMenuClose === 'function') onMenuClose();
        handler();
        setTimeout(function(){ el.focus(); }, 0);
      });
      menu.appendChild(btn);
    }

    /* 按鈕1：$／千分位豁免。同一顆按鈕依目前狀態切換打勾，
       不再另外多開一顆「恢復」按鈕。 */
    if(isNumSel){
      if(alreadyExempt || !hasDollar){
        menuBtn('✓ 恢復加$和千分位符號', function(){
          var list = _getExempt(el).filter(function(n){ return n !== cleanSel; });
          _setExempt(el, list);
          if(savedRange) _replaceSelText(savedRange, _fmtDollar(cleanSel));
          _sendUpdate(el, cls);
        });
      } else {
        menuBtn('暫時不加$和千分位符號', function(){
          var list = _getExempt(el);
          if(list.indexOf(cleanSel) === -1) list.push(cleanSel);
          _setExempt(el, list);
          if(savedRange) _replaceSelText(savedRange, cleanSel);
          _sendUpdate(el, cls);
        });
      }
    } else {
      var dollarAlreadyExempt = exemptList.length > 0;
      if(dollarAlreadyExempt){
        menuBtn('✓ 恢復加$和千分位符號', function(){
          _setExempt(el, []);
          _sendUpdate(el, cls);
        });
      } else {
        menuBtn('暫時不加$和千分位符號', function(){
          var nums = savedSelText.match(/\d+/g) || [];
          var list = _getExempt(el);
          nums.forEach(function(n){ if(list.indexOf(n)===-1) list.push(n); });
          _setExempt(el, list);
          var cleaned = savedSelText.replace(/\$/g,'').replace(/(\d),(\d{3})(?!\d)/g,'$1$2');
          if(savedRange) _replaceSelText(savedRange, cleaned);
          _sendUpdate(el, cls);
        });
      }
    }

    /* 按鈕2：中文數字／阿拉伯數字豁免。跟按鈕1各自獨立，同樣是
       同一顆按鈕依 numeralExempt 狀態切換打勾。 */
    if(_getNumeralExempt(el)){
      menuBtn('✓ 恢復強制變阿拉伯數字', function(){
        _setNumeralExempt(el, false);
        if(savedRange && /[零一二三四五六七八九]/.test(savedSelText)) _replaceSelText(savedRange, _cnToDigits(savedSelText));
        _sendUpdate(el, cls);
      });
    } else {
      menuBtn('不強制變阿拉伯數字', function(){
        _setNumeralExempt(el, true);
        if(savedRange && /[0-9]/.test(savedSelText)) _replaceSelText(savedRange, _digitsToCn(savedSelText));
        _sendUpdate(el, cls);
      });
    }

    menu.style.left = Math.min(e.clientX, window.innerWidth  - 230) + 'px';
    menu.style.top  = Math.min(e.clientY, window.innerHeight - 80)  + 'px';
    document.body.appendChild(menu);
    menu.tabIndex = -1;

    document.addEventListener('mousedown', function rm(ev){
      if(!menu.contains(ev.target)){
        menu.remove();
        document.removeEventListener('mousedown', rm);
        if(typeof onMenuClose === 'function') onMenuClose();
      }
    });
  }
  function attachEditableToAll(){
    EDITABLE_CLASSES.forEach(function(cls){
      document.querySelectorAll('.'+cls).forEach(function(el){
        makeEditable(el, cls);
      });
    });
  }

  function captureCanvas(cb, wantLayers){
    function runAfterFonts(){
      if(window.html2canvas){doCapture(cb, wantLayers);return;}
      var s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload=function(){doCapture(cb, wantLayers);}; s.onerror=function(){if(cb)cb(null);};
      document.head.appendChild(s);
    }
    if(document.fonts && document.fonts.ready){
      document.fonts.ready.then(runAfterFonts).catch(runAfterFonts);
    } else {
      runAfterFonts();
    }
  }
  /* html2canvas 會把圓角元素的 box-shadow 畫進元素內部（首頁LOGO牆膠囊變灰底），
     所以截圖時先移除陰影，截完後用 canvas 原生 shadow 只補畫在元素外側。 */
  function _bnPaintLogoWallShadows(ctx, cv, scale, W, H){
    var specs = window.__bnLogoWallShadowSpecs;
    if(!specs || !specs.length) return;
    var cr = cv.getBoundingClientRect();
    function rr(x, y, w, h, r){
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    specs.forEach(function(s){
      var m = /(rgba?\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/.exec(s.shadow || '');
      if(!m || !s.el) return;
      var r = s.el.getBoundingClientRect();
      var x = (r.left - cr.left) / scale, y = (r.top - cr.top) / scale;
      var w = r.width / scale, h = r.height / scale;
      var rad = Math.min(parseFloat(s.radius) || 0, w / 2, h / 2);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); rr(x, y, w, h, rad);
      ctx.clip('evenodd');
      ctx.shadowColor = m[1]; ctx.shadowOffsetX = parseFloat(m[2]); ctx.shadowOffsetY = parseFloat(m[3]); ctx.shadowBlur = parseFloat(m[4]);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); rr(x, y, w, h, rad); ctx.fill();
      ctx.restore();
    });
  }
  function doCapture(cb, wantLayers){
    var cv=document.getElementById('canvas');
    if(!cv){if(cb)cb(null);return;}
    var W = parseFloat(cv.style.width)  || cv.offsetWidth;
    var H = parseFloat(cv.style.height) || cv.offsetHeight;
    if(!W||!H){if(cb)cb(null);return;}

    /* 截圖策略：所見即所得
       直接對目前已渲染的畫面截圖，不移動 canvas、不重算任何位置。
       用目前的 scale 反推，讓 html2canvas 輸出符合設計原始尺寸。*/

    var scaleMatch = cv.style.transform && cv.style.transform.match(/scale\(([\d.]+)\)/);
    var scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

    var overlay = document.getElementById('_bn_bg_overlay');
    if(overlay) overlay.style.display = 'none';

    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        html2canvas(cv,{
          scale: 1 / scale,   /* 把螢幕縮放還原回設計原始尺寸 */
          useCORS: true,
          allowTaint: true,
          backgroundColor: (_bnFixedWhiteBackgroundTemplate || _bnWhiteCanvasUnderCircleTemplate) ? '#ffffff' : null,
          width: W,
          height: H,
          logging: false
        })
        .then(function(c){
          var out = document.createElement('canvas');
          out.width = W; out.height = H;
          var outCtx = out.getContext('2d');
          outCtx.drawImage(c, 0, 0, out.width, out.height);
          _bnPaintLogoWallShadows(outCtx, cv, scale, W, H);
          var mainUrl = out.toDataURL('image/png');

          if(!wantLayers){
            if(overlay) overlay.style.display = '';
            if(cb) cb(mainUrl);
            return;
          }

          /* ★ 分層截圖（2026-08，給「先壓背景、商品圖不壓」的選擇性壓縮用）：
             背景層 = 底圖照片/背景色 + 保護色塊 + 漸層（吃掉大部分 JPEG 體積）
             前景層 = 商品圖、logo、文字、CTA（需要保持銳利的部分，透明 PNG）
             兩層都跟主圖同尺寸，父層合成時只降背景解析度即可。
             任何一步失敗就只回傳主圖，父層自動退回舊的整張壓縮流程。 */
          var BG_SET = {'背景色':1,'bg':1,'底色':1,'上保護':1,'下保護':1,'左側保護':1,'右側保護':1,
                        '上方保護':1,'下方保護':1,'文案保護':1,'漸層左':1,'漸層右':1,'漸層上':1,'漸層下':1};
          function isBgEl(el){
            if(el.id === '底圖') return true;
            if(!el.classList) return false;
            for(var k in BG_SET){ if(el.classList.contains(k)) return true; }
            return false;
          }
          var kids = Array.prototype.slice.call(cv.children);
          var hcOpts = {scale:1/scale, useCORS:true, allowTaint:true, backgroundColor: (_bnFixedWhiteBackgroundTemplate || _bnWhiteCanvasUnderCircleTemplate) ? '#ffffff' : null, width:W, height:H, logging:false};
          function toUrl(c2, withShadow){
            var o = document.createElement('canvas');
            o.width = W; o.height = H;
            var oc = o.getContext('2d');
            oc.drawImage(c2, 0, 0, W, H);
            if(withShadow) _bnPaintLogoWallShadows(oc, cv, scale, W, H);
            return o.toDataURL('image/png');
          }
          var _hid = [];
          function hideIf(fn){
            kids.forEach(function(el){
              if(fn(el)){ _hid.push({el:el, vis:el.style.visibility}); el.style.visibility='hidden'; }
            });
          }
          function unhide(){
            _hid.forEach(function(o){ o.el.style.visibility = o.vis; });
            _hid = [];
          }

          hideIf(function(el){ return !isBgEl(el); });     /* 只留背景層 */
          html2canvas(cv, hcOpts).then(function(cBg){
            var bgUrl = toUrl(cBg);
            unhide();
            hideIf(isBgEl);                                 /* 只留前景層 */
            var oldCvBg = cv.style.background;
            cv.style.background = 'transparent';            /* 前景層不能帶底色 */
            return html2canvas(cv, hcOpts).then(function(cFg){
              unhide();
              cv.style.background = oldCvBg;
              if(overlay) overlay.style.display = '';
              if(cb) cb(mainUrl, bgUrl, toUrl(cFg, true));
            });
          }).catch(function(){
            unhide();
            if(overlay) overlay.style.display = '';
            if(cb) cb(mainUrl);                             /* 分層失敗 → 只給主圖 */
          });
        })
        .catch(function(){
          if(overlay) overlay.style.display = '';
          if(cb) cb(null);
        });
      });
    });
  }

  function applyColor(cls,color){
    if(!color)return;
    document.querySelectorAll('.'+cls).forEach(function(el){
      if(!el.querySelector('.cta-text')) el.style.color=color;
    });
  }
})();

})();

/* BN_FORCE_CTA_REGULAR_20260701 */
(function(){
  try {
    var css = '.放心買_安心退,.逛逛去,.cta-text{font-family:"ShopeeNotoSans (content)" !important;font-weight:300 !important;font-style:normal !important;}';
    var style = document.createElement('style');
    style.setAttribute('data-bn-cta-regular','1');
    style.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(style);
  } catch(e) {}
})();
