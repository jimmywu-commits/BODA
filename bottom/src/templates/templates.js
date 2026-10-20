/*
 * 版位規格（依 PS 公版實際數值）。
 *
 * 畫布 1200x150：
 *   - 上方 20px 為透明像素（匯出的 PNG 這一段是透明的，不是白的）
 *   - 下方 1200x130 白底齊下擺放
 *   - icon 距白底上緣 10px，icon 框 107x58（等比例縮放塞進框內，不拉伸變形）
 *   - icon 與文字緊接；文字下緣距白底下緣 6px → 預留 56px 文字帶容納 35pt 字級
 *   - icon 與文字各自水平置中、視為一個整體
 *   - 每顆之間間距 > 60px，依顆數自動等距
 *
 * 故意用 .js（window.XXX = {...}）而不是純 .json，因為瀏覽器在 file:// 下用 fetch()
 * 讀本機 JSON 會被 CORS 擋掉，用 <script> 標籤載入則完全不受影響。內容本身仍是單純資料。
 */
window.LAYOUT = {
  canvasWidth: 1200,
  canvasHeight: 150,
  whiteBlockHeight: 130,

  iconBoxWidth: 107,
  iconBoxHeight: 58,
  iconTopFromWhiteTop: 10,
  iconToTextGap: 0,
  textBottomFromWhiteBottom: 6,

  minUnitGap: 60,
  maxTextWidth: 200,

  // 吸底 icon 下方文字採畫布實際 35px。
  fontSize: 35,

  /*
   * 用文字代替 icon 時（9.9 / 10.10 這類檔期數字）的排版。
   *
   * 固定字級而不是自動填滿整個框：自動填滿的話「9.9」（3 字）會受寬度限制放到約 50px、
   * 「10.10」（5 字）只能到約 34px，同一個 107x58 的框裡兩張圖大小差一半，並排看很明顯。
   * 固定 40px 讓常見檔期數字（9.9 / 10.10 / 11.11 / 12.12）看起來一致，
   * 只有真的塞不下才等比縮小，最小不低於 dateFontMin。
   */
  dateFontSize: 40,
  dateFontMin: 16,
  dateFontWeight: "700", // Bold，依規範屬於副標

  // Konva 會把 fontStyle 直接放進 canvas 的 font 字串，所以這裡放數字字重（medium = 500）。
  fontWeight: "500",
  // 專案指定字體，由 render/fontLoader.js 以 FontFace API 預載後才會開始繪製。
  // 這裡刻意不寫任何後備字體：依規範嚴禁用預設字體替代，缺字要看得出來而不是悄悄換字體。
  fontFamily: "ShopeeNotoSansContent",
};

/*
 * 各顆數的水平中心點：1200 寬等分，中心點 = 1200 * (i + 0.5) / N。
 * 最小的一組（5顆）中心點間距 240px、扣掉 icon 框 107px 後仍有 133px 淨間距，滿足 >60px。
 * 若之後 PS 公版要改成非等距，直接改這裡的數字即可。
 */
window.TEMPLATES = {
  2: { centers: [300, 900] },
  3: { centers: [200, 600, 1000] },
  4: { centers: [150, 450, 750, 1050] },
  5: { centers: [120, 360, 600, 840, 1080] },
};

(function () {
  var L = window.LAYOUT;

  // 白底區塊的上緣 y 座標（= 上方透明像素的高度）
  function whiteTop() {
    return L.canvasHeight - L.whiteBlockHeight;
  }

  function getSlotLayout(slotCount, index) {
    var template = window.TEMPLATES[String(slotCount)];
    if (!template) return null;
    var centerX = template.centers[index];
    if (centerX == null) return null;

    var iconY = whiteTop() + L.iconTopFromWhiteTop;
    var textTop = iconY + L.iconBoxHeight + L.iconToTextGap;
    var textBottom = L.canvasHeight - L.textBottomFromWhiteBottom;

    // 文字框寬度不能大到讓相鄰兩顆的間距小於 minUnitGap
    var textWidth = Math.min(L.canvasWidth / slotCount - L.minUnitGap, L.maxTextWidth);

    return {
      centerX: centerX,
      iconX: centerX - L.iconBoxWidth / 2,
      iconY: iconY,
      iconBoxWidth: L.iconBoxWidth,
      iconBoxHeight: L.iconBoxHeight,
      textX: centerX - textWidth / 2,
      textY: textTop,
      textWidth: textWidth,
      textHeight: textBottom - textTop,
    };
  }

  /*
   * 檔期文字（9.9 / 10.10）在 icon 框裡的最終字級。
   *
   * 固定 dateFontSize，塞不下才等比縮小，但**不會低於 dateFontMin**——
   * 縮到看不清楚的字不是可用的成品。所以縮到下限仍然塞不下時，字會溢出框外，
   * 這時 fits 會回 false，UI 要負責警告（同「文字超過 5 字」那套紅框語彙）。
   */
  var measureCtx = null;

  function measureDateText(text) {
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");

    function widthAt(size) {
      measureCtx.font = L.dateFontWeight + " " + size + "px " + L.fontFamily;
      return measureCtx.measureText(text || "").width;
    }

    var base = widthAt(L.dateFontSize);
    var scale = Math.min(
      L.iconBoxWidth / Math.max(1, base),
      L.iconBoxHeight / Math.max(1, L.dateFontSize),
      1
    );
    var size = scale < 1
      ? Math.max(L.dateFontMin, Math.floor(L.dateFontSize * scale))
      : L.dateFontSize;

    var width = widthAt(size);
    return { fontSize: size, width: width, fits: width <= L.iconBoxWidth && size <= L.iconBoxHeight };
  }

  /*
   * 圖片在畫布上的實際位置與大小。
   *
   * 預設是等比例縮放塞進 107x58 的框內（contain，不拉伸變形），再於框內置中；
   * scale 是使用者手動調的倍率（slot.iconScale，1 = 預設），以框的中心為基準放大縮小。
   *
   * 尺寸與座標一律取整數：置中算出來的是 centerX - w/2 這種小數，落在半個像素上
   * 就一定會被重新取樣一次（不管有沒有濾鏡）。匯出的輸出倍率是 1，所以取整之後
   * 場景座標就等於 PNG 的像素座標，整條路徑變成像素對齊。
   *
   * 放在這裡而不是 canvas.js：面板要用同一支算「放這麼大會不會撞到」，兩邊不能各算各的。
   */
  /* BOD／MDD LOGO 的 PNG 自帶上下透明留白；此處存的是完整 PNG 的繪製寬度，
     換算後畫面中可見的「今日旗艦店」為 186px、「品牌旗艦」為 151px。 */
  var SPECIAL_LOGO_CANVAS_WIDTHS = {
    "bod-logo": 191,
    "mdd-logo": 152,
  };

  function fitIcon(naturalWidth, naturalHeight, slotLayout, iconId, scale) {
    var natW = naturalWidth || 1;
    var natH = naturalHeight || 1;
    var preferredWidth = SPECIAL_LOGO_CANVAS_WIDTHS[iconId];
    var base = preferredWidth
      ? preferredWidth / natW
      : Math.min(slotLayout.iconBoxWidth / natW, slotLayout.iconBoxHeight / natH);
    var k = base * (scale > 0 ? scale : 1);
    var w = Math.max(1, Math.round(natW * k));
    var h = Math.max(1, Math.round(natH * k));
    return {
      x: Math.round(slotLayout.centerX - w / 2),
      y: Math.round(slotLayout.iconY + (slotLayout.iconBoxHeight - h) / 2),
      width: w,
      height: h,
    };
  }

  /*
   * 手動放大之後會撞到什麼。回傳文字陣列，空陣列 = 沒問題。
   *
   * 只警告不硬擋（同「文字超過 5 字」那套語彙）：寬扁的 LOGO 放到 2 倍還很安全，
   * 方正的 icon 放到 1.4 倍就會出白底，用一個固定上限擋不出合理的界線。
   */
  var NEIGHBOR_MARGIN = 6;

  function iconOverflow(box, slotCount, index) {
    var template = window.TEMPLATES[String(slotCount)];
    if (!template) return [];
    var centers = template.centers;
    var problems = [];

    if (box.y < whiteTop()) problems.push("超出白底上緣（會畫進上方透明區）");

    // 文字是在文字帶內垂直置中，字形上緣約在帶子上緣 + (帶高 - 字級) / 2
    var slot = getSlotLayout(slotCount, index);
    var textTop = slot.textY + (slot.textHeight - L.fontSize) / 2;
    if (box.y + box.height > textTop) problems.push("可能壓到下方文字");

    var left = index > 0 ? (centers[index - 1] + centers[index]) / 2 + NEIGHBOR_MARGIN : 0;
    var right = index < centers.length - 1
      ? (centers[index] + centers[index + 1]) / 2 - NEIGHBOR_MARGIN
      : L.canvasWidth;
    if (box.x < 0 || box.x + box.width > L.canvasWidth) problems.push("超出畫布左右邊界");
    else if (box.x < left || box.x + box.width > right) problems.push("可能碰到隔壁格");

    return problems;
  }

  window.LayoutEngine = {
    getSlotLayout: getSlotLayout,
    whiteTop: whiteTop,
    measureDateText: measureDateText,
    fitIcon: fitIcon,
    iconOverflow: iconOverflow,
  };
})();
