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

/* ════════════════════════════════════════
   積木清單載入：讀取 /blocks/index.js（BN_BLOCKS 陣列）
   再依序動態載入每個 /blocks/{id}/block.js
════════════════════════════════════════ */
function bnLoadAllBlocks(onDone, basePath, onProgress) {
  function report(loaded, total, succeeded) {
    if (typeof onProgress === 'function') onProgress({
      loaded: loaded, total: total, succeeded: succeeded
    });
  }
  function done(result) {
    if (onDone) onDone(result);
  }
  report(0, 0, 0);
  basePath = basePath || '../blocks/'; /* core.html / canvas.html 放在 /core/ 下，往上一層找 blocks/；
                                           若頁面本身就在根目錄（如 index.html），呼叫時傳 'blocks/' */
  fetch(basePath + 'index.js?t=' + Date.now())
    .then(function (r) { return r.text(); })
    .then(function (text) {
      /* blocks/index.js 內容是 window._bn_blocks_manifest_cb([...]);
         直接執行這段文字取得陣列，格式不變，沿用舊的 manifest 檔案即可 */
      var ids = null;
      window._bn_blocks_manifest_cb = function (arr) { ids = arr; };
      (0, eval)(text);
      if (!Array.isArray(ids)) {
        console.error('[BNCore] blocks/index.js 應輸出陣列');
        done({ total: 0, succeeded: 0 });
        return;
      }

      var remain = ids.length;
      if (!remain) { done({ total: 0, succeeded: 0 }); return; }
      var loaded = 0, succeeded = 0;
      report(0, ids.length, 0);
      ids.forEach(function (id) {
        fetch(basePath + id + '/block.json?t=' + Date.now())
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function (schema) {
            window.BNSchemaRenderer.registerFromSchema(schema);
            succeeded++;
          })
          .catch(function (err) {
            console.error('[BNCore] 載入積木失敗：' + id, err);
          })
          .then(function () {
            loaded++;
            report(loaded, ids.length, succeeded);
            if (--remain <= 0) done({ total: ids.length, succeeded: succeeded });
          });
      });
    })
    .catch(function (err) {
      console.error('[BNCore] blocks/index.js 讀取失敗', err);
      done({ total: 0, succeeded: 0 });
    });
}
