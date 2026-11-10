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

  /* 等級表（2026-11-09 更新，與 BODA index.html 的 LEVELS 同一份 id／名稱／MSBN 張數）。
     sheet＝「BOD A曝光資源版位詳情表.xlsx」裡借用的舊等級列（決定曝光資源預設／選配版位）；
     詳情表日後加上新等級名稱時，會優先用新名稱那一列。 */
  var LEVELS = [
    { id: 'brand_star_mega',    label: '大促 Brand star',      msbnMax: 8, sheet: 'A Brand star (Mega)' },
    { id: 'brand_star_mega_zj', label: '大促 Brand star 資交', msbnMax: 4, sheet: 'A Brand star (Mega) 資交' },
    { id: 'ad_multi',           label: 'AD單買(多店活動)',     msbnMax: 8, sheet: 'B JBP多店' },
    { id: 'ad_bn_only',         label: 'AD單買(BN Only)',      msbnMax: 0, sheet: 'B JBP多店' },
    { id: 'bod_a_plus',         label: 'A BOD+',               msbnMax: 8, sheet: 'B+ BOD A' },
    { id: 'bod_a',              label: 'A BOD',                msbnMax: 8, sheet: 'B+ BOD A' },
    { id: 'bod_a_plus_zj',      label: 'A BOD+(資交)',         msbnMax: 0, sheet: 'B+ BOD A 資交' },
    { id: 'bod_a_zj',           label: 'A BOD(資交)',          msbnMax: 0, sheet: 'B+ BOD A 資交' }
  ];
  /* 舊版等級 id（本機暫存）對應到新等級；沒列到的退回預設等級。 */
  var LEGACY_LEVEL_IDS = { mdd: 'bod_a', mdd_zj: 'bod_a_zj', jbp_multi: 'ad_multi' };
  var LEVEL_KEY = 'wo_level_v1';
  var DEFAULT_LEVEL_ID = 'brand_star_mega';
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

  /* ── 工單總覽的版位名稱 ↔ 排版檔（名字模糊比對）────────────────
     工單寫法很多（DD Card BN (APP)、DDCard、C2C HBN (PC)、Mall HBN、FB POST、FB_Post、
     AMS BN 推廣者後臺BN、Coin_page、SCPN…），統一先轉成版位類別再比對排版檔。 */
  function workorderSlotsOfName(name) {
    var spaced = String(name == null ? '' : name).toLowerCase().replace(/[_\-　]+/g, ' ');
    var c = spaced.replace(/\s+/g, '');
    var word = function (w) { return new RegExp('(^|[^a-z0-9])' + w + '([^a-z0-9]|$)').test(spaced); };
    var out = [];
    if (/ddcard/.test(c)) out.push('ddcard');
    if (/lpbn/.test(c)) {
      var app = /app/.test(c), pc = word('pc');
      if (app && !pc) out.push('lpbnapp');
      else if (pc && !app) out.push('lpbnpc');
      else out.push('lpbnapp', 'lpbnpc');
    }
    if (/hbn/.test(c)) out.push('hbn');
    if (/活動總覽/.test(c)) out.push('活動總覽');
    if (/logo牆|logowall/.test(c)) out.push('logowall');
    if (/fbpost|facebook/.test(c)) out.push('fbpost');
    if (/ams/.test(c)) out.push('ams');
    if (word('ar')) out.push('ar');
    if (/coin/.test(c)) out.push('coin');
    if (word('ig') || /instagram/.test(c)) out.push('ig');
    if (/sc[bp]n/.test(c)) out.push('scbn');
    if (/sba/.test(c)) out.push('sba');
    if (/searchicon/.test(c)) out.push('searchicon');
    if (/searchimage|searchimg/.test(c)) out.push('searchimage');
    return out;
  }
  function workorderSlotOfLayout(layout) {
    var f = String(layout && (layout.file || layout.name) || '').replace(/^.*[\\/]/, '')
      .toLowerCase().replace(/[\s\-　]+/g, '');
    if (/^ddcard/.test(f)) return 'ddcard';
    if (/^lpbn_?app/.test(f)) return 'lpbnapp';
    if (/^lpbn_?pc/.test(f)) return 'lpbnpc';
    if (/^hbn/.test(f)) return 'hbn';
    if (/^活動總覽/.test(f)) return '活動總覽';
    if (/^首頁logo牆/.test(f)) return 'logowall';
    if (/^fb_?post/.test(f)) return 'fbpost';
    if (/^ams/.test(f)) return 'ams';
    if (/^ar(?:[._]|$)/.test(f)) return 'ar';
    if (/^coin/.test(f)) return 'coin';
    if (/^ig/.test(f)) return 'ig';
    if (/^scbn/.test(f)) return 'scbn';
    if (/^sba/.test(f)) return 'sba';
    if (/^searchicon/.test(f)) return 'searchicon';
    if (/^search_?image/.test(f)) return 'searchimage';
    return '';
  }

  /* 工單總覽列出的曝光資源版位（BODA 匯入工單時送來）：{ importId, slots: { 類別: [工單名稱…] } }。
     存在 localStorage（bn 開頭，「清除本機暫存」會一起清），重新整理後清單照樣在。 */
  var WORKORDER_PLACEMENT_KEY = 'bn-workorder-placement-v1';
  var workorderPlacement = readWorkorderPlacement();
  var workorderAppliedIds = {}; /* { 版位 id: 工單勾的值 }：這次開頁後由工單勾選過的版位，晚到的暫存還原不可蓋回舊勾選 */
  function readWorkorderPlacement() {
    try {
      var saved = JSON.parse(localStorage.getItem(WORKORDER_PLACEMENT_KEY) || 'null');
      return saved && saved.slots && typeof saved.slots === 'object' ? saved : null;
    } catch (e) { return null; }
  }
  function writeWorkorderPlacement(value) {
    workorderPlacement = value;
    try {
      if (value) localStorage.setItem(WORKORDER_PLACEMENT_KEY, JSON.stringify(value));
      else localStorage.removeItem(WORKORDER_PLACEMENT_KEY);
    } catch (e) {}
  }
  function clearWorkorderPlacement() { writeWorkorderPlacement(null); }
  function workorderListsSlot(slot) {
    return !!(workorderPlacement && slot && workorderPlacement.slots[slot]);
  }
  /* 工單沒列到的版位：自動選 LOGO 方／橫版、無 LOGO 版時不可再自動勾回來（使用者手動勾不受限）。 */
  function workorderBlocksAutoCheck(layout) {
    return !!workorderPlacement && !workorderListsSlot(workorderSlotOfLayout(layout));
  }
  /* 等級的版位詳情表沒列到、但工單有列的版位：加進排版清單（工單是這次製作的依據）。
     等級已經有的類別不再加（例如 LPBN 固定只用 LPBN_APP／LPBN_PC 兩個）。 */
  function appendWorkorderRows(rows, layouts) {
    if (!workorderPlacement) return rows;
    var have = {}, present = {}, groups = {};
    rows.forEach(function (r) {
      if (!r.layout) return;
      have[String(r.layout.id)] = true;
      var slot = workorderSlotOfLayout(r.layout);
      if (slot) present[slot] = true;
    });
    layouts.forEach(function (l) {
      if (have[String(l.id)]) return;
      var slot = workorderSlotOfLayout(l);
      if (!slot || present[slot] || !workorderListsSlot(slot)) return;
      (groups[slot] = groups[slot] || []).push(l);
    });
    Object.keys(workorderPlacement.slots).forEach(function (slot) {
      (groups[slot] || []).forEach(function (l) {
        rows.push({ slot: workorderPlacement.slots[slot][0] + '（工單）', layout: l, def: true, fromWorkorder: true });
      });
    });
    return rows;
  }

  var currentLevelId = readLevel();
  var SHEET = null;
  var sheetError = '';

  function normalizeLevelId(v) {
    v = String(v == null ? '' : v);
    if (LEGACY_LEVEL_IDS[v]) v = LEGACY_LEVEL_IDS[v];
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === v) return v;
    return DEFAULT_LEVEL_ID;
  }
  function readLevel() {
    var v = null;
    try { v = localStorage.getItem(LEVEL_KEY); } catch (e) {}
    return normalizeLevelId(v);
  }
  function levelOf(id) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return LEVELS[i];
    for (var j = 0; j < LEVELS.length; j++) if (LEVELS[j].id === DEFAULT_LEVEL_ID) return LEVELS[j];
    return LEVELS[0];
  }
  function levelLabel(id) { return levelOf(id).label; }
  /* 版位詳情表裡這個等級的那一列：先找新名稱，找不到再用借用的舊等級列 */
  function levelSheetConf(id) {
    if (!SHEET) return null;
    var level = levelOf(id || currentLevelId);
    return SHEET[level.label] || (level.sheet ? SHEET[level.sheet] : null) || null;
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
    if (id) id = normalizeLevelId(id);
    if (id && id !== currentLevelId) {
      userTouched = {};
      /* 換等級＝改用新等級的預設勾選：還原的勾選、上一份工單的版位清單都不再適用。 */
      restoredChecked = {};
      clearWorkorderPlacement();
      _logoVariantManualOverride = false;
    }
    if (id) currentLevelId = id;
    else currentLevelId = readLevel();
    try { localStorage.setItem(LEVEL_KEY, currentLevelId); } catch (e) {}
    var sel = document.getElementById('lv-select');
    if (sel && sel.value !== currentLevelId) sel.value = currentLevelId;
    /* 同頁的背景圖庫依 A／B 等級切換完整／精簡介面；事件可避免外掛載入順序造成漏同步。 */
    try {
      window.dispatchEvent(new CustomEvent('bn-level-change', { detail: { levelId: currentLevelId } }));
    } catch (e) {}
    if (typeof window._bnBgLibraryApplyLevelMode === 'function') {
      try { window._bnBgLibraryApplyLevelMode(currentLevelId); } catch (e) {}
    }
    if (broadcast && window.parent && window.parent !== window) {
      try { window.parent.postMessage({ type: 'wo-level', level: currentLevelId }, '*'); } catch (e) {}
    }
    paintNote();
    if (typeof window.renderChecks === 'function') window.renderChecks();
    if (typeof window.renderPreviews === 'function') window.renderPreviews();
  }
  window._bnApplyLevel = applyLevel;
  window._bnGetCurrentLevelId = function () { return currentLevelId; };
  /* 主工具匯入工單或左側下拉變更時，父頁會把權威等級送回曝光資源 iframe；
     必須在這裡真正套用下拉與版位清單，不能只讓背景圖庫切換外觀。 */
  window.addEventListener('message', function (event) {
    var message = event && event.data;
    if (message && message.type === 'wo-level' && message.level) {
      applyLevel(String(message.level), false);
    }
  });

  function paintNote() {
    var note = document.getElementById('lv-note');
    if (!note) return;
    if (sheetError) { note.className = 'warn'; note.textContent = sheetError; return; }
    note.className = '';
    var conf = levelSheetConf(currentLevelId);
    if (!conf) { note.textContent = '版位詳情表裡沒有這個等級，先顯示全部排版。'; return; }
    /* MSBN 張數以新等級表為準（詳情表借用的舊等級列張數不同） */
    var levelMsbn = levelOf(currentLevelId).msbnMax;
    var msbnTxt = levelMsbn > 0 ? '　MSBN 可放 ' + levelMsbn + ' 顆。' : '　此等級不提供 MSBN。';
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
    note.textContent = '此等級：預設 ' + d + ' 個版位、選配 ' + o + ' 個（選配要自己打勾）。' + msbnTxt +
      (workorderPlacement ? '　已依工單總覽的版位勾選。' : '');
  }

  var EMPTY_TEXT_DEFAULT = '請在左側勾選排版';
  var EMPTY_TEXT_NO_SLOT = '此等級無曝光資源編輯器';
  function paintEmptyText() {
    var el = document.getElementById('preview-empty-text');
    if (!el) return;
    var conf = levelSheetConf(currentLevelId);
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
          sheetError = '找不到「' + SHEET_FILE + '」，先顯示全部排版（把檔案放到跟 shopee/index.html 同一層即可）。';
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
    var conf = levelSheetConf(currentLevelId);

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
    appendWorkorderRows(rows, layouts);
    return {
      all: rows.filter(function (r) { return r.layout; }).map(function (r) { return r.layout; }),
      rows: rows
    };
  }

  function arLevelHasSlot(){
    var conf = levelSheetConf(currentLevelId);
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
  /* bn-state-plugin 還原暫存時呼叫：還原的勾選要贏過等級預設，重新整理後手動調整才不會被改回去。
     這次開頁後工單已經勾過的版位不讓晚到的暫存蓋回去（暫存是匯入前的舊勾選）。 */
  window._bnSetRestoredChecked = function (map, levelId) {
    /* 暫存的勾選是在別的等級做的（例如這次匯入了別的等級的工單）：不還原，用目前等級的預設。 */
    if (levelId && normalizeLevelId(levelId) !== currentLevelId) return;
    restoredChecked = {};
    Object.keys(map || {}).forEach(function (id) {
      if (Object.prototype.hasOwnProperty.call(workorderAppliedIds, String(id))) {
        /* saveChecked 已經先把舊值寫進 checked，這裡改回工單勾的值 */
        if (window.checked) window.checked[String(id)] = workorderAppliedIds[String(id)];
        return;
      }
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

  /* 手動勾選後，晚到的暫存還原也要以使用者最後的選擇為準。 */
  function noteManualCheck(id, val) {
    if (Object.prototype.hasOwnProperty.call(workorderAppliedIds, String(id))) workorderAppliedIds[String(id)] = !!val;
  }

  function myCheckAll(val) {
    var plan = planForLevel();
    var checked = window.checked || (window.checked = {});
    plan.rows.forEach(function (r) {
      if (!r.layout) return;
      checked[r.layout.id] = !!val;
      userTouched[r.layout.id] = true;
      noteManualCheck(r.layout.id, val);
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
    noteManualCheck(id, val);
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
      /* 工單總覽沒列到的版位（已取消勾選）：自動選 LOGO 版本時不要再勾回來。 */
      if (variants.every(workorderBlocksAutoCheck)) return;
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
    /* 自動勾選（無 LOGO 版、LOGO 方／橫版）走 setLayoutChecks；工單沒列到的版位不讓它自動勾回來。 */
    var origSet = window.setLayoutChecks;
    if (typeof origSet === 'function' && !origSet._lvWrapped) {
      var wrappedSet = function (nextById) {
        var byId = {}, next = {};
        (typeof window.loadLayouts === 'function' ? window.loadLayouts() : []).forEach(function (l) { byId[String(l.id)] = l; });
        Object.keys(nextById || {}).forEach(function (id) {
          if (nextById[id] && byId[String(id)] && workorderBlocksAutoCheck(byId[String(id)])) return;
          next[id] = nextById[id];
        });
        return origSet.call(this, next);
      };
      wrappedSet._lvWrapped = true;
      window.setLayoutChecks = wrappedSet;
    }
  }

  function workorderResourceListed(r) {
    if (r && String(r.check || '') === '未選') return false;
    var count = r && r.count;
    if (count === '' || count == null) return true;
    var n = Number(count);
    return !isFinite(n) || n > 0;
  }
  /* 勾選結果回報給 BODA（顯示在「匯入工單」頁 STEP 1 下方）。 */
  function reportWorkorderPlacement(info) {
    if (!window.parent || window.parent === window) return;
    var checked = window.checked || {};
    var names = (planForLevel().rows || []).filter(function (r) {
      return r.layout && checked[r.layout.id];
    }).map(function (r) { return r.layout.name; });
    try {
      window.parent.postMessage({
        type: 'wo-workorder-exposure-spec-result', importId: info.importId || '', replay: !!info.replay,
        checked: names, listed: info.listed || [], unmatched: info.unmatched || [],
        skipped: info.skipped || [], noLayout: info.noLayout || []
      }, '*');
    } catch (e) {}
  }
  /* 新版工單（工單總覽「版位」欄，BODA 送 exhaustive）：列出的就是這次要做的曝光資源，
     有列到的勾選、沒列到的取消勾選；名字模糊比對成版位類別。
     同一次匯入重送（曝光資源晚開、iframe 重載）只補回清單，不覆蓋之後的手動調整。 */
  function applyWorkorderPlacementList(spec) {
    var importId = String(spec.importId || '');
    var slots = {}, listed = [], unmatched = [], skipped = [];
    spec.resources.forEach(function (r) {
      var name = String(r && r.key || '').replace(/\s+/g, ' ').trim();
      if (!name) return;
      var found = workorderSlotsOfName(name);
      if (!found.length) { unmatched.push(name); return; }
      if (!workorderResourceListed(r)) { skipped.push(name); return; }
      listed.push(name);
      found.forEach(function (slot) {
        if (!slots[slot]) slots[slot] = [];
        if (slots[slot].indexOf(name) === -1) slots[slot].push(name);
      });
    });
    var replay = !!(importId && workorderPlacement && workorderPlacement.importId === importId);
    writeWorkorderPlacement({ importId: importId, slots: slots });
    var checked = window.checked || (window.checked = {});
    var present = {};
    (planForLevel().rows || []).forEach(function (r) {
      if (!r.layout) return;
      var slot = workorderSlotOfLayout(r.layout);
      var on = workorderListsSlot(slot);
      if (on) present[slot] = true;
      if (replay) return;
      checked[r.layout.id] = on;
      userTouched[r.layout.id] = true;
      workorderAppliedIds[String(r.layout.id)] = on;
    });
    var noLayout = Object.keys(slots).filter(function (slot) { return !present[slot]; })
      .map(function (slot) { return slots[slot][0]; });
    if (!replay) _logoVariantManualOverride = false;
    myRenderChecks();
    paintNote();
    if (typeof window.renderPreviews === 'function') window.renderPreviews();
    /* 工單勾的是整類（例如 ddcard 的方／橫／無 LOGO 版都勾），再依目前的 LOGO 自動挑版本。 */
    var variantSync = null;
    if (!replay && (window._bnLogos || []).length && typeof window._bnSyncLogoLayoutSelection === 'function') {
      try { variantSync = window._bnSyncLogoLayoutSelection(); } catch (e) { variantSync = null; }
    }
    if (!replay) { try { document.dispatchEvent(new CustomEvent('bn-state-dirty')); } catch (e) {} }
    Promise.resolve(variantSync).catch(function () {}).then(function () {
      reportWorkorderPlacement({ importId: importId, replay: replay, listed: listed, unmatched: unmatched, skipped: skipped, noLayout: noLayout });
    });
    return true;
  }
  function applyWorkorderExposureSpec(spec) {
    if (!spec) return false;
    if (spec.exhaustive && Array.isArray(spec.resources)) return applyWorkorderPlacementList(spec);
    /* 舊版工單（0918V3 曝光資源矩陣）或沒有版位清單：不使用工單版位清單，只調整有列到的版位。 */
    clearWorkorderPlacement();
    if (!Array.isArray(spec.resources) || !spec.resources.length) { myRenderChecks(); paintNote(); return false; }
    var resources = spec.resources.map(function (r) {
      return {
        key: normKey(String(r && r.key || '')),
        slots: workorderSlotsOfName(r && r.key),
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
      var slot = workorderSlotOfLayout(layout);
      /* 先比版位類別；名字認不出類別時才退回舊的字串包含比對（避免 AR 被 ddcard、Search_Image 吃掉）。 */
      var hit = resources.filter(function (resource) {
        return slot && resource.slots.indexOf(slot) !== -1;
      })[0] || resources.filter(function (resource) {
        return !resource.slots.length &&
          (layoutKey.indexOf(resource.key) !== -1 || resource.key.indexOf(layoutKey) !== -1);
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
