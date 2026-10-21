
  function resolveBgImgUrl(src){
    src = String(src || '').trim();
    if(!src) return '';
    if(/^data:/i.test(src) || /^https?:\/\//i.test(src)) return src;
    src = src.replace(/^\.?\/*/, '');
    src = src.replace(/^bgimgn\//i, '');
    src = src.replace(/^bgimg\//i, '');
    return IMG_BASE_URL.replace(/\/?$/, '/') + src;
  }

/* BN Background Library Plugin
   支援 HBN 同款 bgimg/index.json 圖庫結構：
   bgimg/
   ├─ EL/Fashion/FMCG/Lifestyle
   │  ├─ HBN/
   │  └─ DDCARD/
   ├─ brand.json
   └─ index.json

   用法：在 bn.html 最後載入本檔。
   按「上傳背景圖」時會先開圖庫；只有按「📤 上傳自己的圖片」才會放行原本的上傳流程。
*/
(function(){
  'use strict';
  if(window.__BN_BG_LIBRARY_PLUGIN_READY__) return;
  window.__BN_BG_LIBRARY_PLUGIN_READY__ = true;

  var CFG = window.BN_BG_LIBRARY_CONFIG || {};
  var MANIFEST_URL = CFG.manifestUrl || 'bgimg/index.json';
  var BRAND_URL = CFG.brandUrl || 'bgimg/brand.json';
  var IMG_BASE_URL = CFG.imgBaseUrl || 'bgimg/';
  var CATEGORIES = CFG.categories || ['EL','Fashion','FMCG','Lifestyle'];
  var DEFAULT_IMAGES = CFG.images || [];

  var modal, grid, tabsEl, filtersEl, searchEl, statusEl, selectedEl, applyBtn;
  var allowNativeUploadOnce = false;
  var pendingNativeTarget = null;
  var imagesLoaded = false;
  var indexData = null;
  var brandData = null;
  /* 「全部」是虛擬分類：一打開圖庫預設就顯示所有分類的預覽圖，
     使用者再用上面的分類頁籤或下面的 風格／素材／顏色 篩選縮小範圍。 */
  var ALL_CAT = '全部';
  var currentCat = ALL_CAT;
  var searchQuery = '';
  var cards = [];
  var selected = null;
  var lastJbpMode = null;
  /* B／B+ 包套只提供「類別」與圖庫圖片；等級由 BODA 外掛透過
     wo_level_v1／bn-level-change 同步進來。保留文字判斷作為新等級的備援。 */
  var B_LEVEL_IDS = {
    bod_a:true,
    bod_a_zj:true,
    bod_b_mega:true,
    basic:true,
    jbp_multi:true,
    gold_mega:true
  };
  function currentBodaLevelId(){
    var id = '';
    try{
      if(typeof window._bnGetCurrentLevelId === 'function') id = window._bnGetCurrentLevelId() || '';
    }catch(_){ }
    if(!id){
      try{ id = localStorage.getItem('wo_level_v1') || ''; }catch(_){ }
    }
    return String(id || '').trim();
  }
  function isBLevel(id){
    id = String(id || '').trim();
    if(B_LEVEL_IDS[id]) return true;
    var select = document.getElementById('lv-select');
    var option = select && select.options && select.options[select.selectedIndex];
    return !!(option && /^B(?:\+|\s)/i.test(String(option.textContent || '').trim()));
  }
  function applyBLevelLibraryMode(levelId){
    /*
       B／B+ 的限制只適用於真正由 BODA 入口嵌入的頁面。
       若單獨開啟 index.html，不能因為一般瀏覽器殘留的 wo_level_v1
       （例如 basic、jbp_multi）就把完整圖庫的風格／素材／顏色／搜尋藏掉；
       這也是一般模式看起來只有「類別」、無痕模式卻完整的原因。
    */
    var isBodaHosted = window.IS_BODA === true ||
      (document.documentElement && document.documentElement.getAttribute('data-host') === 'boda');
    /* #a 是唯一完整圖庫入口，不受 B／B+ 的類別-only 規則限制。 */
    var bMode = !isFullLibraryMode() && isBodaHosted && isBLevel(levelId || currentBodaLevelId());
    if(modal) modal.classList.toggle('bn-bglib-b-level', bMode);
    return bMode;
  }
  window._bnBgLibraryApplyLevelMode = applyBLevelLibraryMode;
  /* 只有精確的 #a 才是完整圖庫；無 hash、#jbp／#jpb 與其他 hash 都是類別-only。 */
  function isFullLibraryMode(){
    var s = String(location.hash || '').replace(/^#/,'').trim().toLowerCase();
    return s === 'a';
  }
  function activeFilterDefs(){
    return isFullLibraryMode()
      ? FILTER_DEFS
      : FILTER_DEFS.filter(function(def){ return def.key === 'cat'; });
  }
  function syncJbpModeUI(){
    var categoryOnly = !isFullLibraryMode();
    if(lastJbpMode !== categoryOnly){
      if(categoryOnly){
        filters.style = ALL_CAT;
        filters.material = ALL_CAT;
        filters.color = ALL_CAT;
        searchQuery = '';
        if(searchEl) searchEl.value = '';
      }
      lastJbpMode = categoryOnly;
    }
    if(modal){
      /* 沿用既有 class 名稱，實際意義改為「類別-only 模式」。 */
      modal.classList.toggle('bn-bglib-jbp', categoryOnly);
      if(searchEl){
        searchEl.style.display = categoryOnly ? 'none' : '';
        searchEl.setAttribute('aria-hidden', categoryOnly ? 'true' : 'false');
      }
    }
  }
  /* 風格／素材／顏色 三組篩選（來源：A+與A活動公版管理表.xlsx 的「#分類規則」頁籤，
     由 index.json 的 _rules 帶進來）。每組都是單選，預設「全部」；三組之間是 AND。 */
  var FILTER_DEFS = [
    { key:'style',    label:'風格', field:'style' },
    { key:'material', label:'素材', field:'materials' },
    { key:'color',    label:'顏色', field:'color' },
    { key:'cat',      label:'類別', field:'cat' }
  ];
  var rulesData = null;
  var filters = { style: ALL_CAT, material: ALL_CAT, color: ALL_CAT, cat: ALL_CAT };

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  function isImageFile(s){ return /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(String(s||'')); }
  function cleanFileName(s){ return String(s||'').split('/').pop().replace(/\.[^.]+$/,''); }
  function encodeSrc(src){
    if(/^data:|^https?:/i.test(src)) return src;
    return String(src||'').split('/').map(function(seg){
      try { return encodeURIComponent(decodeURIComponent(seg)); }
      catch(_) { return encodeURIComponent(seg); }
    }).join('/');
  }


  function sampleTopLeftColor(src){
    return new Promise(function(resolve){
      if(!src) return resolve(null);
      var img = new Image();
      if(!/^data:/i.test(src)) img.crossOrigin = 'anonymous';
      img.onload = function(){
        try{
          var c = document.createElement('canvas');
          c.width = 1;
          c.height = 1;
          var ctx = c.getContext('2d', { willReadFrequently:true });
          ctx.drawImage(img, 0, 0, 1, 1);
          var d = ctx.getImageData(0, 0, 1, 1).data;
          resolve(rgbToHex(d[0], d[1], d[2]));
        }catch(_){ resolve(null); }
      };
      img.onerror = function(){ resolve(null); };
      img.src = resolveBgImgUrl(src);
    });
  }

  function rgbToHex(r,g,b){
    function h(n){ n = Math.max(0, Math.min(255, n|0)); return n.toString(16).padStart(2,'0'); }
    return '#' + h(r) + h(g) + h(b);
  }

  function applySampledCanvasBg(src){
    return sampleTopLeftColor(src).then(function(hex){
      if(!hex) return null;
      if(typeof window._bnSetAuthoritativeCanvasBg === 'function'){
        try{ window._bnSetAuthoritativeCanvasBg(hex); }catch(_){ }
      }
      if(window.colorState) window.colorState.canvasBg = hex;
      var dot = document.getElementById('dot-canvasBg');
      if(dot) dot.style.background = hex;
      var hexInp = document.getElementById('cp-hex-input');
      if(window.cpActiveKey === 'canvasBg' && hexInp) hexInp.value = hex;
      if(typeof window.broadcastColors === 'function'){
        try{ window.broadcastColors(); }catch(_){ }
      }
      try{ document.dispatchEvent(new CustomEvent('bn-state-dirty')); }catch(_){ }
      if(typeof window.applyAutoTextPalette === 'function'){
        var sampled = typeof window.sampleBackgroundColors === 'function'
          ? window.sampleBackgroundColors(src) : Promise.resolve(null);
        Promise.resolve(sampled).then(function(samples){
          window.applyAutoTextPalette(samples && samples.canvasBg ? samples.canvasBg : hex,
            samples && samples.visualBg ? samples.visualBg : hex);
        });
      }
      return hex;
    });
  }

  function pickSampleSourceFromStates(states){
    if(!states) return null;
    var keys = Object.keys(states);
    for(var i=0;i<keys.length;i++){
      var st = states[keys[i]];
      if(st && st.src) return st.src;
    }
    return null;
  }

  function installBgColorSamplingHooks(){
    if(window.__BN_BG_COLOR_SAMPLING_HOOKS__) return;
    window.__BN_BG_COLOR_SAMPLING_HOOKS__ = true;

    var nativeSetBgStates = window._bnSetBgStates;
    if(typeof nativeSetBgStates === 'function' && !nativeSetBgStates.__bnColorWrapped){
      var wrappedSetBgStates = function(states, activeId){
        var ret = nativeSetBgStates.apply(this, arguments);
        var src = pickSampleSourceFromStates(states);
        if(src) applySampledCanvasBg(src);
        return ret;
      };
      wrappedSetBgStates.__bnColorWrapped = true;
      window._bnSetBgStates = wrappedSetBgStates;
    }

    var nativeBroadcastBg = window.broadcastBg;
    if(typeof nativeBroadcastBg === 'function' && !nativeBroadcastBg.__bnColorWrapped){
      var wrappedBroadcastBg = function(src){
        var ret = nativeBroadcastBg.apply(this, arguments);
        if(src) applySampledCanvasBg(src);
        return ret;
      };
      wrappedBroadcastBg.__bnColorWrapped = true;
      window.broadcastBg = wrappedBroadcastBg;
    }

    document.addEventListener('change', function(e){
      var input = e.target;
      if(!input || !input.matches || !input.matches('input[type="file"]')) return;
      var meta = ((input.id||'') + ' ' + (input.name||'') + ' ' + (input.className||'') + ' ' + (input.accept||'')).toLowerCase();
      if(meta.indexOf('bg') === -1 && meta.indexOf('背景') === -1) return;
      var file = input.files && input.files[0];
      if(!file || !/^image\//i.test(file.type || '')) return;
      var fr = new FileReader();
      fr.onload = function(ev){ applySampledCanvasBg(ev.target.result); };
      try{ fr.readAsDataURL(file); }catch(_){ }
    }, true);
  }
  function extractNum(filename){
    var base = String(filename||'').replace(/\.[^.]+$/, '');
    base = base.replace(/\bHBN\d*\b/gi, '').replace(/\bDDCARD\d*\b/gi, '');
    var matches = base.match(/[_-](\d+)/g);
    if(matches){
      var nums = matches.map(function(m){ return parseInt(m.slice(1),10); }).filter(function(n){ return n < 1000; });
      if(nums.length){
        if(nums.length > 1 && nums[nums.length-1] === 1) return nums[nums.length-2];
        return nums[nums.length-1];
      }
    }
    var matches2 = base.match(/[a-zA-Z](\d+)/g);
    if(matches2){
      var nums2 = matches2.map(function(m){ return parseInt(m.slice(1),10); }).filter(function(n){ return n < 1000; });
      if(nums2.length) return nums2[nums2.length-1];
    }
    return null;
  }

  function ensureStyle(){
    if(document.getElementById('bn-bglib-style')) return;
    var style = document.createElement('style');
    style.id = 'bn-bglib-style';
    style.textContent = [
      /* 視窗置上對齊、高度固定：篩選列的位置不會因為下面的張數多寡而上下跳動 */
      '.bn-bglib-overlay{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:2147483000;display:none;align-items:flex-start;justify-content:center;padding:24px}',
      '.bn-bglib-overlay.open{display:flex}',
      '.bn-bglib-modal{width:min(1040px,96vw);height:calc(100vh - 48px);max-height:calc(100vh - 48px);background:#111827;border:1px solid #30363d;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.65);display:flex;flex-direction:column;overflow:hidden;color:#e6edf3;font-family:"Segoe UI","PingFang TC",Arial,sans-serif}',
      '.bn-bglib-head{display:flex;align-items:center;gap:12px;padding:14px 18px;background:#161b22;border-bottom:1px solid #30363d}',
      '.bn-bglib-head h3{font-size:15px;margin:0;white-space:nowrap}',
      '.bn-bglib-search{flex:1;min-width:160px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;padding:7px 10px;outline:none}',
      '.bn-bglib-modal.bn-bglib-jbp .bn-bglib-search{display:none}',
      '.bn-bglib-close{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:6px 10px;cursor:pointer}',
      '.bn-bglib-tabs{display:flex;gap:8px;padding:12px 16px 0;background:#111827;flex-wrap:wrap}',
      '.bn-bglib-tab{background:#1c2333;color:#8b949e;border:1px solid #30363d;border-radius:999px;padding:6px 13px;font-size:12px;font-weight:700;cursor:pointer}',
      '.bn-bglib-tab.active{background:#1f6feb;color:#fff;border-color:#388bfd}',
      '.bn-bglib-filters{display:flex;flex-direction:column;gap:6px;padding:12px 16px 0;background:#111827;flex-shrink:0}',
      '.bn-bglib-frow{display:flex;align-items:flex-start;gap:6px;flex-wrap:wrap}',
      '.bn-bglib-flabel{flex:0 0 auto;color:#8b949e;font-size:12px;font-weight:700;line-height:24px;min-width:36px}',
      '.bn-bglib-chip{background:#0d1117;color:#c9d3df;border:1px solid #30363d;border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer;line-height:16px}',
      '.bn-bglib-chip:hover{border-color:#58a6ff}',
      '.bn-bglib-chip.active{background:#238636;color:#fff;border-color:#2ea043}',
      '.bn-bglib-chip.dim{opacity:.4;cursor:not-allowed}',
      '.bn-bglib-chip.dim:hover{border-color:#30363d}',
      '.bn-bglib-chip.dim:disabled{pointer-events:none}',
      '.bn-bglib-chip small{opacity:.7;margin-left:3px;font-size:10px}',
      '.bn-bglib-tags{padding:0 9px 7px;font-size:10px;color:#8b949e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.bn-bglib-body{padding:14px 16px 16px;overflow:auto;flex:1;min-height:0}',
      '.bn-bglib-status{color:#8b949e;font-size:12px;margin-bottom:12px}',
      '.bn-bglib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}',
      '.bn-bglib-card{background:#1c2333;border:1px solid #30363d;border-radius:10px;overflow:hidden;cursor:pointer;text-align:left;color:#e6edf3;transition:transform .12s,border-color .12s;position:relative}',
      '.bn-bglib-card:hover{transform:translateY(-2px);border-color:#388bfd}',
      '.bn-bglib-card.selected{border-color:#58a6ff;box-shadow:0 0 0 2px rgba(88,166,255,.24)}',
      '.bn-bglib-thumb{height:108px;background:#0d1117;display:flex;align-items:center;justify-content:center;overflow:hidden}',
      '.bn-bglib-thumb img{width:100%;height:100%;object-fit:cover;display:block}',
      '.bn-bglib-name{padding:8px 9px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.bn-bglib-check{position:absolute;right:8px;top:8px;width:22px;height:22px;border-radius:50%;background:#1f6feb;color:#fff;display:none;align-items:center;justify-content:center;font-weight:900}',
      '.bn-bglib-card.selected .bn-bglib-check{display:flex}',
      '.bn-bglib-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px 16px;background:#161b22;border-top:1px solid #30363d}',
      '.bn-bglib-upload{background:#238636;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer}',
      '.bn-bglib-slab{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer}',
      '.bn-bglib-slab:hover{background:#1d4ed8}',
      '.bn-bglib-apply{background:#1f6feb;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer}',
      '.bn-bglib-apply:disabled{opacity:.45;cursor:not-allowed}',
      '.bn-bglib-hint{font-size:12px;color:#8b949e;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.bn-bglib-empty{border:1px dashed #30363d;border-radius:10px;padding:24px;text-align:center;color:#8b949e;line-height:1.7;grid-column:1/-1}',
      '.bn-bglib-actions{display:flex;gap:8px;align-items:center;flex-shrink:0}',
      /* B／B+：保留類別列、圖片與套用；隱藏搜尋、自訂上傳與延伸篩選。 */
      '.bn-bglib-overlay.bn-bglib-b-level .bn-bglib-search{display:none!important}',
      '.bn-bglib-overlay.bn-bglib-b-level .bn-bglib-upload{display:none!important}',
      '.bn-bglib-overlay.bn-bglib-b-level .bn-bglib-filter-style,'+
        '.bn-bglib-overlay.bn-bglib-b-level .bn-bglib-filter-material,'+
        '.bn-bglib-overlay.bn-bglib-b-level .bn-bglib-filter-color,'+
        '.bn-bglib-overlay.bn-bglib-b-level .bn-bglib-filter-search,'+
        '.bn-bglib-overlay.bn-bglib-b-level [data-bg-filter="style"],'+
        '.bn-bglib-overlay.bn-bglib-b-level [data-bg-filter="material"],'+
        '.bn-bglib-overlay.bn-bglib-b-level [data-bg-filter="color"],'+
        '.bn-bglib-overlay.bn-bglib-b-level [data-bg-filter="search"]{display:none!important}',
      /* ── SLAB 商品對位視窗 ── */
      '.bn-fit-overlay{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:2147483001;display:none;align-items:center;justify-content:center;padding:20px}',
      '.bn-fit-overlay.open{display:flex}',
      '.bn-fit-modal{width:min(780px,96vw);max-height:94vh;overflow:auto;background:#111827;border:1px solid #30363d;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.65);color:#e6edf3;font-family:"Segoe UI","PingFang TC",Arial,sans-serif}',
      '.bn-fit-head{display:flex;align-items:center;gap:10px;padding:13px 18px;background:#161b22;border-bottom:1px solid #30363d}',
      '.bn-fit-head h3{font-size:15px;margin:0;flex:1}',
      '.bn-fit-body{padding:15px 18px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}',
      /* 舞台 = 輸出的 1200×1200 畫面，所有座標都用百分比，跟實際顯示尺寸無關 */
      '.bn-fit-stage{position:relative;width:min(44vh,360px);height:min(44vh,360px);flex:0 0 auto;border-radius:10px;overflow:hidden;cursor:grab;touch-action:none;user-select:none;background:repeating-conic-gradient(#20262e 0 25%,#161b22 0 50%) 50%/16px 16px}',
      '.bn-fit-stage.dragging{cursor:grabbing}',
      '.bn-fit-plate{position:absolute;inset:0}',
      '.bn-fit-imgwrap{position:absolute}',
      '.bn-fit-imgwrap img{width:100%;height:100%;display:block;-webkit-user-drag:none}',
      '.bn-fit-prod{display:none}',
      '.bn-fit-guide{position:absolute;inset:0;pointer-events:none}',
      '.bn-fit-guide img{width:100%;height:100%;display:block}',
      /* 建議範圍框.PNG 載不到時的備援：直接畫出 DRED 紅框 */
      '.bn-fit-dred{position:absolute;border:2px solid rgba(255,0,0,.8);border-radius:2px;pointer-events:none}',
      '.bn-fit-tip{position:absolute;left:50%;bottom:9px;transform:translateX(-50%);display:flex;align-items:center;gap:7px;white-space:nowrap;background:rgba(13,17,23,.88);border:1px solid #30363d;border-radius:999px;padding:5px 12px 5px 8px;font-size:11px;color:#e6edf3;pointer-events:none;transition:opacity .4s}',
      '.bn-fit-stage.touched .bn-fit-tip{opacity:0}',
      /* 純 CSS 滑鼠滾輪提示動畫（不需要 gif 檔） */
      '.bn-fit-mouse{position:relative;width:15px;height:23px;border:1.5px solid currentColor;border-radius:8px;flex:0 0 auto;opacity:.85}',
      '.bn-fit-mouse::before{content:"";position:absolute;left:50%;top:4px;width:2px;height:6px;margin-left:-1px;border-radius:2px;background:#58a6ff;animation:bnFitWheel 1.8s ease-in-out infinite}',
      '@keyframes bnFitWheel{0%,100%{transform:translateY(0);opacity:1}22%{transform:translateY(-3px);opacity:.3}50%{transform:translateY(0);opacity:1}72%{transform:translateY(7px);opacity:.3}}',
      '.bn-fit-arrows{display:flex;flex-direction:column;gap:1px;font-size:9px;line-height:1;flex:0 0 auto}',
      '.bn-fit-arrows i{font-style:normal;animation:bnFitArrow 1.8s ease-in-out infinite}',
      '.bn-fit-arrows i+i{animation-delay:.9s}',
      '@keyframes bnFitArrow{0%,100%{opacity:.25}18%{opacity:1;color:#58a6ff}55%{opacity:.25}}',
      '.bn-fit-side{flex:1;min-width:230px;font-size:12px;line-height:1.75;color:#c9d3df}',
      '.bn-fit-call{background:#0d1117;border:1px solid #30363d;border-radius:10px;padding:10px 13px;color:#ff8f88;font-size:13px;font-weight:500}',
      '.bn-fit-call b{font-size:15px}',
      '.bn-fit-row{display:flex;align-items:center;gap:9px;margin:13px 0 4px}',
      '.bn-fit-row input[type=range]{flex:1;min-width:0;accent-color:#1f6feb}',
      '.bn-fit-val{min-width:54px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}',
      '.bn-fit-note{font-size:11px;color:#8b949e;line-height:1.75;margin-top:9px}',
      '.bn-fit-note .ok{color:#3fb950;font-weight:700}',
      '.bn-fit-note .warn{color:#f0883e;font-weight:700}',
      '.bn-fit-note .cy{color:#22d3ee;font-weight:700}',
      '.bn-fit-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 18px;background:#161b22;border-top:1px solid #30363d}',
      '.bn-fit-btn{border:0;border-radius:8px;padding:8px 15px;font-weight:700;cursor:pointer;font-size:13px}',
      '.bn-fit-btn.primary{background:#1f6feb;color:#fff}',
      '.bn-fit-btn.primary:disabled{opacity:.45;cursor:not-allowed}',
      '.bn-fit-btn.ghost{background:#21262d;color:#e6edf3;border:1px solid #30363d}',
      '.bn-fit-btn.ghost:hover{border-color:#58a6ff}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function ensureModal(){
    ensureStyle();
    if(modal) return modal;
    modal = document.createElement('div');
    modal.id = 'bnBgLibModal';
    modal.className = 'bn-bglib-overlay';
    modal.innerHTML = ''+
      '<div class="bn-bglib-modal" role="dialog" aria-modal="true" aria-labelledby="bn-bglib-title">'+
        '<div class="bn-bglib-head">'+
          '<h3 id="bn-bglib-title">🖼 背景圖庫</h3>'+
          '<input class="bn-bglib-search" type="search" placeholder="搜尋檔名 / 編號 / 風格 / 素材 / 顏色">'+
          '<button type="button" class="bn-bglib-close">關閉</button>'+
        '</div>'+
        '<div class="bn-bglib-tabs" role="tablist"></div>'+
        '<div class="bn-bglib-filters"></div>'+
        '<div class="bn-bglib-body"><div class="bn-bglib-status"></div><div class="bn-bglib-grid"></div></div>'+
        '<div class="bn-bglib-foot">'+
          '<div class="bn-bglib-hint">選預設圖會依版位寬高比自動套用；要用自己的圖，請按右側按鈕。</div>'+
          '<div class="bn-bglib-actions"><button type="button" class="bn-bglib-upload">📤 上傳自己的圖片</button><button type="button" class="bn-bglib-slab">📐 上傳SLAB底圖</button><button type="button" class="bn-bglib-apply" disabled>套用選取</button></div>'+
        '</div>'+
      '</div>';
    document.body.appendChild(modal);
    grid = modal.querySelector('.bn-bglib-grid');
    tabsEl = modal.querySelector('.bn-bglib-tabs');
    filtersEl = modal.querySelector('.bn-bglib-filters');
    searchEl = modal.querySelector('.bn-bglib-search');
    statusEl = modal.querySelector('.bn-bglib-status');
    selectedEl = modal.querySelector('.bn-bglib-hint');
    applyBtn = modal.querySelector('.bn-bglib-apply');
    syncJbpModeUI();

    modal.querySelector('.bn-bglib-close').addEventListener('click', closeModal);
    modal.addEventListener('click', function(e){ if(e.target === modal) closeModal(); });
    modal.querySelector('.bn-bglib-upload').addEventListener('click', function(){ closeModal(); openNativeUpload(); });
    modal.querySelector('.bn-bglib-slab').addEventListener('click', function(){ openSlabUpload(); });
    applyBtn.addEventListener('click', function(){ if(selected) applyPreset(selected); });
    searchEl.addEventListener('input', function(){ searchQuery = searchEl.value || ''; renderGrid(); });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeModal(); });
    renderTabs();
    return modal;
  }

  /* 舊版的分類頁籤列已拿掉，分類改成最下面一列「類別」篩選（跟風格／素材／顏色同一種 chip）。
     保留這個函式名稱是為了相容其他呼叫點，現在只負責把頁籤列清空。 */
  function renderTabs(){
    if(tabsEl){ tabsEl.innerHTML = ''; tabsEl.style.display = 'none'; }
  }

  /* 風格／素材／顏色／類別 四列篩選。每個 chip 後面的數字是「其他三組篩選」條件下
     會剩幾張，0 張的 chip 變淡但仍可點（點了會看到空清單提示）。
     「類別」列只列 EL / Fashion / FMCG / Lifestyle，A 不列出來（A 的圖透過「全部」
     以及上面三組風格／素材／顏色來找）。 */
  var CATEGORY_CHIP_HIDE = ['A'];
  function getRules(){
    var base;
    if(rulesData){
      base = { style: rulesData.style, material: rulesData.material, color: rulesData.color };
    } else {
      /* index.json 沒有 _rules 時，從圖片本身的標籤反推出清單當備援 */
      base = { style:[], material:[], color:[] };
      listFromCategory(ALL_CAT).forEach(function(img){
        if(img.style && base.style.indexOf(img.style) === -1) base.style.push(img.style);
        (img.materials || []).forEach(function(m){ if(base.material.indexOf(m) === -1) base.material.push(m); });
        if(img.color && base.color.indexOf(img.color) === -1) base.color.push(img.color);
      });
    }
    base.cat = CATEGORIES.filter(function(c){ return CATEGORY_CHIP_HIDE.indexOf(c) === -1; });
    return base;
  }
  function matchFilter(img, def, value){
    if(value === ALL_CAT) return true;
    var v = img[def.field];
    if(Array.isArray(v)) return v.indexOf(value) !== -1;
    return v === value;
  }
  function matchAllFilters(img, except){
    var defs = activeFilterDefs();
    for(var i = 0; i < defs.length; i++){
      var def = defs[i];
      if(def.key === except) continue;
      if(!matchFilter(img, def, filters[def.key])) return false;
    }
    return true;
  }
  function hasAnyTag(img){ return !!(img.style || (img.materials && img.materials.length) || img.color); }
  function renderFilters(){
    if(!filtersEl) return;
    syncJbpModeUI();
    var rules = getRules();
    var defs = activeFilterDefs();
    /* 只有 #a 顯示四列；其他模式只顯示類別列。 */
    filtersEl.innerHTML = defs.map(function(def){
      var opts = [ALL_CAT].concat(rules[def.key] || []);
      return '<div class="bn-bglib-frow bn-bglib-filter-'+esc(def.key)+'" data-bg-filter="'+esc(def.key)+'"><span class="bn-bglib-flabel">'+esc(def.label)+'</span>'+
        opts.map(function(opt){
          var count = opt === ALL_CAT ? null : cards.filter(function(img){
            return matchFilter(img, def, opt) && matchAllFilters(img, def.key);
          }).length;
          var cls = 'bn-bglib-chip' + (filters[def.key] === opt ? ' active' : '') + (count === 0 ? ' dim' : '');
          var disabledAttr = count === 0 ? ' disabled aria-disabled="true"' : '';
          return '<button type="button" class="'+cls+'" data-key="'+esc(def.key)+'" data-val="'+esc(opt)+'"'+disabledAttr+'>'+esc(opt)+
            (count === null ? '' : '<small>'+count+'</small>')+'</button>';
        }).join('')+
      '</div>';
    }).join('');
    filtersEl.querySelectorAll('.bn-bglib-chip').forEach(function(chip){
      chip.addEventListener('click', function(){
          if(chip.disabled) return;
        filters[chip.dataset.key] = chip.dataset.val;
        selected = null;
        if(applyBtn) applyBtn.disabled = true;
        renderFilters();
        renderGrid();
      });
    });
  }

  function loadJson(url){
    return fetch(url + (url.indexOf('?') === -1 ? '?t=' : '&t=') + Date.now())
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });
  }

  function loadImages(){
    if(imagesLoaded) return Promise.resolve();
    imagesLoaded = true;
    if(DEFAULT_IMAGES.length){
      indexData = { _default: DEFAULT_IMAGES };
      CATEGORIES = ['預設背景'];
      currentCat = '預設背景';
      return Promise.resolve();
    }
    return Promise.all([
      loadJson(MANIFEST_URL).catch(function(){ return null; }),
      loadJson(BRAND_URL).catch(function(){ return null; })
    ]).then(function(res){
      indexData = res[0] || {};
      brandData = res[1] || null;
      rulesData = (indexData && indexData._rules && typeof indexData._rules === 'object') ? {
        style: indexData._rules.style || indexData._rules['風格'] || [],
        material: indexData._rules.material || indexData._rules['素材'] || [],
        color: indexData._rules.color || indexData._rules['顏色'] || []
      } : null;
      var keys = detectCategories(indexData);
      if(keys.length){
        CATEGORIES = keys;
        if(currentCat !== ALL_CAT && CATEGORIES.indexOf(currentCat) === -1) currentCat = ALL_CAT;
        if(CATEGORIES.length === 1) currentCat = CATEGORIES[0];
      }
    });
  }

  function detectCategories(data){
    if(!data) return [];
    if(Array.isArray(data)) return ['預設背景'];
    return CATEGORIES.filter(function(k){ return data[k]; }).concat(Object.keys(data).filter(function(k){
      return CATEGORIES.indexOf(k) === -1 && k.charAt(0) !== '_';
    }));
  }

  function listFromCategory(cat){
    var out = [];
    if(!indexData) return out;
    if(Array.isArray(indexData)){
      indexData.forEach(function(item){ addGenericItem(out, item, cat); });
      return out;
    }
    if(indexData._default){
      indexData._default.forEach(function(item){ addGenericItem(out, item, cat); });
      return out;
    }
    if(cat === ALL_CAT){
      CATEGORIES.forEach(function(c){ out = out.concat(listFromCategory(c)); });
      return out;
    }
    var catData = indexData[cat];
    if(!catData) return out;

    // A 活動公版格式：{ A: { items:[ {code,h,v,num,style,materials,color} ] } }
    //   h = 橫式檔（實際量到 1200×360，檔名結尾 _W）→ horizontalSrc，跟 HBN 同規則
    //   v = 直式檔（實際量到 531×792，檔名結尾 _H）→ verticalSrc，跟 DDCARD 同規則
    //   圖檔直接放在 bgimg/A/ 下（沒有 hbn/ddcard 子資料夾）
    if(Array.isArray(catData.items)){
      catData.items.forEach(function(it){
        if(!it) return;
        var h = it.h || it.horizontal || null;
        var v = it.v || it.vertical || null;
        if(!isImageFile(h) && !isImageFile(v)) return;
        out.push({
          name: it.code || cleanFileName(h || v),
          fileName: h || v,
          cat: cat,
          horizontalSrc: h ? IMG_BASE_URL + cat + '/' + h : null,
          verticalSrc: v ? IMG_BASE_URL + cat + '/' + v : null,
          num: (it.num != null) ? it.num : extractNum(h || v),
          style: it.style || '',
          materials: Array.isArray(it.materials) ? it.materials : (it.materials ? [it.materials] : []),
          color: it.color || ''
        });
      });
      return out;
    }

    // HBN 格式：{ EL: { hbn:[...], ddcard:[...] } }
    if(catData.hbn || catData.HBN){
      // 資料夾名稱的大小寫，直接跟著 index.json 裡實際出現的 key 走，
      // 這樣不管實際資料夾是 hbn/ddcard（小寫）還是 HBN/DDCARD（大寫），
      // 只要跟 json 的 key 一致，組出來的網址都會對。
      var hbnKey = ('hbn' in catData) ? 'hbn' : 'HBN';
      var ddKey = ('ddcard' in catData) ? 'ddcard' : (('ddCard' in catData) ? 'ddCard' : 'DDCARD');
      var hbnList = catData.hbn || catData.HBN || [];
      var ddList = catData.ddcard || catData.DDCARD || catData.ddCard || [];
      hbnList.forEach(function(file){
        if(!isImageFile(file)) return;
        var num = extractNum(file);
        /*
         * HBN 與 DDCARD 不能只靠數字配對：同一個分類裡會同時存在
         * EL-9 與 EL-Mockup-9。原本只比 extractNum()，所以會把
         * EL-Mockup-9-hbn 錯配成 EL-9-ddcard。
         * 優先用完整公版名稱配對，只有在沒有完整配對且數字候選唯一時
         * 才使用數字作為相容性備援，避免再次誤配。
         */
        var dd = findPairByName(ddList, file);
        out.push({
          name: cleanFileName(file),
          fileName: file,
          cat: cat,
          horizontalSrc: IMG_BASE_URL + cat + '/' + hbnKey + '/' + file,
          verticalSrc: dd ? IMG_BASE_URL + cat + '/' + ddKey + '/' + dd : null,
          num: num
        });
      });
      return out;
    }

    // 彈性格式：{ EL:[...] }
    if(Array.isArray(catData)){
      catData.forEach(function(item){ addGenericItem(out, item, cat); });
      return out;
    }

    // 彈性格式：{ EL:{ images:[...] } }
    if(Array.isArray(catData.images)){
      catData.images.forEach(function(item){ addGenericItem(out, item, cat); });
      return out;
    }
    return out;
  }

  function pairKey(filename, type){
    var base = String(filename || '').replace(/\.[^.]+$/, '');
    /* 支援 Lifestyle 的舊版命名：...-hbn-2 對應 ...-ddcard。 */
    return base.replace(new RegExp('-(?:' + type + ')(?:-\\d+)?$', 'i'), '').toLowerCase();
  }

  function findPairByName(list, hbnFile){
    if(!Array.isArray(list)) return null;
    var key = pairKey(hbnFile, 'hbn');
    var candidates = list.filter(function(file){
      return isImageFile(file) && pairKey(file, 'ddcard') === key;
    });
    if(candidates.length){
      /* 同一個公版若有多個副檔名，優先選與 HBN 相同的格式。 */
      var hbnExt = String(hbnFile).match(/\.[^.]+$/);
      hbnExt = hbnExt ? hbnExt[0].toLowerCase() : '';
      for(var i=0;i<candidates.length;i++){
        if(String(candidates[i]).match(/\.[^.]+$/)[0].toLowerCase() === hbnExt)
          return candidates[i];
      }
      return candidates[0];
    }

    /* 舊資料若沒有可辨識的完整名稱，僅在數字候選唯一時備援。 */
    var num = extractNum(hbnFile);
    if(num === null) return null;
    var byNum = list.filter(function(file){ return isImageFile(file) && extractNum(file) === num; });
    return byNum.length === 1 ? byNum[0] : null;
  }

  function addGenericItem(out, item, cat){
    if(!item) return;
    if(typeof item === 'string'){
      if(!isImageFile(item)) return;
      var src = item.indexOf('/') >= 0 ? item : IMG_BASE_URL + cat + '/' + item;
      out.push({ name: cleanFileName(item), fileName:item, cat:cat, horizontalSrc:src, verticalSrc:null, num:extractNum(item) });
      return;
    }
    var src = item.src || item.image || item.path || item.url;
    if(!src || !isImageFile(src)) return;
    out.push({
      name: item.name || cleanFileName(src),
      fileName: cleanFileName(src),
      cat: item.group || item.category || cat,
      horizontalSrc: src,
      verticalSrc: item.verticalSrc || item.portraitSrc || item.ddcardSrc || null,
      num: item.num || extractNum(src)
    });
  }

  function buildCards(){
    cards = listFromCategory(currentCat);
  }

  function renderGrid(){
    if(!grid) return;
    syncJbpModeUI();
    var q = String(searchQuery||'').trim().toLowerCase();
    var defs = activeFilterDefs();
    var filtering = defs.some(function(def){ return filters[def.key] !== ALL_CAT; });
    var list = cards.filter(function(img){
      /* 風格／素材／顏色：三組 AND。沒有標籤的舊分類圖（EL 等）只要有任一組
         不是「全部」就會被排除，因為它們沒有可比對的資料。 */
      if(!matchAllFilters(img)) return false;
      if(!q) return true;
      var hay = [img.name, img.fileName, img.num, img.style, img.color].concat(img.materials || [])
        .map(function(s){ return String(s == null ? '' : s).toLowerCase(); }).join(' ');
      return hay.indexOf(q) !== -1;
    });
    if(statusEl){
      var cond = defs.filter(function(def){ return filters[def.key] !== ALL_CAT; })
        .map(function(def){ return def.label + '：' + filters[def.key]; }).join('，');
      statusEl.textContent = (cond || '全部') + '，共 ' + list.length + ' 張' +
        (list.some(function(x){return x.verticalSrc;}) ? '（含直式對應圖）' : '');
    }
    if(!list.length){
      grid.innerHTML = (filtering || q)
        ? '<div class="bn-bglib-empty">這個條件下沒有符合的背景圖。<br>請更換篩選條件或切回「全部」。</div>'
        : '<div class="bn-bglib-empty">目前沒有載入背景圖。<br>請確認 <code>bgimg/index.json</code> 與圖片資料夾是否存在。</div>';
      if(applyBtn) applyBtn.disabled = true;
      return;
    }
    grid.innerHTML = list.map(function(img, idx){
      var src = encodeSrc(img.horizontalSrc || img.verticalSrc);
      var tags = [img.style, (img.materials || []).join('、'), img.color].filter(Boolean).join(' / ');
      return '<button type="button" class="bn-bglib-card'+(selected===img?' selected':'')+'" data-idx="'+idx+'">'+
        '<div class="bn-bglib-thumb"><img src="'+esc(src)+'" alt="" loading="lazy" decoding="async"></div>'+
        '<div class="bn-bglib-name" title="'+esc(img.fileName || img.name)+'">'+esc(img.name)+'</div>'+
        (tags ? '<div class="bn-bglib-tags" title="'+esc(tags)+'">'+esc(tags)+'</div>' : '')+
        '<div class="bn-bglib-check">✓</div>'+
      '</button>';
    }).join('');
    grid.querySelectorAll('.bn-bglib-card').forEach(function(card){
      var img = list[Number(card.dataset.idx)];
      card.addEventListener('click', function(){ selectCard(img); });
      card.addEventListener('dblclick', function(){ applyPreset(img); });
    });
  }

  function selectCard(img){
    selected = img;
    if(selectedEl){
      selectedEl.textContent = '已選：' + (img.name || '') + (img.verticalSrc
        ? (img.cat === 'A' ? '（橫式版位用 _W 圖、直式/方版用 _H 圖）' : '（橫式用 HBN、直式/方版用 DDCARD）')
        : '');
    }
    if(applyBtn) applyBtn.disabled = false;
    renderGrid();
  }

  function openModal(nativeTarget){
    pendingNativeTarget = nativeTarget || pendingNativeTarget || findNativeUploadTarget();
    ensureModal();
    applyBLevelLibraryMode();
    modal.classList.add('open');
    if(statusEl) statusEl.textContent = '載入背景圖庫中…';
    loadImages().then(function(){ renderTabs(); buildCards(); renderFilters(); renderGrid(); }).catch(function(){
      if(grid) grid.innerHTML = '<div class="bn-bglib-empty">無法載入 <code>bgimg/index.json</code>。</div>';
    });
  }
  function closeModal(){ if(modal) modal.classList.remove('open'); }

  /* 主工具與曝光資源的等級下拉透過 wo-level 同步；圖庫已開啟時立即切換。 */
  window.addEventListener('message', function(event){
    var message = event && event.data;
    if(message && message.type === 'wo-level' && message.level) applyBLevelLibraryMode(message.level);
  });
  window.addEventListener('bn-level-change', function(event){
    applyBLevelLibraryMode(event && event.detail && event.detail.levelId);
  });

  function findNativeUploadTarget(){
    return document.getElementById('bg-upload-input') ||
      document.getElementById('bn-bg-inp') ||
      document.querySelector('input[type="file"][id*="bg" i]') ||
      document.querySelector('input[type="file"][name*="bg" i]') ||
      document.querySelector('[data-bg-upload], .bg-upload-btn, #bg-upload-btn');
  }
  function findBgUploadModalOpener(){
    return document.getElementById('bn-bg-open-btn') ||
      document.querySelector('[data-bg-modal-open], .bn-bg-open-btn, .bn-bg-open') ||
      Array.prototype.slice.call(document.querySelectorAll('button,label,a,div,span')).find(function(el){
        var text = (el.textContent || el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
        return /更換.*背景|上傳背景|背景圖上傳/.test(text);
      });
  }
  function openNativeUpload(){
    /* 圖庫右下角「📤 上傳自己的圖片」要接回 BN 原本的
       「更換你的背景」雙欄浮動視窗，而不是直接打開單一 file input。 */
    allowNativeUploadOnce = true;
    setTimeout(function(){ allowNativeUploadOnce = false; }, 1800);

    if(typeof window._bnOpenBgModal === 'function'){
      setTimeout(function(){
        try{ window._bnOpenBgModal(); }catch(_){ }
      }, 0);
      return;
    }

    var opener = findBgUploadModalOpener();
    if(opener){
      try{ opener.click(); }catch(_){ }
      return;
    }

    /* 保留舊版 fallback：若專案沒有雙欄背景視窗，才退回原本 file input。 */
    var target = pendingNativeTarget || findNativeUploadTarget();
    if(target){
      try{ target.click(); }catch(_){ }
    }
  }

  function shouldInterceptClick(el){
    if(!el || allowNativeUploadOnce) return false;
    /* 背景圖庫用 capture click 攔截「上傳背景圖」入口；
       但雙欄背景視窗裡的橫式／直式 file input 必須放行。
       否則點直式 input 時，這裡會再次把背景圖庫打開，造成重複出現。 */
    if(el.closest && (el.closest('#bnBgLibModal') || el.closest('#bn-bg-modal') || el.closest('#bnSlabFitModal'))) return false;
    if(el.matches && el.matches('input[type="file"]')){
      var idn = ((el.id||'') + ' ' + (el.name||'') + ' ' + (el.className||'') + ' ' + (el.accept||'')).toLowerCase();
      return idn.indexOf('bg') !== -1 || idn.indexOf('背景') !== -1;
    }
    var btn = el.closest && el.closest('button,label,a,div,span');
    if(!btn) return false;
    var text = (btn.textContent || btn.getAttribute('title') || btn.getAttribute('aria-label') || '').trim();
    var meta = ((btn.id||'') + ' ' + (btn.className||'') + ' ' + text).toLowerCase();
    if(/上傳自己的圖片/.test(text)) return false;
    return (/上傳背景|背景圖上傳|upload.*bg|bg.*upload|背景圖/.test(meta) && /上傳|upload|選擇|choose/.test(meta));
  }

  document.addEventListener('click', function(e){
    var t = e.target;
    if(!shouldInterceptClick(t)) return;
    e.preventDefault();
    e.stopPropagation();
    openModal(t.matches && t.matches('input[type="file"]') ? t : findNativeUploadTarget());
  }, true);

  function imageToDataUrl(src){
    if(!src || /^data:/i.test(src)) return Promise.resolve(src);
    return fetch(encodeSrc(src)).then(function(r){
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.blob();
    }).then(function(blob){
      return new Promise(function(resolve, reject){
        var fr = new FileReader();
        fr.onload = function(){ resolve(fr.result); };
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
    }).catch(function(){ return src; });
  }

  function getLayoutInfoForIframe(iframe){
    var id = null;
    try{ id = new URLSearchParams((iframe.src||'').split('?')[1]||'').get('bnid'); }catch(_){ }
    var w = parseFloat(iframe.style.width) || iframe.width || 0;
    var h = parseFloat(iframe.style.height) || iframe.height || 0;
    if((!w || !h) && typeof window.loadLayouts === 'function' && id){
      try{
        var ls = window.loadLayouts() || [];
        var item = ls.find(function(x){ return String(x.id) === String(id); });
        if(item){ w = w || item.w || 0; h = h || item.h || 0; }
      }catch(_){ }
    }
    return {id:id, w:w, h:h};
  }


  function getDefaultBgFitForLibraryLayout(info){
    return (info && Number(info.w) > Number(info.h)) ? 'height100' : 'width100';
  }

  /* 橫式/直式的選擇、以及套用後的預設 fit/scale/x/y，一律優先用
     bn-editor-plugin.js 暴露出來的共用判斷函式——那邊才有 FB_POST_方LOGO /
     FB_POST_橫LOGO / SCBN_APP 這幾個版位「固定吃直式背景圖」的專屬例外，
     還有各自的預設縮放/位置。之前這裡自己複製了一份「純看寬高比」的
     判斷邏輯，沒有這些例外，才會出現「手動上傳修好了、選圖庫卻沒修好」
     這種兩條路徑不同步的狀況。找不到共用函式時（理論上不會發生，
     bn-editor-plugin.js 一定比這支檔案先載入），才退回原本單純看寬高比
     的備援邏輯。 */
  function chooseSrcForLayout(info, img, dataH, dataV){
    if(dataH && dataV){
      if(typeof window._bnGetBgLayoutOrientation === 'function'){
        var iframeEl = info && info.id ? document.querySelector('.preview-block iframe[src*="bnid=' + info.id + '"]') : null;
        var orientation = window._bnGetBgLayoutOrientation(info.id, iframeEl);
        return orientation === 'vertical' ? dataV : dataH;
      }
      // 備援：寬高比判斷（橫式吃 HBN，方/直式吃 DDCARD）。
      return (info.w > info.h) ? dataH : dataV;
    }
    return dataH || dataV || null;
  }

  function getBgParamsForLibraryLayout(info, iframeEl){
    if(typeof window._bnGetDefaultBgParamsForLayout === 'function'){
      return window._bnGetDefaultBgParamsForLayout(info && info.id, iframeEl);
    }
    return { fit: getDefaultBgFitForLibraryLayout(info), scale:100, x:50, y:50 };
  }

  function applyPreset(img){
    if(!img) return;
    closeModal();
    if(window._bnStatePlugin && typeof window._bnStatePlugin.toast === 'function')
      window._bnStatePlugin.toast('正在套用背景圖…', 'info', 6000);
    Promise.all([imageToDataUrl(img.horizontalSrc), img.verticalSrc ? imageToDataUrl(img.verticalSrc) : Promise.resolve(null)])
      .then(function(res){
        var dataH = res[0];
        var dataV = res[1];
        applySampledCanvasBg(dataH || dataV);
        var iframes = Array.prototype.slice.call(document.querySelectorAll('.preview-block iframe'));
        var states = {};
        iframes.forEach(function(iframe){
          var info = getLayoutInfoForIframe(iframe);
          if(typeof window._bnIsNoImageBackgroundLayout === 'function' &&
             window._bnIsNoImageBackgroundLayout(info.id, iframe)){
            try{ iframe.contentWindow.postMessage({type:'bn-bg', src:null}, '*'); }catch(_){ }
            return;
          }
          var src = chooseSrcForLayout(info, img, dataH, dataV);
          if(!src) return;
          var params = getBgParamsForLibraryLayout(info, iframe);
          if(info.id) states[info.id] = {src:resolveBgImgUrl(src), fit:params.fit, scale:params.scale, x:params.x, y:params.y, _initialized:true};
          try{ iframe.contentWindow.postMessage({ type:'bn-bg', src:resolveBgImgUrl(src), fit:params.fit, scale:params.scale, x:params.x, y:params.y }, '*'); }catch(_){ }
        });
        if(window._bnSetBgStates){
          try{ window._bnSetBgStates(states, null); }catch(_){ }
        }
        if(!iframes.length && typeof window.broadcastBg === 'function') window.broadcastBg(dataH || dataV || img.horizontalSrc);
        try{ document.dispatchEvent(new CustomEvent('bn-state-dirty')); }catch(_){ }
        if(window._bnStatePlugin && typeof window._bnStatePlugin.toast === 'function')
          window._bnStatePlugin.toast('背景圖已套用', 'ok', 2000);
      }).catch(function(err){
        console.error('[背景圖庫] 套用失敗', err);
        if(window._bnStatePlugin && typeof window._bnStatePlugin.toast === 'function')
          window._bnStatePlugin.toast('背景圖套用失敗，請重試', 'err', 3000);
      });
  }

  /* SLAB 底圖：上傳一張跟「建議範圍框.PNG」同尺寸(1200x1200)的圖，
     交給 bn-editor-plugin 的 _bgStates 狀態系統管理（標記 slab:true），
     而不是直接 postMessage 給 iframe。

     這點很重要：_bgStates 是「下載截圖前重新同步背景」「下載完成後
     還原畫布背景」「本機暫存/匯出 JSON」…等所有背景重播流程唯一認得的
     資料來源（見 bgSendToIframe / bgBroadcastAll / cloneBgStates）。
     如果只是直接 postMessage 一次性套用、不寫進 _bgStates，上面任何一個
     重播流程都會用「沒有背景」的舊狀態覆蓋回去，導致：
       1. 下載 ZIP 時 syncIframeForExport() 在截圖前呼叫 _bnSendBgToIframe()
          重新同步背景，會把 SLAB 圖蓋成空的，截圖結果沒有 SLAB 底圖。
       2. 下載完成後 resyncAllAfterExport() 再呼叫一次同一個同步，畫布上
          原本看得到的 SLAB 底圖也會被清空。
     交給 _bnSetBgStates 之後，上述流程都會透過 bgSendToIframe 正確送出
     bn-bg-slab（而非把它們誤當成一般背景 bn-bg 送出去），畫面跟下載
     結果才能維持「所見即所得」。 */
  /* 各版位套用 SLAB 底圖時的預設微調參數（對應「背景圖調整」面板的三個值）。
     scale=100 / x=50 / y=50 就是純 DRED 對齊的基準位置；這裡的數字是實際
     手動拉到最合適的位置後量出來的，讓上傳當下就直接是正確構圖，
     使用者仍可再用面板微調。x/y 的位移單位是畫布寬高的百分比。 */
  var SLAB_DEFAULT_PARAMS = [
    /* SCBN：扁版位，構圖是實際手拉量出來的專屬參數 */
    { test: /SCBN/i,    scale: 127, x: 47, y: 29 },
    /* FB_POST：102% */
    { test: /FB_POST/i, scale: 102, x: 50, y: 50 },
    /* ddcard：112%，垂直位置 54 */
    { test: /ddcard/i,  scale: 112, x: 50, y: 54 },
    /* LPBN_APP 系列：74% */
    { test: /LPBN_APP/i, scale: 74, x: 56, y: 50 },
    /* LPBN_PC 系列：107% */
    { test: /LPBN_PC/i, scale: 107, x: 52, y: 50 },
    /* AMS BN：124% */
    { test: /AMS\s*BN/i, scale: 124, x: 52, y: 50 }
  ];
  /* 其餘版位（含 HBN、IG、Coin_page、Search_Image）一律 120%。
     注意：這裡的 % 跟「SLAB 商品對位」視窗裡用滾輪把商品縮到紅框的 %
     是兩回事，互不相關——對位視窗負責把商品「對齊到紅框」，這組預設是
     圖套進畫布後，各版位相對於 DRED 基準位置的固定構圖放大值。 */
  var SLAB_FALLBACK_PARAMS = { scale: 120, x: 50, y: 50 };
  function slabDefaultsFor(iframe){
    var src = '';
    try{ src = decodeURIComponent(String((iframe && (iframe.getAttribute('src') || iframe.src)) || '')); }
    catch(_){ src = String((iframe && iframe.src) || ''); }
    for(var i = 0; i < SLAB_DEFAULT_PARAMS.length; i++){
      if(SLAB_DEFAULT_PARAMS[i].test.test(src)) return SLAB_DEFAULT_PARAMS[i];
    }
    return SLAB_FALLBACK_PARAMS;
  }

  /* ── SLAB 圖的像素分析 ─────────────────────────────────
     找出商品本體在圖上的範圍，用來在對位視窗裡「先自動把商品縮放到紅框」，
     使用者再用滾輪／拖曳微調。偵測只是起點，最終以人工確認的畫面為準，
     所以不需要再回頭去加減各版位的預設 %。 */

  function loadImage(src){
    return new Promise(function(resolve, reject){
      var img = new Image();
      img.onload = function(){ resolve(img); };
      img.onerror = function(){ reject(new Error('圖片載入失敗')); };
      img.src = src;
    });
  }

  /* 為了效率，分析前先縮到最長邊 600px；回傳的比例值不受縮放影響。 */
  function imageToPixels(img, maxSide){
    var max = maxSide || 600;
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var k = Math.min(1, max / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    return { data: ctx.getImageData(0, 0, cw, ch).data, w: cw, h: ch };
  }

  function rgbHsv(r, g, b){
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), df = mx - mn, h = 0;
    if(df){
      if(mx === r) h = ((g - b) / df) % 6;
      else if(mx === g) h = (b - r) / df + 2;
      else h = (r - g) / df + 4;
      h *= 60; if(h < 0) h += 360;
    }
    return { h:h, s: mx ? df / mx * 255 : 0, v: mx };
  }

  /* 判斷用的像素分類（都排除米色／褐色／橘色系＝背景、檯面、木質道具、暖光） */
  function isBeige(c){ return c.h >= 15 && c.h <= 60 && c.s < 200; }
  function isColorProduct(r, g, b){        /* 有顏色的商品：粉紅盒、藍綠軟管 */
    var c = rgbHsv(r, g, b);
    return !isBeige(c) && c.s >= 75 && c.v >= 105;
  }
  function isDarkOrColor(r, g, b){         /* 再加上深色（黑色充電器…但也會吃到陰影） */
    var c = rgbHsv(r, g, b);
    if(isBeige(c)) return false;
    if(c.v < 105) return true;
    return c.s >= 75;
  }

  /* 商品本體：
     ① 有透明區（去背 PNG）→ 直接取非透明範圍，最準
     ② 其他 → 以「有顏色的商品」為準。
        本來連深色像素一起算，但情境圖（乾燥花、窗簾、陰影、暗角）會有大量
        深色像素散佈全圖，實測某張情境圖被誤判成佔高度 96%（實際約 28%）。
        改用彩色錨點後 A/B 兩張的結果完全不變（24.8% / 47.2%），情境圖則修正
        為 27.7%——因為比的是「高度」，而最高的本來就是彩色的盒子／軟管，
        黑色充電器比較矮、不影響高度。
        真的幾乎沒有彩色像素時（例如整組都是黑白商品）才退回舊規則。 */
  function detectProduct(img){
    var px = imageToPixels(img);
    var d = px.data, i, hasAlpha = false;
    for(i = 3; i < d.length; i += 4){
      if(d[i] < 240){ hasAlpha = true; break; }
    }
    var out = { hasAlpha: hasAlpha, plate: hasAlpha ? null : plateColorOf(px) };
    if(hasAlpha){
      out.rect = bboxTrim(px, function(r, g, b, a){ return a > 24; });
      out.mode = '透明背景';
      return out;
    }
    var colorCount = 0, total = px.w * px.h;
    for(i = 0; i < d.length; i += 4){
      if(isColorProduct(d[i], d[i+1], d[i+2])) colorCount++;
    }
    if(colorCount > total * 0.002){
      out.rect = bboxTrim(px, isColorProduct);
      out.mode = '情境圖（取彩色商品）';
      return out;
    }
    out.rect = bboxTrim(px, isDarkOrColor);
    out.mode = '純色背景';
    return out;
  }

  /* 四角的平均底色：對位時把圖縮小，1200×1200 會露出四周的空白，
     用原圖四角的底色補起來，棚拍圖看起來才會是連續的背景。
     只要有一角是半透明就回 null（去背 PNG 要留透明，讓版位底色透出來）。 */
  function plateColorOf(px){
    var d = px.data, w = px.w, h = px.h;
    var pts = [[1,1],[w-2,1],[1,h-2],[w-2,h-2]], sum = [0,0,0], k;
    for(var n = 0; n < pts.length; n++){
      var i = ((pts[n][1] * w) + pts[n][0]) * 4;
      if(d[i+3] < 250) return null;
      for(k = 0; k < 3; k++) sum[k] += d[i+k];
    }
    return 'rgb(' + Math.round(sum[0]/4) + ',' + Math.round(sum[1]/4) + ',' + Math.round(sum[2]/4) + ')';
  }

  /* 用百分位裁掉零星雜點，避免單一雜訊像素把範圍拉大 */
  function bboxTrim(px, isInside, lo, hi){
    lo = lo === undefined ? 0.004 : lo;
    hi = hi === undefined ? 0.996 : hi;
    var xs = [], ys = [], d = px.data;
    for(var y = 0; y < px.h; y++){
      for(var x = 0; x < px.w; x++){
        var i = (y * px.w + x) * 4;
        if(!isInside(d[i], d[i+1], d[i+2], d[i+3])) continue;
        xs.push(x); ys.push(y);
      }
    }
    if(!xs.length) return null;
    xs.sort(function(a, b){ return a - b; });
    ys.sort(function(a, b){ return a - b; });
    var n = xs.length;
    function pick(arr, q){ return arr[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))]; }
    var x0 = pick(xs, lo), x1 = pick(xs, hi), y0 = pick(ys, lo), y1 = pick(ys, hi);
    return { x:x0, y:y0, w:x1-x0+1, h:y1-y0+1, imgW:px.w, imgH:px.h };
  }

  var _slabInput = null;
  /* 送進來的一定是「已經在對位視窗調整好的 1200×1200 圖」，
     所以各版位只要套用自己的預設參數就好，不再做任何 ± % 修正
     （比例已經在對位視窗裡對齊到紅框了）。 */
  function applySlabDataUrl(dataUrl){
    (function(){
      var iframes = Array.prototype.slice.call(document.querySelectorAll('.preview-block iframe'));
      var states = {};
      var applied = false;
      iframes.forEach(function(iframe){
        var info = getLayoutInfoForIframe(iframe);
        if(!info || !info.id) return;
        if(typeof window._bnIsNoImageBackgroundLayout === 'function' &&
           window._bnIsNoImageBackgroundLayout(info.id, iframe)) return;
        /* fit 用 'auto'：SLAB 走自己的對齊規則不看 fit，但「背景圖調整」面板
           在 cover 模式下會把縮放滑桿鎖住，用 auto 三個滑桿才都能調。 */
        var dp = slabDefaultsFor(iframe);
        states[info.id] = {src:dataUrl, slab:true, fit:'auto',
          scale:dp.scale, x:dp.x, y:dp.y, _initialized:true};
        applied = true;
      });
      if(typeof window._bnSetBgStates === 'function'){
        window._bnSetBgStates(states, null);
      } else {
        /* 備援：找不到狀態系統時，至少直接套用一次（不會有下載/還原保護）。 */
        iframes.forEach(function(iframe){
          var info = getLayoutInfoForIframe(iframe);
          var st = states[info && info.id];
          if(!st) return;
          try{ iframe.contentWindow.postMessage(
            {type:'bn-bg-slab', src:dataUrl, scale:st.scale, x:st.x, y:st.y}, '*');
          }catch(_){ }
        });
      }
      try{ document.dispatchEvent(new CustomEvent('bn-state-dirty')); }catch(_){ }
      if(window._bnStatePlugin && typeof window._bnStatePlugin.toast === 'function'){
        window._bnStatePlugin.toast(
          applied ? '已套用 SLAB 底圖（各版位維持預設縮放）' : '目前沒有可套用 SLAB 底圖的版位',
          applied ? 'ok' : 'err', 3000);
      }
    })();
  }
  /* ── SLAB 商品對位視窗 ───────────────────────────────────
     上傳 SLAB 圖之後，先把「建議範圍框.PNG」壓在這張圖上面，請使用者把商品
     縮放／拖曳到紅框（DRED）的範圍裡；開啟當下系統會先自動對位一次當起點，
     人工再微調。按下套用時，會把調整後的畫面重新輸出成一張 1200×1200 的圖，
     所以各版位完全沿用原本的 DRED 對齊規則與預設縮放 %，
     不必再去比對 layout 圖、也不需要加減任何 %。 */
  var DRED_REF = { size:1200, x:324, y:372, w:550, h:457 };   /* 從建議範圍框.PNG 量到的紅框 */
  /* 套用到各版位時的最大下游放大倍率：合成後的 1200×1200 圖，會再被各版位的
     曝品範圍尺寸 × 預設 % 拉伸一次（applyBnBgSlab 的 scale × z）。目前 17 個
     版位裡最吃倍率的是 IG（曝品範圍幾何比例 ×1.214）× 120% 預設 ≈ ×1.46；
     這裡抓 1.5 留一點餘裕。之後如果新增版位或改預設 %，實測到更高的倍率時
     要回來調這個常數，否則解析度提示會偏樂觀。 */
  var SLAB_WORST_LAYOUT_MULT = 1.5;
  /* 相對於 jbpbn.html 的位置；載不到時退到下一個候選，全都失敗就改畫 DRED 備援框 */
  var GUIDE_SRCS = ['程式檔案/建議範圍框.PNG', '../程式檔案/建議範圍框.PNG'];

  var fitModal = null, fitStage = null, fitPlate = null, fitWrap = null, fitImg = null,
      fitProdBox = null, fitDred = null, fitRange = null, fitVal = null,
      fitNote = null, fitFileEl = null, fitApplyBtn = null;
  /* 目前這張圖的對位狀態：
       k     = 顯示倍率（原圖 1px → 輸出 k px）
       cx/cy = 圖片中心落在輸出 1200×1200 座標的哪個位置
       baseK = 原圖 100% 時的倍率（整張剛好填滿 1200） */
  var fitState = null;

  function fitClamp(v, lo, hi){ return v < lo ? lo : (v > hi ? hi : v); }

  function ensureFitModal(){
    ensureStyle();
    if(fitModal) return fitModal;
    fitModal = document.createElement('div');
    fitModal.id = 'bnSlabFitModal';
    fitModal.className = 'bn-fit-overlay';
    fitModal.innerHTML = ''+
      '<div class="bn-fit-modal" role="dialog" aria-modal="true">'+
        '<div class="bn-fit-head">'+
          '<h3>📐 SLAB 商品對位</h3>'+
          '<button type="button" class="bn-fit-btn ghost bn-fit-change">更換圖片</button>'+
          '<button type="button" class="bn-fit-btn ghost bn-fit-close">關閉</button>'+
        '</div>'+
        '<div class="bn-fit-body">'+
          '<div class="bn-fit-stage">'+
            '<div class="bn-fit-plate"></div>'+
            '<div class="bn-fit-imgwrap"><img alt=""><div class="bn-fit-prod"></div></div>'+
            '<div class="bn-fit-guide"><img alt=""><div class="bn-fit-dred"></div></div>'+
            '<div class="bn-fit-tip"><span class="bn-fit-mouse"></span>'+
              '<span class="bn-fit-arrows"><i>▲</i><i>▼</i></span>滾輪縮放 · 拖曳移動</div>'+
          '</div>'+
          '<div class="bn-fit-side">'+
            '<div class="bn-fit-call"><b>請把商品放大縮小到紅框範圍</b><br>'+
              '紅框就是各版位的曝品範圍（DRED）。商品調到紅框內，套到每個版位時大小才會剛剛好。</div>'+
            '<div class="bn-fit-note bn-fit-file"></div>'+
            '<div class="bn-fit-row"><span>縮放</span>'+
              '<input type="range" min="15" max="400" step="1" value="100">'+
              '<span class="bn-fit-val">100%</span></div>'+
            '<div class="bn-fit-note"></div>'+
            '<div style="padding-top:12px;border-top:1px solid #404d61;margin-top:12px;font-size:12px;color:#8892a4">'+
              '💡 建議圖片解析度至少 <b>2048×2048px (2K)</b> 以上</div>'+
          '</div>'+
        '</div>'+
        '<div class="bn-fit-foot">'+
          '<div style="display:flex;gap:8px">'+
            '<button type="button" class="bn-fit-btn ghost bn-fit-auto">✨ 重新自動對位</button>'+
            '<button type="button" class="bn-fit-btn ghost bn-fit-reset">↺ 回到原圖</button>'+
          '</div>'+
          '<button type="button" class="bn-fit-btn primary bn-fit-apply" disabled>套用到各版位</button>'+
        '</div>'+
      '</div>';
    document.body.appendChild(fitModal);

    fitStage    = fitModal.querySelector('.bn-fit-stage');
    fitPlate    = fitModal.querySelector('.bn-fit-plate');
    fitWrap     = fitModal.querySelector('.bn-fit-imgwrap');
    fitImg      = fitWrap.querySelector('img');
    fitProdBox  = fitModal.querySelector('.bn-fit-prod');
    fitDred     = fitModal.querySelector('.bn-fit-dred');
    fitRange    = fitModal.querySelector('.bn-fit-row input');
    fitVal      = fitModal.querySelector('.bn-fit-val');
    fitFileEl   = fitModal.querySelector('.bn-fit-file');
    fitNote     = fitModal.querySelectorAll('.bn-fit-note')[1];
    fitApplyBtn = fitModal.querySelector('.bn-fit-apply');

    /* 備援紅框（位置＝DRED 佔 1200×1200 的百分比），只有在 PNG 載不到時才顯示 */
    var S = DRED_REF.size;
    fitDred.style.left   = (DRED_REF.x / S * 100) + '%';
    fitDred.style.top    = (DRED_REF.y / S * 100) + '%';
    fitDred.style.width  = (DRED_REF.w / S * 100) + '%';
    fitDred.style.height = (DRED_REF.h / S * 100) + '%';
    fitDred.style.display = 'none';
    loadGuideInto(fitModal.querySelector('.bn-fit-guide img'));

    fitModal.querySelector('.bn-fit-close').addEventListener('click', closeFitModal);
    fitModal.addEventListener('click', function(e){ if(e.target === fitModal) closeFitModal(); });
    fitModal.querySelector('.bn-fit-change').addEventListener('click', function(){ pickSlabFile(); });
    fitModal.querySelector('.bn-fit-auto').addEventListener('click', function(){
      if(fitState){ fitAutoAlign(); fitStage.classList.add('touched'); }
    });
    fitModal.querySelector('.bn-fit-reset').addEventListener('click', function(){
      if(fitState){ fitResetToOriginal(); fitStage.classList.add('touched'); }
    });
    fitApplyBtn.addEventListener('click', function(){
      if(!fitState) return;
      var out = fitCompose();
      closeFitModal();
      applySlabDataUrl(out);
    });

    /* 整個視窗都接受拖拉換圖 */
    fitModal.addEventListener('dragover', function(e){ e.preventDefault(); });
    fitModal.addEventListener('drop', function(e){
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if(f) openSlabFit(f);
    });

    /* 滾輪縮放：以游標所在的點為軸心，縮放時該點不會跑掉 */
    fitStage.addEventListener('wheel', function(e){
      if(!fitState) return;
      e.preventDefault();
      fitStage.classList.add('touched');
      var r = fitStage.getBoundingClientRect();
      /* 系数 0.0008 让滚轮放大缩小更细致，不会%跳的太快（对标滑桿拉的细致度） */
      fitZoomTo(fitState.k * Math.exp(-e.deltaY * 0.0008),
        (e.clientX - r.left) / r.width  * DRED_REF.size,
        (e.clientY - r.top)  / r.height * DRED_REF.size);
    }, { passive:false });

    /* 拖曳平移 */
    var drag = null;
    fitStage.addEventListener('pointerdown', function(e){
      if(!fitState) return;
      try{ fitStage.setPointerCapture(e.pointerId); }catch(_){ }
      fitStage.classList.add('dragging', 'touched');
      var r = fitStage.getBoundingClientRect();
      drag = { id:e.pointerId, x:e.clientX, y:e.clientY, s: DRED_REF.size / r.width };
    });
    fitStage.addEventListener('pointermove', function(e){
      if(!drag || e.pointerId !== drag.id || !fitState) return;
      fitState.cx += (e.clientX - drag.x) * drag.s;
      fitState.cy += (e.clientY - drag.y) * drag.s;
      drag.x = e.clientX; drag.y = e.clientY;
      fitRender();
    });
    function endDrag(e){
      if(!drag || (e && e.pointerId !== drag.id)) return;
      try{ fitStage.releasePointerCapture(drag.id); }catch(_){ }
      drag = null;
      fitStage.classList.remove('dragging');
    }
    fitStage.addEventListener('pointerup', endDrag);
    fitStage.addEventListener('pointercancel', endDrag);

    fitRange.addEventListener('input', function(){
      if(!fitState) return;
      fitStage.classList.add('touched');
      /* 用紅框中心當軸心，拉滑桿時商品才不會一邊放大一邊往角落跑 */
      fitZoomTo(fitState.baseK * (Number(fitRange.value) / 100),
        DRED_REF.x + DRED_REF.w / 2, DRED_REF.y + DRED_REF.h / 2);
    });

    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && fitModal.classList.contains('open')) closeFitModal();
    });
    return fitModal;
  }

  /* 建議範圍框.PNG 本身就是透明底（四角 alpha=0，紅框 alpha=128），
     直接疊上去就好，不需要去背或混合模式。 */
  function loadGuideInto(imgEl){
    var i = 0;
    function next(){
      if(i >= GUIDE_SRCS.length){
        imgEl.style.display = 'none';
        fitDred.style.display = 'block';   /* 圖載不到就自己畫一個紅框 */
        return;
      }
      imgEl.src = GUIDE_SRCS[i++];
    }
    imgEl.onerror = next;
    imgEl.onload = function(){ fitDred.style.display = 'none'; };
    next();
  }

  function closeFitModal(){ if(fitModal) fitModal.classList.remove('open'); }

  function fitRender(){
    if(!fitState || !fitModal) return;
    var S = DRED_REF.size;
    var w = fitState.natW * fitState.k, h = fitState.natH * fitState.k;
    fitWrap.style.left   = ((fitState.cx - w / 2) / S * 100) + '%';
    fitWrap.style.top    = ((fitState.cy - h / 2) / S * 100) + '%';
    fitWrap.style.width  = (w / S * 100) + '%';
    fitWrap.style.height = (h / S * 100) + '%';
    var pct = Math.round(fitState.k / fitState.baseK * 100);
    fitRange.value = fitClamp(pct, Number(fitRange.min), Number(fitRange.max));
    fitVal.textContent = pct + '%';
    fitNote.innerHTML = fitNoteHtml();
  }

  /* 商品目前落在輸出座標（1200×1200）的哪個位置 */
  function fitProductRectOut(){
    var p = fitState && fitState.prod;
    if(!p) return null;
    var w = fitState.natW * fitState.k, h = fitState.natH * fitState.k;
    var L = fitState.cx - w / 2, T = fitState.cy - h / 2;
    return { x: L + p.x / p.imgW * w, y: T + p.y / p.imgH * h,
             w: p.w / p.imgW * w,     h: p.h / p.imgH * h };
  }

  /* 解析度提示：k 是「原圖 1px → 合成後 1200×1200 圖裡的 1px」的放大倍率
     （對位時商品占畫面比例越小，k 就要越大才能把商品放進紅框）。合成圖
     之後還會被最吃倍率的版位再拉伸 SLAB_WORST_LAYOUT_MULT 倍，所以
     k × SLAB_WORST_LAYOUT_MULT > 1 就代表最終顯示的像素數會超過原圖
     實際擁有的像素數——也就是會被放大、有模糊風險。 */
  function fitResolutionWarningHtml(){
    if(!fitState || !fitState.k) return '';
    var need = fitState.k * SLAB_WORST_LAYOUT_MULT;
    if(need <= 1.05) return '';   /* 留一點緩衝，避免臨界值來回跳字 */
    var w = Math.round(fitState.natW * need), h = Math.round(fitState.natH * need);
    return '<br><span class="warn">⚠ 目前解析度偏低，套用到部分版位（如 IG）後畫面可能模糊</span>　' +
      '建議換一張至少 ' + w + '×' + h + ' px 的原圖';
  }

  function fitNoteHtml(){
    var r = fitProductRectOut();
    if(!r) return '這張圖<span class="warn">自動抓不到商品範圍</span>，請直接用滾輪與拖曳把商品對進紅框。' + fitResolutionWarningHtml();
    var pct = Math.round(r.h / DRED_REF.h * 100);
    var pad = 3;
    var inside = r.x >= DRED_REF.x - pad && r.y >= DRED_REF.y - pad &&
                 r.x + r.w <= DRED_REF.x + DRED_REF.w + pad &&
                 r.y + r.h <= DRED_REF.y + DRED_REF.h + pad;
    return '<span class="cy">青色虛線</span>＝系統偵測到的商品範圍（' + esc(fitState.prodMode) + '）<br>' +
      '商品高度目前是紅框的 <b>' + pct + '%</b>　' +
      (inside ? '<span class="ok">✓ 已在紅框內</span>'
              : '<span class="warn">⚠ 超出紅框</span>，請再縮小或移動') +
      fitResolutionWarningHtml();
  }

  function fitZoomTo(nk, ax, ay){
    if(!fitState) return;
    nk = fitClamp(nk, fitState.baseK * 0.15, fitState.baseK * 4);
    var r = nk / fitState.k;
    fitState.cx = ax + (fitState.cx - ax) * r;
    fitState.cy = ay + (fitState.cy - ay) * r;
    fitState.k = nk;
    fitRender();
  }

  /* 自動對位：把偵測到的商品縮到剛好放進紅框（寬高各取較嚴格的那一邊），
     並讓商品中心對齊紅框中心。這只是給使用者一個起點，之後以人工調整為準。 */
  function fitAutoAlign(){
    var p = fitState && fitState.prod;
    if(!p){ fitResetToOriginal(); return false; }
    var pw = p.w / p.imgW * fitState.natW, ph = p.h / p.imgH * fitState.natH;
    if(!(pw > 0) || !(ph > 0)){ fitResetToOriginal(); return false; }
    var k = Math.min(DRED_REF.h / ph, DRED_REF.w / pw);
    var pcx = (p.x + p.w / 2) / p.imgW, pcy = (p.y + p.h / 2) / p.imgH;
    fitState.k  = k;
    fitState.cx = (DRED_REF.x + DRED_REF.w / 2) - (pcx - 0.5) * fitState.natW * k;
    fitState.cy = (DRED_REF.y + DRED_REF.h / 2) - (pcy - 0.5) * fitState.natH * k;
    fitRender();
    return true;
  }

  function fitResetToOriginal(){
    if(!fitState) return;
    fitState.k  = fitState.baseK;
    fitState.cx = DRED_REF.size / 2;
    fitState.cy = DRED_REF.size / 2;
    fitRender();
  }

  /* 把目前畫面重畫成一張 1200×1200 的圖，之後各版位就照原本的規則吃這張圖 */
  function fitCompose(){
    var S = DRED_REF.size;
    /* 完全沒動過、而且本來就是 1200×1200：直接用原圖，不要多做一次轉檔 */
    if(fitState.natW === S && fitState.natH === S &&
       Math.abs(fitState.k - fitState.baseK) < 1e-6 &&
       Math.abs(fitState.cx - S / 2) < 0.5 && Math.abs(fitState.cy - S / 2) < 0.5){
      return fitState.dataUrl;
    }
    var c = document.createElement('canvas');
    c.width = S; c.height = S;
    var ctx = c.getContext('2d');
    if(fitState.plate){ ctx.fillStyle = fitState.plate; ctx.fillRect(0, 0, S, S); }
    try{ ctx.imageSmoothingQuality = 'high'; }catch(_){ }
    var w = fitState.natW * fitState.k, h = fitState.natH * fitState.k;
    ctx.drawImage(fitState.img, fitState.cx - w / 2, fitState.cy - h / 2, w, h);
    /* 不需要透明時輸出 JPEG：照片轉成 PNG 會讓 dataURL 大好幾倍，
       這張圖會被寫進 _bgStates／本機暫存，體積差很有感。 */
    var opaque = !fitState.hasAlpha && !!fitState.plate;
    try{ return c.toDataURL(opaque ? 'image/jpeg' : 'image/png', 0.94); }
    catch(_){ return fitState.dataUrl; }
  }

  function openSlabFit(file){
    if(!file || !/^image\//i.test(file.type || '')) return;
    ensureFitModal();
    fitModal.classList.add('open');
    fitStage.classList.remove('touched');
    fitApplyBtn.disabled = true;
    fitNote.textContent = '讀取圖片中…';
    var fr = new FileReader();
    fr.onload = function(ev){
      var dataUrl = ev.target.result;
      loadImage(dataUrl).then(function(img){
        var det = null;
        try{ det = detectProduct(img); }catch(_){ }
        var natW = img.naturalWidth || img.width, natH = img.naturalHeight || img.height;
        fitState = {
          img: img, dataUrl: dataUrl, natW: natW, natH: natH,
          baseK: DRED_REF.size / Math.max(natW, natH),
          prod: (det && det.rect) || null,
          prodMode: (det && det.mode) || '',
          hasAlpha: !!(det && det.hasAlpha),
          plate: (det && det.plate) || null,
          k: 1, cx: DRED_REF.size / 2, cy: DRED_REF.size / 2
        };
        fitImg.src = dataUrl;
        fitPlate.style.background = fitState.plate || 'transparent';
        var p = fitState.prod;
        if(p){
          fitProdBox.style.display = 'block';
          fitProdBox.style.left   = (p.x / p.imgW * 100) + '%';
          fitProdBox.style.top    = (p.y / p.imgH * 100) + '%';
          fitProdBox.style.width  = (p.w / p.imgW * 100) + '%';
          fitProdBox.style.height = (p.h / p.imgH * 100) + '%';
        } else {
          fitProdBox.style.display = 'none';
        }
        fitFileEl.textContent = file.name + '　' + natW + '×' + natH + ' px';
        fitAutoAlign();
        fitApplyBtn.disabled = false;
      }).catch(function(){
        fitNote.innerHTML = '<span class="warn">圖片載入失敗</span>，請換一張再試。';
      });
    };
    fr.readAsDataURL(file);
  }

  function pickSlabFile(){
    if(!_slabInput){
      _slabInput = document.createElement('input');
      _slabInput.type = 'file';
      _slabInput.accept = 'image/*';
      _slabInput.style.display = 'none';
      _slabInput.addEventListener('change', function(){
        var f = _slabInput.files && _slabInput.files[0];
        _slabInput.value = '';
        if(f) openSlabFit(f);
      });
      document.body.appendChild(_slabInput);
    }
    _slabInput.click();
  }

  function openSlabUpload(){
    closeModal();
    pickSlabFile();
  }

  function parsePublicTemplateCode(code){
    var s = String(code || '').trim();
    if(!s) return null;
    s = s.replace(/[＿]/g, '_').replace(/[－—–]/g, '-');
    var m = s.match(/\b(EL|FMCG|Fashion|Lifestyle)\s*[-_ ]?\s*(?:Mock\s*up|Mockup)?\s*[-_ ]?\s*0*(\d{1,3})\b/i);
    if(!m){
      /* A 活動公版：a_001 / a_001_H / a_001_W / A-001。_H/_W 只是檔名方向，
         編號不分方向，套用時依版位寬高比自動挑橫式(W)或直式(H)。 */
      var ma = s.match(/(?:^|[^a-z0-9])a\s*[-_ ]\s*0*(\d{1,3})(?:\s*[-_ ]?\s*[HW])?(?![a-z0-9])/i);
      if(!ma) return null;
      var numA = parseInt(ma[1], 10);
      return { category:'A', number:numA, mockup:false, code:'a_' + String(numA).padStart(3, '0') };
    }
    var rawCat = m[1].toLowerCase();
    var catMap = { el:'EL', fmcg:'FMCG', fashion:'Fashion', lifestyle:'Lifestyle' };
    var category = catMap[rawCat] || m[1];
    var number = parseInt(m[2], 10);
    var mockup = /mock\s*up/i.test(m[0]);
    return { category: category, number: number, mockup: mockup,
      code: category + (mockup ? '-Mockup-' : '-') + number };
  }

  function findCardByPublicCode(code){
    var parsed = parsePublicTemplateCode(code);
    if(!parsed) return Promise.resolve(null);
    return loadImages().then(function(){
      var oldCat = currentCat;
      currentCat = parsed.category;
      var list = listFromCategory(parsed.category);
      currentCat = oldCat;
      if(!list || !list.length) return null;
      if(parsed.category === 'A'){
        return list.find(function(img){ return Number(img.num) === parsed.number; }) || null;
      }
      var escapedCategory = parsed.category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var codeMiddle = parsed.mockup
        ? '\\s*[-_ ]?\\s*Mock\\s*up\\s*[-_ ]?\\s*'
        : '\\s*[-_ ]?\\s*';
      var exactCodeRe = new RegExp('(?:^|[^a-z0-9])' + escapedCategory + codeMiddle + '0*' + parsed.number + '(?:[^0-9]|$)', 'i');
      var exact = list.find(function(img){
        return exactCodeRe.test(String(img.fileName || '') + ' ' + String(img.name || '') + ' ' + String(img.horizontalSrc || '') + ' ' + String(img.verticalSrc || ''));
      });
      if(exact) return exact;
      if(parsed.mockup){
        var mockupFallback = list.find(function(img){
          return Number(img.num) === parsed.number && /mockup/i.test(String(img.fileName || '') + ' ' + String(img.horizontalSrc || ''));
        });
        if(mockupFallback) return mockupFallback;
      }
      if(parsed.mockup) return null;
      return list.find(function(img){ return Number(img.num) === parsed.number; }) || null;
    });
  }

  function applyByPublicCode(code){
    return findCardByPublicCode(code).then(function(img){
      if(!img){
        if(window._bnStatePlugin && typeof window._bnStatePlugin.toast === 'function'){
          window._bnStatePlugin.toast('找不到公版背景：' + code, 'err', 3000);
        }
        return false;
      }
      applyPreset(img);
      if(window._bnStatePlugin && typeof window._bnStatePlugin.toast === 'function'){
        window._bnStatePlugin.toast('已套用公版背景：' + (img.cat || '') + '-' + (img.num || ''), 'ok', 2600);
      }
      return true;
    }).catch(function(err){
      console.error('[背景圖庫] 公版編號套用失敗', err);
      return false;
    });
  }

  installBgColorSamplingHooks();

  /* 頁面載好後偷偷預載 index.json + brand.json，打開圖庫時就不用等 */
  function preloadBgData(){
    setTimeout(function(){ loadImages().catch(function(){}); }, 1500);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', preloadBgData);
  else preloadBgData();

  window.BNBgLibrary = {
    open: openModal,
    close: closeModal,
    apply: function(src){ applyPreset({name:cleanFileName(src), horizontalSrc:src, verticalSrc:null}); },
    applyByCode: applyByPublicCode,
    openSlab: openSlabUpload,
    slabFit: openSlabFit,        /* 直接餵一個 File 進對位視窗（測試／外部整合用） */
    findByCode: findCardByPublicCode,
    reload: function(){ imagesLoaded=false; selected=null; return loadImages().then(function(){ renderTabs(); buildCards(); renderFilters(); renderGrid(); }); }
  };
})();
