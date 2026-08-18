(function () {
  // 指定色號
  var ACCENT_COLORS = { orange: "#ee4d2d", red: "#d0011b" };
  var GRAY = "#848484";

  /*
   * 配色規則：
   *  - type "icon"：選取 → 橘/紅；未選取 → 灰 (#848484)。
   *  - type "logo"（廠商 LOGO）：不以紅/橘色覆蓋。選取 → 維持原始品牌色；
   *    未選取 → 整顆轉灰階（用 Konva 的 Grayscale 濾鏡，保留原本明暗層次，
   *    而不是塗成單一灰色）。下方文字則和一般 icon 一樣跟著切換橘/紅/灰。
   */
  function resolveSlotColor(slot, accentColor, isActive) {
    var activeHex = ACCENT_COLORS[accentColor] || ACCENT_COLORS.orange;
    return isActive ? activeHex : GRAY;
  }

  function recolorSvg(svgString, colorHex) {
    return svgString.split("currentColor").join(colorHex);
  }

  /*
   * 沒有寫 width/height、只有 viewBox 的 SVG，被當成 <img> 載入時在部分瀏覽器會拿不到
   * 正確的原始尺寸（變成 0 或預設 300x150），導致等比例縮放算錯。這裡依 viewBox 補上尺寸。
   */
  function ensureSvgSize(svgString) {
    if (/<svg[^>]*\swidth\s*=/.test(svgString)) return svgString;
    var m = svgString.match(
      /viewBox\s*=\s*["']\s*[\d.+-]+[\s,]+[\d.+-]+[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)/
    );
    if (!m) return svgString;
    return svgString.replace(/<svg/, '<svg width="' + m[1] + '" height="' + m[2] + '"');
  }

  function svgToDataUri(svgString) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
  }

  // 向量 icon 若有寫 currentColor，就能直接用字串換色（品質最好、不需要濾鏡）
  function canRecolorViaSvg(icon) {
    return !!(icon.svg && icon.svg.indexOf("currentColor") >= 0);
  }

  // 上傳的點陣圖、或沒寫 currentColor 的 SVG，改用 Konva 的 RGB 濾鏡整片染色
  function needsTintFilter(icon) {
    return icon.type !== "logo" && !canRecolorViaSvg(icon);
  }

  function getIconSourceUri(icon, color) {
    if (icon.src) return icon.src; // 上傳的點陣圖（已經是 data URI）
    var svg = icon.svg;
    if (icon.type !== "logo" && canRecolorViaSvg(icon)) svg = recolorSvg(svg, color || GRAY);
    return svgToDataUri(ensureSvgSize(svg));
  }

  /*
   * 一般 icon（上傳的點陣圖、或沒寫 currentColor 的 SVG）的單色覆蓋。
   *
   * 為什麼不用 Konva 內建的 Konva.Filters.RGB：它的實作是
   *     data[i] = brightness * red
   * 會把目標色乘上原圖亮度，所以原圖深的地方變成深橘、亮的地方變成亮橘——
   * 結果是「一層帶明暗的橘」而不是單色，這正是先前上傳 icon 看起來不對的原因。
   *
   * 這裡直接把每個不透明像素的 RGB 設成目標色本身，只保留 alpha，
   * 得到乾淨的單色剪影。邊緣的半透明像素同樣只換顏色不動 alpha，所以不會有鋸齒。
   *
   * 注意：既然是單色覆蓋，上傳的圖若把鏤空處畫成「不透明的白色」，那些白色也會一起被染色。
   * 要保留鏤空效果，鏤空處必須是真正的透明像素。
   */
  function createSolidTintFilter(hex) {
    var c = hexToRgb(hex || GRAY);
    return function solidTintFilter(imageData) {
      var d = imageData.data;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        d[i] = c.r;
        d[i + 1] = c.g;
        d[i + 2] = c.b;
      }
    };
  }

  // 量測「LOGO 主體」時，半透明的抗鋸齒邊緣不能算數，見 createLogoGrayFilter
  var SOLID_ALPHA = 250;

  // 離純白多遠：純白 = 0。用 min 通道而不是亮度，只要任一通道明顯低於 255 就不算白。
  function whiteDistance(r, g, b) {
    var m = r < g ? r : g;
    if (b < m) m = b;
    return 255 - m;
  }

  /*
   * 廠商 LOGO 未選取時的置灰處理。
   *
   * 【做法：用「離白多遠」當覆蓋率，在白與 #848484 之間內插】
   *
   *     cov  = 這個像素離純白的距離 / 最深的實心像素離純白的距離   （0 = 白，1 = 最深）
   *     結果 = 白 + (#848484 - 白) × cov
   *
   * 由此直接得到三件事，不需要任何額外的門檻或參數：
   *  - 最深的地方精確落在 #848484，**不會有比規範灰更深的像素**。
   *  - 白底 cov = 0，自動維持純白（等同去背），不需要「多白才算白」的門檻。
   *  - 抗鋸齒的過渡像素 cov 介於中間，**平滑地淡回白色**。
   *
   * 【為什麼改掉原本的「亮度區間映射」】
   * 原本是把內容的亮度區間 [minL, maxL] 壓進 [base, base×1.4]，
   * 並用 whiteDistance <= 16 當硬門檻決定「這是白底」。兩個實測到的後果：
   *
   *  1. **邊緣一圈灰。** 離白 17~123 之間的像素（就是每個筆畫外圈的抗鋸齒）
   *     全部被壓進 [132, 185]，再上去直接跳到 255。實測灰階分布在 192 與 256
   *     之間整段是空的——本該平滑淡出的外框，變成一圈約 #b9b9b9 的實色鑲邊。
   *     這就是「灰階的部分有一圈糊的」。
   *  2. **主體漂色。** 去背 LOGO 的半透明邊緣，getImageData 取回的是
   *     未預乘的 RGB，低 alpha 時數值本來就有雜訊。那些雜訊參與了 min/max 量測，
   *     於是主體不再錨在 #848484——實測一顆單色 #4a4a4a 的 LOGO 跑出 #acacac。
   *
   * 所以量測只採「實心」像素（alpha >= 250 且非白），套用時才涵蓋全部像素。
   *
   * 【例外】整顆都是白的 LOGO（白字去背）沒有「離白的距離」可用，
   * 全部 cov 會是 0、整張消失。這種情況退回把所有不透明像素都當 cov = 1。
   */
  function createLogoGrayFilter(baseHex) {
    var base = hexToRgb(baseHex || GRAY);

    return function logoGrayFilter(imageData) {
      var d = imageData.data;
      var i, wd;
      var maxWD = 0;

      // 第一遍：只量實心且非白的像素，找出「最深」有多深
      for (i = 0; i < d.length; i += 4) {
        if (d[i + 3] < SOLID_ALPHA) continue;
        wd = whiteDistance(d[i], d[i + 1], d[i + 2]);
        if (wd > maxWD) maxWD = wd;
      }

      // 沒有實心像素（整顆都是半透明）就放寬到所有可見像素再量一次
      if (maxWD === 0) {
        for (i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 8) continue;
          wd = whiteDistance(d[i], d[i + 1], d[i + 2]);
          if (wd > maxWD) maxWD = wd;
        }
      }

      // 全白 LOGO：離白的距離一律是 0，改成整顆都塗成 base，否則整張會消失
      var allWhite = maxWD === 0;

      for (i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        var cov = allWhite ? 1 : whiteDistance(d[i], d[i + 1], d[i + 2]) / maxWD;
        if (cov > 1) cov = 1; // 比量測到的最深還深（半透明邊緣的雜訊）就夾住
        d[i] = Math.round(255 + (base.r - 255) * cov);
        d[i + 1] = Math.round(255 + (base.g - 255) * cov);
        d[i + 2] = Math.round(255 + (base.b - 255) * cov);
      }
    };
  }

  /*
   * 降取樣後補銳化（unsharp mask）——就是 PS「環迴增值法（更銳利）」在做的事。
   *
   * 兩個實作上的關鍵，寫錯任何一個都會讓這個濾鏡完全無效：
   *
   * 1. 半徑必須跟著快取倍率放大。濾鏡跑在 cache() 產生的點陣圖上（倍率見 canvas.js 的
   *    outputRatio），在 3 倍快取上用半徑 1，等於在輸出解析度上用半徑 1/3，
   *    縮回 1200x150 時整個被平均掉——量起來會像什麼都沒做。
   *    （匯出的倍率現在固定 1，半徑就是 1，剛好等於在輸出解析度上銳化；
   *      預覽放大時倍率變大，半徑跟著變大。）
   * 2. alpha 也要銳化。單色覆蓋過的 icon 每個不透明像素 RGB 完全相同，
   *    形狀全部存在 alpha 通道；只銳化 RGB 對它一點作用都沒有。
   *
   * amount 是 0 = 不變、1 = 標準強度。過大會在邊緣產生白色光暈（halo），
   * 在 58px 的 icon 上非常明顯，所以預設值取得保守。
   */
  var SHARPEN_AMOUNT = 0.55;

  function clampIndex(v, max) {
    return v < 0 ? 0 : v > max ? max : v;
  }

  // 可分離盒狀模糊：水平一趟 + 垂直一趟，用移動總和，成本與半徑無關
  function boxBlur(src, out, w, h, r) {
    var win = r * 2 + 1;
    var mid = new Float32Array(src.length);
    var x, y, c, k, i, sum;

    for (y = 0; y < h; y++) {
      for (c = 0; c < 4; c++) {
        sum = 0;
        for (k = -r; k <= r; k++) sum += src[(y * w + clampIndex(k, w - 1)) * 4 + c];
        for (x = 0; x < w; x++) {
          mid[(y * w + x) * 4 + c] = sum / win;
          sum += src[(y * w + clampIndex(x + r + 1, w - 1)) * 4 + c]
               - src[(y * w + clampIndex(x - r, w - 1)) * 4 + c];
        }
      }
    }
    for (x = 0; x < w; x++) {
      for (c = 0; c < 4; c++) {
        sum = 0;
        for (k = -r; k <= r; k++) sum += mid[(clampIndex(k, h - 1) * w + x) * 4 + c];
        for (y = 0; y < h; y++) {
          out[(y * w + x) * 4 + c] = sum / win;
          sum += mid[(clampIndex(y + r + 1, h - 1) * w + x) * 4 + c]
               - mid[(clampIndex(y - r, h - 1) * w + x) * 4 + c];
        }
      }
    }
  }

  function createSharpenFilter(amount, cacheRatio) {
    var amt = amount == null ? SHARPEN_AMOUNT : amount;
    var radius = Math.max(1, Math.round(cacheRatio || 1));
    return function sharpenFilter(imageData) {
      var w = imageData.width;
      var h = imageData.height;
      if (w < 3 || h < 3) return;
      var d = imageData.data;
      var orig = new Float32Array(d);
      var blur = new Float32Array(d.length);
      boxBlur(orig, blur, w, h, radius);
      for (var i = 0; i < d.length; i++) {
        var v = orig[i] + amt * (orig[i] - blur[i]);
        d[i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    };
  }

  function hexToRgb(hex) {
    var h = (hex || "#000000").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  }

  window.ColorTheme = {
    ACCENT_COLORS: ACCENT_COLORS,
    GRAY: GRAY,
    SHARPEN_AMOUNT: SHARPEN_AMOUNT,
    createLogoGrayFilter: createLogoGrayFilter,
    createSolidTintFilter: createSolidTintFilter,
    createSharpenFilter: createSharpenFilter,
    resolveSlotColor: resolveSlotColor,
    recolorSvg: recolorSvg,
    ensureSvgSize: ensureSvgSize,
    svgToDataUri: svgToDataUri,
    canRecolorViaSvg: canRecolorViaSvg,
    needsTintFilter: needsTintFilter,
    getIconSourceUri: getIconSourceUri,
    hexToRgb: hexToRgb,
  };
})();
