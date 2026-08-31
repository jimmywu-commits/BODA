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
      if(!_bnTagSrcs.red && !_bnTagSrcs.white) _bnLoadTagLayers();
    }
    window._bnSetTagColor = _bnSetTagColor;
    window._bnApplyTag = _bnLoadTagLayers;
    _bnLoadTagLayers();


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

          /* 上下置中：logo 和文字各自垂直置中 */
          _siLogo.style.top = ((_siCanvasH - _siLogoH) / 2) + 'px';
          _siText.style.top = ((_siCanvasH - visTextH) / 2) + 'px';
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
  }

  window.addEventListener('message', function(e) {
    if (!e.data) return;

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
      });
      setTimeout(function(){ try{ refreshOverflowAll(); }catch(_){} }, 0);
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
    }

    if (e.data.type === 'bn-overflow-check') {
      try{ refreshOverflowAll(); }catch(_){}
    }

    if (e.data.type === 'bn-color') {
      var c = e.data.data||{}, cv = document.getElementById('canvas');
      if (c.canvasBg) {
        /* 支援 .背景色 和 .bg 兩種 class 名稱 */
        var bg = cv.querySelector('.背景色') || cv.querySelector('.bg') || cv.querySelector('.底色');
        if(bg) bg.style.backgroundColor = c.canvasBg; else cv.style.background = c.canvasBg;
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
            gel.style.background = 'linear-gradient(' + dir + ', ' + c.canvasBg + ' 0%, ' + _toRgba0rt(c.canvasBg) + ' 100%)';
          }
        });
        /* 所有保護色塊跟著背景色同步 */
        ['.文案保護','.右側保護','.左側保護','.上方保護','.下方保護','.上保護','.下保護','.底色'].forEach(function(sel){
          var el = cv.querySelector(sel);
          if(el) el.style.background = c.canvasBg;
        });
        /* .bg 純色塊也同步（Coin 等版位） */
        var bgEl2 = cv.querySelector('.bg');
        if(bgEl2 && !cv.querySelector('.背景色')) bgEl2.style.backgroundColor = c.canvasBg;
      }
      function ac(cls,col){ if(!col)return; document.querySelectorAll('.'+cls).forEach(function(el){ if(!el.querySelector('.cta-text')) el.style.color=col; }); }
      ac('主標',c.mainText); ac('副標',c.subText); ac('日期',c.dateText); ac('品牌名',c.brandText);
      /* Search_Image：副標案型七字內 顏色跟著副標文字色連動 */
      document.querySelectorAll('.副標案型七字內').forEach(function(el){ if(c.subText) el.style.setProperty('color', c.subText, 'important'); });
      var _bnCtaBg = c.subText || c.ctaBg;
      var _bnCtaText = c.ctaText;
      function _bnCtaContrastText(bgHex){
        var m = String(bgHex || '').match(/^#?([0-9a-f]{6})$/i);
        if(!m) return '#ffffff';
        var n = parseInt(m[1], 16);
        var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        function ch(v){
          v = v / 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        }
        var lum = 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
        var whiteRatio = (1.05) / (lum + 0.05);
        var blackRatio = (lum + 0.05) / 0.05;
        return whiteRatio >= blackRatio ? '#ffffff' : '#000000';
      }
      /* CTA 文字可手動選任意有效色碼；只有舊資料或無效值才回退到黑／白對比色。 */
      var _bnCtaTextValue = String(_bnCtaText || '').trim().toLowerCase();
      _bnCtaText = /^#[0-9a-f]{6}$/.test(_bnCtaTextValue)
        ? _bnCtaTextValue
        : _bnCtaContrastText(_bnCtaBg);
      document.querySelectorAll('.cta-text').forEach(function(el){ if(_bnCtaText) el.style.color=_bnCtaText; });
      /* CTA 底色跟副標色：.逛逛去按鈕 / .cta底 / .逛逛去底 */
      document.querySelectorAll('.逛逛去按鈕,.cta底,.逛逛去底').forEach(function(el){ if(_bnCtaBg) el.style.backgroundColor=_bnCtaBg; });
      /* Search Image CTA 圓底也跟副標色 */
      document.querySelectorAll('.cta圓底').forEach(function(el){ if(_bnCtaBg) el.style.setProperty('background-color', _bnCtaBg, 'important'); });
      if(c.tagColor){
        if(typeof window._bnSetTagColor === 'function') window._bnSetTagColor(c.tagColor);
        else {
          _bnTagColor = (c.tagColor === 'white') ? 'white' : 'red';
          if(typeof window._bnApplyTag === 'function') window._bnApplyTag();
        }
      }
      /* CTA 文字色：.放心買_安心退 / .逛逛去 */
      document.querySelectorAll('.放心買_安心退,.逛逛去').forEach(function(el){ if(_bnCtaText) el.style.color=_bnCtaText; });
      /* CTA 三角色：.cta三角標 / .逛逛去三角標 */
      document.querySelectorAll('.cta三角標,.cta三角箭頭').forEach(function(el){ if(_bnCtaText) el.style.borderLeftColor=_bnCtaText; });
      document.querySelectorAll('.逛逛去三角標').forEach(function(el){ if(_bnCtaText) el.style.borderLeftColor=_bnCtaText; });
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
      var _leftAlignNames = ['hbn','coin','fb_post','lpbn'];
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

      if (!logos.length) { zone.style.opacity=''; zone.style.background=''; return; }

      /* IG方 / 方 Logo 系列：只取第一張，避免方版 logo 區多張擠壓或裁切。 */
      if (isIGSquare || isSquareLogoLayout) logos = logos.slice(0, 1);
      /* ddcard橫：isMultiCenter → 多張，不限制；ddcard方（isIGSquare）→ 單張 */

      zone.style.background = 'transparent';
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
      }    }

    /* 商品新增 */
    if (e.data.type === 'bn-product-add') {
      var pzone = getProductZone(); if(!pzone) return;
      var oldBox = pzone.querySelector('.bn-prod-box[data-id="'+e.data.id+'"]');
      if(oldBox) oldBox.remove();
      pzone.style.background = 'transparent'; pzone.style.opacity = '1';
      pzone.style.overflow = 'visible'; pzone.style.position = 'relative';
      var box = document.createElement('div');
      box.className = 'bn-prod-box'; box.dataset.id = e.data.id; box.dataset.ratio = e.data.ratio||1;
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
      var pimg = document.createElement('img'); pimg.src = e.data.src;
      pimg.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none;display:block;';
      box.appendChild(pimg);
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
      if(el) el.remove();
      var remaining = pzone.querySelectorAll('.bn-prod-box');
      /* 商品全部移除時，只有「人物圖也沒有」才把提示色還原成預設淡紅；
         如果還有人物圖存在，代表這個範圍其實還有內容，不能還原成淡紅提示色。 */
      if(!remaining.length && !pzone.querySelector('.bn-char-box')) { pzone.style.background=''; pzone.style.opacity=''; }
      else if(remaining.length) layoutProducts(pzone);
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
        if(e.data.ratio) boxU.dataset.ratio = e.data.ratio;
        var imgU = boxU.querySelector('img');
        if(imgU && e.data.src) imgU.src = e.data.src;
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
       ★ _bnSingleProductOnlyTemplate（例如 SearchICON_PRODUCT）這個版位完全
         不顯示人物圖，不管全域人物圖狀態如何，一律忽略 bn-character-add。 ════════════════════════════════════════════════════ */
    if (e.data.type === 'bn-character-add') {
      if(_bnSingleProductOnlyTemplate) return; /* 這個版位固定只顯示商品，完全不顯示人物圖 */
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
        if(img3 && e.data.src) img3.src = e.data.src;
      }
      return;
    }

    /* 有人物圖時，商品最多只顯示「目前最上層」的幾件，其餘隱藏（不是移除，
       只是 display:none，移除人物圖後可以直接復原，不用重新排版）。
       _bnSingleProductOnlyTemplate 的版位無視這則訊息帶來的可見度規則，
       固定套用自己的「只留最上層 1 張商品、人物圖完全不顯示」規則。 */
    if (e.data.type === 'bn-character-visibility') {
      var czone4 = getProductZone(); if(!czone4) return;
      if(_bnSingleProductOnlyTemplate){ applySingleProductOnlyIfNeeded(czone4); return; }
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
      }
      return;
    }

    /* 背景圖：放到 .背景色（如有）或畫布底層 */
    if (e.data.type === 'bn-bg') {
      /* 支援 .背景色 和 .bg 兩種 class 名稱 */
      var bgContainer = document.querySelector('.背景色') || document.querySelector('.bg');
      var bimg2 = document.getElementById('底圖');
      var bgSrc   = e.data.src   || null;
      var bgFit   = e.data.fit   || 'cover';
      var bgScale = e.data.scale !== undefined ? e.data.scale : 100;
      var bgX     = e.data.x     !== undefined ? e.data.x     : 50;
      var bgY     = e.data.y     !== undefined ? e.data.y     : 50;

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
          h = Math.max(1, Math.min(h, zhApply));
          l = Math.max(0, Math.min(zwApply - w, l));
          t = Math.max(0, Math.min(zhApply - h, t));
          boxApply.dataset.manualLayout = '1';
          boxApply.style.left = l + 'px';
          boxApply.style.top = t + 'px';
          boxApply.style.width = w + 'px';
          boxApply.style.height = h + 'px';
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

      /* 隱藏所有編輯用控制元素（縮放點等），截完再還原 */
      var _editEls = [];
      if(_cv){
        _cv.querySelectorAll('[data-corner]').forEach(function(h){
          _editEls.push({el:h, disp:h.style.display});
          h.style.display = 'none';
        });
      }

      /* Search_Image1 下載補償：
         只保留副標下載補償。左側紅底共用區（官方旗艦店/橫線/商城logo）
         改為完全所見即所得，不再於下載時針對 1/2/3 做不同位移。
      */
      var SEARCH_IMAGE1_SUBTITLE_OFFSET = 14;
      var _captureAdjustEls = [];
      var _fnameLower = (fname || '').toLowerCase();
      var _isSearchImage1 = _fnameLower.indexOf('search_image1') !== -1;

      if(_isSearchImage1 && _cv){
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
      var CTA_TEXT_OFFSET_RATIO = 0.03;
      if(_cv){
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
      var ICON_TEXT_OFFSET_RATIO = 0.22;
      var _transformAdjustEls = [];
      if(_cv){
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
            _emptyZoneEls.push({el:zn, bg:zn.style.background, op:zn.style.opacity});
            zn.style.background = 'transparent';
            zn.style.opacity = '1';
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

      captureCanvas(function(dataUrl){
        _editEls.forEach(function(o){ o.el.style.display = o.disp; });
        _captureAdjustEls.forEach(function(o){ o.el.style.setProperty('top', o.top, o.priority || ''); });
        _emptyZoneEls.forEach(function(o){ o.el.style.background = o.bg; o.el.style.opacity = o.op; });
        _objectFitAdjustEls.forEach(function(o){
          o.el.style.position = o.position; o.el.style.width = o.width; o.el.style.height = o.height;
          o.el.style.left = o.left; o.el.style.top = o.top;
          o.el.style.maxWidth = o.maxWidth; o.el.style.maxHeight = o.maxHeight;
        });
        _transformAdjustEls.forEach(function(o){ o.el.style.setProperty('transform', o.transform, o.priority || ''); });
        window.parent.postMessage({type:'bn-snapshot',msgId:e.data.msgId,dataUrl:dataUrl},'*');
      });
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
    });
    setTimeout(postAllProductLayouts, 0);
  }

  function getProductZone(){
    var names=['商品範圍','商品圖範圍'];
    for(var i=0;i<names.length;i++){ var z=document.querySelector('.'+names[i]); if(z)return z; }
    return null;
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
    box.addEventListener('pointerdown',function(e){
      if(e.target.dataset.corner) return;
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
      postProductLayout(box);
    },{passive:false});
  }

  /* ════════════════════════════════════════════════════
     人物圖（.bn-char-box）輔助函式，跟商品的 .bn-prod-box 共用同一個 zone，
     但不參與 layoutProducts() 的三角排版計算，也不受它的邊界 clamp 限制。
     ════════════════════════════════════════════════════ */
  var CHAR_Z_BASE = 400; /* 人物 z-index 基準，跟商品(11~一百多內)清楚分層，不會互相打架 */

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
    if(!_bnSingleProductOnlyTemplate || !zone) return;
    zone.querySelectorAll('.bn-char-box').forEach(function(b){ b.style.display = 'none'; });
    var boxes = Array.prototype.slice.call(zone.querySelectorAll('.bn-prod-box'));
    if(!boxes.length) return;
    var main = boxes.filter(function(b){ return (b.dataset.position || '0') === '0'; })[0] || null;
    boxes.forEach(function(b){ b.style.display = (b === main) ? '' : 'none'; });
  }

  /* ── 畫布文字直接點擊編輯 ── */
  var EDITABLE_CLASSES = ['主標','副標','副標案型七字內','日期','品牌名','ICON獨立文案'];
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
        dollarExempt: exemptList.length > 0 ? exemptList : false
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
      'border-radius:10px;padding:6px 0;',
      'box-shadow:0 8px 24px rgba(0,0,0,.5);',
      'min-width:200px;font-size:13px;',
    ].join('');

    function menuBtn(label, handler){
      var btn = document.createElement('div');
      btn.textContent = label;
      btn.style.cssText = 'padding:8px 16px;cursor:pointer;color:#dde3f0;white-space:nowrap;';
      btn.addEventListener('mouseenter', function(){ btn.style.background='#2b2f42'; });
      btn.addEventListener('mouseleave', function(){ btn.style.background=''; });
      btn.addEventListener('mousedown', function(ev){
        ev.preventDefault();
        menu.remove();
        if(typeof onMenuClose === 'function') onMenuClose();
        handler();
        setTimeout(function(){ el.focus(); }, 0);
      });
      menu.appendChild(btn);
    }

    if(isNumSel){
      if(alreadyExempt || !hasDollar){
        /* 恢復：補回 $ 千分位，從豁免清單移除 */
        menuBtn('恢復 $'+_addThousands(cleanSel)+' 的千分位格式', function(){
          var list = _getExempt(el).filter(function(n){ return n !== cleanSel; });
          _setExempt(el, list);
          if(savedRange) _replaceSelText(savedRange, _fmtDollar(cleanSel));
          _sendUpdate(el, cls);
        });
      } else {
        /* 移除：拿掉 $ 和千分位，加入豁免清單 */
        menuBtn('暫時不加$和千分位符號', function(){
          var list = _getExempt(el);
          if(list.indexOf(cleanSel) === -1) list.push(cleanSel);
          _setExempt(el, list);
          if(savedRange) _replaceSelText(savedRange, cleanSel);
          _sendUpdate(el, cls);
        });
      }
    } else {
      /* 非純數字的選取：整段文字豁免選項 */
      menuBtn('暫時不加$和千分位符號（整段）', function(){
        /* 把選取範圍的所有數字加進豁免清單，並移除 $ */
        var nums = savedSelText.match(/\d+/g) || [];
        var list = _getExempt(el);
        nums.forEach(function(n){ if(list.indexOf(n)===-1) list.push(n); });
        _setExempt(el, list);
        var cleaned = savedSelText.replace(/\$/g,'').replace(/(\d),(\d{3})(?!\d)/g,'$1$2');
        if(savedRange) _replaceSelText(savedRange, cleaned);
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

  function captureCanvas(cb){
    function runAfterFonts(){
      if(window.html2canvas){doCapture(cb);return;}
      var s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload=function(){doCapture(cb);}; s.onerror=function(){if(cb)cb(null);};
      document.head.appendChild(s);
    }
    if(document.fonts && document.fonts.ready){
      document.fonts.ready.then(runAfterFonts).catch(runAfterFonts);
    } else {
      runAfterFonts();
    }
  }
  function doCapture(cb){
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
          backgroundColor: null,
          width: W,
          height: H,
          logging: false
        })
        .then(function(c){
          if(overlay) overlay.style.display = '';
          var out = document.createElement('canvas');
          out.width = W; out.height = H;
          out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
          if(cb) cb(out.toDataURL('image/png'));
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
