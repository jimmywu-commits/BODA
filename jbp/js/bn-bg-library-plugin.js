<<<<<<< HEAD

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

  var modal, grid, tabsEl, searchEl, statusEl, selectedEl, applyBtn;
  var allowNativeUploadOnce = false;
  var pendingNativeTarget = null;
  var imagesLoaded = false;
  var indexData = null;
  var brandData = null;
  var currentCat = CATEGORIES[0];
  var searchQuery = '';
  var cards = [];
  var selected = null;

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
      '.bn-bglib-overlay{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:2147483000;display:none;align-items:center;justify-content:center;padding:24px}',
      '.bn-bglib-overlay.open{display:flex}',
      '.bn-bglib-modal{width:min(1040px,96vw);max-height:90vh;background:#111827;border:1px solid #30363d;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.65);display:flex;flex-direction:column;overflow:hidden;color:#e6edf3;font-family:"Segoe UI","PingFang TC",Arial,sans-serif}',
      '.bn-bglib-head{display:flex;align-items:center;gap:12px;padding:14px 18px;background:#161b22;border-bottom:1px solid #30363d}',
      '.bn-bglib-head h3{font-size:15px;margin:0;white-space:nowrap}',
      '.bn-bglib-search{flex:1;min-width:160px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;padding:7px 10px;outline:none}',
      '.bn-bglib-close{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:6px 10px;cursor:pointer}',
      '.bn-bglib-tabs{display:flex;gap:8px;padding:12px 16px 0;background:#111827;flex-wrap:wrap}',
      '.bn-bglib-tab{background:#1c2333;color:#8b949e;border:1px solid #30363d;border-radius:999px;padding:6px 13px;font-size:12px;font-weight:700;cursor:pointer}',
      '.bn-bglib-tab.active{background:#1f6feb;color:#fff;border-color:#388bfd}',
      '.bn-bglib-body{padding:14px 16px 16px;overflow:auto}',
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
      '.bn-bglib-apply{background:#1f6feb;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer}',
      '.bn-bglib-apply:disabled{opacity:.45;cursor:not-allowed}',
      '.bn-bglib-hint{font-size:12px;color:#8b949e;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.bn-bglib-empty{border:1px dashed #30363d;border-radius:10px;padding:24px;text-align:center;color:#8b949e;line-height:1.7;grid-column:1/-1}',
      '.bn-bglib-actions{display:flex;gap:8px;align-items:center;flex-shrink:0}'
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
          '<input class="bn-bglib-search" type="search" placeholder="搜尋檔名 / 編號">'+
          '<button type="button" class="bn-bglib-close">關閉</button>'+
        '</div>'+
        '<div class="bn-bglib-tabs" role="tablist"></div>'+
        '<div class="bn-bglib-body"><div class="bn-bglib-status"></div><div class="bn-bglib-grid"></div></div>'+
        '<div class="bn-bglib-foot">'+
          '<div class="bn-bglib-hint">選預設圖會依版位寬高比自動套用；要用自己的圖，請按右側按鈕。</div>'+
          '<div class="bn-bglib-actions"><button type="button" class="bn-bglib-upload">📤 上傳自己的圖片</button><button type="button" class="bn-bglib-apply" disabled>套用選取</button></div>'+
        '</div>'+
      '</div>';
    document.body.appendChild(modal);
    grid = modal.querySelector('.bn-bglib-grid');
    tabsEl = modal.querySelector('.bn-bglib-tabs');
    searchEl = modal.querySelector('.bn-bglib-search');
    statusEl = modal.querySelector('.bn-bglib-status');
    selectedEl = modal.querySelector('.bn-bglib-hint');
    applyBtn = modal.querySelector('.bn-bglib-apply');

    modal.querySelector('.bn-bglib-close').addEventListener('click', closeModal);
    modal.addEventListener('click', function(e){ if(e.target === modal) closeModal(); });
    modal.querySelector('.bn-bglib-upload').addEventListener('click', function(){ closeModal(); openNativeUpload(); });
    applyBtn.addEventListener('click', function(){ if(selected) applyPreset(selected); });
    searchEl.addEventListener('input', function(){ searchQuery = searchEl.value || ''; renderGrid(); });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeModal(); });
    renderTabs();
    return modal;
  }

  function renderTabs(){
    if(!tabsEl) return;
    tabsEl.innerHTML = CATEGORIES.map(function(cat){
      return '<button type="button" class="bn-bglib-tab'+(cat===currentCat?' active':'')+'" data-cat="'+esc(cat)+'">'+esc(cat)+'</button>';
    }).join('');
    tabsEl.querySelectorAll('.bn-bglib-tab').forEach(function(tab){
      tab.addEventListener('click', function(){
        currentCat = tab.dataset.cat;
        selected = null;
        searchQuery = '';
        if(searchEl) searchEl.value = '';
        renderTabs();
        buildCards();
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
      var keys = detectCategories(indexData);
      if(keys.length){
        CATEGORIES = keys;
        if(CATEGORIES.indexOf(currentCat) === -1) currentCat = CATEGORIES[0];
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
    var catData = indexData[cat];
    if(!catData) return out;

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
        var dd = findPairByNum(ddList, num);
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

  function findPairByNum(list, num){
    if(!Array.isArray(list) || num === null) return null;
    for(var i=0;i<list.length;i++){
      if(extractNum(list[i]) === num) return list[i];
    }
    return null;
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
    var q = String(searchQuery||'').trim().toLowerCase();
    var list = cards.filter(function(img){
      if(!q) return true;
      return String(img.name||'').toLowerCase().indexOf(q) !== -1 || String(img.fileName||'').toLowerCase().indexOf(q) !== -1 || String(img.num||'').indexOf(q) !== -1;
    });
    if(statusEl){
      statusEl.textContent = list.length ? ('分類：' + currentCat + '，共 ' + list.length + ' 張' + (cards.some(function(x){return x.verticalSrc;}) ? '（含直式對應圖）' : '')) : '';
    }
    if(!list.length){
      grid.innerHTML = '<div class="bn-bglib-empty">目前沒有載入背景圖。<br>請確認 <code>bgimg/index.json</code> 與圖片資料夾是否存在。</div>';
      if(applyBtn) applyBtn.disabled = true;
      return;
    }
    grid.innerHTML = list.map(function(img, idx){
      var src = encodeSrc(img.horizontalSrc);
      return '<button type="button" class="bn-bglib-card'+(selected===img?' selected':'')+'" data-idx="'+idx+'">'+
        '<div class="bn-bglib-thumb"><img src="'+esc(src)+'" alt=""></div>'+
        '<div class="bn-bglib-name" title="'+esc(img.fileName || img.name)+'">'+esc(img.name)+'</div>'+
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
      selectedEl.textContent = '已選：' + (img.name || '') + (img.verticalSrc ? '（橫式用 HBN、直式/方版用 DDCARD）' : '');
    }
    if(applyBtn) applyBtn.disabled = false;
    renderGrid();
  }

  function openModal(nativeTarget){
    pendingNativeTarget = nativeTarget || pendingNativeTarget || findNativeUploadTarget();
    ensureModal();
    modal.classList.add('open');
    if(statusEl) statusEl.textContent = '載入背景圖庫中…';
    loadImages().then(function(){ renderTabs(); buildCards(); renderGrid(); }).catch(function(){
      if(grid) grid.innerHTML = '<div class="bn-bglib-empty">無法載入 <code>bgimg/index.json</code>。</div>';
    });
  }
  function closeModal(){ if(modal) modal.classList.remove('open'); }

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
    if(el.closest && el.closest('#bnBgLibModal')) return false;
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
    if(statusEl) statusEl.textContent = '套用中…';
    Promise.all([imageToDataUrl(img.horizontalSrc), img.verticalSrc ? imageToDataUrl(img.verticalSrc) : Promise.resolve(null)])
      .then(function(res){
        var dataH = res[0];
        var dataV = res[1];
        applySampledCanvasBg(dataH || dataV);
        var iframes = Array.prototype.slice.call(document.querySelectorAll('.preview-block iframe'));
        var states = {};
        iframes.forEach(function(iframe){
          var info = getLayoutInfoForIframe(iframe);
          var src = chooseSrcForLayout(info, img, dataH, dataV);
          if(!src) return;
          var params = getBgParamsForLibraryLayout(info, iframe);
          if(info.id) states[info.id] = {src:resolveBgImgUrl(src), fit:params.fit, scale:params.scale, x:params.x, y:params.y, _initialized:true};
          try{ iframe.contentWindow.postMessage({ type:'bn-bg', src:resolveBgImgUrl(src), fit:params.fit, scale:params.scale, x:params.x, y:params.y }, '*'); }catch(_){ }
        });
        if(window._bnSetBgStates){
          try{ window._bnSetBgStates(states, null); }catch(_){ }
        }
        // 若沒有任何 iframe，仍保留原本單張 broadcast 行為。
        if(!iframes.length && typeof window.broadcastBg === 'function') window.broadcastBg(dataH || dataV || img.horizontalSrc);
        try{ document.dispatchEvent(new CustomEvent('bn-state-dirty')); }catch(_){ }
      });
  }


  function parsePublicTemplateCode(code){
    var s = String(code || '').trim();
    if(!s) return null;
    s = s.replace(/[＿]/g, '_').replace(/[－—–]/g, '-');
    var m = s.match(/\b(EL|FMCG|Fashion|Lifestyle)\s*[-_ ]?\s*(?:Mock\s*up|Mockup)?\s*[-_ ]?\s*0*(\d{1,3})\b/i);
    if(!m) return null;
    var rawCat = m[1].toLowerCase();
    var catMap = { el:'EL', fmcg:'FMCG', fashion:'Fashion', lifestyle:'Lifestyle' };
    return { category: catMap[rawCat] || m[1], number: parseInt(m[2], 10), code: (catMap[rawCat] || m[1]) + '-' + parseInt(m[2], 10) };
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
      var exactCodeRe = new RegExp('(?:^|[^a-z0-9])' + parsed.category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-_ ]?\\s*0*' + parsed.number + '(?:[^0-9]|$)', 'i');
      var exact = list.find(function(img){
        return exactCodeRe.test(String(img.fileName || '') + ' ' + String(img.name || '') + ' ' + String(img.horizontalSrc || '') + ' ' + String(img.verticalSrc || ''));
      });
      if(exact) return exact;
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

  window.BNBgLibrary = {
    open: openModal,
    close: closeModal,
    apply: function(src){ applyPreset({name:cleanFileName(src), horizontalSrc:src, verticalSrc:null}); },
    applyByCode: applyByPublicCode,
    findByCode: findCardByPublicCode,
    reload: function(){ imagesLoaded=false; selected=null; return loadImages().then(function(){ renderTabs(); buildCards(); renderGrid(); }); }
  };
})();
=======

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

  var modal, grid, tabsEl, searchEl, statusEl, selectedEl, applyBtn;
  var allowNativeUploadOnce = false;
  var pendingNativeTarget = null;
  var imagesLoaded = false;
  var indexData = null;
  var brandData = null;
  var currentCat = CATEGORIES[0];
  var searchQuery = '';
  var cards = [];
  var selected = null;

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
      '.bn-bglib-overlay{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:2147483000;display:none;align-items:center;justify-content:center;padding:24px}',
      '.bn-bglib-overlay.open{display:flex}',
      '.bn-bglib-modal{width:min(1040px,96vw);max-height:90vh;background:#111827;border:1px solid #30363d;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.65);display:flex;flex-direction:column;overflow:hidden;color:#e6edf3;font-family:"Segoe UI","PingFang TC",Arial,sans-serif}',
      '.bn-bglib-head{display:flex;align-items:center;gap:12px;padding:14px 18px;background:#161b22;border-bottom:1px solid #30363d}',
      '.bn-bglib-head h3{font-size:15px;margin:0;white-space:nowrap}',
      '.bn-bglib-search{flex:1;min-width:160px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;padding:7px 10px;outline:none}',
      '.bn-bglib-close{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:6px 10px;cursor:pointer}',
      '.bn-bglib-tabs{display:flex;gap:8px;padding:12px 16px 0;background:#111827;flex-wrap:wrap}',
      '.bn-bglib-tab{background:#1c2333;color:#8b949e;border:1px solid #30363d;border-radius:999px;padding:6px 13px;font-size:12px;font-weight:700;cursor:pointer}',
      '.bn-bglib-tab.active{background:#1f6feb;color:#fff;border-color:#388bfd}',
      '.bn-bglib-body{padding:14px 16px 16px;overflow:auto}',
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
      '.bn-bglib-apply{background:#1f6feb;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer}',
      '.bn-bglib-apply:disabled{opacity:.45;cursor:not-allowed}',
      '.bn-bglib-hint{font-size:12px;color:#8b949e;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.bn-bglib-empty{border:1px dashed #30363d;border-radius:10px;padding:24px;text-align:center;color:#8b949e;line-height:1.7;grid-column:1/-1}',
      '.bn-bglib-actions{display:flex;gap:8px;align-items:center;flex-shrink:0}'
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
          '<input class="bn-bglib-search" type="search" placeholder="搜尋檔名 / 編號">'+
          '<button type="button" class="bn-bglib-close">關閉</button>'+
        '</div>'+
        '<div class="bn-bglib-tabs" role="tablist"></div>'+
        '<div class="bn-bglib-body"><div class="bn-bglib-status"></div><div class="bn-bglib-grid"></div></div>'+
        '<div class="bn-bglib-foot">'+
          '<div class="bn-bglib-hint">選預設圖會依版位寬高比自動套用；要用自己的圖，請按右側按鈕。</div>'+
          '<div class="bn-bglib-actions"><button type="button" class="bn-bglib-upload">📤 上傳自己的圖片</button><button type="button" class="bn-bglib-apply" disabled>套用選取</button></div>'+
        '</div>'+
      '</div>';
    document.body.appendChild(modal);
    grid = modal.querySelector('.bn-bglib-grid');
    tabsEl = modal.querySelector('.bn-bglib-tabs');
    searchEl = modal.querySelector('.bn-bglib-search');
    statusEl = modal.querySelector('.bn-bglib-status');
    selectedEl = modal.querySelector('.bn-bglib-hint');
    applyBtn = modal.querySelector('.bn-bglib-apply');

    modal.querySelector('.bn-bglib-close').addEventListener('click', closeModal);
    modal.addEventListener('click', function(e){ if(e.target === modal) closeModal(); });
    modal.querySelector('.bn-bglib-upload').addEventListener('click', function(){ closeModal(); openNativeUpload(); });
    applyBtn.addEventListener('click', function(){ if(selected) applyPreset(selected); });
    searchEl.addEventListener('input', function(){ searchQuery = searchEl.value || ''; renderGrid(); });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeModal(); });
    renderTabs();
    return modal;
  }

  function renderTabs(){
    if(!tabsEl) return;
    tabsEl.innerHTML = CATEGORIES.map(function(cat){
      return '<button type="button" class="bn-bglib-tab'+(cat===currentCat?' active':'')+'" data-cat="'+esc(cat)+'">'+esc(cat)+'</button>';
    }).join('');
    tabsEl.querySelectorAll('.bn-bglib-tab').forEach(function(tab){
      tab.addEventListener('click', function(){
        currentCat = tab.dataset.cat;
        selected = null;
        searchQuery = '';
        if(searchEl) searchEl.value = '';
        renderTabs();
        buildCards();
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
      var keys = detectCategories(indexData);
      if(keys.length){
        CATEGORIES = keys;
        if(CATEGORIES.indexOf(currentCat) === -1) currentCat = CATEGORIES[0];
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
    var catData = indexData[cat];
    if(!catData) return out;

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
        var dd = findPairByNum(ddList, num);
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

  function findPairByNum(list, num){
    if(!Array.isArray(list) || num === null) return null;
    for(var i=0;i<list.length;i++){
      if(extractNum(list[i]) === num) return list[i];
    }
    return null;
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
    var q = String(searchQuery||'').trim().toLowerCase();
    var list = cards.filter(function(img){
      if(!q) return true;
      return String(img.name||'').toLowerCase().indexOf(q) !== -1 || String(img.fileName||'').toLowerCase().indexOf(q) !== -1 || String(img.num||'').indexOf(q) !== -1;
    });
    if(statusEl){
      statusEl.textContent = list.length ? ('分類：' + currentCat + '，共 ' + list.length + ' 張' + (cards.some(function(x){return x.verticalSrc;}) ? '（含直式對應圖）' : '')) : '';
    }
    if(!list.length){
      grid.innerHTML = '<div class="bn-bglib-empty">目前沒有載入背景圖。<br>請確認 <code>bgimg/index.json</code> 與圖片資料夾是否存在。</div>';
      if(applyBtn) applyBtn.disabled = true;
      return;
    }
    grid.innerHTML = list.map(function(img, idx){
      var src = encodeSrc(img.horizontalSrc);
      return '<button type="button" class="bn-bglib-card'+(selected===img?' selected':'')+'" data-idx="'+idx+'">'+
        '<div class="bn-bglib-thumb"><img src="'+esc(src)+'" alt=""></div>'+
        '<div class="bn-bglib-name" title="'+esc(img.fileName || img.name)+'">'+esc(img.name)+'</div>'+
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
      selectedEl.textContent = '已選：' + (img.name || '') + (img.verticalSrc ? '（橫式用 HBN、直式/方版用 DDCARD）' : '');
    }
    if(applyBtn) applyBtn.disabled = false;
    renderGrid();
  }

  function openModal(nativeTarget){
    pendingNativeTarget = nativeTarget || pendingNativeTarget || findNativeUploadTarget();
    ensureModal();
    modal.classList.add('open');
    if(statusEl) statusEl.textContent = '載入背景圖庫中…';
    loadImages().then(function(){ renderTabs(); buildCards(); renderGrid(); }).catch(function(){
      if(grid) grid.innerHTML = '<div class="bn-bglib-empty">無法載入 <code>bgimg/index.json</code>。</div>';
    });
  }
  function closeModal(){ if(modal) modal.classList.remove('open'); }

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
    if(el.closest && el.closest('#bnBgLibModal')) return false;
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
    if(statusEl) statusEl.textContent = '套用中…';
    Promise.all([imageToDataUrl(img.horizontalSrc), img.verticalSrc ? imageToDataUrl(img.verticalSrc) : Promise.resolve(null)])
      .then(function(res){
        var dataH = res[0];
        var dataV = res[1];
        applySampledCanvasBg(dataH || dataV);
        var iframes = Array.prototype.slice.call(document.querySelectorAll('.preview-block iframe'));
        var states = {};
        iframes.forEach(function(iframe){
          var info = getLayoutInfoForIframe(iframe);
          var src = chooseSrcForLayout(info, img, dataH, dataV);
          if(!src) return;
          var params = getBgParamsForLibraryLayout(info, iframe);
          if(info.id) states[info.id] = {src:resolveBgImgUrl(src), fit:params.fit, scale:params.scale, x:params.x, y:params.y, _initialized:true};
          try{ iframe.contentWindow.postMessage({ type:'bn-bg', src:resolveBgImgUrl(src), fit:params.fit, scale:params.scale, x:params.x, y:params.y }, '*'); }catch(_){ }
        });
        if(window._bnSetBgStates){
          try{ window._bnSetBgStates(states, null); }catch(_){ }
        }
        // 若沒有任何 iframe，仍保留原本單張 broadcast 行為。
        if(!iframes.length && typeof window.broadcastBg === 'function') window.broadcastBg(dataH || dataV || img.horizontalSrc);
        try{ document.dispatchEvent(new CustomEvent('bn-state-dirty')); }catch(_){ }
      });
  }


  function parsePublicTemplateCode(code){
    var s = String(code || '').trim();
    if(!s) return null;
    s = s.replace(/[＿]/g, '_').replace(/[－—–]/g, '-');
    var m = s.match(/\b(EL|FMCG|Fashion|Lifestyle)\s*[-_ ]?\s*(?:Mock\s*up|Mockup)?\s*[-_ ]?\s*0*(\d{1,3})\b/i);
    if(!m) return null;
    var rawCat = m[1].toLowerCase();
    var catMap = { el:'EL', fmcg:'FMCG', fashion:'Fashion', lifestyle:'Lifestyle' };
    return { category: catMap[rawCat] || m[1], number: parseInt(m[2], 10), code: (catMap[rawCat] || m[1]) + '-' + parseInt(m[2], 10) };
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
      var exactCodeRe = new RegExp('(?:^|[^a-z0-9])' + parsed.category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-_ ]?\\s*0*' + parsed.number + '(?:[^0-9]|$)', 'i');
      var exact = list.find(function(img){
        return exactCodeRe.test(String(img.fileName || '') + ' ' + String(img.name || '') + ' ' + String(img.horizontalSrc || '') + ' ' + String(img.verticalSrc || ''));
      });
      if(exact) return exact;
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

  window.BNBgLibrary = {
    open: openModal,
    close: closeModal,
    apply: function(src){ applyPreset({name:cleanFileName(src), horizontalSrc:src, verticalSrc:null}); },
    applyByCode: applyByPublicCode,
    findByCode: findCardByPublicCode,
    reload: function(){ imagesLoaded=false; selected=null; return loadImages().then(function(){ renderTabs(); buildCards(); renderGrid(); }); }
  };
})();
>>>>>>> d0c1f49ca454b8cb7adfad3de1a2ba8ba35521b1
