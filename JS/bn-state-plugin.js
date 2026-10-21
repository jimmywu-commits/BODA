/*!
 * BN State Plugin
 * 1. banwords：用 applyToElement（同 sba.html），含 toast + 手動選 xlsx fallback
 * 2. 本機暫存（localStorage）
 * 3. 下載暫存 / 上傳暫存按鈕
 *
 * 依賴：js/banwords-engine-hbn.js（自動載入）
 */
(function(global){
  'use strict';
  if(global.__BN_STATE_PLUGIN__) return;
  global.__BN_STATE_PLUGIN__ = true;

  var STORAGE_KEY = 'bn_editor_state_v1';

  function ready(fn){
    if(document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function loadScript(src, cb){
    if(document.querySelector('script[src="'+src+'"]')){
      if(cb) cb(); return;
    }
    var s = document.createElement('script');
    s.src = src; s.onload = cb||function(){}; s.onerror = function(){ if(cb) cb(); };
    document.head.appendChild(s);
  }



  /* IndexedDB：完整本機暫存。背景圖 dataURL 很容易超過 localStorage 容量，
     因此完整 state 存 IndexedDB；localStorage 僅作為小型備援/舊版相容。 */
  var IDB_DB = 'bn_editor_state_db';
  var IDB_STORE = 'states';
  var IDB_KEY = 'current';

  function openStateDb(){
    return new Promise(function(resolve, reject){
      if(!('indexedDB' in global)){ reject(new Error('IndexedDB not supported')); return; }
      var req = indexedDB.open(IDB_DB, 1);
      req.onupgradeneeded = function(){
        var db = req.result;
        if(!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error || new Error('IndexedDB open failed')); };
    });
  }

  function idbSetState(state){
    return openStateDb().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(state, IDB_KEY);
        tx.oncomplete = function(){ db.close(); resolve(); };
        tx.onerror = function(){ var err = tx.error; try{ db.close(); }catch(_){} reject(err || new Error('IndexedDB write failed')); };
      });
    });
  }

  function idbGetState(){
    return openStateDb().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(IDB_STORE, 'readonly');
        var req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = function(){ resolve(req.result || null); };
        req.onerror = function(){ reject(req.error || new Error('IndexedDB read failed')); };
        tx.oncomplete = function(){ try{ db.close(); }catch(_){} };
      });
    });
  }

  function idbClearState(){
    return openStateDb().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(IDB_KEY);
        tx.oncomplete = function(){ db.close(); resolve(); };
        tx.onerror = function(){ var err = tx.error; try{ db.close(); }catch(_){} reject(err || new Error('IndexedDB delete failed')); };
      });
    });
  }

  function stripHeavyStateForLocalStorage(state){
    var light = clone(state || {});
    light._heavyStripped = true;
    if(light.background && light.background.states){
      Object.keys(light.background.states).forEach(function(id){
        if(light.background.states[id]) light.background.states[id].src = light.background.states[id].src ? '__BN_IDB__' : null;
      });
      if(light.background.statesByFile){
        Object.keys(light.background.statesByFile).forEach(function(file){
          if(light.background.statesByFile[file]) light.background.statesByFile[file].src = light.background.statesByFile[file].src ? '__BN_IDB__' : null;
        });
      }
      if(light.background.legacySrc) light.background.legacySrc = '__BN_IDB__';
    }
    if(light.products){ light.products.forEach(function(p){ if(p && p.src) p.src='__BN_IDB__'; }); }
    if(light.logos){ light.logos.forEach(function(l){ if(l && l.src) l.src='__BN_IDB__'; }); }
    if(light.character && light.character.src){ light.character.src='__BN_IDB__'; }
    if(light.character2 && light.character2.src){ light.character2.src='__BN_IDB__'; }
    return light;
  }

  function isFullStateCandidate(state){
    return !!(state && state.version === 1 && !stateHasHeavyPlaceholders(state));
  }

  function readLocalState(key){
    try{
      var raw = localStorage.getItem(key);
      if(!raw) return null;
      var state = JSON.parse(raw);
      return state && state.version === 1 ? state : null;
    }catch(_){ return null; }
  }

  function getNewestState(states, preferFull){
    var list = (states || []).filter(function(s){ return s && s.version === 1; });
    if(preferFull) list = list.filter(isFullStateCandidate);
    if(!list.length) return null;
    list.sort(function(a,b){ return (b.ts || 0) - (a.ts || 0); });
    return list[0];
  }

  function mergeLightIntoFull(full, light){
    if(!full || !light || !light._heavyStripped) return full;
    if((light.ts || 0) <= (full.ts || 0)) return full;
    var merged = clone(full);
    merged.ts = light.ts || merged.ts;
    ['portableVersion','layoutManifest','texts','colors','inputMeta','toolbar','layouts','bgCheckers',
      'checked','checkedByFile','logoLayouts','logoLayoutsByFile'].forEach(function(k){
      if(light[k] !== undefined) merged[k] = clone(light[k]);
    });

    if(Array.isArray(light.products) && Array.isArray(merged.products)){
      var byId = {};
      merged.products.forEach(function(p){ if(p && p.id) byId[p.id] = p; });
      light.products.forEach(function(lp){
        if(!lp || !lp.id || !byId[lp.id]) return;
        ['sizeScale','position','zOrder','width','height','x','y','scale','rotate','layout','layouts','layoutsByFile','crop','meta'].forEach(function(k){
          if(lp[k] !== undefined) byId[lp.id][k] = clone(lp[k]);
        });
      });
    }

    if(Array.isArray(light.logos) && Array.isArray(merged.logos)){
      var logosById = {};
      merged.logos.forEach(function(l){ if(l && l.id) logosById[l.id] = l; });
      light.logos.forEach(function(ll, i){
        var target = (ll && ll.id && logosById[ll.id]) || merged.logos[i];
        if(!target || !ll) return;
        Object.keys(ll).forEach(function(k){ if(k !== 'src' && ll[k] !== undefined) target[k] = clone(ll[k]); });
      });
    }

    ['character','character2'].forEach(function(key){
      var lightChar = light[key];
      var mergedChar = merged[key];
      if(!lightChar || !mergedChar) return;
      Object.keys(lightChar).forEach(function(k){
        if(k !== 'src' && lightChar[k] !== undefined) mergedChar[k] = clone(lightChar[k]);
      });
    });

    if(light.background && merged.background){
      if(light.background.activeId !== undefined) merged.background.activeId = light.background.activeId;
      if(light.background.activeFile !== undefined) merged.background.activeFile = light.background.activeFile;
      if(light.background.states && merged.background.states){
        Object.keys(light.background.states).forEach(function(id){
          var ls = light.background.states[id] || {};
          var ms = merged.background.states[id] || {};
          Object.keys(ls).forEach(function(k){ if(k !== 'src' && ls[k] !== undefined) ms[k] = clone(ls[k]); });
          merged.background.states[id] = ms;
        });
      }
      if(light.background.statesByFile && merged.background.statesByFile){
        Object.keys(light.background.statesByFile).forEach(function(file){
          var lsFile = light.background.statesByFile[file] || {};
          var msFile = merged.background.statesByFile[file] || {};
          Object.keys(lsFile).forEach(function(k){
            if(k !== 'src' && lsFile[k] !== undefined) msFile[k] = clone(lsFile[k]);
          });
          merged.background.statesByFile[file] = msFile;
        });
      }
    }
    return merged;
  }

  /* ── Toast（同 sba.html 風格） ── */
  function showToast(msg, type, duration){
    var t = document.createElement('div');
    var bg = type === 'err' ? '#7f1d1d' : type === 'ok' ? '#14532d' : '#1a1d2a';
    var color = type === 'err' ? '#fca5a5' : type === 'ok' ? '#86efac' : '#dde3f0';
    t.style.cssText=[
      'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);',
      'background:'+bg+';color:'+color+';',
      'padding:8px 20px;border-radius:10px;font-size:13px;',
      'box-shadow:0 8px 24px rgba(0,0,0,.5);z-index:99999;',
      'white-space:nowrap;max-width:90vw;',
    ].join('');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function(){ t.remove(); }, duration||2500);
  }

  /* ══════════════════════════════════════
     1. Banwords 橋接（applyToElement）
  ══════════════════════════════════════ */

  /* 各欄位對應的 data-role（banwords-engine 用這個查規則） */
  var FIELD_MAP = {
    'txt-brand': { role:'品牌名', label:'品牌名' },
    'txt-main':  { role:'主標',   label:'主標'   },
    'txt-sub':   { role:'副標',   label:'副標'   },
    'txt-date':  { role:'date',   label:'日期'   },
  };

  /* 左側欄位 role → 畫布上對應的可編輯 class（副標另含 Search Image 的變體） */
  function fieldCfg2Class(cfg){
    var role = cfg && cfg.role;
    if(role === 'date') return ['日期'];
    if(role === '副標')  return ['副標','副標案型七字內'];
    if(role === '主標')  return ['主標'];
    if(role === '品牌名') return ['品牌名'];
    return [];
  }

  /* 把中文數字豁免旗標同步到所有版位畫布上的對應欄位 */
  function broadcastNumeralExempt(classes, on){
    if(!classes || !classes.length) return;
    document.querySelectorAll('.preview-block iframe').forEach(function(ifr){
      classes.forEach(function(cls){
        try{ ifr.contentWindow.postMessage({type:'bn-numeral-exempt', field:cls, on:!!on}, '*'); }catch(_){ }
      });
    });
  }

  /* applyToElement 需要 contenteditable 元素
     <input> 不是，所以用 shadow div 橋接 */
  function applyBanwordToInput(inp, fieldCfg, opts){
    if(!global.banwordEngine) return null;

    /* 建（或重用）橋接用的 shadow div */
    var shadowId = '_bn_bw_shadow_' + inp.id;
    var shadow = document.getElementById(shadowId);
    if(!shadow){
      shadow = document.createElement('div');
      shadow.id = shadowId;
      shadow.setAttribute('contenteditable', 'true');
      shadow.dataset.role = fieldCfg.role;
      shadow.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;';
      document.body.appendChild(shadow);
    }

    /* 把 input 值寫進 shadow，套 dollarExempt / numeralExempt */
    shadow.textContent = inp.value;
    if(opts && opts.dollarExempt){
      shadow.dataset.dollarExempt = JSON.stringify(opts.dollarExempt);
    } else {
      shadow.dataset.dollarExempt = '';
    }
    shadow.dataset.numeralExempt = (opts && opts.numeralExempt) ? '1' : '';

    var result = global.banwordEngine.applyToElement(shadow, {
      role: fieldCfg.role,
      force: true,
      getText: function(el){ return el.textContent; }
    });

    if(result && result.text !== undefined && result.text !== inp.value){
      inp.value = result.text;
      /* 補上 $ 與千分位後才超過上限時，標記為系統造成，
         讓左側 input 監聽不要把文字截掉（改用紅框＋擋下載提醒）。 */
      if(typeof global.bnMarkFmtOver === 'function'){
        try{ global.bnMarkFmtOver(inp); }catch(_){}
      }
      inp.dispatchEvent(new Event('input', {bubbles:true}));
      if(typeof global.bnRefreshLimitAlert === 'function'){
        try{ global.bnRefreshLimitAlert(); }catch(_){}
      }
    }

    /* Toast 提示 */
    if(result && result.message){
      showToast(result.message, 'err', result.duration||4000);
    }

    return result;
  }

  function bridgeInputs(){
    var needsInitial = [];
    Object.keys(FIELD_MAP).forEach(function(id){
      var inp = document.getElementById(id);
      if(!inp || inp.dataset.bnBanwordBound === '1') return;
      inp.dataset.bnBanwordBound = '1';
      var cfg = FIELD_MAP[id];

      /* blur：跑 applyToElement */
      inp.addEventListener('blur', function(){
        var opts = {};
        if(inp.dataset.dollarExempt){
          try{ opts.dollarExempt = JSON.parse(inp.dataset.dollarExempt); }catch(_){}
        }
        opts.numeralExempt = inp.dataset.numeralExempt === '1';
        applyBanwordToInput(inp, cfg, opts);
      });

      /* 右鍵：暫時不加$和千分位、不強制變阿拉伯數字 */
      inp.addEventListener('contextmenu', function(e){
        e.preventDefault();
        showInputMenu(e, inp, cfg);
      });

      if(inp.value) needsInitial.push({ inp: inp, cfg: cfg });
    });

    if(needsInitial.length){
      setTimeout(function(){
        needsInitial.forEach(function(item){
          if(document.activeElement === item.inp) return;
          applyBanwordToInput(item.inp, item.cfg, {});
        });
      }, 100);
    }
  }

  function runAllFieldsOnce(){
    Object.keys(FIELD_MAP).forEach(function(id){
      var inp = document.getElementById(id);
      if(!inp || !inp.value) return;
      if(document.activeElement === inp) return;
      applyBanwordToInput(inp, FIELD_MAP[id], {});
    });
    if(typeof global.broadcastText === 'function') global.broadcastText();
  }

  global.bnRunAllFields = function(){
    if(global.banwordEngine){
      runAllFieldsOnce();
      return;
    }
    var tries = 0;
    var timer = setInterval(function(){
      tries++;
      if(global.banwordEngine){
        clearInterval(timer);
        runAllFieldsOnce();
      } else if(tries >= 30){
        clearInterval(timer);
      }
    }, 200);
  };

  function showInputMenu(e, inp, cfg){
    var existing = document.getElementById('_bn_input_ctx');
    if(existing) existing.remove();

    var menu = document.createElement('div');
    menu.id = '_bn_input_ctx';
    menu.style.cssText=[
      'position:fixed;z-index:99999;',
      'background:#1a1d2a;border:1px solid #2e3347;',
      'border-radius:10px;padding:6px 0;',
      'box-shadow:0 8px 24px rgba(0,0,0,.5);min-width:200px;font-size:13px;',
    ].join('');

    var isBothExempt = inp.dataset.dollarExempt && inp.dataset.thousandsExempt === '1' && inp.dataset.numeralExempt === '1';

    [
      { label: isBothExempt ? '✓ 已豁免（點擊取消）' : '暫時不加$符號與千分位符號、不強制變阿拉伯數字', action:'both' },
      { label: '重新檢查禁用語', action:'check' },
    ].forEach(function(item){
      var btn = document.createElement('div');
      btn.textContent = item.label;
      btn.style.cssText = 'padding:8px 16px;cursor:pointer;color:#dde3f0;white-space:nowrap;';
      btn.addEventListener('mouseenter', function(){ btn.style.background='#2b2f42'; });
      btn.addEventListener('mouseleave', function(){ btn.style.background=''; });
      btn.addEventListener('click', function(){
        menu.remove();
        if(item.action === 'both'){
          if(isBothExempt){
            inp.dataset.dollarExempt = '';
            inp.dataset.thousandsExempt = '';
            inp.dataset.numeralExempt = '';
          } else {
            var pos = [];
            for(var i=0;i<inp.value.length;i++){ if(inp.value[i]==='$') pos.push(i); }
            inp.dataset.dollarExempt = JSON.stringify(pos);
            inp.dataset.thousandsExempt = '1';
            inp.dataset.numeralExempt = '1';
          }
          /* 同步到畫布：畫布上編輯文字時會把自己的旗標回傳給父層，
             不同步的話，之後在畫布上動一下文字就會把這裡的豁免洗掉。 */
          broadcastNumeralExempt(fieldCfg2Class(cfg), inp.dataset.numeralExempt === '1');
        } else if(item.action === 'check'){
          applyBanwordToInput(inp, cfg, {});
        }
      });
      menu.appendChild(btn);
    });

    menu.style.left = Math.min(e.clientX, window.innerWidth-220)+'px';
    menu.style.top  = Math.min(e.clientY, window.innerHeight-100)+'px';
    document.body.appendChild(menu);
    setTimeout(function(){
      document.addEventListener('click', function rm(){ menu.remove(); document.removeEventListener('click',rm); });
    }, 10);
  }

  /* ── banwords.xlsx 載入（含 fallback 手動選取，同 sba.html） ── */
  function ensureExcelPicker(){
    var wrap = document.getElementById('_bn_excelManualLoader');
    if(wrap) return wrap;
    wrap = document.createElement('div');
    wrap.id = '_bn_excelManualLoader';
    wrap.style.cssText=[
      'position:fixed;right:20px;bottom:90px;z-index:100002;',
      'background:rgba(220,38,38,.96);color:#fff;',
      'padding:12px 14px;border-radius:12px;',
      'box-shadow:0 8px 24px rgba(0,0,0,.28);',
      'font-size:13px;line-height:1.5;max-width:320px;display:none;',
    ].join('');
    wrap.innerHTML=[
      '<div style="font-weight:700;margin-bottom:6px;">讀取 banwords.xlsx 失敗</div>',
      '<div style="margin-bottom:8px;">請手動選取同層的「banwords.xlsx」</div>',
      '<button id="_bn_excelManualBtn" style="border:0;background:#fff;color:#111;padding:6px 10px;border-radius:8px;cursor:pointer;">手動選取 banwords.xlsx</button>',
      '<input type="file" id="_bn_excelManualInput" accept=".xlsx" style="display:none">',
    ].join('');
    document.body.appendChild(wrap);

    wrap.querySelector('#_bn_excelManualBtn').addEventListener('click', function(){
      wrap.querySelector('#_bn_excelManualInput').click();
    });
    wrap.querySelector('#_bn_excelManualInput').addEventListener('change', function(e){
      var file = e.target.files && e.target.files[0];
      if(!file) return;
      file.arrayBuffer().then(function(buf){
        var rules = global.banwordEngine.loadRulesFromExcelArrayBuffer(buf);
        showToast('已手動載入 banwords.xlsx（'+( Array.isArray(rules)?rules.length:0 )+'條）','ok',2200);
        wrap.style.display = 'none';
        bridgeInputs();
      }).catch(function(err){
        showToast('手動載入失敗：'+err.message,'err',2200);
      });
    });
    return wrap;
  }

  function loadBanwordsExcel(){
    if(!global.banwordEngine) return;
    /* 先確保 SheetJS (XLSX) 已載入 */
    function doFetch(){
      fetch('banwords.xlsx', {cache:'no-store'})
      .then(function(r){
        if(!r.ok) throw new Error('HTTP '+r.status);
        return r.arrayBuffer();
      })
      .then(function(buf){
        var rules = global.banwordEngine.loadRulesFromExcelArrayBuffer(buf);
        console.log('[BNState] banwords loaded:', Array.isArray(rules)?rules.length:0, '條');
        bridgeInputs();
      })
      .catch(function(err){
        console.warn('[BNState] banwords.xlsx 載入失敗', err);
        ensureExcelPicker().style.display = 'block';
        bridgeInputs();
      });
    }
    if(global.XLSX){
      doFetch();
    } else {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js';
      s.onload = doFetch;
      s.onerror = function(){
        console.warn('[BNState] SheetJS CDN 載入失敗，嘗試本機...');
        doFetch(); /* 試試看，可能已有其他方式載入 */
      };
      document.head.appendChild(s);
    }
  }

  function initBanwords(){
    /* 強制載入最新 banwords engine，避免瀏覽器沿用舊快取，造成修正後看起來仍沒生效。 */
    loadScript('js/banwords-engine-hbn.js?t=' + Date.now(), function(){
      loadBanwordsExcel();
    });
  }

  function clone(obj){
    try{ return JSON.parse(JSON.stringify(obj)); }
    catch(_){ return obj; }
  }

  /* 數字版位 id 只在目前瀏覽器的 bn-layouts 內有效；跨電腦、無痕模式、
     清除網站資料或更換 origin 後都可能改變。暫存檔因此另外以版型檔名保存
     一份可攜式索引，匯入時再映射到目前環境的 id。 */
  function normalizeLayoutFile(file){
    var value = String(file || '').trim().replace(/\\/g, '/');
    try{ value = decodeURIComponent(value); }catch(_){ }
    value = value.split('?')[0].split('#')[0].replace(/^.*\//, '');
    return value.toLowerCase();
  }

  function getLayoutIndex(){
    var byId = {}, byFile = {}, list = [];
    var layouts = typeof global.loadLayouts === 'function' ? (global.loadLayouts() || []) : [];
    layouts.forEach(function(layout){
      if(!layout) return;
      var id = String(layout.id);
      var file = normalizeLayoutFile(layout.file || layout.name);
      if(!id || !file) return;
      byId[id] = file;
      byFile[file] = id;
      list.push({id:id, file:file, name:String(layout.name || '')});
    });
    return {byId:byId, byFile:byFile, list:list};
  }

  function idMapToFileMap(values, index){
    var out = {};
    if(!values || typeof values !== 'object') return out;
    index = index || getLayoutIndex();
    Object.keys(values).forEach(function(id){
      var file = index.byId[String(id)];
      if(file) out[file] = clone(values[id]);
    });
    return out;
  }

  function mergeFileMapIntoIdMap(legacyValues, portableValues, index, savedManifest){
    var out = legacyValues && typeof legacyValues === 'object' ? clone(legacyValues) : {};
    index = index || getLayoutIndex();
    /* 新格式也保留舊 id map；利用下載當時的 manifest，先把舊 id 的資料
       搬到目前 id。這讓 portable map 可只存小型設定，不必複製背景 dataURL。 */
    if(Array.isArray(savedManifest)){
      savedManifest.forEach(function(saved){
        if(!saved) return;
        var oldId = String(saved.id);
        var currentId = index.byFile[normalizeLayoutFile(saved.file || saved.name)];
        if(currentId && Object.prototype.hasOwnProperty.call(out, oldId)){
          out[currentId] = clone(out[oldId]);
        }
      });
    }
    if(!portableValues || typeof portableValues !== 'object') return out;
    Object.keys(portableValues).forEach(function(file){
      var id = index.byFile[normalizeLayoutFile(file)];
      if(!id) return;
      var portableValue = clone(portableValues[file]);
      if(out[id] && portableValue && typeof out[id] === 'object' && typeof portableValue === 'object' &&
          !Array.isArray(out[id]) && !Array.isArray(portableValue)){
        out[id] = Object.assign({}, out[id], portableValue);
      }else{
        out[id] = portableValue;
      }
    });
    return out;
  }

  function addPortableLayouts(entity, index){
    if(!entity) return entity;
    var out = clone(entity);
    out.layoutsByFile = idMapToFileMap(out.layouts || {}, index);
    return out;
  }

  function restorePortableLayouts(entity, index, savedManifest){
    if(!entity) return entity;
    var out = clone(entity);
    out.layouts = mergeFileMapIntoIdMap(out.layouts, out.layoutsByFile, index, savedManifest);
    return out;
  }

  function isHexColor(v){
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim());
  }
  var BN_DEFAULT_CANVAS_BG = '#6bc0ec';
  function isDefaultCanvasBg(v){ return isHexColor(v) && String(v).toLowerCase() === BN_DEFAULT_CANVAS_BG; }
  function isUserCanvasBg(v){ return isHexColor(v) && (global._bnUserCanvasBgLocked || !isDefaultCanvasBg(v)); }

  function getLockedCanvasBg(){
    /* 以目前父層實際 colorState 為最高優先，避免 ZIP 匯出期間舊暫存/預設藍回灌。 */
    if(global.colorState && isUserCanvasBg(global.colorState.canvasBg)) return global.colorState.canvasBg;
    if(isUserCanvasBg(global._bnCanvasBgHardLock)) return global._bnCanvasBgHardLock;
    if(isUserCanvasBg(global._bnPersistentCanvasBg)) return global._bnPersistentCanvasBg;
    if(global._bnFrozenColorData && isUserCanvasBg(global._bnFrozenColorData.canvasBg)) return global._bnFrozenColorData.canvasBg;
    if((global._bnBgColorExportGuardUntil && Date.now() < global._bnBgColorExportGuardUntil) && global._bnLastUserColorState && isUserCanvasBg(global._bnLastUserColorState.canvasBg)) return global._bnLastUserColorState.canvasBg;
    return null;
  }

  function applyLockedCanvasBg(colors){
    var locked = getLockedCanvasBg();
    if(locked){
      colors = colors || {};
      colors.canvasBg = locked;
      global._bnPersistentCanvasBg = locked;
      global._bnCanvasBgHardLock = locked;
      global._bnUserCanvasBgLocked = true;
      if(global.colorState) global.colorState.canvasBg = locked;
    }
    return colors;
  }

  function collectColors(){
    var colors = {};
    /* 舊快照只當備援；目前畫面上的 colorState 才是下載暫存的權威來源。
       ZIP 匯出會先建立 frozen snapshot，獨立「下載暫存」則不會，舊邏輯
       優先讀 _bnLastUserColorState，才會讓兩條下載流程產生不同的字色。 */
    if(global._bnLastUserColorState) Object.assign(colors, clone(global._bnLastUserColorState));
    if(typeof global.getColorData === 'function'){
      try{ Object.assign(colors, clone(global.getColorData())); }catch(_){ }
    }
    if(global.colorState) Object.assign(colors, clone(global.colorState));
    if(typeof global.bnSanitizeRestrictedColorData === 'function'){
      colors = global.bnSanitizeRestrictedColorData(colors);
    }
    return applyLockedCanvasBg(colors);
  }

  function markDirty(){
    try{ document.dispatchEvent(new CustomEvent('bn-state-dirty')); }catch(_){ }
  }

  function collectInputMeta(){
    var out = {};
    ['txt-brand','txt-main','txt-sub','txt-date'].forEach(function(id){
      var el = document.getElementById(id);
      if(!el) return;
      out[id] = {
        value: el.value || '',
        dollarExempt: el.dataset.dollarExempt || '',
        thousandsExempt: el.dataset.thousandsExempt || '',
        numeralExempt: el.dataset.numeralExempt || ''
      };
    });
    return out;
  }

  function applyInputMeta(meta){
    if(!meta || typeof meta !== 'object') return;
    Object.keys(meta).forEach(function(id){
      var el = document.getElementById(id);
      var m = meta[id] || {};
      if(!el) return;
      if(m.value !== undefined){ el.value = m.value; el.dispatchEvent(new Event('input',{bubbles:true})); }
      el.dataset.dollarExempt = m.dollarExempt || '';
      el.dataset.thousandsExempt = m.thousandsExempt || '';
      el.dataset.numeralExempt = m.numeralExempt || '';
    });
  }

  function collectToolbarState(){
    var sidebar = document.getElementById('sidebar');
    var scroll = document.getElementById('sidebar-scroll');
    var state = { controls:{}, panels:{}, scrollTop: scroll ? scroll.scrollTop : 0 };
    if(!sidebar) return state;

    sidebar.querySelectorAll('input,select,textarea').forEach(function(el, idx){
      if(!el.id && !el.name) return;
      if(el.type === 'file') return;
      var key = el.id || el.name || ('control_'+idx);
      /* cp-hex-input / cp-native 是色盤面板的暫時輸入值，真正顏色已存在 state.colors。
         若把它們也存入 toolbar 並在載入時 dispatch input/change，
         會用舊色盤值覆蓋 colorState.canvasBg，造成背景色跳回預設藍。 */
      if(key === 'cp-hex-input' || key === 'cp-native') return;
      var v;
      if(el.type === 'checkbox' || el.type === 'radio') v = !!el.checked;
      else v = el.value;
      state.controls[key] = { tag:el.tagName, type:el.type || '', value:v };
    });

    var cp = document.getElementById('cp-panel');
    if(cp){
      state.panels.colorPicker = {
        activeKey: global.cpActiveKey || null,
        open: cp.classList.contains('open'),
        left: cp.style.left || '',
        top: cp.style.top || ''
      };
    }
    state.previewMax = global.PREVIEW_MAX;
    return state;
  }

  function applyToolbarState(state){
    if(!state || typeof state !== 'object') return;
    var controls = state.controls || {};
    Object.keys(controls).forEach(function(key){
      var el = document.getElementById(key) || document.querySelector('[name="'+String(key).replace(/"/g,'\\"')+'"]');
      if(!el || el.type === 'file') return;
      if(key === 'cp-hex-input' || key === 'cp-native') return;
      var item = controls[key] || {};
      if(el.type === 'checkbox' || el.type === 'radio') el.checked = !!item.value;
      else if(item.value !== undefined) el.value = item.value;
      try{ el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }catch(_){ }
    });
    if(state.scrollTop !== undefined){
      var scroll = document.getElementById('sidebar-scroll');
      if(scroll) setTimeout(function(){ scroll.scrollTop = state.scrollTop || 0; }, 80);
    }
    if(state.panels && state.panels.colorPicker){
      var cp = document.getElementById('cp-panel');
      if(cp){
        cp.style.left = state.panels.colorPicker.left || cp.style.left;
        cp.style.top = state.panels.colorPicker.top || cp.style.top;
        cp.classList.toggle('open', !!state.panels.colorPicker.open);
      }
      if(state.panels.colorPicker.activeKey !== undefined) global.cpActiveKey = state.panels.colorPicker.activeKey;
    }
    if(state.previewMax !== undefined) global.PREVIEW_MAX = state.previewMax;
  }

  /* ══════════════════════════════════════
     2. 本機暫存
  ══════════════════════════════════════ */
  function collectState(){
    var layoutIndex = getLayoutIndex();
    var bgStates = typeof global._bnGetBgStates==='function' ? global._bnGetBgStates() : {};
    var activeBgId = typeof global._bnGetBgActiveId==='function' ? global._bnGetBgActiveId() : null;
    var checkedState = global.loadChecked ? global.loadChecked() : {};
    var checkedByFileState = typeof global.loadCheckedByFile === 'function'
      ? global.loadCheckedByFile() : idMapToFileMap(checkedState, layoutIndex);
    var bgStatesByFile = idMapToFileMap(bgStates, layoutIndex);
    Object.keys(bgStatesByFile).forEach(function(file){
      /* 圖片本體已存在 background.states；可攜索引只需保存位置參數。 */
      if(bgStatesByFile[file]) delete bgStatesByFile[file].src;
    });
    return {
      version: 1,
      portableVersion: 1,
      /* 勾選結果與版位入口的版本同步；舊本機暫存仍可還原其他編輯內容，
         但不再把舊版的 checked 狀態覆蓋回目前頁面。 */
      selectionVersion: global.BN_LAYOUT_SELECTION_VERSION || '',
      ts: Date.now(),
      layoutManifest: clone(layoutIndex.list),
      texts:{
        brand:(document.getElementById('txt-brand')||{}).value||'',
        main: (document.getElementById('txt-main') ||{}).value||'',
        sub:  (document.getElementById('txt-sub')  ||{}).value||'',
        date: (document.getElementById('txt-date') ||{}).value||'',
        icon: (document.getElementById('txt-icon') ||{}).value||'',
      },
      colors: collectColors(),
      inputMeta: collectInputMeta(),
      logos: (global._bnLogos||[]).map(function(l){ return clone(l); }),
      logoLayouts: clone(global._bnLogoLayouts || {}),
      logoLayoutsByFile: idMapToFileMap(global._bnLogoLayouts || {}, layoutIndex),
      character: addPortableLayouts(global._bnCharacter, layoutIndex),
      character2: addPortableLayouts(global._bnCharacter2, layoutIndex),
      charPairFirst: global._bnCharPairFirst || null,
      products:(global._bnProducts||[]).map(function(p){
        return addPortableLayouts({id:p.id,src:p.src,baseSrc:p.baseSrc,ratio:p.ratio,name:p.name,
          sizeScale:p.sizeScale||1,position:p.position||0,zOrder:p.zOrder||0,
          width:p.width, height:p.height, x:p.x, y:p.y, scale:p.scale, rotate:p.rotate,
          layout:p.layout ? clone(p.layout) : undefined,
          layouts:p.layouts ? clone(p.layouts) : undefined,
          crop:p.crop ? clone(p.crop) : undefined, meta:p.meta ? clone(p.meta) : undefined}, layoutIndex);
      }),
      background:{
        activeId: activeBgId,
        activeFile: activeBgId !== null && activeBgId !== undefined ? (layoutIndex.byId[String(activeBgId)] || null) : null,
        states: bgStates,
        statesByFile: bgStatesByFile,
        legacySrc: global._bgDataUrl || null
      },
      toolbar: collectToolbarState(),
      layouts: typeof global.getLayoutState==='function' ? clone(global.getLayoutState()) : null,
      bgCheckers: typeof global.getBgCheckerState==='function' ? clone(global.getBgCheckerState()) : [],
      checked: checkedState,
      checkedByFile: checkedByFileState,
    };
  }

  function hasRealDataUrl(v){
    return typeof v === 'string' && v && v !== '__BN_IDB__';
  }

  function stateHasHeavyPlaceholders(state){
    if(!state) return false;
    if(state._heavyStripped) return true;
    if(state.character && state.character.src === '__BN_IDB__') return true;
    if(state.character2 && state.character2.src === '__BN_IDB__') return true;
    var bg = state.background || {};
    if(bg.legacySrc === '__BN_IDB__') return true;
    var st = bg.states || {};
    return Object.keys(st).some(function(id){ return st[id] && st[id].src === '__BN_IDB__'; });
  }

  function applyState(state, options){
    if(!state||state.version!==1) return;
    options = options || {};
    var explicitUpload = options.source === 'upload' || options.forceColors === true;
    var layoutIndex = getLayoutIndex();
    global._bnStateApplying = true;
    var heavyStripped = stateHasHeavyPlaceholders(state);
    global._bnLogoLayouts = mergeFileMapIntoIdMap(
      state.logoLayouts || {}, state.logoLayoutsByFile || {}, layoutIndex, state.layoutManifest
    );
    if(state.texts){
      ['brand','main','sub','date','icon'].forEach(function(k){
        var el=document.getElementById('txt-'+k);
        if(el&&state.texts[k]!==undefined){ el.value=state.texts[k]; el.dispatchEvent(new Event('input',{bubbles:true})); }
      });
    }
    if(state.colors&&global.colorState){
      var nextColors = clone(state.colors);
      /* ZIP 匯出或剛匯出後，若舊暫存帶預設藍進來，不可覆蓋使用者目前吸色後的背景色。 */
      var guardActive = global._bnFrozenColorData || (global._bnBgColorExportGuardUntil && Date.now() < global._bnBgColorExportGuardUntil);
      if(!explicitUpload && guardActive && global._bnLastUserColorState){
        nextColors = Object.assign(nextColors, clone(global._bnLastUserColorState));
      }
      if(explicitUpload){
        /* 明確上傳的暫存檔必須完整還原自己的顏色，不可被目前頁面剛好仍在
           作用中的 ZIP／背景色 guard 覆蓋。 */
        delete global._bnFrozenColorData;
        global._bnBgColorExportGuardUntil = 0;
        if(isHexColor(nextColors.canvasBg)){
          if(typeof global._bnSetAuthoritativeCanvasBg === 'function'){
            try{ global._bnSetAuthoritativeCanvasBg(nextColors.canvasBg); }catch(_){ }
          }else{
            global._bnCanvasBgHardLock = nextColors.canvasBg;
            global._bnPersistentCanvasBg = nextColors.canvasBg;
            global._bnUserCanvasBgLocked = true;
          }
        }
      }else{
        nextColors = applyLockedCanvasBg(nextColors);
      }
      if(typeof global.bnSanitizeRestrictedColorData==='function'){
        nextColors = global.bnSanitizeRestrictedColorData(nextColors);
      }
      Object.assign(global.colorState,nextColors);
      if(typeof global.bnFixEatenColors==='function'){
        try{ global.bnFixEatenColors(global.colorState); }catch(_){ }
      }
      /* 回灌後再套一次頁面層級的共用規則（例如與 BODA 共用的 CTA 底色），
         避免舊暫存把跨頁一致的設定蓋掉。 */
      if(typeof global._bnNormalizeColorStateRules==='function'){
        try{ global._bnNormalizeColorStateRules(); }catch(_){ }
      }
      global._bnLastUserColorState = clone(global.colorState);
      if(typeof global.renderColorPickers==='function') global.renderColorPickers();
      if(typeof global.broadcastColors==='function') global.broadcastColors();
    }
    applyInputMeta(state.inputMeta);
    if(state.logos&&Array.isArray(state.logos)){
      if(!heavyStripped || state.logos.some(function(l){ return l && hasRealDataUrl(l.src); })){
        global._bnLogos=state.logos.filter(function(l){ return !l || l.src !== '__BN_IDB__'; });
        global._bnLogoDataUrl=global._bnLogos.length?global._bnLogos[0].src:null;
        if(typeof global._bnRenderLogoList==='function') global._bnRenderLogoList();
        if(typeof global._bnBroadcastLogos==='function') global._bnBroadcastLogos();
      }
    }
    if(state.products&&Array.isArray(state.products)){
      if(!heavyStripped || state.products.some(function(p){ return p && hasRealDataUrl(p.src); })){
        global._bnProducts=state.products
          .filter(function(p){ return !p || p.src !== '__BN_IDB__'; })
          .map(function(p){ return restorePortableLayouts(p, layoutIndex, state.layoutManifest); });
        if(typeof global._bnRenderProdList==='function') global._bnRenderProdList();
        if(typeof global._bnRebroadcastProducts==='function') global._bnRebroadcastProducts();
        if(typeof global._bnRequestProductLayouts==='function'){
          [500, 1200, 2200].forEach(function(delay){ setTimeout(global._bnRequestProductLayouts, delay); });
        }
      }
    }
    if('character' in state || 'character2' in state){
      /* character 為 null 代表使用者存檔時沒有人物圖，允許還原成「移除」；
         但若這份 state 是被 strip 過的輕量版且人物圖是佔位符，就不要拿它把真正的人物圖蓋掉。
         人物1、人物2 各自獨立判斷，其中一個是佔位符不影響另一個正常還原。 */
      if('character' in state){
        var charPlaceholder = state.character && state.character.src === '__BN_IDB__';
        if(!charPlaceholder) global._bnCharacter = state.character ? restorePortableLayouts(state.character, layoutIndex, state.layoutManifest) : null;
      }
      if('character2' in state){
        var char2Placeholder = state.character2 && state.character2.src === '__BN_IDB__';
        if(!char2Placeholder) global._bnCharacter2 = state.character2 ? restorePortableLayouts(state.character2, layoutIndex, state.layoutManifest) : null;
      }
      if('charPairFirst' in state && state.charPairFirst){
        global._bnCharPairFirst = state.charPairFirst;
      }
      if(typeof global._bnRenderCharacter==='function') global._bnRenderCharacter();
      if(typeof global._bnBroadcastCharacter==='function') global._bnBroadcastCharacter();
    }
    if(state.layouts && typeof global.setLayoutState==='function'){
      global.setLayoutState(state.layouts);
    }
    var selectionVersion = global.BN_LAYOUT_SELECTION_VERSION || '';
    var canRestoreSelection = explicitUpload ||
      (selectionVersion && state.selectionVersion === selectionVersion);
    if((state.checked || state.checkedByFile) && typeof global.saveChecked==='function' && canRestoreSelection){
      if(state.checkedByFile && typeof global.saveCheckedByFile === 'function'){
        global.saveCheckedByFile(state.checkedByFile);
      }
      var restoredChecked = mergeFileMapIntoIdMap(state.checked || {}, state.checkedByFile || {}, layoutIndex, state.layoutManifest);
      global.saveChecked(restoredChecked);
      if(typeof global.renderChecks==='function') global.renderChecks();
      /* _bnExporting 期間不重建 iframe，避免下載時畫布被清空並閃回預設顏色 */
      if(typeof global.renderPreviews==='function' && !global._bnExporting) global.renderPreviews();
    }
    if(state.bgCheckers && typeof global.setBgCheckerState==='function'){
      global.setBgCheckerState(state.bgCheckers);
    }
    if(state.background && !heavyStripped){
      if(hasRealDataUrl(state.background.legacySrc)) global._bgDataUrl = state.background.legacySrc;
      var restoredBgStates = mergeFileMapIntoIdMap(
        state.background.states || {}, state.background.statesByFile || {}, layoutIndex, state.layoutManifest
      );
      var restoredActiveId = state.background.activeId || null;
      if(state.background.activeFile){
        restoredActiveId = layoutIndex.byFile[normalizeLayoutFile(state.background.activeFile)] || restoredActiveId;
      }
      if(typeof global._bnSetBgStates==='function') global._bnSetBgStates(restoredBgStates, restoredActiveId);
      else if(hasRealDataUrl(state.background.legacySrc) && typeof global.broadcastBg==='function') global.broadcastBg(state.background.legacySrc);
    }
    applyToolbarState(state.toolbar);
    /* 暫存載入後再次刷新畫布背景，避免只更新左側預覽但 iframe 沒重繪。 */
    if(typeof global._bnRefreshCanvasBackgrounds==='function'){
      [0, 250, 700, 1500].forEach(function(delay){
        setTimeout(function(){ global._bnRefreshCanvasBackgrounds(); }, delay);
      });
    }
    setTimeout(function(){ global.bnRunAllFields(); }, 300);
    setTimeout(function(){ global._bnStateApplying = false; }, 1800);
  }

  function autoSave(){
    /* 清除暫存時禁止任何計時器／beforeunload 再把舊狀態寫回去。 */
    if(global._bnExporting || global._bnStateDownloading || global._bnClearingState) return;
    var state;
    try{ state = collectState(); }
    catch(e){ console.warn('[BNState] collectState 失敗', e); return; }

    /* 完整資料（含背景圖、商品圖、logo dataURL）優先寫入 IndexedDB。 */
    idbSetState(state).catch(function(e){
      console.warn('[BNState] IndexedDB autoSave 失敗，改嘗試 localStorage 完整備援', e);
      try{ localStorage.setItem(STORAGE_KEY + '_full', JSON.stringify(state)); }
      catch(err){ console.warn('[BNState] localStorage full autoSave 也失敗，可能圖片太大', err); }
    });

    /* localStorage 只放輕量摘要供文字/工具列備援；帶 _heavyStripped，載入時不會拿它清掉背景/商品/logo。 */
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(stripHeavyStateForLocalStorage(state))); }
    catch(e){ console.warn('[BNState] localStorage light autoSave 失敗',e); }
  }

  function autoLoad(){
    var localFull = readLocalState(STORAGE_KEY + '_full');
    var localLight = readLocalState(STORAGE_KEY);

    idbGetState().then(function(idbState){
      /* 不能盲目用 IndexedDB：若上一輪 IDB 寫入失敗或落後，會讀到更舊的商品位置。
         這裡改成在 IDB / localStorage full 之間取 ts 最新的完整 state；
         只有沒有完整 state 時，才使用輕量備援，避免舊資料蓋掉新畫面。 */
      var full = getNewestState([idbState, localFull], true);
      if(full){
        full = mergeLightIntoFull(full, localLight);
        applyState(full);
        console.log('[BNState] 完整本機暫存載入完成，來源時間:', new Date(full.ts || Date.now()).toLocaleString());
        return;
      }
      if(localLight){
        applyState(localLight);
        console.log('[BNState] 輕量本機暫存載入完成，來源時間:', new Date(localLight.ts || Date.now()).toLocaleString());
      }
    }).catch(function(e){
      console.warn('[BNState] IndexedDB autoLoad 失敗，改用 localStorage', e);
      var full = getNewestState([localFull], true);
      if(full){ applyState(mergeLightIntoFull(full, localLight)); return; }
      if(localLight) applyState(localLight);
    });
  }

  function startAutoSave(){
    setInterval(autoSave,30000);
    window.addEventListener('beforeunload',autoSave);
    function queueSave(e){
      /* bn-state-dirty 可能從 document 或 iframe message 流程發出，target 不會在 #sidebar。
         舊邏輯只接受 sidebar 事件，導致商品拖曳/縮放、背景畫布設定等不會寫入本機暫存，刷新後就回到舊資料。 */
      var isDirtyEvent = e && e.type === 'bn-state-dirty';
      var fromSidebar = !e || (e.target && e.target.closest && e.target.closest('#sidebar'));
      if(global._bnExporting || global._bnStateDownloading || global._bnStateApplying || global._bnClearingState) return;
      if(isDirtyEvent || fromSidebar){
        clearTimeout(global._bnSaveTimer);
        global._bnSaveTimer=setTimeout(autoSave, isDirtyEvent ? 250 : 1500);
      }
    }
    document.addEventListener('input',queueSave,true);
    document.addEventListener('change',queueSave,true);
    document.addEventListener('bn-state-dirty',queueSave,true);
  }

  /* ══════════════════════════════════════
     3. 下載 / 上傳 暫存按鈕
  ══════════════════════════════════════ */
  function insertSaveLoadBar(){
    var sidebar=document.getElementById('sidebar');
    if(!sidebar||document.getElementById('_bn_save_bar')) return;

    var bar=document.createElement('div');
    bar.id='_bn_save_bar';
    bar.style.cssText='padding:8px 14px;border-top:1px solid var(--border,#30363d);display:flex;gap:6px;flex-shrink:0;';

    var bs='flex:1;padding:7px 6px;background:var(--bg2,#1c2333);border:1px solid var(--border,#30363d);border-radius:7px;color:var(--text2,#8b949e);font-size:11px;cursor:pointer;transition:.12s;text-align:center;';

    var dlBtn=document.createElement('button');
    dlBtn.type='button';
    dlBtn.textContent='⬇ 下載暫存'; dlBtn.style.cssText=bs;
    function downloadStateJson(ev){
      if(ev){
        ev.preventDefault();
        ev.stopPropagation();
        if(ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      }
      /*
       * 先以只讀快照訊息取得每個 iframe 的最後位置；這不會 applyState、
       * renderPreviews 或重建商品 DOM，因此畫布不會清空。
       */
      global._bnStateDownloading = true;
      var syncPromise = typeof global._bnSyncLayoutSnapshot === 'function'
        ? global._bnSyncLayoutSnapshot(900)
        : Promise.resolve();
      Promise.resolve(syncPromise).then(function(){
        var snapshot;
        try{
          snapshot = collectState();
        }catch(error){
          global._bnStateDownloading = false;
          showToast('暫存下載失敗，請稍後再試','err');
          console.warn('[BNState] download collectState 失敗', error);
          return;
        }
        /* 下載 JSON 不做任何全域重建/還原/刷新，也不寫 localStorage。 */
        var blob = new Blob([JSON.stringify(snapshot,null,2)], {type:'application/json'});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'bn-state-' + new Date().toISOString().slice(0,16).replace('T','_') + '.json';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function(){
          URL.revokeObjectURL(url);
          if(a.parentNode) a.parentNode.removeChild(a);
          global._bnStateDownloading = false;
        }, 1000);
        showToast('暫存已下載','ok');
      }).catch(function(error){
        global._bnStateDownloading = false;
        showToast('暫存下載失敗，請稍後再試','err');
        console.warn('[BNState] download layout sync 失敗', error);
      });
      return false;
    }
    dlBtn.addEventListener('mousedown', function(ev){ ev.stopPropagation(); }, true);
    dlBtn.addEventListener('click', downloadStateJson, true);

    var ulWrap=document.createElement('label');
    ulWrap.style.cssText=bs+'cursor:pointer;display:block;';
    ulWrap.textContent='⬆ 上傳暫存';
    var ulInp=document.createElement('input');
    ulInp.type='file'; ulInp.accept='.json'; ulInp.style.display='none';
    ulInp.addEventListener('change',function(){
      var file=this.files[0]; if(!file) return;
      var reader=new FileReader();
      reader.onload=function(e){
        try{
          var uploadedState = JSON.parse(e.target.result);
          if(!uploadedState || uploadedState.version !== 1){
            throw new Error('不是有效的 BN 暫存檔');
          }
          applyState(uploadedState, {source:'upload', forceColors:true});
          /* applyState 會重建/推送 iframe，等它穩定後再寫本機暫存；
             避免剛套用一半的輕量狀態把完整背景/商品覆蓋掉。 */
          setTimeout(autoSave, 2300);
          setTimeout(markDirty, 2400);
          showToast('暫存已載入','ok');
        }catch(_){ showToast('暫存格式錯誤','err'); }
      };
      reader.onerror=function(){ showToast('暫存檔讀取失敗','err'); };
      reader.readAsText(file);
      ulInp.value='';
    });
    ulWrap.appendChild(ulInp);

    /* 清除本機暫存按鈕 */
    var clrBar=document.createElement('div');
    clrBar.style.cssText='display:block;padding:0 14px 10px;flex-shrink:0;';
    var clrBtn=document.createElement('button');
    clrBtn.type='button';
    clrBtn.textContent='🗑 清除本機暫存';
    clrBtn.style.cssText='width:100%;padding:7px 6px;background:transparent;border:1px solid var(--border,#30363d);border-radius:7px;color:#ef4444;font-size:11px;cursor:pointer;transition:.12s;text-align:center;';
    clrBtn.addEventListener('mouseenter',function(){ clrBtn.style.background='rgba(239,68,68,.08)'; });
    clrBtn.addEventListener('mouseleave',function(){ clrBtn.style.background='transparent'; });
    clrBtn.addEventListener('click',function(){
      if(!confirm('確定要清除本機暫存？頁面將重新整理，畫面會回到預設值。')) return;
      /* 先鎖住所有自動暫存，避免清除後在 reload 前又把舊資料寫回去。 */
      global._bnClearingState = true;
      clearTimeout(global._bnSaveTimer);
      try{
        /* 1. 清除 localStorage + IndexedDB 完整暫存
           ────────────────────────────────────────────────
           重要：'bn-layouts' 這個鍵值絕對不能清掉！它存的是「版位清單設定」
           （每個版位對應的 id / 檔名），不是使用者的編輯進度。
           商品、人物、每個版位的背景設定，全部都是用這個 id 當 key 存起來的
           （例如 products[].layouts = {"這個id": {left,top,width,height}}）。

           之前這裡沒有排除 'bn-layouts'，一旦清掉，頁面重新整理時會自動
           重新掃描版位清單（scanLayouts() 在頁面載入時一定會執行一次），
           因為對照不到舊的清單，所有版位都會拿到全新產生的 id
           （用當下的時間戳記重新產生，一定跟清除前不一樣）。
           這樣一來，不管使用者上傳哪一份暫存檔，裡面商品/人物/背景的位置
           資料全部都是用清除前的舊 id 存的，跟清除後畫面上全新的 id
           完全對不起來，等於整份暫存檔的位置資料都變成孤兒資料、
           完全沒有作用，畫面只能整個退回預設位置——這正是「上傳暫存檔
           沒辦法 100% 還原商品/人物/背景位置」的根本原因，不是上傳
           流程的優先權不夠高，是清除這個動作本身，把「位置資料要對照
           的那把鑰匙（id）」也一起清掉了。
           這裡明確排除 'bn-layouts'，只清除使用者的編輯狀態，
           版位清單設定維持不變，id 不會因為清除暫存而改變。

           這裡也要清掉 BODA 共用的文字／背景色鍵值；它們不以 bn 開頭，
           若不清除，頁面 reload 後仍會把舊文案或舊背景色重新套回來。 */
        var preservedLayoutKey = 'bn-layouts';
        var preservedExternalKeys = {};
        Object.keys(localStorage).forEach(function(k){
          var isBnState = k.indexOf('bn') === 0 && k !== preservedLayoutKey && !preservedExternalKeys[k];
          var isSharedBnInput = k === 'wo_shared_exposure_text_v1' || k === 'wo_shared_canvas_bg_v1';
          if(isBnState || isSharedBnInput){
            try{ localStorage.removeItem(k); }catch(_){ }
          }
        });

        /* 版位掛標／蝦皮 LOGO 的網址探測只存在 sessionStorage，
           不是編輯內容，但清除暫存時一併清掉，確保本分頁也是真正乾淨。 */
        try{
          Object.keys(sessionStorage).forEach(function(k){
            if(k.indexOf('bn') === 0) sessionStorage.removeItem(k);
          });
        }catch(_){ }

        /* 保留版位 id／檔名／尺寸／啟用狀態，僅清掉使用者勾選結果，
           讓畫面回到初次載入時的預設勾選規則。 */
        try{
          var rawLayouts = localStorage.getItem(preservedLayoutKey);
          if(rawLayouts){
            var savedLayouts = JSON.parse(rawLayouts);
            if(Array.isArray(savedLayouts)){
              savedLayouts.forEach(function(layout){
                if(layout && Object.prototype.hasOwnProperty.call(layout,'checked')) delete layout.checked;
              });
              localStorage.setItem(preservedLayoutKey, JSON.stringify(savedLayouts));
            }
          }
        }catch(_){ }

        Promise.resolve(idbClearState()).catch(function(e){ console.warn('[BNState] IndexedDB clear 失敗', e); })
          .then(function(){
            /* 一定要重新整理頁面才會真正回到預設值。
               之前這裡只清掉 localStorage/IndexedDB（儲存層），
               沒有重置「目前頁面正在執行中」的商品/人物/Logo/各版位背景
               這些記憶體內的狀態——這些變數分散在好幾支不同的檔案裡，
               不重新整理頁面的話，即使儲存的資料清掉了，畫面上看到的
               還是清除前那份還留在記憶體裡的舊資料，重新上傳背景圖之類的
               操作也會沿用那份舊資料，跟「清除、回到預設值」的預期不符。
               重新整理頁面才能保證是真正乾淨的初始狀態。 */
            location.reload();
          });

        /* 2. 文字輸入框還原預設 value，觸發 broadcastText
           （雖然馬上就會重新整理頁面，這裡先做一次是為了讓使用者在
           頁面重新整理前，也能立刻看到畫面有反應，而不是按下去像沒反應。）*/
        var defaults = {
          'txt-brand': '品牌名不放圖9字內',
          'txt-main':  '滿$200享9折',
          'txt-sub':   '副標$500起',
          'txt-date':  '5/18 - 5/25 期間限定',
          'txt-icon':  '文案',
          'txt-ar':    '最多六個字內'
        };
        Object.keys(defaults).forEach(function(id){
          var el = document.getElementById(id);
          if(el){ el.value = defaults[id]; el.dispatchEvent(new Event('input',{bubbles:true})); }
        });

        /* 3. 顏色還原預設 */
        if(global.colorState){
          /* 清除畫布色的權威鎖與匯出 guard，避免舊背景色在 reload 前又被套回。 */
          global._bnAuthoritativeCanvasBg = null;
          global._bnCanvasBgHardLock = null;
          global._bnPersistentCanvasBg = null;
          global._bnUserCanvasBgLocked = false;
          global._bnLastUserColorState = null;
          global._bnFrozenColorData = null;
          global._bnBgColorExportGuardUntil = 0;
          Object.assign(global.colorState, {
            mainText:'#2b79c4', subText:'#2540b5', dateText:'#2b79c4',
            brandText:'#2b79c4', canvasBg:'#6bc0ec', ctaText:'#ffffff', ctaTextAuto:true,
            ctaBgAuto:true, ctaBg:'#2540b5', searchImageCtaBg:'#2540b5',
            tagColor:'red', logoColor:'white'
          });
          /* 預設文字／CTA 色改由父層吃色邏輯依預設底色推算（舊的固定藍對預設底會吃色）。 */
          if(typeof global.applyAutoTextPalette==='function'){
            try{ global.applyAutoTextPalette('#6bc0ec','#6bc0ec'); }catch(_){ }
          }
          if(typeof global.renderColorPickers==='function') global.renderColorPickers();
          if(typeof global.broadcastColors==='function') global.broadcastColors();
        }

        if(typeof global.applyTagColor === 'function') global.applyTagColor('red');
        if(typeof global.applyLogoColor === 'function') global.applyLogoColor('white');

        showToast('已清除，頁面即將重新整理…','ok');
      }catch(e){ global._bnClearingState = false; showToast('清除失敗：'+e.message,'err'); }
    });
    clrBar.appendChild(clrBtn);

    bar.appendChild(dlBtn); bar.appendChild(ulWrap);
    var dlBar=document.getElementById('bn-download-bar');
    if(dlBar&&dlBar.nextSibling) sidebar.insertBefore(bar,dlBar.nextSibling);
    else sidebar.appendChild(bar);
    /* 清除按鈕加在暫存列下面 */
    if(bar.nextSibling) sidebar.insertBefore(clrBar,bar.nextSibling);
    else sidebar.appendChild(clrBar);
  }

  /* ══════════════════════════════════════
     初始化
  ══════════════════════════════════════ */
  ready(function(){
    global._bnStatePlugin = { save:autoSave, load:autoLoad, collect:collectState, apply:applyState, toast:showToast };

    /* banwords */
    initBanwords();

    /* 等 sidebar 出現 */
    function tryInsert(){
      if(document.getElementById('sidebar')){
        insertSaveLoadBar();
        setTimeout(autoLoad, 800);
        startAutoSave();
      } else { setTimeout(tryInsert,300); }
    }
    tryInsert();
  });

})(window);
