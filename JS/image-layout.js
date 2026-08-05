/* ════════════════════════════════════════════════════════
   image-layout.js
   ────────────────────────────────────────────────────────
   負責兩件事：
   1. 商品圖/LOGO 支援「一個欄位放多張圖」（試算表欄位用逗號分隔檔名，
      例如 "a.jpg,b.jpg" 就是這個範圍要放兩張圖，以此類推）。
      排版規則：
        - 每張圖預設高度 = 這個圖片範圍的高，無論幾張都一樣
        - 圖片之間固定 5px 間距
        - 不管幾張，整組圖片都要在範圍內垂直+水平置中
        - 如果全部圖片排起來的總寬超過範圍寬度，整組等比例一起縮小
   2. 滑鼠滾輪縮放，而且是「針對單一張圖」個別縮放：
        - 滑鼠移到某一張圖上滾動滾輪，只調整那一張的大小(權重)
        - 如果整組還有空間(還沒塞滿)，放大那一張不會影響其他張
        - 一旦整組已經塞滿(總寬碰到範圍邊界)，放大某一張就會擠壓
          其他張，讓它們等比例縮小；反過來縮小某一張，其他張會
          等比例補回空間變大
      實作方式：每張圖有自己的「權重」(預設1)，權重決定它「理想大小」
      (範圍高 × 權重)，把每張圖的理想寬度加總，如果超過範圍寬度，
      就整組一起乘上同一個「塞得下的縮放比例」──這樣單獨調整某一張的
      權重，會連動影響到最終大家實際顯示的大小，天然達到「此消彼長」
      的效果，不用特別寫「搶誰的空間」這種邏輯。

   使用方式：這個檔案完全獨立運作，只要在 index.html 裡用
   <script src="image-layout.js"></script> 載入（放在 schema-renderer.js
   之後即可），不用在其他地方額外呼叫任何函式──畫面上只要出現
   schema-renderer.js 產生的 .bn-imggroup 容器，這裡就會自動處理好排版
   跟滾輪縮放，包括之後每次因為編輯文字等原因重新渲染、產生新的
   .bn-imggroup 也會自動抓到，不用手動重新註冊。
════════════════════════════════════════════════════════ */
(function () {

  var GAP = 5;              // 圖片之間的固定間距(px)
  var ZOOM_STEP = 0.08;      // 每次滾輪縮放的幅度
  var ZOOM_MIN = 0.15;
  var ZOOM_MAX = 4;

  /* 每張圖的縮放權重要「跨重新渲染」記住──因為使用者編輯旁邊欄位時，
     畫面會整塊重新渲染、產生全新的 DOM 節點，不能把權重存在
     DOM節點自己身上（節點會被換掉，值就不見了）。
     改成存在這個記憶體裡的表，用「最近的祖先id + 欄位key + 第幾張圖」
     當識別碼，只要那個祖先容器的id沒變(例如 imp-mount-0)，
     重新渲染後還是能對回同一張圖之前調整過的權重。 */
  var weightStore = {};

  function getGroupKey(group) {
    var el = group;
    while (el && !el.id) el = el.parentElement;
    var anchorId = el ? el.id : 'global';
    var fieldKey = group.getAttribute('data-field-key') || '';
    return anchorId + '::' + fieldKey;
  }

  function getImgs(group) {
    return Array.prototype.slice.call(group.querySelectorAll('img.bn-imggroup-img'));
  }

  function getWeight(groupKey, index) {
    var arr = weightStore[groupKey];
    return (arr && arr[index] != null) ? arr[index] : 1;
  }

  function setWeight(groupKey, index, value) {
    if (!weightStore[groupKey]) weightStore[groupKey] = {};
    weightStore[groupKey][index] = value;
  }

  /* 量測並套用排版：每張圖各自的「理想寬度」= 範圍高 × 自己的權重 × 原始比例，
     全部加起來如果超過範圍寬度，整組一起乘上同一個縮放比例壓回剛好放得下。
     這樣單獨放大某一張(權重變大)，如果已經超過範圍寬度，全部(含自己)乘上的
     縮放比例會變小，最終結果就是那一張變大、其他張(權重沒變、但乘到的縮放
     比例變小了)就跟著變小──天然達到「此消彼長」的效果。 */
  function applyLayout(group) {
    var imgs = getImgs(group);
    if (!imgs.length) return;

    var containerH = group.clientHeight;
    var containerW = group.clientWidth;
    if (!containerH || !containerW) return;

    var groupKey = getGroupKey(group);
    var n = imgs.length;
    var totalGap = GAP * (n - 1);

    var idealWidths = imgs.map(function (img, i) {
      var ratio = (img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : 1;
      var weight = getWeight(groupKey, i);
      return containerH * ratio * weight;
    });
    var idealTotalW = idealWidths.reduce(function (a, b) { return a + b; }, 0);

    var fitScale = 1;
    if (idealTotalW + totalGap > containerW && idealTotalW > 0) {
      fitScale = Math.max((containerW - totalGap) / idealTotalW, 0.02);
    }

    group.style.gap = GAP + 'px';
    imgs.forEach(function (img, i) {
      var finalWidth = idealWidths[i] * fitScale;
      img.style.width = finalWidth + 'px';
      img.style.height = 'auto';
    });
  }

  function layoutWhenReady(group) {
    var imgs = getImgs(group);
    if (!imgs.length) return;
    var pending = imgs.filter(function (img) { return !(img.complete && img.naturalWidth); });
    if (!pending.length) { applyLayout(group); return; }
    var remaining = pending.length;
    pending.forEach(function (img) {
      function done() { remaining--; if (remaining <= 0) applyLayout(group); }
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }

  /* 滑鼠滾輪縮放：滾輪要綁在「每一張圖片自己身上」，不是綁在整個群組，
     這樣滑鼠停在哪一張上面滾動，才會只調整那一張的權重 */
  function enableWheelZoomPerImage(group) {
    getImgs(group).forEach(function (img, i) {
      img.addEventListener('wheel', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var groupKey = getGroupKey(group);
        var w = getWeight(groupKey, i);
        w += (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
        w = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, w));
        setWeight(groupKey, i, w);
        applyLayout(group);
      }, { passive: false });
      img.style.cursor = 'zoom-in';
      img.title = '滑鼠滾輪可以單獨放大縮小這一張圖（如果整組已經塞滿，其他張會跟著縮小/放大）';
    });
  }

  function processGroup(group) {
    layoutWhenReady(group); /* 每次都要重新排版一次(套用之前記住的權重) */
    if (group._bnImgLayoutBound) return; /* 滾輪事件是綁在<img>本身上，重新渲染出的新<img>節點還是要重新綁一次 */
    group._bnImgLayoutBound = true;
    enableWheelZoomPerImage(group);
  }

  function scanAndProcess(root) {
    if (!root || !root.querySelectorAll) return;
    var groups = root.classList && root.classList.contains('bn-imggroup')
      ? [root].concat(Array.prototype.slice.call(root.querySelectorAll('.bn-imggroup')))
      : Array.prototype.slice.call(root.querySelectorAll('.bn-imggroup'));
    groups.forEach(processGroup);
  }

  /* 監看整個畫面：不管是匯入工單、預覽全部版位、還是其他任何地方，
     只要畫面上新增了 .bn-imggroup（例如使用者編輯欄位後重新渲染），
     這裡都會自動抓到並處理排版，不需要在別的地方手動呼叫任何函式 */
  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        scanAndProcess(node);
      });
    });
  });

  function start() {
    observer.observe(document.body, { childList: true, subtree: true });
    scanAndProcess(document.body);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.BNImageLayout = {
    scanAndProcess: scanAndProcess,
    /* 匯出目前所有圖片的滾輪縮放權重（給「下載暫存檔」用） */
    getWeights: function () {
      try { return JSON.parse(JSON.stringify(weightStore)); }
      catch (e) { return {}; }
    },
    /* 還原之前存下來的縮放權重（匯入暫存檔時用），套完立刻重新排版 */
    setWeights: function (w) {
      weightStore = (w && typeof w === 'object') ? w : {};
      scanAndProcess(document.body);
    }
  };
})();

