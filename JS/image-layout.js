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
      匯入工單與維修畫布中，圖片可超出原本範圍放大；超出部分會在圖片區裁切。商品／贈品／代言人／簽名檔若屬同一編號區域，仍以這些區域的聯集作為共同可移動範圍。
   2. 滑鼠滾輪縮放，而且是「針對單一張圖」個別縮放：
        - 滑鼠移到某一張圖上滾動滾輪，只調整那一張的大小(權重)，不影響其他張
        - 匯入工單與維修畫布中，放大後可超出範圍，超出部分會裁切在單一或同區域的圖片區內
      實作方式：每張圖有自己的「權重」(預設1)。先用權重1算出「剛好排進範圍裡」
      的原始大小(整組太寬就一起等比縮小)，再各自乘上自己的權重──
      匯入工單與維修畫布會將權重與位移限制在單一或同區域聯集範圍內；其他頁面維持原本行為。

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
  /* 同檔名 LOGO 共用縮放權重；不同版位重新渲染時也能套用同一個縮放結果。 */
  var linkedWeightStore = {};
  /* 每張圖被拖曳過的位移，跟權重一樣用同一組識別碼記住：{ groupKey: { index: {x,y} } } */
  var offsetStore = {};

  /* 匯入工單頁會在頁籤切換、統一換色、文字輸入時大量重建 DOM；另外畫布本身
     還會用 transform 縮放。某些瀏覽器在圖片載入時該頁仍是 display:none，
     clientWidth/clientHeight 會是 0，第一次排版就直接略過。
     ResizeObserver 會在圖片框真正有尺寸時再補做一次，避免看得到圖卻無法縮放／拖曳。 */
  var groupResizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(function (entries) {
        entries.forEach(function (entry) {
          var group = entry.target;
          if (group && group.isConnected) applyLayout(group);
        });
      })
    : null;

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

  function imageSyncKey(img) {
    if (!img) return '';
    var group = img;
    while (group && group.nodeType === 1 && !(group.classList && group.classList.contains('bn-imggroup'))) group = group.parentElement;
    var field = group ? group.getAttribute('data-field-key') : '';
    if (!/^logoImg\d*$/i.test(String(field || ''))) return '';
    var src = img.getAttribute('src') || img.src || '';
    var assets = window.uploadedImages;
    if (Array.isArray(assets)) {
      for (var i = 0; i < assets.length; i++) {
        var asset = assets[i];
        if (!asset || (asset.url !== src && asset.baseUrl !== src)) continue;
        var name = String(asset.name || '').trim().toLowerCase();
        if (name) return 'name:' + name;
      }
    }
    return src ? 'url:' + src : '';
  }

  function getWeight(groupKey, index, img) {
    var syncKey = imageSyncKey(img);
    if (syncKey && linkedWeightStore[syncKey] != null) return linkedWeightStore[syncKey];
    var arr = weightStore[groupKey];
    return (arr && arr[index] != null) ? arr[index] : 1;
  }

  function setWeight(groupKey, index, value, img, suppressSync) {
    if (!weightStore[groupKey]) weightStore[groupKey] = {};
    weightStore[groupKey][index] = value;
    var syncKey = imageSyncKey(img);
    if (syncKey) {
      linkedWeightStore[syncKey] = value;
      if (!suppressSync) syncWeightForImage(syncKey);
    }
  }

  function syncWeightForImage(syncKey) {
    if (!syncKey || typeof document === 'undefined') return;
    var groups = document.querySelectorAll('.bn-imggroup');
    for (var gi = 0; gi < groups.length; gi++) {
      var group = groups[gi];
      var imgs = getImgs(group);
      var groupKey = getGroupKey(group);
      var changed = false;
      for (var i = 0; i < imgs.length; i++) {
        if (imageSyncKey(imgs[i]) !== syncKey) continue;
        if (!weightStore[groupKey]) weightStore[groupKey] = {};
        weightStore[groupKey][i] = linkedWeightStore[syncKey];
        changed = true;
      }
      if (changed) applyLayout(group);
    }
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

  /* ── 匯入工單圖片邊界 ──────────────────────────────────────
     一般圖片使用自己的 data-img-field 圖片框；商品／贈品／代言人／簽名檔
     在同一個編號（或同一個 repeat 實例）時，使用所有相關圖片框的聯集。
     這樣同一區域的多張素材可以在共同空間內重新排版，但不會跑出版位；副區與 MSBN 皆適用。 */
  function workOrderMountOf(el) {
    while (el && el.nodeType === 1) {
      /* 匯入工單與維修畫布的副區、MSBN 都包在各自的 mount／stage；
         不依賴 blockId，所以副區、MSBN 及 MSBN 內副區排都會套用。 */
      if ((el.id && /^(imp|mnt)-mount-/i.test(el.id)) ||
          (el.classList && (el.classList.contains('imp-slot') || el.classList.contains('imp-mount') || el.classList.contains('mt-stage')))) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function isBoundedWorkOrderGroup(group) {
    return !!workOrderMountOf(group);
  }

  function closestImageZone(group) {
    var el = group;
    while (el && el.nodeType === 1) {
      if (el.hasAttribute && el.hasAttribute('data-img-field')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function schemaRootOf(el) {
    while (el && el.nodeType === 1) {
      if (el.getAttribute && el.getAttribute('data-bn-schema-id')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function imageBoundaryFamily(field) {
    var value = String(field || '');
    var m = /^(.*?)(productImg|giftImg|endorserImg|signImg)([0-9]*)$/i.exec(value);
    if (m) return 'shared:' + m[1].toLowerCase() + ':' + m[3];
    return 'single:' + value.toLowerCase();
  }

  function imageBoundaryOfGroup(group) {
    var zone = closestImageZone(group);
    if (!zone) return null;
    var field = zone.getAttribute('data-img-field') || '';
    var family = imageBoundaryFamily(field);
    var scope = schemaRootOf(zone);
    var zones = scope ? scope.querySelectorAll('[data-img-field]') : [zone];
    var union = null;
    for (var i = 0; i < zones.length; i++) {
      var candidate = zones[i];
      if (imageBoundaryFamily(candidate.getAttribute('data-img-field') || '') !== family) continue;
      var rect = candidate.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (!union) {
        union = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      } else {
        union.left = Math.min(union.left, rect.left);
        union.top = Math.min(union.top, rect.top);
        union.right = Math.max(union.right, rect.right);
        union.bottom = Math.max(union.bottom, rect.bottom);
      }
    }
    if (!union) {
      var own = zone.getBoundingClientRect();
      if (!own.width || !own.height) return null;
      union = { left: own.left, top: own.top, right: own.right, bottom: own.bottom };
    }
    union.width = union.right - union.left;
    union.height = union.bottom - union.top;
    return union;
  }

  function elementScale(el, rect) {
    var sx = el.offsetWidth ? rect.width / el.offsetWidth : 1;
    var sy = el.offsetHeight ? rect.height / el.offsetHeight : sx;
    if (!isFinite(sx) || sx <= 0) sx = 1;
    if (!isFinite(sy) || sy <= 0) sy = sx;
    return { x: sx, y: sy };
  }

  function clampImageOffset(img, groupKey, index, bounds) {
    if (!bounds || !img || !img.offsetWidth || !img.offsetHeight) return;
    var offset = getOffset(groupKey, index);
    var rect = img.getBoundingClientRect();
    var scale = elementScale(img, rect);
    var baseLeft = rect.left - offset.x * scale.x;
    var baseTop = rect.top - offset.y * scale.y;
    /* 圖片小於可用區時仍完整留在區內；放大後則允許大於區域，
       只限制它持續覆蓋圖片區，讓使用者可自由平移取景，超出部分由容器裁切。 */
    var imageW = rect.width, imageH = rect.height;
    var minX, maxX, minY, maxY;
    if (imageW >= bounds.width) {
      minX = (bounds.right - imageW - baseLeft) / scale.x;
      maxX = (bounds.left - baseLeft) / scale.x;
    } else {
      minX = (bounds.left - baseLeft) / scale.x;
      maxX = (bounds.right - imageW - baseLeft) / scale.x;
    }
    if (imageH >= bounds.height) {
      minY = (bounds.bottom - imageH - baseTop) / scale.y;
      maxY = (bounds.top - baseTop) / scale.y;
    } else {
      minY = (bounds.top - baseTop) / scale.y;
      maxY = (bounds.bottom - imageH - baseTop) / scale.y;
    }
    var x = Math.min(maxX, Math.max(minX, offset.x));
    var y = Math.min(maxY, Math.max(minY, offset.y));
    if (!isFinite(x)) x = 0;
    if (!isFinite(y)) y = 0;
    if (Math.abs(x - offset.x) > 0.01 || Math.abs(y - offset.y) > 0.01) {
      setOffset(groupKey, index, x, y);
      applyOffset(img, groupKey, index);
    }
  }

  function maxWeightWithinBounds(img, baseWidth, baseHeight, fitScale, bounds) {
    if (!bounds || !img || !img.offsetWidth) return Infinity;
    var scale = elementScale(img, img.getBoundingClientRect());
    var availableW = bounds.width / scale.x;
    var availableH = bounds.height / scale.y;
    var widthAtWeightOne = baseWidth * fitScale;
    var heightAtWeightOne = baseHeight * fitScale;
    if (!widthAtWeightOne || !heightAtWeightOne) return Infinity;
    return Math.max(0.02, Math.min(availableW / widthAtWeightOne, availableH / heightAtWeightOne));
  }
  /* 量測並套用排版：
     1. 先算「原始大小」(權重都當 1)：每張圖高度＝範圍高、依原始比例算寬度，
        整組加起來太寬就一起乘上同一個縮放比例壓回剛好放得下
        ──這一步只決定「還沒動過手」時的預設樣子，跟以前一樣。
     2. 再把每張圖自己的縮放權重乘上去。權重不參與上面那個「壓回範圍內」的計算，
        所以匯入工單時會依單一或同區域聯集範圍夾制縮放與位移
        （其他頁面維持原本的自由縮放行為）。 */
  function applyLayout(group) {
    var imgs = getImgs(group);
    if (!imgs.length) return;

    var containerH = group.clientHeight;
    var containerW = group.clientWidth;
    if (!containerH || !containerW) return;

    var groupKey = getGroupKey(group);
    var bounded = isBoundedWorkOrderGroup(group);
    var bounds = bounded ? imageBoundaryOfGroup(group) : null;
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
      var weight = getWeight(groupKey, i, img);

      var finalWidth = baseWidths[i] * fitScale * weight;
      img.style.width = finalWidth + 'px';
      img.style.height = 'auto';
      img.style.maxWidth = 'none';
      img.style.maxHeight = 'none';
      applyOffset(img, groupKey, i);
      if (bounds) clampImageOffset(img, groupKey, i, bounds);
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
  function applyLogoBackgroundColor(group) {
    var target = group;
    while (target && target.nodeType === 1 && !target.hasAttribute('data-logo-bg-sample')) target = target.parentElement;
    if (!target) return;
    var imgs = getImgs(group), img = null;
    if (imgs.length > 1) return; /* 多顆 Logo 不共用單一吸色結果 */
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].complete && imgs[i].naturalWidth && imgs[i].naturalHeight) { img = imgs[i]; break; }
    }
    if (!img) return;
    var spec = String(target.getAttribute('data-logo-bg-sample') || 'adaptive');
    var positions = [];
    var maxX = Math.max(0, img.naturalWidth - 2);
    var maxY = Math.max(0, img.naturalHeight - 2);
    function addPosition(insetX, insetY) {
      positions.push({
        x: Math.max(0, Math.min(maxX, Math.round(insetX))),
        y: Math.max(0, Math.min(maxY, Math.round(insetY)))
      });
    }
    if (spec.toLowerCase() === 'adaptive') {
      [2, 5, 8, 12].forEach(function (inset) { addPosition(inset, inset); });
    } else {
      var parts = spec.split(',');
      var x = Number(parts[0]), y = Number(parts[1]);
      addPosition(isFinite(x) ? x : 2, isFinite(y) ? y : 2);
    }
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    try {
      var ctx = canvas.getContext('2d');
      /* 匯入工單會先裁掉圖片外緣，透明 PNG 常只剩 1px 透明留白；
         原本從 2px 開始多點取樣會直接落到 LOGO 本體（例如 SAMPO 的紅字）。
         依規則優先看裁切後左上 1×1：只要仍透明，就代表沒有可吸的背景，固定白底。 */
      ctx.clearRect(0, 0, 2, 2);
      ctx.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
      var topLeftAlpha = ctx.getImageData(0, 0, 1, 1).data[3];
      if (topLeftAlpha < 32) {
        target.style.backgroundColor = '#ffffff';
        target.setAttribute('data-logo-bg-sampled', '#ffffff');
        target.setAttribute('data-logo-bg-transparent', 'true');
        return;
      }
      target.removeAttribute('data-logo-bg-transparent');
      var bins = {};
      positions.forEach(function (pos) {
        ctx.clearRect(0, 0, 2, 2);
        ctx.drawImage(img, pos.x, pos.y, 2, 2, 0, 0, 2, 2);
        var d = ctx.getImageData(0, 0, 2, 2).data;
        for (var i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 32) continue;
          var r = d[i], g = d[i + 1], b = d[i + 2];
          var key = Math.round(r / 16) + ',' + Math.round(g / 16) + ',' + Math.round(b / 16);
          var bin = bins[key] || (bins[key] = { count: 0, r: 0, g: 0, b: 0 });
          bin.count++;
          bin.r += r; bin.g += g; bin.b += b;
        }
      });
      var best = null;
      Object.keys(bins).forEach(function (key) {
        if (!best || bins[key].count > best.count) best = bins[key];
      });
      if (!best) return;
      var color = 'rgb(' + Math.round(best.r / best.count) + ',' +
        Math.round(best.g / best.count) + ',' + Math.round(best.b / best.count) + ')';
      target.style.backgroundColor = color;
      target.setAttribute('data-logo-bg-sampled', color);
    } catch (e) {
      /* 外部圖片未提供 CORS 時無法讀取像素，保留原本底色。 */
    }
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
      applyLogoBackgroundColor(group);
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
        var w = getWeight(groupKey, i, img);
        w += (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
        w = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, w));
        setWeight(groupKey, i, w, img);
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
          var nextX = start.x + (ev.clientX - startX) / scale;
          var nextY = start.y + (ev.clientY - startY) / scale;
          setOffset(groupKey, i, nextX, nextY);
          applyOffset(img, groupKey, i);
          if (isBoundedWorkOrderGroup(group)) {
            clampImageOffset(img, groupKey, i, imageBoundaryOfGroup(group));
          }
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
        setWeight(groupKey, i, 1, img);
        setOffset(groupKey, i, 0, 0);
        applyLayout(group);
      });

      img.style.cursor = 'grab';
      img.title = '滾輪縮放這張圖、按住左鍵可拖曳移動位置、連按兩下復原（匯入工單與維修畫布時不能超出圖片範圍）';
    });
  }

  function processGroup(group) {
    layoutWhenReady(group); /* 每次都要重新排版一次(套用之前記住的權重) */
    if (groupResizeObserver && !group._bnImgResizeObserved) {
      group._bnImgResizeObserved = true;
      groupResizeObserver.observe(group);
    }
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
    /* ResizeObserver 不支援時的退路；也處理瀏覽器縮放／視窗尺寸改變。 */
    window.addEventListener('resize', function () { scanAndProcess(document.body); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scanAndProcess(document.body);
    });
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

