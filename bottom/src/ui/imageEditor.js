/*
 * 圖片編輯器（前身是純裁切器，以 CropperJS 為基礎，參考 logo-editor-plugin.js 改寫）。
 *
 * 能做的事：
 *  1. 裁切／縮放。裁切框「可以拖到圖片外面」（viewMode: 0），多出來的部分會是透明像素，
 *     等於幫圖加透明留白——這是控制 icon 在 107×58 框內大小與位置的手段：
 *     加一圈透明邊之後 contain 縮放會讓圖變小、留白變多。
 *  2. 去白底（見 bgRemove.js，分「只去邊界連通的白」與「所有白色」兩種）。
 *  3. 編輯器內自己的 復原 / 重做，因為去背與裁切都是破壞性操作，沒有回頭路會很難用。
 *
 * 送進 Cropper 之前會先把來源圖高解析光柵化：CropperJS 輸出的是點陣圖，
 * 若直接餵一張 48x48 的 SVG，裁切結果就是 48x48，放到 107x58 的框裡會糊掉。
 * 先畫大到至少 CROP_MIN_WIDTH 再裁，向量圖放大不失真，裁完才有足夠解析度。
 */
(function () {
  var CSS_URL = "https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.css";
  var JS_URL = "https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.js";
  var CROP_MIN_WIDTH = 428; // = icon 框寬 107 的 4 倍，確保裁切後仍夠銳利
  var MAX_OUTPUT = 4000; // viewMode:0 可以把裁切框拖得很誇張，輸出要設上限
  var HISTORY_LIMIT = 30;
  var PAD_STEP = 0.12; // 「加透明邊」每按一次往外加的比例

  var loadingPromise = null;
  var activeCropper = null;

  // 這一次開啟編輯器的工作階段
  var session = null; // { history: [dataUrl], index, onDone, tolerance }

  function loadCropper() {
    if (window.Cropper) return Promise.resolve();
    if (loadingPromise) return loadingPromise;

    loadingPromise = new Promise(function (resolve, reject) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = CSS_URL;
      document.head.appendChild(link);

      var script = document.createElement("script");
      script.src = JS_URL;
      script.onload = function () { resolve(); };
      script.onerror = function () {
        loadingPromise = null;
        reject(new Error("無法載入裁切元件 CropperJS，請確認網路連線"));
      };
      document.head.appendChild(script);
    });
    return loadingPromise;
  }

  // 把任何來源（SVG data URI / PNG / JPG）先畫成夠大的點陣圖
  function rasterize(src, minWidth) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var nw = img.naturalWidth || img.width || 1;
        var nh = img.naturalHeight || img.height || 1;
        var scale = Math.max(1, minWidth / nw);
        var w = Math.round(nw * scale);
        var h = Math.round(nh * scale);

        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = function () { reject(new Error("圖片載入失敗")); };
      img.src = src;
    });
  }

  function loadImageData(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        var ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        resolve({ ctx: ctx, canvas: canvas, imageData: ctx.getImageData(0, 0, canvas.width, canvas.height) });
      };
      img.onerror = function () { reject(new Error("圖片載入失敗")); };
      img.src = dataUrl;
    });
  }

  /*
   * 匯入時自動裁除透明／白色外框。
   *
   * 只在四角是透明或近白色時啟用白底判斷，避免把有色底的 Logo、照片背景
   * 誤當成留白裁掉；四角透明的 PNG 則直接依 alpha 外接矩形裁切。
   */
  function trimWhiteBorder(dataUrl) {
    return loadImageData(dataUrl).then(function (r) {
      /* 大圖先縮到 2400px 以內做邊界判斷，避免匯入手機原圖時佔用過多記憶體。 */
      var sourceCanvas = r.canvas;
      var maxDimension = 2400;
      var sourceMax = Math.max(sourceCanvas.width, sourceCanvas.height);
      if (sourceMax > maxDimension) {
        var resize = maxDimension / sourceMax;
        var resized = document.createElement("canvas");
        resized.width = Math.max(1, Math.round(sourceCanvas.width * resize));
        resized.height = Math.max(1, Math.round(sourceCanvas.height * resize));
        resized.getContext("2d").drawImage(sourceCanvas, 0, 0, resized.width, resized.height);
        sourceCanvas = resized;
      }
      var sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
      var d = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
      var w = sourceCanvas.width;
      var h = sourceCanvas.height;
      var corners = [0, w - 1, (h - 1) * w, h * w - 1].map(function (pixel) {
        var i = pixel * 4;
        return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
      });
      var whiteCorners = corners.every(function (p) {
        return p.a <= 12 || (p.a >= 235 && p.r >= 238 && p.g >= 238 && p.b >= 238);
      });
      if (!whiteCorners) return { src: dataUrl, changed: false };

      var x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 4;
          var alpha = d[i + 3];
          var isTransparent = alpha <= 12;
          var isWhiteBorder = alpha >= 235 && d[i] >= 238 && d[i + 1] >= 238 && d[i + 2] >= 238;
          if (!isTransparent && !isWhiteBorder) {
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1)) {
        return { src: dataUrl, changed: false };
      }

      /* 留 1px 抗鋸齒安全邊，避免把圖形邊緣切掉，但不保留可見白框。 */
      x0 = Math.max(0, x0 - 1);
      y0 = Math.max(0, y0 - 1);
      x1 = Math.min(w - 1, x1 + 1);
      y1 = Math.min(h - 1, y1 + 1);
      var cw = x1 - x0 + 1;
      var ch = y1 - y0 + 1;
      var out = document.createElement("canvas");
      out.width = cw;
      out.height = ch;
      out.getContext("2d").drawImage(sourceCanvas, x0, y0, cw, ch, 0, 0, cw, ch);
      return { src: out.toDataURL("image/png"), changed: true, width: cw, height: ch };
    });
  }
  function destroyCropper() {
    try { if (activeCropper) activeCropper.destroy(); } catch (e) { /* 已銷毀就忽略 */ }
    activeCropper = null;
  }

  function ensureModal() {
    var existing = document.getElementById("crop-modal");
    if (existing) return existing;

    var modal = document.createElement("div");
    modal.id = "crop-modal";
    modal.className = "crop-modal";
    modal.innerHTML =
      '<div class="crop-panel">' +
      "  <header>" +
      "    <strong>圖片編輯器</strong>" +
      '    <button type="button" class="mini" data-crop="close">關閉</button>' +
      "  </header>" +
      '  <div class="crop-body checker"><img id="crop-image" alt="編輯預覽" /></div>' +
      '  <div class="crop-tools">' +
      '    <span class="crop-group-label">裁切</span>' +
      '    <button type="button" class="mini" data-crop="free">自由比例</button>' +
      '    <button type="button" class="mini" data-crop="square">1:1</button>' +
      '    <button type="button" class="mini" data-crop="box">107:58</button>' +
      '    <button type="button" class="mini" data-crop="crop">✂ 套用裁切</button>' +
      '    <button type="button" class="mini" data-crop="reset">重設視圖</button>' +
      "  </div>" +
      '  <div class="crop-tools">' +
      '    <span class="crop-group-label">邊界</span>' +
      '    <button type="button" class="mini" data-crop="pad">⊕ 加透明邊</button>' +
      '    <button type="button" class="mini" data-crop="trim">⊖ 裁到內容</button>' +
      '    <span class="crop-hint">裁切框也可以拖到圖外，多出來的部分一樣是透明像素</span>' +
      "  </div>" +
      '  <div class="crop-tools">' +
      '    <span class="crop-group-label">去背</span>' +
      '    <button type="button" class="mini" data-crop="bg-edge">去白底（保留內部白色）</button>' +
      '    <button type="button" class="mini" data-crop="bg-all">連內部白色一起去</button>' +
      '    <label class="crop-slider">容差' +
      '      <input type="range" id="crop-tolerance" min="0" max="120" step="2" />' +
      '      <span id="crop-tolerance-value"></span>' +
      "    </label>" +
      "  </div>" +
      '  <div class="crop-actions">' +
      '    <button type="button" class="mini" data-crop="undo">↩ 復原</button>' +
      '    <button type="button" class="mini" data-crop="redo">↪ 重做</button>' +
      '    <span class="crop-status" id="crop-status"></span>' +
      '    <button type="button" class="primary" data-crop="apply">✓ 完成</button>' +
      "  </div>" +
      "</div>";
    document.body.appendChild(modal);
    return modal;
  }

  function setStatus(text) {
    var node = document.getElementById("crop-status");
    if (node) node.textContent = text || "";
  }

  function syncHistoryButtons() {
    var modal = document.getElementById("crop-modal");
    if (!modal || !session) return;
    var undoBtn = modal.querySelector('[data-crop="undo"]');
    var redoBtn = modal.querySelector('[data-crop="redo"]');
    if (undoBtn) undoBtn.disabled = session.index <= 0;
    if (redoBtn) redoBtn.disabled = session.index >= session.history.length - 1;
  }

  function current() {
    return session.history[session.index];
  }

  function pushStep(dataUrl) {
    // 從中途 undo 之後又做新動作 → 丟掉後面那些，跟一般編輯器的行為一致
    session.history = session.history.slice(0, session.index + 1);
    session.history.push(dataUrl);
    if (session.history.length > HISTORY_LIMIT) session.history.shift();
    session.index = session.history.length - 1;
  }

  // 重新用目前這一步的圖初始化 Cropper
  function loadWorking() {
    var modal = document.getElementById("crop-modal");
    var image = modal.querySelector("#crop-image");

    return new Promise(function (resolve) {
      destroyCropper();
      image.onload = function () {
        image.onload = null;
        destroyCropper();
        activeCropper = new window.Cropper(image, {
          /*
           * viewMode: 0 = 裁切框不受圖片邊界限制，可以拖到圖外。
           * 這正是「擴大裁切範圍、填透明像素」需要的模式；
           * getCroppedCanvas() 預設 fillColor 是 transparent，超出的部分天然就是透明。
           * 代價是圖有可能被拖到看不見，所以「重設視圖」是必要功能而不是裝飾。
           */
          viewMode: 0,
          autoCropArea: 1,
          movable: true,
          zoomable: true,
          scalable: true,
          background: false, // 關掉 Cropper 自己的底，讓我們的棋盤格透出來
        });
        syncHistoryButtons();
        resolve();
      };
      image.removeAttribute("src");
      image.src = current();
    });
  }

  function runBgRemove(mode) {
    var tol = session.tolerance;
    setStatus("處理中…");

    loadImageData(current())
      .then(function (r) {
        var changed = window.BgRemove.apply(r.imageData, { tolerance: tol, mode: mode });
        if (!changed) {
          setStatus("依目前容差沒有偵測到可去除的白底，試著把容差調高。");
          return null;
        }
        r.ctx.putImageData(r.imageData, 0, 0);
        pushStep(r.canvas.toDataURL("image/png"));
        return changed;
      })
      .then(function (changed) {
        if (changed === null) return;
        return loadWorking().then(function () {
          setStatus(
            (mode === "all" ? "已去除所有白色" : "已去除邊界白底") +
              "（容差 " + tol + "，" + changed.toLocaleString() + " 個像素）"
          );
        });
      })
      .catch(function (err) {
        setStatus("去背失敗：" + err.message);
      });
  }

  /*
   * 直接往四周加一圈透明像素。
   *
   * 為什麼要有這顆按鈕，明明拖裁切框也能外擴：
   * viewMode:0 的裁切框雖然不受圖片邊界限制，卻仍受「彈窗容器」限制——
   * 圖片填滿容器高度時，往上下根本拖不出去。這顆按鈕直接改工作圖的畫布尺寸，
   * 不受容器大小影響，而且比例精確可預期。拖裁切框留給細部微調。
   *
   * 實際用途：icon 在 107×58 框裡是 contain 縮放，加一圈透明邊之後圖會變小、留白變多，
   * 這是唯一能讓某一顆看起來比別顆小的方法。
   */
  function padTransparent() {
    setStatus("處理中…");
    loadImageData(current())
      .then(function (r) {
        var padX = Math.round(r.canvas.width * PAD_STEP);
        var padY = Math.round(r.canvas.height * PAD_STEP);
        var w = r.canvas.width + padX * 2;
        var h = r.canvas.height + padY * 2;

        if (w > MAX_OUTPUT || h > MAX_OUTPUT) {
          setStatus("已達尺寸上限 " + MAX_OUTPUT + "px，無法再加透明邊。");
          return null;
        }

        var out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        // 新畫布預設就是全透明，把原圖畫在中間即可，四周自然是透明像素
        out.getContext("2d").drawImage(r.canvas, padX, padY);
        pushStep(out.toDataURL("image/png"));
        return { w: w, h: h };
      })
      .then(function (size) {
        if (!size) return;
        return loadWorking().then(function () {
          setStatus("已加透明邊（" + size.w + "×" + size.h + "）");
        });
      })
      .catch(function (err) {
        setStatus("加透明邊失敗：" + err.message);
      });
  }

  /*
   * 自動裁到內容：算出所有不透明像素的外接矩形再裁。
   * 去背之後最常做的下一件事就是這個——把多餘的透明留白切掉，
   * icon 才會在 107×58 的框裡佔滿應有的比例。
   */
  function trimToContent() {
    setStatus("處理中…");
    loadImageData(current())
      .then(function (r) {
        var d = r.imageData.data;
        var w = r.canvas.width;
        var h = r.canvas.height;
        var minX = w, minY = h, maxX = -1, maxY = -1;

        for (var y = 0; y < h; y++) {
          for (var x = 0; x < w; x++) {
            if (d[(y * w + x) * 4 + 3] <= 8) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }

        if (maxX < 0) {
          setStatus("整張圖都是透明的，沒有內容可以裁。");
          return null;
        }
        if (minX === 0 && minY === 0 && maxX === w - 1 && maxY === h - 1) {
          setStatus("四周沒有多餘的透明留白，不用裁。");
          return null;
        }

        var cw = maxX - minX + 1;
        var ch = maxY - minY + 1;
        var out = document.createElement("canvas");
        out.width = cw;
        out.height = ch;
        out.getContext("2d").drawImage(r.canvas, minX, minY, cw, ch, 0, 0, cw, ch);
        pushStep(out.toDataURL("image/png"));
        return { w: cw, h: ch };
      })
      .then(function (size) {
        if (!size) return;
        return loadWorking().then(function () {
          setStatus("已裁到內容（" + size.w + "×" + size.h + "）");
        });
      })
      .catch(function (err) {
        setStatus("裁到內容失敗：" + err.message);
      });
  }

  function commitCrop() {
    if (!activeCropper) return;
    var out = activeCropper.getCroppedCanvas({
      maxWidth: MAX_OUTPUT,
      maxHeight: MAX_OUTPUT,
      imageSmoothingQuality: "high",
    });
    if (!out) return;
    pushStep(out.toDataURL("image/png"));
    loadWorking().then(function () {
      setStatus("已套用裁切（" + out.width + "×" + out.height + "）");
    });
  }

  function open(src, onDone, onError) {
    var modal = ensureModal();
    var image = modal.querySelector("#crop-image");
    var slider = modal.querySelector("#crop-tolerance");
    var sliderValue = modal.querySelector("#crop-tolerance-value");

    function close() {
      destroyCropper();
      modal.classList.remove("open");
      session = null;
      document.removeEventListener("keydown", onKeyDown, true);
    }

    function onKeyDown(e) {
      if (!session) return;
      if (e.key === "Escape") { close(); return; }
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); step(-1); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); step(1); }
    }

    function step(delta) {
      var next = session.index + delta;
      if (next < 0 || next >= session.history.length) return;
      session.index = next;
      loadWorking().then(function () {
        setStatus(delta < 0 ? "已復原" : "已重做");
      });
    }

    session = {
      history: [],
      index: -1,
      tolerance: window.BgRemove.DEFAULT_TOLERANCE,
      onDone: onDone,
    };

    slider.value = String(session.tolerance);
    sliderValue.textContent = String(session.tolerance);
    slider.oninput = function (e) {
      session.tolerance = Number(e.target.value);
      sliderValue.textContent = e.target.value;
    };

    // 每次開啟都重新綁事件，避免殘留上一次的 onDone
    modal.onclick = function (e) {
      var btn = e.target.closest ? e.target.closest("[data-crop]") : null;
      if (!btn) {
        if (e.target === modal) close(); // 點遮罩關閉
        return;
      }
      var action = btn.getAttribute("data-crop");

      if (action === "close") { close(); return; }
      if (!session || !session.history.length) return;

      if (action === "undo") { step(-1); return; }
      if (action === "redo") { step(1); return; }
      if (action === "bg-edge") { runBgRemove("edge"); return; }
      if (action === "bg-all") { runBgRemove("all"); return; }
      if (action === "pad") { padTransparent(); return; }
      if (action === "trim") { trimToContent(); return; }
      if (action === "crop") { commitCrop(); return; }

      if (!activeCropper) return;

      if (action === "free") activeCropper.setAspectRatio(NaN);
      else if (action === "square") activeCropper.setAspectRatio(1);
      else if (action === "box") {
        activeCropper.setAspectRatio(window.LAYOUT.iconBoxWidth / window.LAYOUT.iconBoxHeight);
      } else if (action === "reset") activeCropper.reset();
      else if (action === "apply") {
        var out = activeCropper.getCroppedCanvas({
          maxWidth: MAX_OUTPUT,
          maxHeight: MAX_OUTPUT,
          imageSmoothingQuality: "high",
        });
        if (!out) return;
        var dataUrl = out.toDataURL("image/png");
        var done = session.onDone;
        close();
        if (typeof done === "function") done(dataUrl);
      }
    };

    modal.classList.add("open");
    setStatus("");
    document.addEventListener("keydown", onKeyDown, true);

    rasterize(src, CROP_MIN_WIDTH)
      .then(function (rasterSrc) {
        return loadCropper().then(function () { return rasterSrc; });
      })
      .then(function (rasterSrc) {
        if (!session) return; // 載入期間被關掉了
        session.history = [rasterSrc];
        session.index = 0;
        return loadWorking();
      })
      .catch(function (err) {
        close();
        if (typeof onError === "function") onError(err);
      });

    // 讓外面（全域 undo 快捷鍵）知道編輯器開著，才不會兩層 undo 打架
    void image;
  }

  function isOpen() {
    return !!session;
  }

  window.ImageEditor = { open: open, isOpen: isOpen, trimWhiteBorder: trimWhiteBorder };
})();
