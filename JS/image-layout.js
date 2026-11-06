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
  /* 副區同檔名 LOGO 共用縮放權重；MSBN 會在 imageSyncKey 中停用這個連動。 */
  var linkedWeightStore = {};
  /* 每張圖被拖曳過的位移，跟權重一樣用同一組識別碼記住：{ groupKey: { index: {x,y} } } */
  var offsetStore = {};

  /* 匯入工單的上一步／下一步由父頁管理；這裡只負責在真正改動圖片前後送出
     一次 gesture 事件。滾輪會連續觸發，所以同一張圖 220ms 內的縮放合併成一步。 */
  function imageHistoryContext(group) {
    var el = group;
    while (el && el.nodeType === 1) {
      var id = el.id || '';
      if (/^imp-mount-/i.test(id)) return 'import';
      if (/^prevall-mount-/i.test(id)) return 'preview';
      if (/^mnt-mount-/i.test(id)) return 'maint';
      el = el.parentElement;
    }
    return '';
  }

  function emitImageHistory(group, phase, action) {
    var context = imageHistoryContext(group);
    if (context !== 'import' && context !== 'preview') return;
    try {
      window.dispatchEvent(new CustomEvent('bn-image-layout-history', {
        detail: { phase: phase, action: action || 'edit', context: context }
      }));
    } catch (e) {}
  }

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
    /* MSBN 同一個 field 可能在同一張版位中出現多個獨立圖片區。
       不能只用 mount + field，否則其中一張的縮放會套到另一張；
       用同 field 在 schema 內的 DOM 順序作為穩定 instance key，重繪後仍可還原。 */
    if (isMsbnGroup(group)) {
      var root = schemaRootOf(group);
      var groups = root ? root.querySelectorAll('.bn-imggroup') : [];
      var ordinal = 0;
      for (var i = 0; i < groups.length; i++) {
        var candidate = groups[i];
        if ((candidate.getAttribute('data-field-key') || '') !== fieldKey) continue;
        if (candidate === group) break;
        ordinal++;
      }
      return anchorId + '::msbn::' + fieldKey + '::' + ordinal;
    }
    return anchorId + '::' + fieldKey;
  }

  function isMsbnGroup(group) {
    var root = schemaRootOf(group);
    return !!(root && /^msbn_/i.test(root.getAttribute('data-bn-schema-id') || ''));
  }

  function getImgs(group) {
    return Array.prototype.slice.call(group.querySelectorAll('img.bn-imggroup-img'));
  }

  function imageSyncKey(img) {
    if (!img) return '';
    var group = img;
    while (group && group.nodeType === 1 && !(group.classList && group.classList.contains('bn-imggroup'))) group = group.parentElement;
    /* MSBN 每張圖片都要獨立縮放；不要使用副區的同檔名 LOGO 連動。 */
    if (isMsbnGroup(group)) return '';
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

  function imageEditorGeometry(img) {
    var data = img && img.dataset;
    if (!data) return null;
    var sourceWidth = Number(data.layoutSourceWidth);
    var sourceHeight = Number(data.layoutSourceHeight);
    var outputWidth = Number(data.layoutOutputWidth);
    var outputHeight = Number(data.layoutOutputHeight);
    if (!(sourceWidth > 0 && sourceHeight > 0 && outputWidth > 0 && outputHeight > 0)) return null;
    return {
      sourceWidth: sourceWidth,
      sourceHeight: sourceHeight,
      outputWidth: outputWidth,
      outputHeight: outputHeight,
      offsetX: Number(data.layoutOffsetX) || 0,
      offsetY: Number(data.layoutOffsetY) || 0
    };
  }

  /* 把記住的位移套到這張圖上（用 transform，不影響其他張圖的排版位置）。
     編輯器輸出可能比商品本體多出影子邊界；矩陣會把本體還原到原來的錨點，
     同時讓影子延伸到圖片框外，flex 佔位仍維持原寬度。 */
  /* override：只用在畫面上的位移（例如暫時夾回範圍內），不寫回 offsetStore。
     實際套在畫面上的位移記在 img._bnAppliedOffset，供夾制計算與拖曳起點使用。 */
  function applyOffset(img, groupKey, index, override) {
    var o = override || getOffset(groupKey, index);
    img._bnAppliedOffset = { x: o.x || 0, y: o.y || 0 };
    var weight = getWeight(groupKey, index, img);
    var geometry = imageEditorGeometry(img);
    img._bnImageLayoutWeight = weight;
    if (geometry && img.offsetWidth) {
      var baseWidth = img.offsetWidth;
      var productHeight = baseWidth * geometry.sourceHeight / geometry.sourceWidth;
      var group = img.parentElement;
      var groupHeight = group ? group.clientHeight : img.offsetHeight;
      var layoutTop = (groupHeight - img.offsetHeight) / 2;
      var desiredTop = (groupHeight - productHeight) / 2;
      var editScale = geometry.outputWidth / geometry.sourceWidth;
      var txEdit = -geometry.offsetX * baseWidth / geometry.sourceWidth;
      var tyEdit = desiredTop - layoutTop - geometry.offsetY * baseWidth / geometry.sourceWidth;
      var centerX = baseWidth / 2;
      var centerY = desiredTop - layoutTop + productHeight / 2;
      var scale = editScale * weight;
      var tx = o.x + centerX * (1 - weight) + weight * txEdit;
      var ty = o.y + centerY * (1 - weight) + weight * tyEdit;
      img.style.transformOrigin = 'top left';
      img.style.transform = 'matrix(' + scale + ',0,0,' + scale + ',' + tx + ',' + ty + ')';
      img._bnImageLayoutScale = scale;
      return;
    }
    img.style.transformOrigin = 'center center';
    var transforms = [];
    if (o.x || o.y) transforms.push('translate(' + o.x + 'px,' + o.y + 'px)');
    if (weight !== 1) transforms.push('scale(' + weight + ')');
    img.style.transform = transforms.join(' ');
    img._bnImageLayoutScale = weight;
  }

  /* ── 匯入工單圖片邊界 ──────────────────────────────────────
     一般圖片使用自己的 data-img-field 圖片框；商品／贈品／代言人／簽名檔
     在同一個編號（或同一個 repeat 實例）時，使用所有相關圖片框的聯集。
     這樣同一區域的多張素材可以在共同空間內重新排版，但不會跑出版位；副區與 MSBN 皆適用。 */
  function workOrderMountOf(el) {
    while (el && el.nodeType === 1) {
      /* 匯入工單與維修畫布的副區、MSBN 都包在各自的 mount／stage；
         不依賴 blockId，所以副區、MSBN 及 MSBN 內副區排都會套用。 */
      if ((el.id && /^(imp|mnt|prevall)-mount-/i.test(el.id)) ||
          (el.classList && (el.classList.contains('imp-slot') || el.classList.contains('imp-mount') ||
            el.classList.contains('mt-stage') || el.classList.contains('preview-all-mount')))) {
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
    /* MSBN B-1-3／B-1-4 的商品圖只能在白底圓角框內移動與縮放；
       不要把同版位的整張卡片底色算進來。 */
    if (zone.getAttribute('data-image-boundary') === 'own') {
      var ownBoundary = zone.getBoundingClientRect();
      if (!ownBoundary.width || !ownBoundary.height) return null;
      return {
        left: ownBoundary.left, top: ownBoundary.top,
        right: ownBoundary.right, bottom: ownBoundary.bottom,
        width: ownBoundary.width, height: ownBoundary.height
      };
    }
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
    var ownScale = Number(el && el._bnImageLayoutScale) || Number(el && el._bnImageLayoutWeight) || 1;
    var sx = el.offsetWidth ? rect.width / el.offsetWidth / ownScale : 1;
    var sy = el.offsetHeight ? rect.height / el.offsetHeight / ownScale : sx;
    if (!isFinite(sx) || sx <= 0) sx = 1;
    if (!isFinite(sy) || sy <= 0) sy = sx;
    return { x: sx, y: sy };
  }

  /* displayOnly：自動排版（重畫、圖片載入、還原暫存）只把畫面上的位置夾回範圍內，
     不改寫存好的位移。第一次排版時圖片框可能還沒切換成正確的直／橫範圍、或還是舊畫面，
     若直接寫回，使用者調好的位置會被永久夾掉，暫存檔／重新整理就還原不回來。
     拖曳、滾輪、四角縮放等使用者操作才會寫回夾制後的結果。 */
  function clampImageOffset(img, groupKey, index, bounds, displayOnly) {
    if (!bounds || !img || !img.offsetWidth || !img.offsetHeight) return;
    var stored = getOffset(groupKey, index);
    /* rect 反映的是「目前畫面上套用的」位移，基準位置要用它反推。 */
    var offset = img._bnAppliedOffset || stored;
    var rect = img.getBoundingClientRect();
    var scale = elementScale(img, rect);
    var geometry = imageEditorGeometry(img);
    var weight = getWeight(groupKey, index, img);
    var visualW = rect.width, visualH = rect.height;
    var baseLeft, baseTop, imageW, imageH;
    if (geometry) {
      /* 只用商品本體夾制；影子可以自然延伸出圖片框，不會因陰影大小推動商品。 */
      imageW = img.offsetWidth * weight * scale.x;
      imageH = img.offsetWidth * geometry.sourceHeight / geometry.sourceWidth * weight * scale.y;
      var productOffsetX = weight * geometry.offsetX * img.offsetWidth / geometry.sourceWidth * scale.x;
      var productOffsetY = weight * geometry.offsetY * img.offsetWidth / geometry.sourceWidth * scale.y;
      baseLeft = rect.left + productOffsetX - offset.x * scale.x;
      baseTop = rect.top + productOffsetY - offset.y * scale.y;
    } else {
      /* 先回到目前縮放比例下「尚未平移」的實際邊界；縮放中心造成的位移也要保留，
         讓邊界夾制不會自行把已置中的圖片往上或往左推。 */
      baseLeft = rect.left - offset.x * scale.x;
      baseTop = rect.top - offset.y * scale.y;
      imageW = visualW;
      imageH = visualH;
    }
    /* 圖片小於可用區時仍完整留在區內；放大後則允許大於區域，
       只限制它持續覆蓋圖片區，讓使用者可自由平移取景，超出部分由容器裁切。 */
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
    var x = Math.min(maxX, Math.max(minX, stored.x));
    var y = Math.min(maxY, Math.max(minY, stored.y));
    if (!isFinite(x)) x = 0;
    if (!isFinite(y)) y = 0;
    if (displayOnly) {
      if (Math.abs(x - offset.x) > 0.01 || Math.abs(y - offset.y) > 0.01) applyOffset(img, groupKey, index, { x: x, y: y });
      return;
    }
    if (Math.abs(x - stored.x) > 0.01 || Math.abs(y - stored.y) > 0.01) {
      setOffset(groupKey, index, x, y);
      applyOffset(img, groupKey, index);
    } else if (Math.abs(stored.x - offset.x) > 0.01 || Math.abs(stored.y - offset.y) > 0.01) {
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
  /* opts.persistClamp：使用者剛縮放（滾輪、四角把手）時，夾回範圍內的位置要寫回；
     其他自動排版只影響畫面，不改寫存好的位移（見 clampImageOffset）。 */
  function applyLayout(group, opts) {
    var persistClamp = !!(opts && opts.persistClamp);
    var imgs = getImgs(group);
    if (!imgs.length) return;
    /* overflow:hidden 的圖片框也是捲動容器，scrollIntoView／聚焦可能把它內部捲動，
       圖片看起來就被位移了；排版時一律歸零。 */
    var zoneEl = closestImageZone(group);
    if (zoneEl && (zoneEl.scrollTop || zoneEl.scrollLeft)) { zoneEl.scrollTop = 0; zoneEl.scrollLeft = 0; }

    var containerH = group.clientHeight;
    var containerW = group.clientWidth;
    if (!containerH || !containerW) return;

    var groupKey = getGroupKey(group);
    var bounded = isBoundedWorkOrderGroup(group);
    var bounds = bounded ? imageBoundaryOfGroup(group) : null;
    var n = imgs.length;
    var totalGap = GAP * (n - 1);

    var savedSlotRatios = null;
    var savedGapPx = null;
    /* 佔位比例是在某個容器大小下算出來的。容器大小一變（例如依曝品原圖直／橫，把曝品＋贈品
       範圍從寬版切成直版），就要用新範圍重算；不能沿用舊範圍的比例，否則重畫時誰先排版，
       誰就會被縮成舊範圍的大小（換前後位置後商品突然變大／變小就是這個原因）。
       換影子圖等容器不變的情況，仍沿用原本比例，同組其他圖片不會跳動。 */
    var slotBox = containerW + 'x' + containerH;
    imgs.some(function (img) {
      if (!img.dataset || !img.dataset.layoutSlotRatios) return false;
      if (img.dataset.layoutSlotBox && img.dataset.layoutSlotBox !== slotBox) return false;
      try {
        var parsed = JSON.parse(img.dataset.layoutSlotRatios);
        if (Array.isArray(parsed) && parsed.length === imgs.length && parsed.every(function (ratio) {
          return typeof ratio === 'number' && isFinite(ratio) && ratio >= 0;
        })) {
          savedSlotRatios = parsed;
          var gapPx = Number(img.dataset.layoutGapPx);
          if (isFinite(gapPx) && gapPx >= 0) savedGapPx = gapPx;
          return true;
        }
      } catch (e) {}
      return false;
    });
    var layoutGap = savedSlotRatios ? (savedGapPx == null ? GAP : savedGapPx) : GAP;
    var baseWidths = imgs.map(function (img, i) {
      if (savedSlotRatios) return savedSlotRatios[i] * containerW;
      /* 烘過影子／編輯器輸出的圖：flex 佔位用「商品本體」的寬高比，不是整張輸出圖的；
         影子多出來的寬度由 applyOffset 的矩陣延伸到框外，不會把商品本體擠小。 */
      var geometry = imageEditorGeometry(img);
      var ratio = geometry ? (geometry.sourceWidth / geometry.sourceHeight)
        : ((img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : 1);
      return containerH * ratio;
    });
    var baseTotalW = baseWidths.reduce(function (a, b) { return a + b; }, 0);

    var fitScale = 1;
    if (!savedSlotRatios && baseTotalW + totalGap > containerW && baseTotalW > 0) {
      fitScale = Math.max((containerW - totalGap) / baseTotalW, 0.02);
    }

    group.style.gap = layoutGap + 'px';
    var appliedSlotRatios = [];
    imgs.forEach(function (img, i) {
      var weight = getWeight(groupKey, i, img);

      /* 權重只做視覺 transform，不改 flex 佔位寬度；縮放單張圖時，
         同組其他圖片的起點與間距因此固定不動。 */
      var slotWidth = baseWidths[i] * fitScale;
      img.style.width = slotWidth + 'px';
      img.style.height = 'auto';
      img.style.maxWidth = 'none';
      img.style.maxHeight = 'none';
      appliedSlotRatios.push(slotWidth / containerW);
      applyOffset(img, groupKey, i);
      if (bounds) clampImageOffset(img, groupKey, i, bounds, !persistClamp);
    });
    imgs.forEach(function (img) {
      if (!img.dataset) return;
      img.dataset.layoutSlotRatios = JSON.stringify(appliedSlotRatios);
      img.dataset.layoutGapPx = String(layoutGap);
      img.dataset.layoutSlotBox = slotBox;
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
    /* LOGO 區固定白底，不再取圖片左上角像素色。 */
    target.style.backgroundColor = '#ffffff';
    target.removeAttribute('data-logo-bg-sampled');
    target.removeAttribute('data-logo-bg-transparent');
    return;
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
    /* 正方形沒有落在「寬小於高」，依需求與未上傳狀態一起使用 wide。
       烘過影子的圖整張會比商品寬，要用商品本體的寬高比來判斷。 */
    var sourceGeometry = sourceImg ? imageEditorGeometry(sourceImg) : null;
    var sourceW = sourceGeometry ? sourceGeometry.sourceWidth : (sourceImg ? sourceImg.naturalWidth : 0);
    var sourceH = sourceGeometry ? sourceGeometry.sourceHeight : (sourceImg ? sourceImg.naturalHeight : 0);
    var mode = sourceImg && sourceW < sourceH ? 'tall' : 'wide';
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

  /* ── 匯入工單商品：畫布內四角縮放／旋轉把手 ───────────────────
     操作邏輯沿用 SHOPEE 商品框：縮放點只改這張商品的權重，旋轉把手以商品
     中心計算任意角度。影子本身不在這個檔案重繪，避免 image-layout 和影子
     模組互相依賴；旋轉事件交給 index.html 的 BODAImportShadow 管線處理：
       clean base → rotate → rebuild shadow → keep current visual scale
     因此不會把舊影子一起旋轉，也不會在連續操作後逐次縮小。 */
  var transformSelection = null;
  var transformOverlay = null;
  var transformOverlayParts = null;
  var transformOverlayRefreshQueued = false;

  /* 可以點選出四角縮放／↻ 旋轉框的圖片：
     - 商品、贈品：旋轉後由 index.html 重新合成影子；
     - 代言人圖：一樣可縮放／旋轉，但不烘影子（index.html 旋轉後直接寫回）。
     簽名與 LOGO 維持原本操作，不顯示把手。 */
  function isImportTransformImage(group) {
    if (!group || imageHistoryContext(group) !== 'import') return false;
    return /^(?:productImg|giftImg|endorserImg)\d*$/i.test(String(group.getAttribute('data-field-key') || ''));
  }

  function installTransformOverlay() {
    if (transformOverlay || typeof document === 'undefined' || !document.body) return;
    var style = document.createElement('style');
    style.setAttribute('data-bn-import-transform-style', '1');
    style.textContent = '' +
      '.bn-import-transform-overlay{position:fixed;z-index:40000;display:none;box-sizing:border-box;pointer-events:none;border:1.5px solid #229188;box-shadow:0 0 0 1px rgba(255,255,255,.78),0 1px 6px rgba(0,0,0,.22);}' +
      '.bn-import-transform-overlay.is-processing{border-style:dashed;opacity:.82;}' +
      '.bn-import-transform-corner{position:absolute;box-sizing:border-box;width:12px;height:12px;padding:0;border:2px solid #fff;border-radius:50%;background:#229188;box-shadow:0 1px 3px rgba(0,0,0,.3);pointer-events:auto;touch-action:none;}' +
      '.bn-import-transform-corner[data-bn-corner="nw"]{left:0;top:0;transform:translate(-50%,-50%);cursor:nwse-resize;}' +
      '.bn-import-transform-corner[data-bn-corner="ne"]{right:0;top:0;transform:translate(50%,-50%);cursor:nesw-resize;}' +
      '.bn-import-transform-corner[data-bn-corner="sw"]{left:0;bottom:0;transform:translate(-50%,50%);cursor:nesw-resize;}' +
      '.bn-import-transform-corner[data-bn-corner="se"]{right:0;bottom:0;transform:translate(50%,50%);cursor:nwse-resize;}' +
      '.bn-import-transform-rotate{position:absolute;left:50%;top:-38px;box-sizing:border-box;width:27px;height:27px;padding:0;border:2px solid #fff;border-radius:50%;background:#229188;color:#fff;font:700 19px/22px Arial,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.3);transform:translateX(-50%);cursor:grab;pointer-events:auto;touch-action:none;}' +
      '.bn-import-transform-rotate:active{cursor:grabbing;}' +
      '.bn-import-transform-badge{position:absolute;left:50%;top:-66px;display:none;min-width:36px;padding:2px 5px;border-radius:4px;background:rgba(20,40,35,.9);color:#fff;font:700 10px/1.2 Arial,sans-serif;text-align:center;transform:translateX(-50%);white-space:nowrap;pointer-events:none;}' +
      /* LOGO、簽名等不能縮放旋轉的圖：從右側工具列點選時只框出位置，不顯示把手。 */
      '.bn-import-transform-overlay.is-frame-only .bn-import-transform-corner,.bn-import-transform-overlay.is-frame-only .bn-import-transform-rotate{display:none;}' +
      '.bn-import-transform-overlay.is-frame-only{border-style:dashed;}';
    (document.head || document.documentElement).appendChild(style);

    var overlay = document.createElement('div');
    overlay.className = 'bn-import-transform-overlay';
    overlay.setAttribute('data-bn-edit-only', '1');
    overlay.setAttribute('aria-label', '圖片縮放與旋轉控制');
    ['nw', 'ne', 'sw', 'se'].forEach(function (corner) {
      var handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'bn-import-transform-corner';
      handle.setAttribute('data-bn-corner', corner);
      handle.setAttribute('aria-label', '等比例縮放圖片');
      overlay.appendChild(handle);
    });
    var rotate = document.createElement('button');
    rotate.type = 'button';
    rotate.className = 'bn-import-transform-rotate';
    rotate.setAttribute('aria-label', '拖曳可任意旋轉圖片，雙擊可復原本次旋轉');
    rotate.title = '拖曳可任意旋轉圖片';
    rotate.textContent = '↻';
    overlay.appendChild(rotate);
    var badge = document.createElement('span');
    badge.className = 'bn-import-transform-badge';
    overlay.appendChild(badge);
    document.body.appendChild(overlay);
    transformOverlay = overlay;
    transformOverlayParts = { rotate: rotate, badge: badge };
    bindTransformResizeHandles(overlay);
    bindTransformRotateHandle(rotate, badge);

    document.addEventListener('pointerdown', function (event) {
      if (!transformSelection || !transformOverlay) return;
      var target = event.target;
      if (target === transformSelection.img || transformOverlay.contains(target)) return;
      hideTransformOverlay();
    }, true);
    window.addEventListener('resize', scheduleTransformOverlayRefresh);
    window.addEventListener('scroll', scheduleTransformOverlayRefresh, true);
  }

  /* index.html 另外存的「商品本體在含影子輸出圖中的位置」（data-product-body-*）。
     會裁切的圖片框排版時不用 layout* 幾何（整張 contain），但選取框仍要只框商品本體。 */
  function productBodyGeometry(img) {
    var data = img && img.dataset;
    if (!data) return null;
    var g = {
      sourceWidth: Number(data.productBodyWidth),
      sourceHeight: Number(data.productBodyHeight),
      outputWidth: Number(data.productOutputWidth),
      outputHeight: Number(data.productOutputHeight),
      offsetX: Number(data.productBodyOffsetX) || 0,
      offsetY: Number(data.productBodyOffsetY) || 0
    };
    return g.sourceWidth > 0 && g.sourceHeight > 0 && g.outputWidth > 0 && g.outputHeight > 0 ? g : null;
  }

  /* 選取框範圍：只框商品本體，不含影子。 */
  function visibleProductRect(img) {
    if (!img || !img.getBoundingClientRect) return null;
    var rect = img.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    var geometry = imageEditorGeometry(img) || productBodyGeometry(img);
    if (!geometry || !(geometry.outputWidth > 0 && geometry.outputHeight > 0)) return rect;
    return {
      left: rect.left + rect.width * geometry.offsetX / geometry.outputWidth,
      top: rect.top + rect.height * geometry.offsetY / geometry.outputHeight,
      width: rect.width * geometry.sourceWidth / geometry.outputWidth,
      height: rect.height * geometry.sourceHeight / geometry.outputHeight
    };
  }

  function refreshTransformOverlay() {
    transformOverlayRefreshQueued = false;
    if (!transformSelection || !transformOverlay) return;
    var img = transformSelection.img;
    var group = transformSelection.group;
    if (!img || !img.isConnected || !group || !group.isConnected ||
        (!transformSelection.frameOnly && !isImportTransformImage(group))) {
      hideTransformOverlay();
      return;
    }
    var mount = workOrderMountOf(group);
    if (!mount || (mount.closest && mount.closest('.bn-export-capture'))) {
      transformOverlay.style.display = 'none';
      return;
    }
    var rect = visibleProductRect(img);
    if (!rect || rect.width < 2 || rect.height < 2) {
      transformOverlay.style.display = 'none';
      return;
    }
    transformOverlay.style.left = rect.left + 'px';
    transformOverlay.style.top = rect.top + 'px';
    transformOverlay.style.width = rect.width + 'px';
    transformOverlay.style.height = rect.height + 'px';
    transformOverlay.style.display = 'block';
  }

  function scheduleTransformOverlayRefresh() {
    if (transformOverlayRefreshQueued) return;
    transformOverlayRefreshQueued = true;
    /* 下一個繪製週期更新；視窗在背景時 rAF 可能暫停，最多等 60ms 也要更新。 */
    var run = function () { if (transformOverlayRefreshQueued) refreshTransformOverlay(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    setTimeout(run, 60);
  }

  function hideTransformOverlay() {
    transformSelection = null;
    clearSelectionPriority();
    if (transformOverlay) {
      transformOverlay.style.display = 'none';
      transformOverlay.classList.remove('is-processing');
      transformOverlay.classList.remove('is-frame-only');
    }
  }

  /* opts.frameOnly：只框出位置（LOGO、簽名等不能縮放旋轉的圖）。
     opts.priority：從右側工具列指定要操作這一張時，疊在它上面的其他圖片暫時讓開滑鼠，
     即使被別張圖蓋住，也能直接在畫布上拖曳、滾輪縮放；點畫布其他地方取消選取就恢復。 */
  function selectTransformImage(img, group, index, opts) {
    opts = opts || {};
    if (!opts.frameOnly && !isImportTransformImage(group)) return;
    installTransformOverlay();
    clearSelectionPriority();
    transformSelection = { img: img, group: group, index: index, frameOnly: !!opts.frameOnly };
    transformOverlay.classList.toggle('is-frame-only', !!opts.frameOnly);
    if (opts.priority) applySelectionPriority(img);
    scheduleTransformOverlayRefresh();
  }

  /* ── 圖片點擊判定 ─────────────────────────────────────────
     圖片元素的可點範圍是整個矩形，連透明的部分也算；兩張圖疊在一起時，
     上層圖片的透明邊會擋住下層看得到的圖，造成「看起來沒擋到卻點不到」。 */
  var yieldedImages = [];
  function stackingZOf(el) {
    var z = Number(el && el.style && el.style.zIndex);
    return isFinite(z) ? z : 0;
  }
  /* a 是否疊在 b 上面（同一個版位內）：先比圖片框的 z-index，再比框內的 z-index，最後比 HTML 先後。 */
  function imageIsAbove(a, b) {
    var za = a.closest ? a.closest('[data-img-field]') : null;
    var zb = b.closest ? b.closest('[data-img-field]') : null;
    if (za && zb && za !== zb) {
      var dz = stackingZOf(za) - stackingZOf(zb);
      if (dz) return dz > 0;
      return !!(za.compareDocumentPosition(zb) & Node.DOCUMENT_POSITION_PRECEDING);
    }
    var di = stackingZOf(a) - stackingZOf(b);
    if (di) return di > 0;
    return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING);
  }
  function rectsOverlap(a, b) {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  }
  /* 圖片外面那兩層容器（圖片框 [data-img-field] 與 .bn-imggroup）本身透明，卻會接收滑鼠；
     上層欄位的容器常整塊蓋住下層圖片，造成「看起來沒擋到卻點不到」。
     有背景色（例如曝品範圍的色塊）的框是看得到的，不算透明容器。 */
  function isTransparentImageContainer(el) {
    if (!el || el.nodeType !== 1 || !el.classList) return false;
    if (!el.classList.contains('bn-imggroup') && !el.hasAttribute('data-img-field')) return false;
    if (!workOrderMountOf(el)) return false;
    var cs = window.getComputedStyle(el);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return false;
    var m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor || '');
    if (m) {
      var parts = m[1].split(',');
      var alpha = parts.length > 3 ? Number(parts[3]) : 1;
      if (alpha > 0.05) return false;
    }
    return true;
  }
  function yieldElement(el) {
    if (!el || el.classList.contains('bn-img-yield')) return;
    el.classList.add('bn-img-yield');
    yieldedImages.push(el);
  }
  function applySelectionPriority(img) {
    var mount = workOrderMountOf(img);
    if (!mount) return;
    var rect = img.getBoundingClientRect();
    var ownGroup = img.closest('.bn-imggroup');
    var ownZone = img.closest('[data-img-field]');
    Array.prototype.forEach.call(mount.querySelectorAll('img.bn-imggroup-img'), function (other) {
      if (other === img || !rectsOverlap(rect, other.getBoundingClientRect()) || !imageIsAbove(other, img)) return;
      yieldElement(other);
      /* 連同它外面的透明容器一起讓開（不能是被選圖片自己的容器）。 */
      [other.closest('.bn-imggroup'), other.closest('[data-img-field]')].forEach(function (box) {
        if (box && box !== ownGroup && box !== ownZone && !box.contains(img) && isTransparentImageContainer(box)) yieldElement(box);
      });
    });
  }
  function clearSelectionPriority() {
    yieldedImages.forEach(function (other) { other.classList.remove('bn-img-yield'); });
    yieldedImages = [];
  }

  /* 透明處點穿：滑鼠停在某張圖的透明像素上、而且下面還有圖片時，讓這張圖暫時不接收滑鼠，
     按下去就會落在下面真正看得到的那張（拖曳、滾輪縮放、點選都一樣）。 */
  var alphaSamples = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var passThroughImages = [];
  var passThroughFrame = 0;
  var passThroughPoint = null;
  function installPointerStyle() {
    if (typeof document === 'undefined' || document.querySelector('style[data-bn-image-pointer-style]')) return;
    var style = document.createElement('style');
    style.setAttribute('data-bn-image-pointer-style', '1');
    style.textContent = '.bn-img-passthrough,.bn-img-yield{pointer-events:none !important;}';
    (document.head || document.documentElement).appendChild(style);
  }
  function alphaAtPoint(img, x, y) {
    if (!alphaSamples || !img.complete || !img.naturalWidth || !img.naturalHeight) return 255;
    var src = img.currentSrc || img.src || '';
    var sample = alphaSamples.get(img);
    if (!sample || sample.src !== src) {
      var scale = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth * scale));
      var h = Math.max(1, Math.round(img.naturalHeight * scale));
      sample = { src: src, w: 0, h: 0, data: null };
      try {
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        sample = { src: src, w: w, h: h, data: ctx.getImageData(0, 0, w, h).data };
      } catch (e) { /* 跨網域圖片讀不到像素：當成不透明，維持原本的點擊行為 */ }
      alphaSamples.set(img, sample);
    }
    if (!sample.data) return 255;
    var rect = img.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return 0;
    /* 圖片以 object-fit:contain 置中顯示；先算出實際畫圖的範圍再對應像素。 */
    var fit = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
    var drawW = img.naturalWidth * fit, drawH = img.naturalHeight * fit;
    var u = (x - rect.left - (rect.width - drawW) / 2) / drawW;
    var v = (y - rect.top - (rect.height - drawH) / 2) / drawH;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
    var px = Math.min(sample.w - 1, Math.floor(u * sample.w));
    var py = Math.min(sample.h - 1, Math.floor(v * sample.h));
    return sample.data[(py * sample.w + px) * 4 + 3];
  }
  function restorePassThrough() {
    passThroughImages.forEach(function (img) { img.classList.remove('bn-img-passthrough'); });
    passThroughImages = [];
  }
  function updatePassThrough() {
    passThroughFrame = 0;
    var point = passThroughPoint;
    restorePassThrough();
    if (!point || typeof document.elementsFromPoint !== 'function') return;
    var stack = document.elementsFromPoint(point.x, point.y);
    /* 由上往下找第一張「這一點有顏色」的圖片；在它之上的透明圖片、透明容器都讓滑鼠穿過去。
       中間遇到文字、色塊等其他圖層就停止（那是看得到的內容，維持原本的點擊行為）。 */
    var skip = [];
    var target = null;
    for (var i = 0; i < stack.length; i++) {
      var el = stack[i];
      if (el.matches && el.matches('img.bn-imggroup-img')) {
        if (alphaAtPoint(el, point.x, point.y) > 24) { target = el; break; }
        skip.push(el);
        continue;
      }
      if (isTransparentImageContainer(el)) { skip.push(el); continue; }
      break;
    }
    if (!target || !skip.length) return;
    /* 目標圖片自己的容器不能穿過（它們在目標下面，本來就不會擋到）。 */
    skip.forEach(function (el) {
      if (el.contains && el.contains(target)) return;
      el.classList.add('bn-img-passthrough');
      passThroughImages.push(el);
    });
  }
  function isPassThroughCandidate(el) {
    return !!(el && el.matches && (el.matches('img.bn-imggroup-img') || el.matches('.bn-imggroup') || el.hasAttribute('data-img-field')));
  }
  function schedulePassThrough(event) {
    if (event.buttons) return; /* 拖曳中不換目標 */
    var onImage = isPassThroughCandidate(event.target);
    if (!onImage && !passThroughImages.length) return;
    passThroughPoint = { x: event.clientX, y: event.clientY };
    if (passThroughFrame) return;
    /* 用計時器而不是 requestAnimationFrame：視窗在背景時 rAF 可能整個暫停，排程會卡住不再更新。 */
    passThroughFrame = setTimeout(updatePassThrough, 16);
  }
  if (typeof document !== 'undefined') {
    installPointerStyle();
    document.addEventListener('pointermove', schedulePassThrough, true);
    /* 只在滑鼠真的離開視窗時重置（pointerout 且沒有 relatedTarget）；不能監聽 pointerleave，
       它在每個元素離開時都會觸發，點穿一生效就會被自己取消。 */
    document.addEventListener('pointerout', function (event) {
      if (event.relatedTarget) return;
      passThroughPoint = null;
      restorePassThrough();
    }, true);
    /* 從素材區拖圖片進畫布時，放開的位置要照原本的圖片框判定，不能被點穿狀態影響。 */
    document.addEventListener('dragenter', function () { passThroughPoint = null; restorePassThrough(); }, true);
  }

  /* 給右側工具列使用：框出指定的圖片並讓它優先接收滑鼠；能縮放旋轉的圖同時顯示把手。 */
  function selectImageFromTool(img) {
    if (!img || !img.closest) return false;
    var group = img.closest('.bn-imggroup');
    if (!group) return false;
    var index = getImgs(group).indexOf(img);
    if (index < 0) return false;
    installPointerStyle();
    selectTransformImage(img, group, index, { frameOnly: !isImportTransformImage(group), priority: true });
    return true;
  }

  function currentTransformSelection() {
    if (!transformSelection || !transformSelection.img || !transformSelection.img.isConnected) return null;
    return transformSelection;
  }

  function dispatchProductTransform(stage, selection, angle) {
    if (!selection) return;
    try {
      window.dispatchEvent(new CustomEvent('bn-import-product-transform', {
        detail: {
          stage: stage,
          angle: Number(angle) || 0,
          img: selection.img,
          group: selection.group,
          index: selection.index,
          fieldKey: selection.group.getAttribute('data-field-key') || ''
        }
      }));
    } catch (e) {}
  }

  function normalizeTransformAngle(value) {
    value = Number(value) || 0;
    value = ((value % 360) + 360) % 360;
    return value > 180 ? value - 360 : value;
  }

  function formatTransformAngle(value) {
    var rounded = Math.round((Number(value) || 0) * 10) / 10;
    return String(rounded).replace(/\.0$/, '') + '°';
  }

  function bindTransformResizeHandles(overlay) {
    Array.prototype.forEach.call(overlay.querySelectorAll('[data-bn-corner]'), function (handle) {
      handle.addEventListener('pointerdown', function (event) {
        if (event.button !== 0) return;
        var selection = currentTransformSelection();
        if (!selection) return;
        var rect = visibleProductRect(selection.img);
        if (!rect) return;
        event.preventDefault();
        event.stopPropagation();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var startDistance = Math.max(8, Math.hypot(event.clientX - cx, event.clientY - cy));
        var groupKey = getGroupKey(selection.group);
        var startWeight = getWeight(groupKey, selection.index, selection.img);
        var moved = false;
        emitImageHistory(selection.group, 'begin', 'resize');
        try { handle.setPointerCapture(event.pointerId); } catch (e) {}
        function move(moveEvent) {
          var current = currentTransformSelection();
          if (!current || current.img !== selection.img) return;
          var nextDistance = Math.max(4, Math.hypot(moveEvent.clientX - cx, moveEvent.clientY - cy));
          var nextWeight = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, startWeight * nextDistance / startDistance));
          if (Math.abs(nextWeight - getWeight(groupKey, selection.index, selection.img)) < 0.001) return;
          moved = true;
          setWeight(groupKey, selection.index, nextWeight, selection.img);
          applyLayout(selection.group, { persistClamp: true });
          scheduleTransformOverlayRefresh();
        }
        function finish() {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', finish);
          handle.removeEventListener('pointercancel', finish);
          handle.removeEventListener('lostpointercapture', finish);
          emitImageHistory(selection.group, 'commit', moved ? 'resize' : 'noop');
          scheduleTransformOverlayRefresh();
        }
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
        handle.addEventListener('lostpointercapture', finish);
      });
    });
  }

  function bindTransformRotateHandle(handle, badge) {
    handle.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      var selection = currentTransformSelection();
      var rect = selection && visibleProductRect(selection.img);
      if (!selection || !rect) return;
      event.preventDefault();
      event.stopPropagation();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var startAngle = Math.atan2(event.clientY - cy, event.clientX - cx);
      var lastAngle = 0;
      if (transformOverlay) transformOverlay.classList.add('is-processing');
      badge.textContent = formatTransformAngle(0);
      badge.style.display = 'block';
      emitImageHistory(selection.group, 'begin', 'rotate');
      dispatchProductTransform('rotate-start', selection, 0);
      try { handle.setPointerCapture(event.pointerId); } catch (e) {}
      function move(moveEvent) {
        var current = currentTransformSelection();
        if (!current || current.img !== selection.img) return;
        var angle = normalizeTransformAngle((Math.atan2(moveEvent.clientY - cy, moveEvent.clientX - cx) - startAngle) * 180 / Math.PI);
        if (moveEvent.shiftKey) angle = Math.round(angle / 15) * 15;
        else {
          var near = Math.round(angle / 90) * 90;
          if (Math.abs(angle - near) < 3) angle = near;
        }
        angle = normalizeTransformAngle(angle);
        if (Math.abs(angle - lastAngle) < 0.15) return;
        lastAngle = angle;
        badge.textContent = formatTransformAngle(angle);
        /* index.html 會節流重製，拖曳期間每一個最新角度都會從同一張乾淨底圖處理。 */
        dispatchProductTransform('rotate-change', selection, angle);
      }
      function finish() {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        handle.removeEventListener('lostpointercapture', finish);
        badge.style.display = 'none';
        if (transformOverlay) transformOverlay.classList.remove('is-processing');
        dispatchProductTransform('rotate-end', selection, lastAngle);
        emitImageHistory(selection.group, 'commit', Math.abs(lastAngle) >= 0.15 ? 'rotate' : 'noop');
        scheduleTransformOverlayRefresh();
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
      handle.addEventListener('lostpointercapture', finish);
    });
  }

  /* 滑鼠滾輪縮放＋按住左鍵拖曳移動：都要綁在「每一張圖片自己身上」，不是綁在整個群組，
     這樣滑鼠停在哪一張上面操作，就只會動到那一張 */
  function enableImageInteractions(group) {
    getImgs(group).forEach(function (img, i) {
      /* 滾輪縮放 */
      img.addEventListener('load', function () {
        /* 裁切編輯器會原位換 src；只更新這張圖的 transform，保持同組 flex 位置。 */
        applyOffset(img, getGroupKey(group), i);
        if (isBoundedWorkOrderGroup(group)) {
          clampImageOffset(img, getGroupKey(group), i, imageBoundaryOfGroup(group), true);
        }
        if (transformSelection && transformSelection.img === img) scheduleTransformOverlayRefresh();
      });

      img.addEventListener('wheel', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!img._bnImageLayoutWheelTimer) emitImageHistory(group, 'begin', 'zoom');
        else clearTimeout(img._bnImageLayoutWheelTimer);
        var groupKey = getGroupKey(group);
        var w = getWeight(groupKey, i, img);
        w += (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
        w = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, w));
        setWeight(groupKey, i, w, img);
        applyLayout(group, { persistClamp: true });
        if (transformSelection && transformSelection.img === img) scheduleTransformOverlayRefresh();
        img._bnImageLayoutWheelTimer = setTimeout(function () {
          img._bnImageLayoutWheelTimer = null;
          emitImageHistory(group, 'commit', 'zoom');
        }, 220);
      }, { passive: false });

      /* 按住左鍵拖曳移動這一張圖 */
      img.draggable = false; /* 關掉瀏覽器原生的「拖曳圖片」，不然會出現半透明殘影 */
      img.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        emitImageHistory(group, 'begin', 'move');
        var groupKey = getGroupKey(group);
        /* 從畫面上實際看到的位置開始拖（可能是自動夾回範圍後的位置），圖片才不會一按就跳。 */
        var start = img._bnAppliedOffset ? { x: img._bnAppliedOffset.x, y: img._bnAppliedOffset.y } : getOffset(groupKey, i);
        var startX = e.clientX, startY = e.clientY;
        var moved = false;
        /* 匯入預覽整塊會被 CSS transform 縮放，滑鼠移動的距離要換算回原始尺寸，
           不然縮到 50% 時圖片會跑得比滑鼠快一倍 */
        var rect = img.getBoundingClientRect();
        var scale = elementScale(img, rect).x;
        if (!scale || !isFinite(scale)) scale = 1;
        var prevCursor = img.style.cursor;
        img.style.cursor = 'grabbing';

        function onMove(ev) {
          moved = true;
          var nextX = start.x + (ev.clientX - startX) / scale;
          var nextY = start.y + (ev.clientY - startY) / scale;
          setOffset(groupKey, i, nextX, nextY);
          applyOffset(img, groupKey, i);
          if (isBoundedWorkOrderGroup(group)) {
            clampImageOffset(img, groupKey, i, imageBoundaryOfGroup(group));
          }
          if (transformSelection && transformSelection.img === img) scheduleTransformOverlayRefresh();
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          img.style.cursor = prevCursor || 'grab';
          emitImageHistory(group, 'commit', moved ? 'move' : 'noop');
          if (transformSelection && transformSelection.img === img) scheduleTransformOverlayRefresh();
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      /* 連按兩下：這張圖回到原本的大小與位置 */
      img.addEventListener('dblclick', function (e) {
        e.preventDefault();
        e.stopPropagation();
        emitImageHistory(group, 'begin', 'reset');
        var groupKey = getGroupKey(group);
        setWeight(groupKey, i, 1, img);
        setOffset(groupKey, i, 0, 0);
        applyLayout(group);
        emitImageHistory(group, 'commit', 'reset');
        if (transformSelection && transformSelection.img === img) scheduleTransformOverlayRefresh();
      });

      /* 只有正式「匯入工單」畫布的商品／贈品／代言人圖顯示四角縮放與 ↻ 把手。
         點選本身不改資料；原有的按住拖移、滾輪縮放、雙擊復原仍完整保留。 */
      img.addEventListener('click', function () {
        if (isImportTransformImage(group)) selectTransformImage(img, group, i);
      });

      img.style.cursor = 'grab';
      img.title = isImportTransformImage(group)
        ? '點一下顯示四角縮放與 ↻ 旋轉；也可滾輪縮放、按住左鍵拖曳、連按兩下復原'
        : '滾輪縮放這張圖、按住左鍵可拖曳移動位置、連按兩下復原（匯入工單與維修畫布時不能超出圖片範圍）';
    });
  }

  function processGroup(group) {
    layoutWhenReady(group); /* 每次都要重新排版一次(套用之前記住的權重) */
    if (transformSelection && transformSelection.group === group) scheduleTransformOverlayRefresh();
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
    if (transformSelection && (!transformSelection.img || !transformSelection.img.isConnected)) hideTransformOverlay();
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
    refreshEditedImage: function (img, options) {
      if (!img) return false;
      var group = img;
      while (group && group.nodeType === 1 && !(group.classList && group.classList.contains('bn-imggroup'))) group = group.parentElement;
      if (!group) return false;
      var imgs = getImgs(group);
      var index = imgs.indexOf(img);
      if (index < 0) return false;
      /* 商品影子會把 src 換成含留白的輸出圖，並在 img.dataset 寫入
         商品本體幾何。此時若只重套 transform，flex 佔位仍是換圖前的比例，
         首次呈現便會比重新整理後小；reflow 會在圖載入後重算同一組圖片。 */
      if (options && options.reflow) {
        /* 換成含影子的輸出圖時，舊的 slot 比例是依換圖前的圖算出來的。
           必須先丟掉它，才能依 data-layout-source-* 的商品本體幾何重新 fit；
           否則首次匯入會與重新整理後的尺寸不同。只在呼叫端明確要求時重設，
           不影響使用者一般編輯後保留的多圖排列。 */
        if (options.resetSlots) {
          imgs.forEach(function (item) {
            if (!item || !item.dataset) return;
            delete item.dataset.layoutSlotRatios;
            delete item.dataset.layoutGapPx;
            delete item.dataset.layoutSlotBox;
          });
        }
        layoutWhenReady(group);
      } else {
        var groupKey = getGroupKey(group);
        applyOffset(img, groupKey, index);
        if (isBoundedWorkOrderGroup(group)) clampImageOffset(img, groupKey, index, imageBoundaryOfGroup(group), true);
      }
      return true;
    },
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
    },
    /* 復原時同時套用縮放與位移，只重排一次，避免先套大小、再套位置的閃動。 */
    getState: function () {
      try {
        return JSON.parse(JSON.stringify({ weights: weightStore, offsets: offsetStore }));
      } catch (e) {
        return { weights: {}, offsets: {} };
      }
    },
    setState: function (state) {
      state = state && typeof state === 'object' ? state : {};
      weightStore = state.weights && typeof state.weights === 'object' ? state.weights : {};
      offsetStore = state.offsets && typeof state.offsets === 'object' ? state.offsets : {};
      scanAndProcess(document.body);
    },
    /* 讓影子管線在原地換掉 src 後，立即把選取框重新量到新的商品本體範圍。 */
    refreshTransformControls: scheduleTransformOverlayRefresh,
    hideTransformControls: hideTransformOverlay,
    /* 右側工具列點某一張圖時呼叫：畫布框出這張圖，並讓它優先接收滑鼠。 */
    selectImage: selectImageFromTool
  };
})();
