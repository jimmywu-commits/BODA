(function () {
  var cache = {};
  var failures = [];

  /*
   * 用 data: URI 載入圖片（而不是相對路徑檔案），這樣即使整個工具是用 file:// 雙擊開啟，
   * 畫到 canvas 上也不會被判定為 tainted，之後的批次匯出（stage.toDataURL）才能正常運作。
   *
   * onerror 一定要處理：載不進來的圖（最常見是 SVG 少了 xmlns，瀏覽器會直接拒絕）
   * 若只掛 onload，callback 永遠不會被呼叫——匯出那邊的 Promise.all 就會永久卡住，
   * 使用者看到的是一個轉不完的「匯出中…」，完全沒有錯誤訊息。
   * 失敗時一律用 null 回呼，讓上層自己決定要跳過還是報錯。
   */
  function loadImage(dataUri, callback) {
    var entry = cache[dataUri];
    if (entry) {
      if (entry.loaded) callback(entry.img);
      else entry.callbacks.push(callback);
      return;
    }

    entry = { loaded: false, img: null, callbacks: [callback] };
    cache[dataUri] = entry;

    function settle(img) {
      entry.loaded = true;
      entry.img = img;
      var callbacks = entry.callbacks;
      entry.callbacks = [];
      callbacks.forEach(function (cb) {
        cb(img);
      });
    }

    var img = new Image();
    img.onload = function () { settle(img); };
    img.onerror = function () {
      // 記下來（而不是靜靜跳過），匯出前才有辦法擋下「缺圖的成品」
      if (failures.indexOf(dataUri) < 0) failures.push(dataUri);
      settle(null);
    };
    img.src = dataUri;
  }

  function hasFailed(dataUri) {
    return failures.indexOf(dataUri) >= 0;
  }

  /* ---------------- 降取樣（縮圖）快取 ---------------- */

  var scaled = {};
  var scaledKeys = [];
  var SCALED_LIMIT = 120; // 每顆素材大約會用到 3~4 種尺寸，這個上限夠用又不會無限長大

  /*
   * 為什麼要自己縮，不直接把大圖交給 Konva：
   *
   * 廠商 LOGO 常常是 600x300 這種尺寸，塞進 107x58 的框等於一步縮掉 5~6 倍。
   * canvas 的 drawImage 只用 2x2 鄰域的雙線性取樣，縮這麼多會直接跳過大部分來源像素——
   * 實測（同一張測試 LOGO，對照理想的面積平均）：
   *     一步 drawImage        RMS 27.3   平均梯度 17.9（理想 14.1）
   *     漸進減半              RMS  7.7   平均梯度 12.3
   * 梯度「高於」理想值代表這不是模糊而是混疊（鋸齒），細筆畫會斷斷續續、
   * 這正是下載回來的 PNG 看起來髒的成因。
   *
   * imageSmoothingQuality = "high" 在單獨的 canvas 上確實有效（RMS 27.3 → 7.8），
   * 但實測把它強加到 Konva 建立的每一張畫布上，匯出的無濾鏡 LOGO 完全沒有變化
   * （RMS 27.32 → 27.32），所以不能靠這個瀏覽器提示，只能自己縮。
   *
   * 漸進減半的原理：雙線性在「縮小不超過一半」時取樣是足夠的，
   * 所以每一步最多砍一半，最後一步才落到目標尺寸。
   */
  function downscale(img, targetW, targetH) {
    var srcW = img.naturalWidth || img.width;
    var srcH = img.naturalHeight || img.height;
    var cur = img;
    var cw = srcW;
    var ch = srcH;

    function step(w, h) {
      var c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      var ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
      ctx.drawImage(cur, 0, 0, w, h);
      cur = c;
      cw = w;
      ch = h;
    }

    while (cw > targetW * 2 && ch > targetH * 2) {
      step(Math.max(targetW, Math.round(cw / 2)), Math.max(targetH, Math.round(ch / 2)));
    }
    if (cw !== targetW || ch !== targetH) step(targetW, targetH);
    return cur;
  }

  /*
   * 取得「已經縮到 targetW x targetH 的點陣圖」。
   * 目標比原圖大就直接回傳原圖——放大交給 Konva 做即可，自己先放大只是白佔記憶體。
   */
  function getScaled(dataUri, img, targetW, targetH) {
    var w = Math.max(1, Math.round(targetW));
    var h = Math.max(1, Math.round(targetH));
    var srcW = img.naturalWidth || img.width;
    var srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) return img;
    if (srcW <= w && srcH <= h) return img;

    var key = dataUri + "|" + w + "x" + h;
    if (scaled[key]) return scaled[key];

    var out = downscale(img, w, h);
    scaled[key] = out;
    scaledKeys.push(key);
    while (scaledKeys.length > SCALED_LIMIT) delete scaled[scaledKeys.shift()];
    return out;
  }

  window.IconImageCache = {
    loadImage: loadImage,
    hasFailed: hasFailed,
    getScaled: getScaled,
    failureCount: function () { return failures.length; },
  };
})();
