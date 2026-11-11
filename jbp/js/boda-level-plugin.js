/* ══════════════════════════════════════════════════════════════
   等級 × 版位詳情表外掛（boda-level-plugin.js）
   ──────────────────────────────────────────────────────────────
   1. 在左側「文字內容」上面加一個「等級」下拉，跟工單生成器連動
      （共用 localStorage 的 wo_level_v1；被 index.html 用 iframe 內嵌時
       再加 postMessage 即時互相通知，兩邊改都會同步）。
   2. 「排版選擇」依照 BODA 根目錄「MS與BN曝光版位.xlsx」D 欄等級、L:X 勾選矩陣過濾。
   3. 曝光人物圖片只允許在商品／人物區內移動，不可拖進文字區或畫布外。
   4. 商品影子顏色移到左側全域色票，一次套用全部商品；單品編輯只保留幾何設定。
   5. 這支是獨立外掛，整段刪掉就會回到原本的行為。
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var _scriptDir = (document.currentScript && document.currentScript.src || '').replace(/[^\/\\]*$/, '');

  /* 等級表（與 BODA index.html 的 LEVELS 同一份 id／名稱／MSBN 張數）。 */
  var LEVELS = [
    { id: 'brand_star_mega',    label: '大促 Brand star',      msbnMax: 8 },
    { id: 'brand_star_mega_zj', label: '大促 Brand star 資交', msbnMax: 4 },
    { id: 'ad_multi',           label: 'AD單買(多店活動)',     msbnMax: 8 },
    { id: 'ad_bn_only',         label: 'AD單買(BN Only)',      msbnMax: 0 },
    { id: 'bod_a_plus',         label: 'A BOD+',               msbnMax: 8 },
    { id: 'bod_a',              label: 'A BOD',                msbnMax: 8 },
    { id: 'bod_a_plus_zj',      label: 'A BOD+(資交)',         msbnMax: 0 },
    { id: 'bod_a_zj',           label: 'A BOD(資交)',          msbnMax: 0 },
    { id: 'jbp_multi',          label: 'B級 JBP(多店活動)',     msbnMax: 3 }
  ];
  /* 舊版等級 id（本機暫存）對應到新等級；沒列到的退回預設等級。 */
  var LEGACY_LEVEL_IDS = { mdd: 'bod_a', mdd_zj: 'bod_a_zj' };
  var LEVEL_KEY = 'wo_level_v1';
  var DEFAULT_LEVEL_ID = 'brand_star_mega';
  var SHEET_FILE = 'MS與BN曝光版位.xlsx';

  var SLOT_RULES = [
    { key: 'ddcard',      test: /^ddcard/i },
    { key: 'hbn',         test: /^HBN_/i },
    { key: 'mallhbn',     test: /^HBN_/i },
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
    { key: 'campaigncard', test: /^SCBN_APP/i },
    { key: 'lpbnapp',     test: /^LPBN_APP/i },
    { key: 'lpbnpc',      test: /^LPBN_PC/i },
    { key: 'lpbn',        test: /^LPBN_/i }
  ];
  function normKey(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[\s_\-　]/g, '').trim();
  }
  var SHEET_SLOT_HEADERS = {
    lpbn: 'LPBN',
    ddcard: 'DDCARD',
    mallhbn: 'MALL HBN',
    '活動總覽': '活動總覽',
    '首頁logo牆': '首頁LOGO牆',
    ar: 'AR',
    fbpost: 'FB POST',
    amsbn: 'AMS BN',
    campaigncard: 'Campaign Card',
    coinpage: 'Coinpage',
    ig: 'IG',
    searchicon: 'Search Icon',
    searchimage: 'Search Image'
  };

  /* ── 工單總覽的版位名稱 ↔ 排版檔（名字模糊比對）────────────────
     工單寫法很多（DD Card BN (APP)、DDCard、C2C HBN (PC)、Mall HBN、FB POST、FB_Post、
     AMS BN 推廣者後臺BN、Coin_page、Campaign Card、SCPN…），統一先轉成版位類別再比對排版檔。 */
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
    if (/sc[bp]n|campaigncard/.test(c)) out.push('scbn');
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

  /* 工單總覽由上到下的版位順序。名稱仍走上面同一套模糊比對；同類版位
     （例如 C2C HBN／Mall HBN）只建立一個排序位置，版型變體維持原先次序。 */
  function workorderSlotOrder(resources) {
    var order = [], seen = {};
    (resources || []).forEach(function (resource) {
      workorderSlotsOfName(resource && resource.key).forEach(function (slot) {
        if (!slot || seen[slot]) return;
        seen[slot] = true;
        order.push(slot);
      });
    });
    return order;
  }
  function workorderSlotRank(slot, placement) {
    var order = placement && Array.isArray(placement.order) ? placement.order : [];
    var rank = order.indexOf(slot);
    return rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
  }
  function workorderRowRank(row, placement) {
    var slots = [];
    var layoutSlot = row && row.layout ? workorderSlotOfLayout(row.layout) : '';
    if (layoutSlot) slots.push(layoutSlot);
    workorderSlotsOfName(row && row.slot).forEach(function (slot) {
      if (slots.indexOf(slot) === -1) slots.push(slot);
    });
    return slots.reduce(function (best, slot) {
      return Math.min(best, workorderSlotRank(slot, placement));
    }, Number.MAX_SAFE_INTEGER);
  }
  function sortLayoutsForWorkorder(layouts, placement) {
    return (layouts || []).map(function (layout, index) {
      return { layout: layout, index: index, rank: workorderSlotRank(workorderSlotOfLayout(layout), placement) };
    }).sort(function (a, b) {
      return a.rank === b.rank ? a.index - b.index : a.rank - b.rank;
    }).map(function (item) { return item.layout; });
  }
  function sortPlanRowsForWorkorder(rows, placement) {
    return (rows || []).map(function (row, index) {
      return { row: row, index: index, rank: workorderRowRank(row, placement) };
    }).sort(function (a, b) {
      return a.rank === b.rank ? a.index - b.index : a.rank - b.rank;
    }).map(function (item) { return item.row; });
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
  /* shopee/index.html 的預覽畫布在建立 iframe 前會呼叫這個排序器，讓右側畫布
     與左側排版選擇使用同一個工單順序。沒有工單時原樣回傳。 */
  window._bnSortLayoutsForDisplay = function (layouts) {
    return sortLayoutsForWorkorder(layouts, workorderPlacement);
  };
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
  /* MS與BN曝光版位表 D 欄以顯示名稱作為唯一等級 key。 */
  function levelSheetConf(id) {
    if (!SHEET) return null;
    var level = levelOf(id || currentLevelId);
    return SHEET[level.label] || null;
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

  /* ── 代言人字色：曝光資源單向同步到活動頁 ─────────────────
     _bnEndorserNote.color 有色碼＝手動色；空字串＝自動黑白。父頁只讀這個狀態，
     不提供反向套色訊息，避免兩頁各自保存一份後互相覆蓋。 */
  var _lastEndorserTextColorSignature = null;
  var _endorserTextColorReportTimer = 0;
  function currentEndorserTextColorState() {
    var note = window._bnEndorserNote;
    var color = note && /^#[0-9a-fA-F]{6}$/.test(String(note.color || ''))
      ? String(note.color).toLowerCase() : '';
    return { color: color, manual: !!color };
  }
  function reportEndorserTextColor(force) {
    if (!window.parent || window.parent === window) return;
    var state = currentEndorserTextColorState();
    var signature = (state.manual ? 'manual:' : 'auto:') + state.color;
    if (!force && signature === _lastEndorserTextColorSignature) return;
    _lastEndorserTextColorSignature = signature;
    try {
      window.parent.postMessage({
        type: 'wo-endorser-text-color', color: state.color, manual: state.manual,
        source: 'BODA_EXPOSURE'
      }, '*');
    } catch (e) {}
  }
  function scheduleEndorserTextColorReport(force, delay) {
    clearTimeout(_endorserTextColorReportTimer);
    _endorserTextColorReportTimer = setTimeout(function () {
      reportEndorserTextColor(!!force);
    }, typeof delay === 'number' ? delay : 20);
  }
  function ensureEndorserTextColorTargetStyle() {
    if (document.getElementById('boda-endorser-color-target-style')) return;
    var style = document.createElement('style');
    style.id = 'boda-endorser-color-target-style';
    style.textContent =
      '#bn-endorser-section.boda-endorser-color-target{animation:bodaEndorserColorTarget 1.4s ease-out;}' +
      '@keyframes bodaEndorserColorTarget{0%,45%{box-shadow:0 0 0 2px #a855f7,0 0 0 7px rgba(168,85,247,.18);}100%{box-shadow:none;}}';
    (document.head || document.documentElement).appendChild(style);
  }
  function openEndorserTextColorEditor(attempt) {
    var section = document.getElementById('bn-endorser-section');
    if (!section) {
      if ((attempt || 0) < 12) setTimeout(function () { openEndorserTextColorEditor((attempt || 0) + 1); }, 120);
      return false;
    }
    ensureEndorserTextColorTargetStyle();
    try { section.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); }
    catch (e) { try { section.scrollIntoView(); } catch (_) {} }
    section.classList.remove('boda-endorser-color-target');
    /* 重新觸發動畫，即使使用者連續從活動頁點進來也能看見定位提示。 */
    void section.offsetWidth;
    section.classList.add('boda-endorser-color-target');
    setTimeout(function () { section.classList.remove('boda-endorser-color-target'); }, 1500);
    var target = document.getElementById('bn-endorser-note-color') || document.getElementById('bn-endorser-note-auto');
    if (target && typeof target.focus === 'function') {
      try { target.focus({ preventScroll: true }); } catch (e) { try { target.focus(); } catch (_) {} }
    }
    reportEndorserTextColor(true);
    return true;
  }
  function hookEndorserTextColorBridge() {
    if (window.__bodaEndorserTextColorBridgeInstalled) return;
    window.__bodaEndorserTextColorBridgeInstalled = true;
    document.addEventListener('bn-state-dirty', function () {
      scheduleEndorserTextColorReport(false, 30);
    });
    /* 編輯器的目標 listener 會先更新 _bnEndorserNote，事件冒泡到這裡後再回報最新狀態。 */
    document.addEventListener('input', function (event) {
      if (event.target && event.target.id === 'bn-endorser-note-color') {
        scheduleEndorserTextColorReport(false, 0);
      }
    });
    document.addEventListener('click', function (event) {
      if (event.target && event.target.id === 'bn-endorser-note-auto') {
        scheduleEndorserTextColorReport(false, 0);
      }
    });
    window.addEventListener('message', function (event) {
      var message = event && event.data;
      if (!message) return;
      if (message.type === 'wo-request-endorser-text-color') reportEndorserTextColor(true);
      if (message.type === 'wo-open-endorser-text-color') openEndorserTextColorEditor(0);
    });
    /* 本機暫存還原與編輯器 UI 建立的時序不固定，多補幾次只讀回報。 */
    [0, 220, 800, 1800].forEach(function (delay) {
      setTimeout(function () { reportEndorserTextColor(delay === 1800); }, delay);
    });
  }

  function paintNote() {
    var note = document.getElementById('lv-note');
    if (!note) return;
    if (sheetError) { note.className = 'warn'; note.textContent = sheetError; return; }
    note.className = '';
    var conf = levelSheetConf(currentLevelId);
    if (!conf) { note.textContent = '版位詳情表裡沒有這個等級，先顯示全部排版。'; return; }
    var levelMsbn = levelOf(currentLevelId).msbnMax;
    var msbnTxt = levelMsbn > 0 ? '　MSBN 可放 ' + levelMsbn + ' 顆。' : '　此等級不提供 MSBN。';
    var plan = planForLevel();
    var layoutCount = plan.rows.filter(function (r) { return !!r.layout; }).length;
    if (!conf.order.length && !layoutCount) {
      note.textContent = '此等級在版位詳情表裡沒有曝光資源版位。' + msbnTxt;
      return;
    }
    note.textContent = '此等級：曝光版位 ' + conf.order.length + ' 項、可用排版 ' + layoutCount + ' 個（試算表有打勾才顯示）。' + msbnTxt +
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
    s.src = _scriptDir + '../../JS/xlsx.full.min.js?v=20261110-ms-bn-matrix';
    s.onload = function () { cb(); };
    s.onerror = function () { cb(new Error('SheetJS 載入失敗')); };
    document.head.appendChild(s);
  }

  function isSheetChecked(v) {
    if (v === true || v === 1) return true;
    var s = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, '');
    return /^(?:v|y|yes|true|1|✓|✔|√|勾|是)$/.test(s);
  }

  function parseSheet(rows) {
    var out = {};
    var head = rows[0] || [];
    var levelCol = 3; /* D：工單總覽名稱 */
    var slotCols = [];
    for (var col = 11; col <= 23; col++) { /* L:X：曝光資源版位 */
      var slotName = SHEET_SLOT_HEADERS[normKey(head[col])];
      if (slotName) slotCols.push({ col: col, name: slotName });
    }
    rows.forEach(function (r, i) {
      if (i === 0) return;
      var levelName = String((r[levelCol] == null ? '' : r[levelCol])).trim();
      if (!levelName) return;
      var conf = out[levelName] = { order: [], def: {}, files: {}, msbnMax: null };
      slotCols.forEach(function (slot) {
        if (!isSheetChecked(r[slot.col])) return;
        conf.order.push(slot.name);
        conf.def[slot.name] = true;
      });
    });
    return out;
  }

  function loadSheet(cb) {
    ensureXLSX(function (err) {
      if (err) { sheetError = '讀不到版位詳情表（SheetJS 載入失敗），先顯示全部排版。'; cb(); return; }
      fetch(_scriptDir + '../../' + encodeURIComponent(SHEET_FILE) + '?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(function (buf) {
          var wb = window.XLSX.read(new Uint8Array(buf), { type: 'array' });
          var ws = wb.Sheets['MS與BN曝光版位'] || wb.Sheets[wb.SheetNames[0]];
          var rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
          SHEET = parseSheet(rows);
          sheetError = '';
        })
        .catch(function () {
          sheetError = '找不到「' + SHEET_FILE + '」，先顯示全部排版（請把檔案放在 BODA 根目錄）。';
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

    function layoutKey(l) {
      return String(l && l.id != null ? l.id : (l && (l.file || l.name) || ''));
    }

    if (!conf) {
      var orderedLayouts = sortLayoutsForWorkorder(layouts, workorderPlacement);
      return {
        all: orderedLayouts.slice(),
        rows: orderedLayouts.map(function (l) {
          return { slot: '', layout: l, def: true };
        })
      };
    }

    var rows = [];
    var usedIds = {};
    conf.order.forEach(function (name) {
      var hits = filesForSlot(conf, name, layouts).filter(function (l) {
        return !usedIds[layoutKey(l)];
      });
      if (!hits.length) {
        rows.push({ slot: name, layout: null, def: conf.def[name] });
        return;
      }
      hits.forEach(function (l) {
        usedIds[layoutKey(l)] = true;
        rows.push({ slot: name, layout: l, def: conf.def[name] });
      });
    });
    rows = sortPlanRowsForWorkorder(rows, workorderPlacement);
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
        head = '<div class="lc-group">' + esc(r.slot) + '</div>';
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
    var slotOrder = workorderSlotOrder(spec.resources);
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
    writeWorkorderPlacement({ importId: importId, slots: slots, order: slotOrder });
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

  /* ── 全體商品影子顏色 ────────────────────────────────────────
     shopee 的影子是烘進每件商品 PNG，原本顏色藏在單品「影子」視窗裡；
     這裡把顏色提升成曝光資源左欄的全域設定。套色只更新商品影像內容，
     不 remove/add 商品，因此既有位置、大小、裁切、旋轉與前後順序都保留。

     空值＝依背景自動；HEX＝固定色。固定色存在同源 localStorage，父層 BODA
     的背景同步會尊重它，不會在下一次換底時又把手動色蓋掉。 */
  var BODA_GLOBAL_SHADOW_COLOR_KEY = 'bn_global_product_shadow_color_v1';
  var bodaGlobalShadowBusy = false;

  function normalizeBodaShadowColor(value) {
    var color = String(value || '').trim();
    if (/^#[0-9a-f]{3}$/i.test(color)) color = '#' + color.slice(1).split('').map(function (ch) { return ch + ch; }).join('');
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '';
  }
  function readBodaShadowColorOverride() {
    try { return normalizeBodaShadowColor(localStorage.getItem(BODA_GLOBAL_SHADOW_COLOR_KEY)); }
    catch (e) { return ''; }
  }
  function writeBodaShadowColorOverride(value) {
    var color = normalizeBodaShadowColor(value);
    try {
      if (color) localStorage.setItem(BODA_GLOBAL_SHADOW_COLOR_KEY, color);
      else localStorage.removeItem(BODA_GLOBAL_SHADOW_COLOR_KEY);
    } catch (e) {}
    return color;
  }
  function getBodaShadowColorSetting() {
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent._bodaGetExposureShadowColorSetting === 'function') {
        var parentSetting = window.parent._bodaGetExposureShadowColorSetting();
        if (parentSetting && normalizeBodaShadowColor(parentSetting.color)) {
          return {
            manual: normalizeBodaShadowColor(parentSetting.manual),
            color: normalizeBodaShadowColor(parentSetting.color),
            background: normalizeBodaShadowColor(parentSetting.background)
          };
        }
      }
    } catch (e) {}
    var manual = readBodaShadowColorOverride();
    var fallback = normalizeBodaShadowColor(window._bnGroundShadow && window._bnGroundShadow.DEFAULT && window._bnGroundShadow.DEFAULT.color) || '#5a5a5a';
    return { manual: manual, color: manual || fallback, background: '' };
  }
  function setBodaShadowDefaultColor(color) {
    var normalized = normalizeBodaShadowColor(color);
    if (normalized && window._bnGroundShadow && window._bnGroundShadow.DEFAULT) {
      window._bnGroundShadow.DEFAULT.color = normalized;
    }
    return normalized;
  }
  /* 只替換 color；enabled、角度、位移、寬度、長度與旋轉一律沿用單品設定。 */
  function bodaShadowConfigForProduct(product, color, shadowApi) {
    var existing = product && product.meta && product.meta.groundShadow;
    var cfg = Object.assign({}, shadowApi && shadowApi.DEFAULT || {}, existing || {}, {
      color: normalizeBodaShadowColor(color) || '#5a5a5a'
    });
    return shadowApi && typeof shadowApi.normalize === 'function' ? shadowApi.normalize(cfg) : cfg;
  }
  function sendBodaShadowProductInPlace(product) {
    if (!product || !product.id) return false;
    var sent = false;
    document.querySelectorAll('.preview-block iframe').forEach(function (frame) {
      try {
        if (!frame.contentWindow) return;
        frame.contentWindow.postMessage({
          type: 'bn-product-update-image',
          id: product.id,
          src: product.src,
          ratio: product.ratio,
           /* 全域影子換色與背景自動換色相同：只換像素，不重算商品框。 */
           preserveFrame: true,
          keepScale: true,
          rotate: Number(product.meta && product.meta.rotate) || 0,
          productRect: product.meta && product.meta.productRect
        }, '*');
        sent = true;
      } catch (e) {}
    });
    return sent;
  }
  /* 正常情況交給父層既有的序列重製流程；獨立開啟 iframe 時才走這個後備。 */
  function applyBodaShadowColorFallback(color) {
    var shadowApi = window._bnGroundShadow;
    var products = Array.isArray(window._bnProducts) ? window._bnProducts : [];
    color = setBodaShadowDefaultColor(color);
    if (!shadowApi || typeof shadowApi.applyToProduct !== 'function' || !color || !products.length) {
      return Promise.resolve({ color: color || '#5a5a5a', manual: readBodaShadowColorOverride(), changed: false });
    }
    var changed = 0, skipped = 0;
    var job = Promise.resolve();
    products.forEach(function (product) {
      if (!product) return;
      job = job.then(function () {
        var meta = product.meta || {};
        var existing = meta.groundShadow;
        var cfg = bodaShadowConfigForProduct(product, color, shadowApi);
        if (existing && existing.enabled === false) {
          product.meta = meta;
          product.meta.groundShadow = cfg;
          changed++;
          return;
        }
        /* 已有烘製影子卻找不到無影子底圖時不可再疊一層；保留畫面並回報略過。 */
        if (existing && !(product.baseSrc || meta.baseSrc)) { skipped++; return; }
        var sourceBase = product.baseSrc || meta.baseSrc || product.src;
        var sourceRotate = Number(meta.rotate) || 0;
        var sourceSignature = JSON.stringify(existing || null);
        var draft = Object.assign({}, product, {
          baseSrc: sourceBase,
          meta: Object.assign({}, meta, {
            groundShadow: existing ? Object.assign({}, existing) : existing
          })
        });
        return shadowApi.applyToProduct(draft, cfg).then(function () {
          var liveMeta = product.meta || {};
          if ((product.baseSrc || liveMeta.baseSrc || product.src) !== sourceBase ||
              (Number(liveMeta.rotate) || 0) !== sourceRotate ||
              JSON.stringify(liveMeta.groundShadow || null) !== sourceSignature) {
            skipped++;
            return;
          }
          product.src = draft.src;
          product.baseSrc = draft.baseSrc;
          product.ratio = draft.ratio;
          product.meta = Object.assign({}, liveMeta, draft.meta || {});
          sendBodaShadowProductInPlace(product);
          changed++;
        })['catch'](function () { skipped++; });
      });
    });
    return job.then(function () {
      if (typeof window._bnRenderProdList === 'function') window._bnRenderProdList();
      if (changed) {
        try { document.dispatchEvent(new CustomEvent('bn-state-dirty')); } catch (e) {}
      }
      return { color: color, manual: readBodaShadowColorOverride(), changed: !!changed, skipped: skipped };
    });
  }
  function applyBodaGlobalShadowSetting(manualColor) {
    var manual = writeBodaShadowColorOverride(manualColor);
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent._bodaApplyExposureShadowColorSetting === 'function') {
        return Promise.resolve(window.parent._bodaApplyExposureShadowColorSetting(manual));
      }
    } catch (e) {}
    var setting = getBodaShadowColorSetting();
    return applyBodaShadowColorFallback(manual || setting.color);
  }

  function setBodaShadowToolBusy(busy, message) {
    bodaGlobalShadowBusy = !!busy;
    var tool = document.getElementById('boda-global-shadow-tool');
    if (!tool) return;
    tool.querySelectorAll('input,button').forEach(function (control) {
      if (control.id !== 'boda-global-shadow-mode') control.disabled = !!busy;
    });
    var status = document.getElementById('boda-global-shadow-status');
    if (status && message) status.textContent = message;
    tool.classList.toggle('is-busy', !!busy);
  }
  function refreshBodaShadowTool(info) {
    var setting = info && normalizeBodaShadowColor(info.color) ? {
      manual: normalizeBodaShadowColor(info.manual),
      color: normalizeBodaShadowColor(info.color),
      background: normalizeBodaShadowColor(info.background)
    } : getBodaShadowColorSetting();
    setBodaShadowDefaultColor(setting.color);
    var picker = document.getElementById('boda-global-shadow-picker');
    var hex = document.getElementById('boda-global-shadow-hex');
    var mode = document.getElementById('boda-global-shadow-mode');
    var status = document.getElementById('boda-global-shadow-status');
    if (picker && document.activeElement !== picker) picker.value = setting.color;
    if (hex && document.activeElement !== hex) hex.value = setting.color.toUpperCase();
    if (mode) mode.value = setting.manual ? 'manual' : 'auto';
    if (status && !bodaGlobalShadowBusy) {
      var count = Array.isArray(window._bnProducts) ? window._bnProducts.length : 0;
      status.textContent = setting.manual
        ? '固定色已套用' + (count ? '至 ' + count + ' 件商品' : '；之後新增商品也會沿用') + '，換背景不會覆蓋。'
        : '目前依背景自動' + (setting.background ? '（' + setting.background.toUpperCase() + '）' : '') + '；背景各異時可固定一個全域色。';
    }
    return setting;
  }
  window._bnRefreshGlobalShadowColorTool = refreshBodaShadowTool;

  function hidePerProductShadowColor() {
    var input = document.querySelector('#bn-shadow-modal input[data-role="color"]');
    var group = input && input.parentElement && input.parentElement.parentElement;
    if (group && group.parentElement && group.parentElement.classList.contains('bn-shadow-ctrl')) {
      group.style.display = 'none';
      group.setAttribute('aria-hidden', 'true');
    }
    var hint = document.querySelector('#bn-shadow-modal .bn-shadow-hint');
    if (hint && !hint.dataset.bodaGlobalColorNote) {
      hint.dataset.bodaGlobalColorNote = '1';
      hint.textContent += ' 影子顏色請回左側「全體商品影子顏色」一次設定。';
    }
  }
  function installBodaShadowEditorGuard() {
    var shadowApi = window._bnGroundShadow;
    if (!shadowApi || typeof shadowApi.openEditor !== 'function') return false;
    if (!shadowApi.openEditor.__bodaGlobalColorWrapped) {
      var originalOpen = shadowApi.openEditor;
      var wrappedOpen = function (product, onApplied) {
        if (!product) return originalOpen.apply(shadowApi, arguments);
        var setting = getBodaShadowColorSetting();
        setBodaShadowDefaultColor(setting.color);
        product.meta = product.meta || {};
        var hadShadow = Object.prototype.hasOwnProperty.call(product.meta, 'groundShadow');
        var previousShadow = product.meta.groundShadow;
        /* openEditor 會同步複製設定；呼叫後立刻還原正式資料，按取消不會偷改商品。 */
        product.meta.groundShadow = bodaShadowConfigForProduct(product, setting.color, shadowApi);
        var result;
        try { result = originalOpen.call(shadowApi, product, onApplied); }
        finally {
          if (hadShadow) product.meta.groundShadow = previousShadow;
          else delete product.meta.groundShadow;
        }
        setTimeout(hidePerProductShadowColor, 0);
        return result;
      };
      wrappedOpen.__bodaGlobalColorWrapped = true;
      shadowApi.openEditor = wrappedOpen;
    }
    hidePerProductShadowColor();
    return true;
  }

  function mountBodaGlobalShadowTool() {
    installBodaShadowEditorGuard();
    if (document.getElementById('boda-global-shadow-tool')) return true;
    var list = document.getElementById('bn-prod-list');
    if (!list || !list.parentElement) return false;
    if (!document.getElementById('boda-global-shadow-style')) {
      var style = document.createElement('style');
      style.id = 'boda-global-shadow-style';
      style.textContent = [
        '#boda-global-shadow-tool{margin:7px 0 6px;padding:8px;border:1px solid var(--border,#30363d);border-radius:7px;background:rgba(255,255,255,.025)}',
        '#boda-global-shadow-tool .bgs-title{font-size:11px;font-weight:800;color:var(--text2,#c9d1d9);margin-bottom:6px}',
        '#boda-global-shadow-tool .bgs-row{display:grid;grid-template-columns:34px minmax(74px,1fr) auto;gap:5px;align-items:center}',
        '#boda-global-shadow-tool input[type=color]{width:34px;height:28px;padding:1px;border:1px solid var(--border,#30363d);border-radius:5px;background:transparent;cursor:pointer}',
        '#boda-global-shadow-tool .bgs-hex{min-width:0;width:100%;box-sizing:border-box;padding:5px 6px;border:1px solid var(--border,#30363d);border-radius:5px;background:var(--bg,#0d1117);color:var(--text,#e6edf3);font:11px/1.3 ui-monospace,monospace;text-transform:uppercase}',
        '#boda-global-shadow-tool button{padding:5px 7px;border:1px solid var(--border,#30363d);border-radius:5px;background:var(--bg2,#1c2333);color:var(--text2,#c9d1d9);font-size:10px;cursor:pointer;white-space:nowrap}',
        '#boda-global-shadow-tool button:hover{border-color:var(--accent,#1f6feb);color:var(--accent,#58a6ff)}',
        '#boda-global-shadow-tool .bgs-actions{display:flex;justify-content:flex-end;gap:5px;margin-top:6px}',
        '#boda-global-shadow-tool .bgs-apply{background:var(--accent,#1f6feb);border-color:var(--accent,#1f6feb);color:#fff}',
        '#boda-global-shadow-tool .bgs-status{margin-top:6px;color:var(--text3,#8b949e);font-size:9.5px;line-height:1.45}',
        '#boda-global-shadow-tool.is-busy{opacity:.72}',
        '#bn-shadow-modal .bn-shadow-ctrl>div:has(input[data-role="color"]){display:none!important}'
      ].join('\n');
      document.head.appendChild(style);
    }
    var tool = document.createElement('div');
    tool.id = 'boda-global-shadow-tool';
    tool.innerHTML = [
      '<div class="bgs-title">全體商品影子顏色</div>',
      '<div class="bgs-row">',
      '  <input id="boda-global-shadow-picker" type="color" aria-label="全體商品影子顏色">',
      '  <input id="boda-global-shadow-hex" class="bgs-hex" type="text" maxlength="7" spellcheck="false" aria-label="影子色碼">',
      '  <button type="button" class="bgs-apply" id="boda-global-shadow-apply">套用全部</button>',
      '</div>',
      '<div class="bgs-actions"><button type="button" id="boda-global-shadow-auto">依背景自動</button></div>',
      '<input id="boda-global-shadow-mode" type="hidden" value="auto">',
      '<div class="bgs-status" id="boda-global-shadow-status">讀取影子設定中…</div>'
    ].join('');
    list.parentElement.insertBefore(tool, list);
    var picker = document.getElementById('boda-global-shadow-picker');
    var hex = document.getElementById('boda-global-shadow-hex');
    var mode = document.getElementById('boda-global-shadow-mode');
    var applyBtn = document.getElementById('boda-global-shadow-apply');
    var autoBtn = document.getElementById('boda-global-shadow-auto');
    function chosenColor() { return normalizeBodaShadowColor(hex.value) || normalizeBodaShadowColor(picker.value); }
    function runSetting(manual) {
      if (bodaGlobalShadowBusy) return;
      if (manual && !chosenColor()) {
        document.getElementById('boda-global-shadow-status').textContent = '請輸入完整的 6 位 HEX 色碼。';
        return;
      }
      if (mode) mode.value = manual ? 'manual' : 'auto';
      setBodaShadowToolBusy(true, manual ? '正在重製全部商品影子…' : '正在恢復依背景自動並重製影子…');
      applyBodaGlobalShadowSetting(manual ? chosenColor() : '').then(function (result) {
        setBodaShadowToolBusy(false);
        refreshBodaShadowTool(result);
      }, function (error) {
        setBodaShadowToolBusy(false, '影子顏色套用失敗，商品與排版已保留。');
        console.warn('[BODA] 全體商品影子顏色套用失敗', error);
      });
    }
    picker.addEventListener('input', function () { hex.value = picker.value.toUpperCase(); });
    hex.addEventListener('input', function () {
      var color = normalizeBodaShadowColor(hex.value);
      if (color) picker.value = color;
    });
    hex.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); runSetting(true); }
    });
    applyBtn.addEventListener('click', function () { runSetting(true); });
    autoBtn.addEventListener('click', function () { runSetting(false); });
    /* 下載暫存會保存 hidden mode；上傳暫存還原時由這個 change 套回自訂／自動模式。 */
    mode.addEventListener('change', function () {
      var restore = function () { runSetting(mode.value === 'manual'); };
      if (window._bnStateApplying) setTimeout(restore, 120);
      else restore();
    });
    refreshBodaShadowTool();
    return true;
  }
  function hookBodaGlobalShadowTool() {
    [0, 120, 500].forEach(function (delay) { setTimeout(mountBodaGlobalShadowTool, delay); });
    if (window.__bodaGlobalShadowToolObserver) return;
    window.__bodaGlobalShadowToolObserver = new MutationObserver(function () {
      mountBodaGlobalShadowTool();
      hidePerProductShadowColor();
    });
    window.__bodaGlobalShadowToolObserver.observe(document.body, { childList:true, subtree:true });
  }

  /* ── 人物圖片邊界 ────────────────────────────────────────────
     shopee/layout-runtime 的人物拖曳刻意沒有 clamp，甚至允許移出畫布；
     BODA 的人物圖則必須留在版型既有的「商品範圍／商品圖範圍」，因為那個
     範圍就是設計稿預留的人物安全區，外面是主標／副標／日期等文字區。

     只限制一般人物1／人物2；代言人照片、簽名檔有自己的文字避讓與連動規則，
     不在這裡重複限制。父頁外掛不修改 shopee Junction，而是在每張版位 iframe
     ready 後掛入同源的邊界守門，拖曳、四角縮放、滾輪、暫存還原與版位連動
     都會經過同一套 clamp。 */
  var BODA_CHARACTER_SELECTOR = [
    '.bn-char-box[data-slot="_bnCharacter"]:not(.bn-endorser-box)',
    '.bn-char-box[data-slot="_bnCharacter2"]:not(.bn-endorser-box)'
  ].join(',');
  var _characterBoundsRequestSeq = 0;

  function clampCharacterRect(rect, zoneWidth, zoneHeight) {
    var zw = Number(zoneWidth), zh = Number(zoneHeight);
    var left = Number(rect && rect.left), top = Number(rect && rect.top);
    var width = Number(rect && rect.width), height = Number(rect && rect.height);
    if(!(zw > 0) || !(zh > 0) || !(width > 0) || !(height > 0)) return null;
    if(!isFinite(left)) left = 0;
    if(!isFinite(top)) top = 0;
    /* 人物比安全區大時先等比例縮小；否則單靠位移永遠不可能完全避開文字區。 */
    var scale = Math.min(1, zw / width, zh / height);
    width *= scale;
    height *= scale;
    left = Math.max(0, Math.min(zw - width, left));
    top = Math.max(0, Math.min(zh - height, top));
    return { left:left, top:top, width:width, height:height };
  }

  function installCharacterBoundsForFrame(frame) {
    var childWindow, childDocument;
    try {
      childWindow = frame && frame.contentWindow;
      childDocument = frame && (frame.contentDocument || (childWindow && childWindow.document));
    } catch (e) { return false; }
    if(!childWindow || !childDocument || !childDocument.documentElement) return false;
    if(childDocument.__bodaCharacterBoundsInstalled) return true;
    childDocument.__bodaCharacterBoundsInstalled = true;

    var lastInteractiveAt = 0;
    var snapshotTimer = 0;
    var observer = null;

    function isManagedCharacter(box) {
      return !!(box && box.matches && box.matches(BODA_CHARACTER_SELECTOR));
    }
    function characterFromEvent(event) {
      var target = event && event.target;
      var box = target && target.closest ? target.closest(BODA_CHARACTER_SELECTOR) : null;
      return isManagedCharacter(box) ? box : null;
    }
    function clampBox(box) {
      if(!isManagedCharacter(box)) return false;
      var zone = box.parentElement;
      if(!zone || !zone.matches || !zone.matches('.商品範圍,.商品圖範圍')) return false;
      var zoneStyle = childWindow.getComputedStyle(zone);
      var zw = parseFloat(zoneStyle.width) || zone.offsetWidth || 0;
      var zh = parseFloat(zoneStyle.height) || zone.offsetHeight || 0;
      var rect = {
        left: parseFloat(box.style.left),
        top: parseFloat(box.style.top),
        width: parseFloat(box.style.width) || box.offsetWidth,
        height: parseFloat(box.style.height) || box.offsetHeight
      };
      var next = clampCharacterRect(rect, zw, zh);
      if(!next) return false;
      var changed = !isFinite(rect.left) || !isFinite(rect.top) ||
        Math.abs(rect.left - next.left) > 0.05 || Math.abs(rect.top - next.top) > 0.05 ||
        Math.abs(rect.width - next.width) > 0.05 || Math.abs(rect.height - next.height) > 0.05;
      if(!changed) return false;
      box.style.left = next.left + 'px';
      box.style.top = next.top + 'px';
      box.style.width = next.width + 'px';
      box.style.height = next.height + 'px';
      box.title = '人物圖片僅能在商品／人物區內移動';
      return true;
    }
    function clampAll() {
      var changed = false;
      Array.prototype.forEach.call(childDocument.querySelectorAll(BODA_CHARACTER_SELECTOR), function (box) {
        if(clampBox(box)) changed = true;
      });
      return changed;
    }
    /* 直接使用 layout-runtime 既有的快照入口回寫座標，避免在外掛複製
       getProductSyncArea 的百分比換算。snapshotOnly 也不會再次觸發方橫連動。 */
    function requestCorrectedSnapshot() {
      clearTimeout(snapshotTimer);
      snapshotTimer = setTimeout(function () {
        try {
          childWindow.postMessage({
            type: 'bn-layout-snapshot-request',
            requestId: 'boda-character-bounds-' + Date.now() + '-' + (++_characterBoundsRequestSeq)
          }, '*');
          document.dispatchEvent(new CustomEvent('bn-state-dirty'));
        } catch (e) {}
      }, 40);
    }

    /* document bubble 會在 layout-runtime 的 box/handle listener 之後執行；同一幀
       內立刻拉回，瀏覽器還沒繪製就已是合法位置，因此不會閃進文字區。 */
    childDocument.addEventListener('pointermove', function (event) {
      if(!characterFromEvent(event)) return;
      lastInteractiveAt = Date.now();
      clampAll();
    }, false);
    childDocument.addEventListener('pointerup', function (event) {
      if(!characterFromEvent(event)) return;
      lastInteractiveAt = Date.now();
      if(clampAll()) requestCorrectedSnapshot();
    }, false);
    childDocument.addEventListener('pointercancel', function (event) {
      if(!characterFromEvent(event)) return;
      lastInteractiveAt = Date.now();
      if(clampAll()) requestCorrectedSnapshot();
    }, false);
    childDocument.addEventListener('wheel', function (event) {
      if(!characterFromEvent(event)) return;
      lastInteractiveAt = Date.now();
      /* 原本 wheel handler 已先回報一次；若被邊界修正，再用快照覆蓋成正確值。 */
      if(clampAll()) requestCorrectedSnapshot();
    }, false);

    /* 舊暫存、人物新增與方橫版位連動都是程式直接改 inline style，不會經過
       pointer 事件；監看人物框本身的新增／style 變化後同樣拉回安全區。 */
    observer = new childWindow.MutationObserver(function (mutations) {
      var relevant = mutations.some(function (mutation) {
        if(mutation.type === 'attributes') return isManagedCharacter(mutation.target);
        return Array.prototype.some.call(mutation.addedNodes || [], function (node) {
          return node && node.nodeType === 1 &&
            (isManagedCharacter(node) || (node.querySelector && node.querySelector(BODA_CHARACTER_SELECTOR)));
        });
      });
      if(!relevant) return;
      var changed = clampAll();
      if(changed && Date.now() - lastInteractiveAt > 120) requestCorrectedSnapshot();
    });
    observer.observe(childDocument.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['style', 'class', 'data-slot']
    });
    childDocument.__bodaCharacterBoundsObserver = observer;
    if(clampAll()) requestCorrectedSnapshot();
    return true;
  }

  function installCharacterBoundsForId(id) {
    var frame = id != null ? document.getElementById('iframe-' + id) : null;
    if(frame) installCharacterBoundsForFrame(frame);
  }
  function installCharacterBoundsForAllFrames() {
    document.querySelectorAll('.preview-block iframe').forEach(installCharacterBoundsForFrame);
  }
  function hookCharacterBounds() {
    var originalReady = window._bnOnIframeReady;
    if(typeof originalReady === 'function' && !originalReady.__bodaCharacterBoundsWrapped) {
      var wrappedReady = function (id) {
        var result = originalReady.apply(this, arguments);
        [0, 120, 500].forEach(function (delay) {
          setTimeout(function () { installCharacterBoundsForId(id); }, delay);
        });
        return result;
      };
      wrappedReady.__bodaCharacterBoundsWrapped = true;
      window._bnOnIframeReady = wrappedReady;
    }
    installCharacterBoundsForAllFrames();
    if(!window.__bodaCharacterBoundsFrameObserver) {
      var frameInstallTimer = 0;
      window.__bodaCharacterBoundsFrameObserver = new MutationObserver(function () {
        clearTimeout(frameInstallTimer);
        frameInstallTimer = setTimeout(installCharacterBoundsForAllFrames, 0);
      });
      window.__bodaCharacterBoundsFrameObserver.observe(document.body, { childList:true, subtree:true });
    }
  }

  function boot() {
    var sharedBg = typeof readSharedCanvasBg === 'function' ? readSharedCanvasBg() : null;
    if (sharedBg && typeof applySharedCanvasBg === 'function') applySharedCanvasBg(sharedBg, true);
    hookEndorserTextColorBridge();
    mountSelect();
    hook();
    hookBodaGlobalShadowTool();
    hookCharacterBounds();
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
