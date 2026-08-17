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
   2.5 按住滑鼠左鍵拖曳，可以單獨移動某一張圖的位置（每張圖各自記住自己的位移，
      跟縮放權重一樣「跨重新渲染」記住，也會存進暫存檔）。
      超出圖片範圍的部分會被裁掉（範圍本身就是 overflow:hidden）。
   2. 滑鼠滾輪縮放，而且是「針對單一張圖」個別縮放：
        - 滑鼠移到某一張圖上滾動滾輪，只調整那一張的大小(權重)，不影響其他張
        - 放大可以超出原本的圖片範圍，不會被範圍壓回來、也不會被裁掉
      實作方式：每張圖有自己的「權重」(預設1)。先用權重1算出「剛好排進範圍裡」
      的原始大小(整組太寬就一起等比縮小)，再各自乘上自己的權重──
      權重不參與「壓回範圍內」的計算，所以放大時才能超出範圍。

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
  /* 每張圖被拖曳過的位移，跟權重一樣用同一組識別碼記住：{ groupKey: { index: {x,y} } } */
  var offsetStore = {};

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

  function getOffset(groupKey, index) {
    var arr = offsetStore[groupKey];
    var o = arr && arr[index];
    return { x: (o && o.x) || 0, y: (o && o.y) || 0 };
  }

  function setOffset(groupKey, index, x, y) {
    if (!offsetStore[groupKey]) offsetStore[groupKey] = {};
    offsetStore[groupKey][index] = { x: x, y: y };
  }

  /* 把記住的位移套到這張圖上（用 transform，不影響其他張圖的排版位置） */
  function applyOffset(img, groupKey, index) {
    var o = getOffset(groupKey, index);
    img.style.transform = (o.x || o.y) ? ('translate(' + o.x + 'px,' + o.y + 'px)') : '';
  }

  /* 量測並套用排版：
     1. 先算「原始大小」(權重都當 1)：每張圖高度＝範圍高、依原始比例算寬度，
        整組加起來太寬就一起乘上同一個縮放比例壓回剛好放得下
        ──這一步只決定「還沒動過手」時的預設樣子，跟以前一樣。
     2. 再把每張圖自己的縮放權重乘上去。權重不參與上面那個「壓回範圍內」的計算，
        所以滾輪放大時可以超出原本的範圍、不會被壓回來，也不會被裁掉
        （範圍只是預設的擺放位置，overflow 已經改成不裁切）。 */
  function applyLayout(group) {
    var imgs = getImgs(group);
    if (!imgs.length) return;

    var containerH = group.clientHeight;
    var containerW = group.clientWidth;
    if (!containerH || !containerW) return;

    var groupKey = getGroupKey(group);
    var n = imgs.length;
    var totalGap = GAP * (n - 1);

    var baseWidths = imgs.map(function (img) {
      var ratio = (img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : 1;
      return containerH * ratio;
    });
    var baseTotalW = baseWidths.reduce(function (a, b) { return a + b; }, 0);

    var fitScale = 1;
    if (baseTotalW + totalGap > containerW && baseTotalW > 0) {
      fitScale = Math.max((containerW - totalGap) / baseTotalW, 0.02);
    }

    group.style.gap = GAP + 'px';
    imgs.forEach(function (img, i) {
      var finalWidth = baseWidths[i] * fitScale * getWeight(groupKey, i);
      img.style.width = finalWidth + 'px';
      img.style.height = 'auto';
      img.style.maxWidth = 'none';   /* 不讓任何外部樣式把放大後的圖片又壓回範圍內 */
      img.style.maxHeight = 'none';
      applyOffset(img, groupKey, i); /* 重新排版後，之前拖過的位移要留著 */
    });
  }

  /* ── 依曝品原圖寬高比切換「曝品＋贈品」範圍 ──────────────────
     renderer 會在需要切換的圖片框上輸出：
       data-aspect-source-field="productImg"
       data-aspect-wide-box="left,top,width,height"
       data-aspect-tall-box="left,top,width,height"

     同一個版位裡，所有 source field 相同的框是一組。以該曝品欄位第一張
     成功載入的圖片判斷：寬 >= 高（含正方形）用 wide；寬 < 高用 tall。
     因此左、右兩邊各自判斷，互不影響；沒有上傳時維持 block.json 的 wide 預設。 */
  function closestSchemaRoot(el) {
    while (el && el.nodeType === 1) {
      if (el.getAttribute && el.getAttribute('data-bn-schema-id')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function parseAspectBox(raw) {
    var parts = String(raw || '').split(',').map(Number);
    if (parts.length !== 4) return null;
    for (var i = 0; i < parts.length; i++) if (!isFinite(parts[i])) return null;
    return { left: parts[0], top: parts[1], width: parts[2], height: parts[3] };
  }

  function exactAttrElements(root, attr, value) {
    if (!root || !root.querySelectorAll) return [];
    return Array.prototype.filter.call(root.querySelectorAll('[' + attr + ']'), function (el) {
      return el.getAttribute(attr) === value;
    });
  }

  function sourceImageOf(scope, sourceField) {
    var sourceBoxes = exactAttrElements(scope, 'data-img-field', sourceField);
    for (var i = 0; i < sourceBoxes.length; i++) {
      var imgs = sourceBoxes[i].querySelectorAll('img.bn-imggroup-img');
      for (var j = 0; j < imgs.length; j++) {
        if (imgs[j].complete && imgs[j].naturalWidth && imgs[j].naturalHeight) return imgs[j];
      }
    }
    return null;
  }

  function applyAspectSwitch(scope, sourceField) {
    if (!scope || !sourceField) return;
    var targets = exactAttrElements(scope, 'data-aspect-source-field', sourceField);
    if (!targets.length) return;

    var sourceImg = sourceImageOf(scope, sourceField);
    /* 正方形沒有落在「寬小於高」，依需求與未上傳狀態一起使用 wide。 */
    var mode = sourceImg && sourceImg.naturalWidth < sourceImg.naturalHeight ? 'tall' : 'wide';
    var attr = mode === 'tall' ? 'data-aspect-tall-box' : 'data-aspect-wide-box';

    targets.forEach(function (target) {
      var box = parseAspectBox(target.getAttribute(attr));
      if (!box) return;
      target.style.left = box.left + 'px';
      target.style.top = box.top + 'px';
      target.style.width = box.width + 'px';
      target.style.height = box.height + 'px';
      target.setAttribute('data-aspect-mode', mode);

      /* 外框尺寸改變後，裡面的 contain / 多圖 / 滾輪縮放都要用新尺寸重算。 */
      var nestedGroup = target.querySelector('.bn-imggroup');
      if (nestedGroup) applyLayout(nestedGroup);
    });
  }

  function schemaRootsAround(root) {
    var out = [];
    function add(el) { if (el && out.indexOf(el) === -1) out.push(el); }
    if (!root) return out;
    if (root.nodeType === 9) {
      Array.prototype.forEach.call(root.querySelectorAll('[data-bn-schema-id]'), add);
      return out;
    }
    if (root.nodeType !== 1) return out;
    if (root.getAttribute('data-bn-schema-id')) add(root);
    add(closestSchemaRoot(root));
    Array.prototype.forEach.call(root.querySelectorAll('[data-bn-schema-id]'), add);
    return out;
  }

  function applyAspectSwitches(root) {
    schemaRootsAround(root).forEach(function (scope) {
      var seen = {};
      Array.prototype.forEach.call(scope.querySelectorAll('[data-aspect-source-field]'), function (target) {
        var sourceField = target.getAttribute('data-aspect-source-field');
        if (!sourceField || seen[sourceField]) return;
        seen[sourceField] = true;
        applyAspectSwitch(scope, sourceField);
      });
    });
  }

  function layoutWhenReady(group) {
    var imgs = getImgs(group);
    if (!imgs.length) return;
    function finish() {
      applyLayout(group);
      /* product 圖此刻已有 naturalWidth / naturalHeight，才能正確切換整組範圍。 */
      applyAspectSwitches(group);
    }
    var pending = imgs.filter(function (img) { return !(img.complete && img.naturalWidth); });
    if (!pending.length) { finish(); return; }
    var remaining = pending.length;
    pending.forEach(function (img) {
      function done() { remaining--; if (remaining <= 0) finish(); }
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }

  /* 滑鼠滾輪縮放＋按住左鍵拖曳移動：都要綁在「每一張圖片自己身上」，不是綁在整個群組，
     這樣滑鼠停在哪一張上面操作，就只會動到那一張 */
  function enableImageInteractions(group) {
    getImgs(group).forEach(function (img, i) {
      /* 滾輪縮放 */
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

      /* 按住左鍵拖曳移動這一張圖 */
      img.draggable = false; /* 關掉瀏覽器原生的「拖曳圖片」，不然會出現半透明殘影 */
      img.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var groupKey = getGroupKey(group);
        var start = getOffset(groupKey, i);
        var startX = e.clientX, startY = e.clientY;
        /* 匯入預覽整塊會被 CSS transform 縮放，滑鼠移動的距離要換算回原始尺寸，
           不然縮到 50% 時圖片會跑得比滑鼠快一倍 */
        var rect = img.getBoundingClientRect();
        var scale = (img.offsetWidth && rect.width) ? (rect.width / img.offsetWidth) : 1;
        if (!scale || !isFinite(scale)) scale = 1;
        var prevCursor = img.style.cursor;
        img.style.cursor = 'grabbing';

        function onMove(ev) {
          setOffset(groupKey, i,
            start.x + (ev.clientX - startX) / scale,
            start.y + (ev.clientY - startY) / scale);
          applyOffset(img, groupKey, i);
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          img.style.cursor = prevCursor || 'grab';
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      /* 連按兩下：這張圖回到原本的大小與位置 */
      img.addEventListener('dblclick', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var groupKey = getGroupKey(group);
        setWeight(groupKey, i, 1);
        setOffset(groupKey, i, 0, 0);
        applyLayout(group);
      });

      img.style.cursor = 'grab';
      img.title = '滾輪縮放這張圖、按住左鍵可拖曳移動位置、連按兩下復原（可以超出原本的範圍，不會被裁掉）';
    });
  }

  function processGroup(group) {
    layoutWhenReady(group); /* 每次都要重新排版一次(套用之前記住的權重) */
    if (group._bnImgLayoutBound) return; /* 滾輪/拖曳事件是綁在<img>本身上，重新渲染出的新<img>節點還是要重新綁一次 */
    group._bnImgLayoutBound = true;
    enableImageInteractions(group);
  }

  function scanAndProcess(root) {
    if (!root || !root.querySelectorAll) return;
    var groups = root.classList && root.classList.contains('bn-imggroup')
      ? [root].concat(Array.prototype.slice.call(root.querySelectorAll('.bn-imggroup')))
      : Array.prototype.slice.call(root.querySelectorAll('.bn-imggroup'));
    groups.forEach(processGroup);
    /* 空框本來就是 wide；有圖片但已從快取完成時，這裡也立即補做一次方向判斷。 */
    applyAspectSwitches(root);
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
    },
    /* 匯出／還原每張圖被拖曳過的位移（跟權重一樣存進暫存檔） */
    getOffsets: function () {
      try { return JSON.parse(JSON.stringify(offsetStore)); }
      catch (e) { return {}; }
    },
    setOffsets: function (o) {
      offsetStore = (o && typeof o === 'object') ? o : {};
      scanAndProcess(document.body);
    }
  };
})();

