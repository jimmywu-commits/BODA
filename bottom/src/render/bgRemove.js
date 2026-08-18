/*
 * 去白底。
 *
 * 兩種模式，差別是「內部的白色會不會被打穿」：
 *
 *  edge（邊界泛洪，預設）
 *    從圖片四邊往內擴散，只移除「跟外框連通」的白色。LOGO 內部被顏色包圍的白字、
 *    白色圖標、白色高光因為連不到邊界，會完整保留。多數廠商 LOGO 要的是這個。
 *
 *  all（全部白色）
 *    不管連不連通，所有夠白的像素一律打掉。用在「白色本來就是背景的一部分」，
 *    例如整張圖是白底黑線稿、或內部鏤空處本來就該透明的圖。
 *
 * 抗鋸齒邊緣的處理：LOGO 外緣像素是「白 → LOGO 色」的漸變，硬砍會留一圈白毛邊。
 * 所以判定不是非 0 即 255，而是留一條 FEATHER 寬的漸進帶，在帶內依「離純白的距離」
 * 給比例 alpha，邊緣才會平順地淡出。
 */
(function () {
  var FEATHER = 32; // 邊緣漸進帶寬（以下方的 whiteness 距離為單位，0~255）
  var DEFAULT_TOLERANCE = 24;

  /*
   * 「離純白多遠」：純白 = 0，越暗或越飽和數字越大。
   * 用 min(r,g,b) 而不是亮度，因為只要任一通道明顯低於 255 就不算白——
   * 淺粉、淺藍這種「接近白但有色偏」的 JPG 壓縮雜訊才吃得掉。
   */
  function whiteness(d, i) {
    var m = d[i];
    if (d[i + 1] < m) m = d[i + 1];
    if (d[i + 2] < m) m = d[i + 2];
    return 255 - m;
  }

  // 回傳這個像素該保留多少比例的 alpha（0 = 全透明，1 = 完全保留）
  function alphaFactor(dev, tol, soft) {
    if (dev <= tol) return 0;
    if (dev >= soft) return 1;
    return (dev - tol) / (soft - tol);
  }

  function applyAll(d, tol, soft) {
    var changed = 0;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var f = alphaFactor(whiteness(d, i), tol, soft);
      if (f >= 1) continue;
      d[i + 3] = Math.round(d[i + 3] * f);
      changed++;
    }
    return changed;
  }

  function applyEdgeFlood(d, w, h, tol, soft) {
    var n = w * h;
    var visited = new Uint8Array(n);
    var stack = new Int32Array(n);
    var sp = 0;

    // 能不能從這個像素繼續往內擴散：本來就透明可以、還在漸進帶內也可以，
    // 一旦碰到「確定是實體內容」的像素就停住，泛洪不會鑽進 LOGO 裡面。
    function push(p) {
      if (visited[p]) return;
      var i = p * 4;
      if (d[i + 3] !== 0 && whiteness(d, i) >= soft) return;
      visited[p] = 1;
      stack[sp++] = p;
    }

    var x, y;
    for (x = 0; x < w; x++) {
      push(x);                 // 上緣
      push((h - 1) * w + x);   // 下緣
    }
    for (y = 0; y < h; y++) {
      push(y * w);             // 左緣
      push(y * w + w - 1);     // 右緣
    }

    while (sp > 0) {
      var p = stack[--sp];
      var py = (p / w) | 0;
      var px = p - py * w;
      if (px > 0) push(p - 1);
      if (px < w - 1) push(p + 1);
      if (py > 0) push(p - w);
      if (py < h - 1) push(p + w);
    }

    var changed = 0;
    for (var q = 0; q < n; q++) {
      if (!visited[q]) continue;
      var j = q * 4;
      if (d[j + 3] === 0) continue;
      var f = alphaFactor(whiteness(d, j), tol, soft);
      if (f >= 1) continue;
      d[j + 3] = Math.round(d[j + 3] * f);
      changed++;
    }
    return changed;
  }

  /*
   * 就地修改 imageData。回傳被動到 alpha 的像素數，
   * 為 0 代表「這張圖依目前容差沒有可去除的白底」，UI 要講出來而不是靜靜地什麼都沒發生。
   */
  function apply(imageData, options) {
    var opts = options || {};
    var tol = typeof opts.tolerance === "number" ? opts.tolerance : DEFAULT_TOLERANCE;
    var soft = tol + FEATHER;

    if (opts.mode === "all") {
      return applyAll(imageData.data, tol, soft);
    }
    return applyEdgeFlood(imageData.data, imageData.width, imageData.height, tol, soft);
  }

  window.BgRemove = {
    FEATHER: FEATHER,
    DEFAULT_TOLERANCE: DEFAULT_TOLERANCE,
    whiteness: whiteness,
    apply: apply,
  };
})();
