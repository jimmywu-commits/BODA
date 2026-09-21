/* ══════════════════════════════════════════════════════════════
   等級 × 版位詳情表外掛（boda-level-plugin.js）
   ──────────────────────────────────────────────────────────────
   1. 在左側「文字內容」上面加一個「等級」下拉，跟工單生成器連動
      （共用 localStorage 的 wo_level_v1；被 index.html 用 iframe 內嵌時
       再加 postMessage 即時互相通知，兩邊改都會同步）。
   2. 「排版選擇」依照同層的「BOD A曝光資源版位詳情表.xlsx」過濾。
   3. 這支是獨立外掛，整段刪掉就會回到原本的行為。
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var _scriptDir = (document.currentScript && document.currentScript.src || '').replace(/[^\/\\]*$/, '');

  var LEVELS = [
    { id: 'brand_star_mega',    label: 'A Brand star (Mega)' },
    { id: 'brand_star_mega_zj', label: 'A Brand star (Mega) 資交' },
    { id: 'select_pkg',         label: 'A 精選套裝' },
    { id: 'mdd',                label: 'A 品牌旗艦MDD' },
    { id: 'mdd_zj',             label: 'A 品牌旗艦MDD 資交' },
    { id: 'bod_a',              label: 'B+ BOD A' },
    { id: 'bod_a_zj',           label: 'B+ BOD A 資交' },
    { id: 'bod_b_mega',         label: 'B+ BOD B (Mega)' },
    { id: 'basic',              label: 'B+ 基礎套裝' },
    { id: 'jbp_multi',          label: 'B JBP多店' },
    { id: 'gold_mega',          label: 'B 金牌 (Mega)' }
  ];
  var LEVEL_KEY = 'wo_level_v1';
  var DEFAULT_LEVEL_ID = 'bod_a';
  var SHEET_FILE = 'BOD A曝光資源版位詳情表.xlsx';

  var SLOT_RULES = [
    { key: 'ddcard',      test: /^ddcard/i },
    { key: 'hbn',         test: /^HBN_/i },
    { key: 'amsbn',       test: /^AMS(?: BN)?/i },
    { key: 'ams',         test: /^AMS(?: BN)?/i },
    { key: '活動總覽',     test: /^活動總覽/i },
    { key: '首頁LOGO牆',   test: /^首頁\s*LOGO\s*牆/i },
    { key: 'ig',          test: /^IG/i },
    { key: 'coinpage',    test: /^Coin_page/i },
    { key: 'ar',         test: /^AR/i },
    { key: 'fbpost',      test: /^FB_POST/i },
    { key: 'searchicon',  test: /^SearchICON_/i },
    { key: 'searchimage', test: /^Search_Image/i },
    { key: 'lpbnapp',     test: /^LPBN_APP/i },
    { key: 'lpbnpc',      test: /^LPBN_PC/i },
    { key: 'lpbn',        test: /^LPBN_/i }
  ];
  function normKey(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[\s_\-　]/g, '').trim();
  }

  var currentLevelId = readLevel();
  var SHEET = null;
  var sheetError = '';

  function readLevel() {
    var v = null;
    try { v = localStorage.getItem(LEVEL_KEY); } catch (e) {}
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === v) return v;
    return DEFAULT_LEVEL_ID;
  }
  function levelLabel(id) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return LEVELS[i].label;
    for (var j = 0; j < LEVELS.length; j++) if (LEVELS[j].id === DEFAULT_LEVEL_ID) return LEVELS[j].label;
    return LEVELS[0].label;
  }

  /* ── 等級下拉：插在「文字內容」上面 ───────────────────── */
  function mountSelect() {
    var sel = document.getElementById('lv-select');
    if (!sel) return;
    sel.innerHTML = LEVELS.map(function (l) { return '<option value="' + l.id + '">' + l.label + '</option>'; }).join('');
    sel.value = currentLevelId;
    sel.addEventListener('change', function () {
      applyLevel(sel.value, true);
    });
  }

  function applyLevel(id, broadcast) {
    if (id && id !== currentLevelId) {
      userTouched = {};
      _logoVariantManualOverride = false;
    }
    if (id) currentLevelId = id;
    else currentLevelId = readLevel();
    try { localStorage.setItem(LEVEL_KEY, currentLevelId); } catch (e) {}
    var sel = document.getElementById('lv-select');
    if (sel && sel.value !== currentLevelId) sel.value = currentLevelId;
    if (broadcast && window.parent && window.parent !== window) {
      try { window.parent.postMessage({ type: 'wo-level', level: currentLevelId }, '*'); } catch (e) {}
    }
    paintNote();
    if (typeof window.renderChecks === 'function') window.renderChecks();
    if (typeof window.renderPreviews === 'function') window.renderPreviews();
  }
  window._bnApplyLevel = applyLevel;
  window._bnGetCurrentLevelId = function () { return currentLevelId; };

  function paintNote() {
    var note = document.getElementById('lv-note');
    if (!note) return;
    if (sheetError) { note.className = 'warn'; note.textContent = sheetError; return; }
    note.className = '';
    var conf = SHEET && SHEET[levelLabel(currentLevelId)];
    if (!conf) { note.textContent = '版位詳情表裡沒有這個等級，先顯示全部排版。'; return; }
    var msbnTxt = (conf.msbnMax == null) ? ''
      : (conf.msbnMax > 0 ? '　MSBN 可放 ' + conf.msbnMax + ' 顆。' : '　此等級不提供 MSBN。');
    var plan = planForLevel();
    var d = 0, o = 0;
    plan.rows.forEach(function (r) {
      if (!r.layout) return;
      if (r.def) d++; else o++;
    });
    if (!conf.order.length && !d && !o) {
      note.textContent = '此等級在版位詳情表裡沒有曝光資源版位。' + msbnTxt;
      return;
    }
    note.textContent = '此等級：預設 ' + d + ' 個版位、選配 ' + o + ' 個（選配要自己打勾）。' + msbnTxt;
  }

  var EMPTY_TEXT_DEFAULT = '請在左側勾選排版';
  var EMPTY_TEXT_NO_SLOT = '此等級無曝光資源編輯器';
  function paintEmptyText() {
    var el = document.getElementById('preview-empty-text');
    if (!el) return;
    var conf = SHEET && SHEET[levelLabel(currentLevelId)];
    var plan = planForLevel();
    el.textContent = (conf && !conf.order.length && !plan.rows.some(function (r) { return !!r.layout; }))
      ? EMPTY_TEXT_NO_SLOT : EMPTY_TEXT_DEFAULT;
  }

  /* ── 讀版位詳情表 ─────────────────────────────────── */
  function ensureXLSX(cb) {
    if (window.XLSX) { cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js';
    s.onload = function () { cb(); };
    s.onerror = function () { cb(new Error('SheetJS 載入失敗')); };
    document.head.appendChild(s);
  }

  function slotName(v) {
    var s = String(v == null ? '' : v).trim();
    return (s === '' || s === '無' || s === '-' || s === '無版位') ? '' : s;
  }

  function colMap(head) {
    var m = { name: 0, def: 1, opt: 2, msbn: -1, files: -1 };
    (head || []).forEach(function (h, i) {
      var t = String(h == null ? '' : h).replace(/\s/g, '');
      if (/下拉|等級|版位名稱/.test(t)) m.name = i;
      else if (/預設版位/.test(t)) m.def = i;
      else if (/打勾|選配/.test(t)) m.opt = i;
      else if (/MSBN/i.test(t)) m.msbn = i;
      else if (/檔名|排版/.test(t)) m.files = i;
    });
    return m;
  }

  function parseSheet(rows) {
    var out = {}, cur = null;
    var m = colMap(rows[0]);
    rows.forEach(function (r, i) {
      if (i === 0) return;
      var a = String((r[m.name] == null ? '' : r[m.name])).trim();
      var b = slotName(r[m.def]);
      var c = slotName(r[m.opt]);
      var d = (m.files >= 0) ? String((r[m.files] == null ? '' : r[m.files])).trim() : '';
      if (a) {
        cur = a;
        var n = (m.msbn >= 0) ? parseInt(r[m.msbn], 10) : NaN;
        out[cur] = { order: [], def: {}, files: {}, msbnMax: isNaN(n) ? null : n };
      }
      if (!cur) return;
      var name = b || c;
      if (!name) return;
      if (out[cur].order.indexOf(name) === -1) out[cur].order.push(name);
      out[cur].def[name] = !!b;
      if (d) out[cur].files[name] = d.split(/[,，、\s]+/).filter(Boolean);
    });
    return out;
  }

  function loadSheet(cb) {
    ensureXLSX(function (err) {
      if (err) { sheetError = '讀不到版位詳情表（SheetJS 載入失敗），先顯示全部排版。'; cb(); return; }
      fetch(_scriptDir + '../' + encodeURIComponent(SHEET_FILE) + '?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(function (buf) {
          var wb = window.XLSX.read(new Uint8Array(buf), { type: 'array' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
          SHEET = parseSheet(rows);
          sheetError = '';
        })
        .catch(function () {
          sheetError = '找不到「' + SHEET_FILE + '」，先顯示全部排版（把檔案放到跟 jbpbn.html 同一層即可）。';
        })
        .then(function () { cb(); });
    });
  }

  /* ── 版位名稱 ↔ 排版檔案 ───────────────────────────── */
  function filesForSlot(conf, name, layouts) {
    if (conf.files[name] && conf.files[name].length) {
      var want = conf.files[name].map(function (f) { return normKey(f.replace(/\.html$/i, '')); });
      return layouts.filter(function (l) {
        return want.indexOf(normKey(String(l.file).replace(/\.html$/i, ''))) !== -1;
      });
    }
    var k = normKey(name);
    var rule = null;
    for (var i = 0; i < SLOT_RULES.length; i++) if (normKey(SLOT_RULES[i].key) === k) { rule = SLOT_RULES[i]; break; }
    if (!rule) return [];
    return layouts.filter(function (l) { return rule.test.test(String(l.file)); });
  }

  function planForLevel() {
    var layouts = (typeof window.loadLayouts === 'function' ? window.loadLayouts() : [])
      .filter(function (l) { return l.enabled; });
    var conf = SHEET && SHEET[levelLabel(currentLevelId)];

    function stem(v) {
      return normKey(String(v == null ? '' : v).replace(/\.html$/i, ''));
    }
    function layoutKey(l) {
      return String(l && l.id != null ? l.id : (l && (l.file || l.name) || ''));
    }

    var universal = [];
    var universalRows = [];
    var universalIds = {};
    ['LPBN_APP', 'LPBN_PC'].forEach(function (code) {
      var hit = layouts.filter(function (l) {
        return stem(l.file) === stem(code) || stem(l.name) === stem(code);
      })[0];
      if (!hit) return;
      var key = layoutKey(hit);
      if (universalIds[key]) return;
      universalIds[key] = true;
      universal.push(hit);
      universalRows.push({ slot: code, layout: hit, def: true });
    });

    if (!conf) {
      var rest = layouts.filter(function (l) { return !universalIds[layoutKey(l)]; });
      return {
        all: universal.concat(rest),
        rows: universalRows.concat(rest.map(function (l) {
          return { slot: '', layout: l, def: true };
        }))
      };
    }

    var rows = universalRows.slice();
    conf.order.forEach(function (name) {
      var hits = filesForSlot(conf, name, layouts).filter(function (l) {
        return !universalIds[layoutKey(l)];
      });
      if (!hits.length) {
        if (/^lpbn(?:app|pc)?$/i.test(normKey(name))) return;
        rows.push({ slot: name, layout: null, def: conf.def[name] });
        return;
      }
      hits.forEach(function (l) {
        rows.push({ slot: name, layout: l, def: conf.def[name] });
      });
    });
    return {
      all: rows.filter(function (r) { return r.layout; }).map(function (r) { return r.layout; }),
      rows: rows
    };
  }

  function arLevelHasSlot(){
    var conf = SHEET && SHEET[levelLabel(currentLevelId)];
    if(!conf) return false;
    return conf.order.some(function(name){ return normKey(name).indexOf('ar') === 0; });
  }
  function updateArTextFieldVisibility(){
    var wrap = document.getElementById('ar-text-field');
    if(!wrap) return;
    var show = arLevelHasSlot();
    wrap.style.display = show ? '' : 'none';
    if(show && typeof bnSyncArTextDefault === 'function') bnSyncArTextDefault();
  }

  /* ── 覆寫勾選清單 ─────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var userTouched = {};
  var restoredChecked = {};
  window._bnSetRestoredChecked = function (map) {
    restoredChecked = {};
    Object.keys(map || {}).forEach(function (id) {
      restoredChecked[String(id)] = !!map[id];
      userTouched[String(id)] = true;
      if (window.checked) window.checked[String(id)] = !!map[id];
    });
  };

  function syncChecked(plan) {
    var checked = window.checked || (window.checked = {});
    var allow = {};
    plan.rows.forEach(function (r) {
      if (!r.layout) return;
      allow[r.layout.id] = true;
      var hasRestored = Object.prototype.hasOwnProperty.call(restoredChecked, String(r.layout.id));
      checked[r.layout.id] = userTouched[r.layout.id] ? !!checked[r.layout.id] : (hasRestored ? !!restoredChecked[r.layout.id] : !!r.def);
    });
    (typeof window.loadLayouts === 'function' ? window.loadLayouts() : []).forEach(function (l) {
      if (!allow[l.id]) checked[l.id] = false;
    });
  }

  function myRenderChecks() {
    updateArTextFieldVisibility();
    paintEmptyText();
    var wrap = document.getElementById('layout-checks');
    if (!wrap) return;
    var plan = planForLevel();
    syncChecked(plan);

    if (!plan.rows.length) {
      wrap.innerHTML = '<div class="no-layouts">這個等級沒有可用的版位</div>';
      return;
    }
    var checked = window.checked || {};
    var lastSlot = null;
    wrap.innerHTML = plan.rows.map(function (r) {
      var head = '';
      if (r.slot && r.slot !== lastSlot) {
        lastSlot = r.slot;
        head = '<div class="lc-group">' + esc(r.slot) + (r.def ? '' : '（選配）') + '</div>';
      }
      if (!r.layout) {
        return head +
          '<label class="layout-check-item lc-missing" title="版位詳情表有列到，但目前沒有對應的版型檔">' +
            '<input type="checkbox" disabled>' +
            '<span class="lc-name">' + esc(r.slot) + '</span>' +
            '<span class="lc-tip">尚未提供版型</span>' +
          '</label>';
      }
      var hasRestored = Object.prototype.hasOwnProperty.call(restoredChecked, String(r.layout.id));
      var on = userTouched[r.layout.id] ? !!checked[r.layout.id] : (hasRestored ? !!restoredChecked[r.layout.id] : !!r.def);
      return head +
        '<label class="layout-check-item">' +
          '<input type="checkbox" ' + (on ? 'checked' : '') +
            ' onchange="onCheck(' + r.layout.id + ', this.checked)">' +
          '<span class="lc-name">' + esc(r.layout.name) + '</span>' +
          '<span class="lc-size">' + (r.layout.w ? r.layout.w + '×' + r.layout.h : '') + '</span>' +
        '</label>';
    }).join('');
  }

  function myCheckAll(val) {
    var plan = planForLevel();
    var checked = window.checked || (window.checked = {});
    plan.rows.forEach(function (r) {
      if (!r.layout) return;
      checked[r.layout.id] = !!val;
      userTouched[r.layout.id] = true;
    });
    if (plan.rows.some(function (r) { return r.layout && isLogoVariantLayout(r.layout); })) {
      _logoVariantManualOverride = true;
    }
    myRenderChecks();
    if (typeof window.renderPreviews === 'function') window.renderPreviews();
  }

  var _logoVariantManualOverride = false;
  var _logoVariantSignature = '';
  function isLogoVariantLayout(layout) {
    var s = String((layout && (layout.name || layout.file)) || '');
    return /(無logo|no[-_ ]?logo|方式logo|方(?:式|版)?logo|方logo|square|vertical|portrait|橫(?:式|版)?logo|橫logo|horizontal|landscape)/i.test(s);
  }
  function logoVariantSignature() {
    return (window._bnLogos || []).map(function (l) {
      var src = String((l && l.src) || '');
      return String((l && l.id) || '') + '|' + String((l && l.ratio) || '') + '|' + src.slice(0, 32) + '|' + src.slice(-32);
    }).join('||');
  }

  function myOnCheck(id, val) {
    var checked = window.checked || (window.checked = {});
    checked[id] = !!val;
    userTouched[id] = true;
    var selected = (planForLevel().rows || []).find(function (r) {
      return r.layout && String(r.layout.id) === String(id);
    });
    if (selected && isLogoVariantLayout(selected.layout)) {
      _logoVariantManualOverride = true;
    }
    if (typeof window.renderPreviews === 'function') window.renderPreviews();
  }

  window.bnAutoSelectLogoVariant = function (variant, fromLogoAuto) {
    variant = variant === 'none' ? 'none' : (variant === 'all' ? 'all' : (variant === 'square' ? 'square' : 'horizontal'));
    if (fromLogoAuto) {
      var signature = logoVariantSignature();
      if (signature !== _logoVariantSignature) {
        _logoVariantSignature = signature;
        _logoVariantManualOverride = false;
      }
      if (_logoVariantManualOverride) return false;
    }
    var groups = {}, rows = planForLevel().rows || [];
    function layoutVariant(layout) {
      var s = String((layout && (layout.name || layout.file)) || '');
      if (/(無logo|no[-_ ]?logo)/i.test(s)) return 'none';
      if (/(方式logo|方(?:式|版)?logo|方logo|square|vertical|portrait)/i.test(s)) return 'square';
      if (/(橫(?:式|版)?logo|橫logo|horizontal|landscape)/i.test(s)) return 'horizontal';
      return '';
    }
    function pairKey(layout) { return normKey(String((layout && (layout.name || layout.file)) || '').replace(/\.html$/i, '').replace(/無logo|no[-_ ]?logo|方式logo|方(?:式|版)?logo|方logo|橫(?:式|版)?logo|橫logo|square|vertical|portrait|horizontal|landscape/gi, '')); }
    rows.forEach(function (r) { var v = r.layout && layoutVariant(r.layout), k = r.layout && pairKey(r.layout); if (!v || !k) return; if (!groups[k]) groups[k] = {}; groups[k][v] = r.layout; });
    var checked = window.checked || (window.checked = {}), changed = false;
    Object.keys(groups).forEach(function (k) {
      var pair = groups[k];
      var variants = [pair.none, pair.square, pair.horizontal].filter(Boolean);
      if (!variants.length || (!pair.none && (!pair.square || !pair.horizontal))) return;
      variants.forEach(function (layout) {
        var currentVariant = layoutVariant(layout);
        var next = variant === 'none' ? (pair.none ? currentVariant === 'none' : true) :
          (variant === 'all' ? currentVariant !== 'none' : currentVariant === variant);
        if (checked[layout.id] !== next) { checked[layout.id] = next; changed = true; }
        userTouched[layout.id] = true;
      });
    });
    if (changed) { myRenderChecks(); if (typeof window.renderPreviews === 'function') window.renderPreviews(); }
    return changed;
  };

  function hook() {
    window.renderChecks = myRenderChecks;
    window.checkAll = myCheckAll;
    window.onCheck = myOnCheck;
    var orig = window.renderPreviews;
    if (typeof orig === 'function' && !orig._lvWrapped) {
      var wrapped = function () { paintEmptyText(); syncChecked(planForLevel()); return orig.apply(this, arguments); };
      wrapped._lvWrapped = true;
      window.renderPreviews = wrapped;
    }
  }

  function applyWorkorderExposureSpec(spec) {
    if (!spec || !Array.isArray(spec.resources) || !spec.resources.length) return false;
    var resources = spec.resources.map(function (r) {
      return {
        key: normKey(String(r && r.key || '')),
        count: Number(r && r.count) || 0,
        selected: Number(r && r.count) > 0 && String(r && r.check || '') !== '未選'
      };
    }).filter(function (r) { return !!r.key; });
    if (!resources.length) return false;
    var layouts = typeof window.loadLayouts === 'function' ? window.loadLayouts() : [];
    var changed = false;
    layouts.forEach(function (layout) {
      var layoutKey = normKey(String(layout && (layout.file || layout.name) || ''));
      if (!layoutKey) return;
      var hit = resources.filter(function (resource) {
        return layoutKey.indexOf(resource.key) !== -1 || resource.key.indexOf(layoutKey) !== -1;
      })[0];
      if (!hit) return;
      var next = !!hit.selected;
      if (window.checked[layout.id] !== next) { window.checked[layout.id] = next; changed = true; }
      userTouched[layout.id] = true;
    });
    if (changed) {
      myRenderChecks();
      if (typeof window.renderPreviews === 'function') window.renderPreviews();
    }
    return changed;
  }
  window._bnApplyWorkorderExposureSpec = applyWorkorderExposureSpec;

  /* 外層 BODA 可能在本外掛完成載入前就送出工單勾選規則；
     先套用一次，並在版位詳情表載入完成後再補套用，確保 layout 清單已就緒。 */
  function applyPendingWorkorderExposureSpec() {
    var pending = window._bnPendingWorkorderExposureSpec;
    if (!pending) return;
    delete window._bnPendingWorkorderExposureSpec;
    applyWorkorderExposureSpec(pending);
  }

  function boot() {
    var sharedBg = typeof readSharedCanvasBg === 'function' ? readSharedCanvasBg() : null;
    if (sharedBg && typeof applySharedCanvasBg === 'function') applySharedCanvasBg(sharedBg, true);
    mountSelect();
    hook();
    paintNote();
    myRenderChecks();
    loadSheet(function () {
      paintNote();
      myRenderChecks();
      applyPendingWorkorderExposureSpec();
      if (typeof window.renderPreviews === 'function') window.renderPreviews();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); });
  else setTimeout(boot, 0);
})();
