/*!
 * Logo Auto Trim Plugin v1
 * ─────────────────────────────────────────────────────────────
 * 用途：logo 上傳後自動把上下左右多餘的留白（純色底或透明底）切掉，
 *       讓 logo 在版位上不會因為原圖留白太多而顯得特別小。
 *
 * 為什麼不直接沿用 bn-editor-plugin.js 裡給商品圖用的 autoTrim()：
 *   那一版會無條件把「接近純白」的像素當成留白，商品圖沒問題，
 *   但 logo 常常本身就是白色（白色蝦皮 logo、白字 logo 疊在透明底上），
 *   套下去整張圖會被判定成空白、直接被切爛。
 *   所以這裡改成「先判斷圖有沒有透明通道」再決定用哪一套判斷：
 *     有透明底 → 只看 alpha，完全不看顏色（白色 logo 也安全）
 *     沒透明底 → 取四角當底色，色差在容許值內才算留白
 *
 * 安全機制（寧可不切，也不要切爛）：
 *   1. 四角顏色差異太大（>40）→ 判定不是單色留白（可能是照片或漸層底），不動作
 *   2. 算出來的內容範圍小於原圖面積 1% → 判定誤判，不動作
 *   3. 省下的面積不到 2% → 沒必要重新編碼，維持原圖（避免 jpg 轉 png 白白變大）
 *   4. 任何 canvas / 讀圖錯誤 → 一律回傳原圖，不讓上傳流程中斷
 *
 * API：
 *   window.BNLogoTrim.trim(src, opts) -> Promise<{
 *     src,        // 裁好的 dataURL（沒裁就是原本的 src）
 *     trimmed,    // true = 有裁；false = 保持原圖
 *     reason,     // 沒裁的原因：no-box / too-small / no-gain / error
 *     box,        // {x,y,width,height} 原圖座標
 *     ratio       // 裁完的寬高比
 *   }>
 *
 *   window.BNLogoTrim.findBox(imgEl, opts) -> {x,y,width,height,...} | null
 *     給 CropperJS 用：直接回傳原圖座標系的邊界框，可餵給 cropper.setData()
 *
 *   opts：
 *     tolerance      純色底的色差容許值，預設 12（越大切越兇，掃描圖建議 25~30）
 *     alphaThreshold 透明底的 alpha 門檻，預設 10
 *     padRatio       裁完四周保留的邊距比例，預設 0.02（2%）
 *     scanMax        掃描用的縮圖最長邊，預設 1000（只影響找邊界的速度，不影響輸出畫質）
 *     minGain        至少要省下多少面積才真的裁，預設 0.02
 * ─────────────────────────────────────────────────────────────
 */
/* Upload-time policy override (2026-08): trim() only auto-crops an opaque
   white/near-white background. Transparent, colored, gradient, and photo
   backgrounds keep the original upload. findBox() remains background-agnostic
   so the explicit manual crop tool can still assist with any image. */
(function (global) {
  if (global.__BN_LOGO_AUTOTRIM_PLUGIN__) return;
  global.__BN_LOGO_AUTOTRIM_PLUGIN__ = true;

  var DEFAULTS = {
    tolerance: 12,
    alphaThreshold: 10,
    whiteThreshold: 230,
    padRatio: 0.02,
    scanMax: 1000,
    minGain: 0.02,
    minAreaRatio: 0.01,
    cornerSpreadMax: 50
  };

  function opt(o, k) {
    o = o || {};
    return o[k] == null ? DEFAULTS[k] : o[k];
  }

  function loadImg(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      i.onload = function () { res(i); };
      i.onerror = function () { rej(new Error('image load failed')); };
      i.src = src;
    });
  }

  /* ── 找出「非留白」內容的邊界框，回傳原圖座標 ── */
  function findBox(img, opts) {
    var nw = img.naturalWidth || img.width;
    var nh = img.naturalHeight || img.height;
    if (!nw || !nh) return null;

    /* 找邊界用縮圖就夠了，1000px 以內掃描很快；輸出時才用原圖裁，畫質不受影響 */
    var sc = Math.min(1, opt(opts, 'scanMax') / Math.max(nw, nh));
    var w = Math.max(1, Math.round(nw * sc));
    var h = Math.max(1, Math.round(nh * sc));

    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);

    var d;
    try { d = ctx.getImageData(0, 0, w, h).data; }
    catch (e) { return null; }   /* 跨網域圖會被 canvas 汙染擋住，直接放棄 */

    var alphaTh = opt(opts, 'alphaThreshold');
    var total = w * h;

    /* 這張圖有沒有「一片」真正的透明區域？
       注意不能只看「有沒有任何一個 alpha < 255 的像素」——很多白底 PNG 在縮放、
       去背過的邊緣會殘留幾個半透明像素，那樣會誤判成透明底，接著用 alpha 去掃，
       結果整張白底都被當成內容、什麼都切不掉。所以要求真正全透明的像素
       至少占全圖 0.5%，才認定這是張透明底圖。 */
    var clearCount = 0;
    for (var p = 3; p < d.length; p += 4) {
      if (d[p] <= alphaTh) clearCount++;
    }
    var hasAlpha = clearCount > total * 0.005;

    var bg = null;
    var whiteBackground = false;
    if (!hasAlpha) {
      var pts = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
      var cs = [];
      pts.forEach(function (pt) {
        var i = (pt[1] * w + pt[0]) * 4;
        /* 透明的角落沒有可信的顏色（RGB 可能是垃圾值），取樣時跳過 */
        if (d[i + 3] <= alphaTh) return;
        cs.push([d[i], d[i + 1], d[i + 2]]);
      });
      if (cs.length < 3) return null;   /* 可用的角落太少，無法判斷底色 */
      var avg = [0, 1, 2].map(function (k) {
        return cs.reduce(function (s, pp) { return s + pp[k]; }, 0) / cs.length;
      });
      /* 四角顏色彼此差太多 → 底不是單色（照片、漸層、滿版設計），不要亂裁 */
      var spread = 0;
      cs.forEach(function (pp) {
        [0, 1, 2].forEach(function (k) {
          spread = Math.max(spread, Math.abs(pp[k] - avg[k]));
        });
      });
      if (spread > opt(opts, 'cornerSpreadMax')) return null;
      bg = avg;
      var whiteTh = opt(opts, 'whiteThreshold');
      whiteBackground = cs.every(function (pp) {
        return pp[0] >= whiteTh && pp[1] >= whiteTh && pp[2] >= whiteTh;
      });
    }

    var tol3 = opt(opts, 'tolerance') * 3;   /* 三通道絕對差相加，門檻等比放大 */

    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var blank;
        if (hasAlpha) {
          blank = d[i + 3] <= alphaTh;
        } else {
          /* 單色底模式下，零星的全透明像素同樣視為留白 */
          blank = d[i + 3] <= alphaTh ||
            (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2])) <= tol3;
        }
        if (blank) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;   /* 整張都是留白 */

    /* 縮圖座標換回原圖座標 */
    var inv = 1 / sc;
    var bx = Math.floor(x0 * inv);
    var by = Math.floor(y0 * inv);
    var bw = Math.min(nw - bx, Math.ceil((x1 - x0 + 1) * inv));
    var bh = Math.min(nh - by, Math.ceil((y1 - y0 + 1) * inv));

    /* 貼齊邊界看起來太緊，留一點呼吸空間 */
    var pad = Math.round(Math.max(bw, bh) * opt(opts, 'padRatio'));
    bx = Math.max(0, bx - pad);
    by = Math.max(0, by - pad);
    bw = Math.min(nw - bx, bw + pad * 2);
    bh = Math.min(nh - by, bh + pad * 2);

    return {
      x: bx, y: by, width: bw, height: bh,
      hasAlpha: hasAlpha, background: bg, whiteBackground: whiteBackground,
      natural: { width: nw, height: nh }
    };
  }

  /* ── 主流程：吃 src，回傳裁好的 src ── */
  function trim(src, opts) {
    return loadImg(src).then(function (img) {
      var nw = img.naturalWidth, nh = img.naturalHeight;
      var out = { src: src, trimmed: false, reason: '', box: null, ratio: nw / nh };

      var box = findBox(img, opts);
      if (!box) { out.reason = 'no-box'; return out; }
      /* 允許裁剪的情況：白色背景（不透明圖）或透明背景（PNG alpha）。
         只擋有色底、漸層底、照片底（這些 findBox 會回傳 null 或
         whiteBackground=false 且 hasAlpha=false）。 */
      if (!box.whiteBackground && !box.hasAlpha) {
        out.reason = 'non-white-background';
        return out;
      }

      var area = box.width * box.height;
      var full = nw * nh;
      if (area < full * opt(opts, 'minAreaRatio')) { out.reason = 'too-small'; return out; }
      if (1 - area / full < opt(opts, 'minGain')) { out.reason = 'no-gain'; return out; }

      var o = document.createElement('canvas');
      o.width = box.width; o.height = box.height;
      var octx = o.getContext('2d');
      octx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);

      out.src = o.toDataURL('image/png');
      out.trimmed = true;
      out.box = box;
      out.ratio = box.width / box.height;
      return out;
    })['catch'](function () {
      /* 去邊只是加分功能，失敗就當沒這回事，絕不擋住上傳 */
      return { src: src, trimmed: false, reason: 'error', box: null, ratio: 1 };
    });
  }

  global.BNLogoTrim = {
    trim: trim,
    findBox: findBox,
    DEFAULTS: DEFAULTS
  };

}(window));
