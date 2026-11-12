/* ════════════════════════════════════════
   BN Core Engine — 積木式版位管理核心
   ────────────────────────────────────────
   每個「版位」是一個獨立的積木（block），存放在 /blocks/{id}/block.js。
   block.js 只需呼叫 BNCore.registerBlock({...}) 註冊自己，
   core 不需要認識任何版位的細節（欄位、樣式、結構都由積木自己定義）。

   積木定義格式：
   BNCore.registerBlock({
     id:     'msbn3p',        // 唯一代號，同時對應資料夾名稱
     name:   '三品比對 3P',    // 顯示名稱
     width:  1200,
     height: 400,
     fields: [                // 可編輯欄位（core 依此自動產生設定面板）
       { key:'productName', label:'品名', type:'text', default:'商品名稱' },
       { key:'bgImage',     label:'底圖網址', type:'image', default:'' },
       { key:'themeColor',  label:'主色', type:'color', default:'#9f2f67' }
     ],
     style:  '.blk-msbn3p{...}',   // 純 CSS 字串，整段只注入一次
     render: function(data){ return '<div class="blk-msbn3p">...</div>'; }
   });
════════════════════════════════════════ */
(function (global) {
  var registry = {};      // { blockId: blockDef }
  var listeners = [];     // 註冊完成後要通知的 callback

  var BNCore = {
    /* 積木註冊 */
    registerBlock: function (def) {
      if (!def || !def.id) { console.error('[BNCore] registerBlock 缺少 id'); return; }
      if (!def.fields) def.fields = [];
      if (typeof def.render !== 'function') {
        console.error('[BNCore] 積木 "' + def.id + '" 缺少 render()');
        return;
      }
      registry[def.id] = def;

      /* 把積木自己的 CSS 注入頁面（每個積木只注入一次） */
      if (def.style && !document.getElementById('bn-style-' + def.id)) {
        var styleTag = document.createElement('style');
        styleTag.id = 'bn-style-' + def.id;
        styleTag.textContent = def.style;
        document.head.appendChild(styleTag);
      }

      listeners.forEach(function (fn) { fn(def); });
    },

    /* 取得所有已註冊積木 */
    getBlocks: function () {
      return Object.keys(registry).map(function (id) { return registry[id]; });
    },

    getBlock: function (id) { return registry[id] || null; },

    /* 積木註冊完成後通知（core.html 用來刷新工具列） */
    onRegister: function (fn) { listeners.push(fn); },

    /* 依 data 渲染單一積木實例，回傳 HTML 字串
       opts.editable=true 時，文字圖層會加上 contenteditable，可以直接在畫布上點擊編輯 */
    renderInstance: function (blockId, data, opts) {
      var def = registry[blockId];
      if (!def) return '<div style="padding:20px;color:#f66">找不到積木：' + blockId + '</div>';

      /* 補齊預設值，缺的欄位用 field.default 補上 */
      var merged = {};
      def.fields.forEach(function (f) { merged[f.key] = f.default; });
      Object.assign(merged, data || {});

      return def.render(merged, opts);
    },

    /* 依積木欄位定義，取得該積木的預設資料物件 */
    defaultData: function (blockId) {
      var def = registry[blockId];
      if (!def) return {};
      var data = {};
      def.fields.forEach(function (f) { data[f.key] = f.default; });
      return data;
    }
  };

  global.BNCore = BNCore;
})(window);

/* Production: one deterministic catalogue instead of one request per block.
 * After changing schemas run: node tools/build-block-catalogue.js
 * Maintenance/dev: bnLoadAllBlocks(done, 'blocks/', progress, {forceRefresh:true})
 * explicitly reads source JSON again. Ordinary loads keep stable cache keys. */
var BN_BLOCKS_RELEASE = 'blocks-c2f67ca46169f340';
var bnBlockCatalogueTasks = Object.create(null);
function bnLoadAllBlocks(onDone, basePath, onProgress, options) {
  options = options || {};
  var refresh = options.forceRefresh === true || options.development === true;
  var base = new URL(basePath || '../blocks/', document.baseURI).href;
  if (base.charAt(base.length - 1) !== '/') base += '/';
  var suffix = '?v=' + BN_BLOCKS_RELEASE + (refresh ? '&refresh=' + Date.now() : '');
  var source = refresh ? 'source' : 'bundle';
  function report(loaded, total, succeeded) {
    if (typeof onProgress === 'function') onProgress({ loaded: loaded, total: total, succeeded: succeeded });
  }
  function validIds(ids) {
    var seen = Object.create(null);
    return Array.isArray(ids) && ids.every(function (id) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id) || seen[id]) return false;
      seen[id] = true; return true;
    });
  }
  function fetchWithTimeout(url) {
    return new Promise(function (resolve, reject) {
      var finished = false, controller = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (finished) return; finished = true;
        if (controller) controller.abort(); reject(new Error('讀取逾時：' + url));
      }, 15000);
      var fetchOptions = { cache: refresh ? 'reload' : 'default' };
      if (controller) fetchOptions.signal = controller.signal;
      fetch(url, fetchOptions).then(function (response) {
        if (finished) return;
        if (!response.ok) throw new Error('HTTP ' + response.status + '：' + url);
        /* Keep the timeout until the body is complete, not just the headers. */
        return response.text();
      }).then(function (text) {
        if (finished) return; finished = true; clearTimeout(timer); resolve(text);
      }).catch(function (error) {
        if (finished) return; finished = true; clearTimeout(timer); reject(error);
      });
    });
  }
  function loadSources() {
    source = 'source';
    return fetchWithTimeout(base + 'index.js' + suffix).then(function (text) {
      /* The manifest is data; do not execute arbitrary fetched JS with eval. */
      var match = text.match(/_bn_blocks_manifest_cb\s*\(\s*(\[[\s\S]*\])\s*\)\s*;?\s*$/);
      var ids = match ? JSON.parse(match[1]) : null;
      if (!validIds(ids)) throw new Error('blocks/index.js 應輸出不重複的版位 ID 陣列');
      var schemas = new Array(ids.length), cursor = 0;
      function worker() {
        var index = cursor++;
        if (index >= ids.length) return Promise.resolve();
        var id = ids[index];
        if (!refresh && window.BNCore.getBlock(id)) return worker();
        return fetchWithTimeout(base + id + '/block.json' + suffix).then(function (text) {
          var schema = JSON.parse(text);
          if (!schema || schema.id !== id) throw new Error('版位 ID 不相符：' + id);
          schemas[index] = schema;
        }).catch(function (error) {
          console.error('[BNCore] 載入積木失敗：' + id, error);
        }).then(worker);
      }
      /* Source fallback/dev mode is bounded too; never start 107 fetches at once. */
      var workers = [];
      for (var i = 0; i < Math.min(6, ids.length); i++) workers.push(worker());
      return Promise.all(workers).then(function () { return { ids: ids, schemas: schemas }; });
    });
  }
  function loadBundle() {
    if (bnBlockCatalogueTasks[base]) return bnBlockCatalogueTasks[base];
    var task = new Promise(function (resolve, reject) {
      var script = document.createElement('script'), finished = false;
      var timer = setTimeout(function () { finish(new Error('版位 bundle 載入逾時')); }, 15000);
      function finish(error) {
        if (finished) return;
        finished = true; clearTimeout(timer); script.onload = script.onerror = null; script.remove();
        if (error) { reject(error); return; }
        var catalogue = window.BN_BLOCK_CATALOGUES && window.BN_BLOCK_CATALOGUES[base];
        if (!catalogue || catalogue.format !== 'boda-block-catalogue' || catalogue.version !== BN_BLOCKS_RELEASE.replace(/^blocks-/, '') || !validIds(catalogue.ids) ||
            !Array.isArray(catalogue.schemas) || catalogue.schemas.length !== catalogue.ids.length ||
            !catalogue.ids.every(function (id, index) { return catalogue.schemas[index] && catalogue.schemas[index].id === id; })) {
          reject(new Error('版位 bundle 不完整，請重新建立 catalogue.bundle.js')); return;
        }
        resolve(catalogue);
      }
      script.async = true; script.src = base + 'catalogue.bundle.js' + suffix;
      script.onload = function () { finish(); };
      script.onerror = function () { finish(new Error('版位 bundle 載入失敗')); };
      document.head.appendChild(script);
    });
    bnBlockCatalogueTasks[base] = task;
    task.catch(function () { if (bnBlockCatalogueTasks[base] === task) delete bnBlockCatalogueTasks[base]; });
    return task;
  }
  function register(catalogue) {
    var ids = catalogue.ids, schemas = catalogue.schemas, succeeded = 0, cursor = 0;
    report(0, ids.length, 0);
    return new Promise(function (resolve) {
      function batch() {
        var end = Math.min(cursor + 12, ids.length);
        while (cursor < end) {
          var id = ids[cursor], schema = schemas[cursor];
          try {
            if (!refresh && window.BNCore.getBlock(id)) succeeded++;
            else if (schema) {
              /* Renderer normalises schemas; preserve the cached catalogue as source data. */
              window.BNSchemaRenderer.registerFromSchema(JSON.parse(JSON.stringify(schema)));
              if (window.BNCore.getBlock(id)) succeeded++;
            }
          } catch (error) { console.error('[BNCore] 註冊積木失敗：' + id, error); }
          cursor++; report(cursor, ids.length, succeeded);
        }
        if (cursor < ids.length) setTimeout(batch, 0);
        else resolve({ total: ids.length, succeeded: succeeded, source: source, version: catalogue.version || BN_BLOCKS_RELEASE });
      }
      batch();
    });
  }
  report(0, 0, 0);
  var task = refresh ? loadSources() : loadBundle().catch(function (error) {
    console.warn('[BNCore] 改用來源版位（請確認已更新 catalogue.bundle.js）：', error);
    return loadSources();
  });
  return task.then(register).catch(function (error) {
    console.error('[BNCore] 版位清單讀取失敗', error);
    return { total: 0, succeeded: 0, source: source };
  }).then(function (result) { if (onDone) onDone(result); return result; });
}
