/*
 * 專案指定字體 ShopeeNotoSans(content) 的非同步預載。
 *
 * 規範鐵律：Canvas 渲染文字前必須確保字體 100% 載入成功，嚴禁字體閃爍（FOUT）或預設字體替代。
 * 因此本模組回傳一個 Promise，app.js 會等它 resolve 之後才驅動畫布繪製；
 * 匯出前也會再檢查一次（見 export/exportBatch.js），避免產出用錯字體的圖。
 *
 * 為什麼自己用 FontFace 建構子而不是 CSS @font-face：
 *  1. 原始檔名帶括號 ShopeeNotoSans(content)-Medium.ttf，括號在 CSS font-family 名稱裡很容易出事，
 *     用 FontFace 可以自己指定一個乾淨的家族名（ShopeeNotoSansContent），URL 裡的括號則用 %28/%29 編碼。
 *  2. 可以明確 await 載入結果、明確捕捉失敗，符合鐵律要求的「確認 100% 成功」。
 *
 * 載入兩個字重：
 *  - Medium (500)：每顆下方那行說明文字，依規範屬於「主標」。
 *  - Bold (700)：用文字代替 icon 時的檔期數字（9.9 / 10.10），依規範屬於「副標」。
 *
 * 優先共用曝光工具的同源 WOFF2，兩字重原始大小由 36.42 MB 降為 16.06 MB。
 * 不換字型、不改字重；舊版部署缺 WOFF2 時才退回原有 TTF。
 * 任一字重載入失敗都會停在錯誤畫面——這是刻意的，
 * 「字重不對的圖」和「字體錯的圖」一樣是不能交出去的成品。
 */
(function () {
  var FONT_FAMILY = "ShopeeNotoSansContent";
  var SOURCES = [
    { base: "../shopee/fonts/", format: "woff2" },
    { base: "https://jimmywu-commits.github.io/shopee/fonts/", format: "woff2" },
    { base: "../fonts/", format: "ttf" },
    { base: "https://jimmywu-commits.github.io/shopee/fonts/", format: "ttf" },
  ];

  var FACES = [
    { file: "ShopeeNotoSans%28content%29-Medium", weight: "500" },
    { file: "ShopeeNotoSans%28content%29-Bold", weight: "700" },
  ];

  var state = { status: "loading", error: null };
  var listeners = [];
  var pending = null;
  var loadedFaces = Object.create(null);
  var pendingFaces = Object.create(null);

  function setState(next) {
    state = next;
    listeners.slice().forEach(function (fn) {
      fn(state);
    });
  }

  function fontShorthand(weight) {
    return weight + " " + window.LAYOUT.fontSize + "px " + FONT_FAMILY;
  }

  function load() {
    if (state.status === "ready") return Promise.resolve();
    if (pending) return pending;
    if (typeof window.FontFace === "undefined" || !document.fonts) {
      var msg = "這個瀏覽器不支援 FontFace API，無法保證字體正確，請改用 Chrome / Edge。";
      setState({ status: "failed", error: msg });
      return Promise.reject(new Error(msg));
    }

    setState({ status: "loading", error: null });

    function loadFace(face, index, lastError) {
      if (loadedFaces[face.weight]) return Promise.resolve(loadedFaces[face.weight]);
      if (index >= SOURCES.length) return Promise.reject(lastError || new Error("字體載入失敗"));
      var asset = SOURCES[index];
      var source = 'url("' + asset.base + face.file + '.' + asset.format + '")';
      return Promise.resolve().then(function () {
        return new window.FontFace(FONT_FAMILY, source, { weight: face.weight }).load();
      }).then(function (loaded) {
        document.fonts.add(loaded);
        loadedFaces[face.weight] = loaded;
        return loaded;
      }).catch(function (err) {
        return loadFace(face, index + 1, err);
      });
    }

    pending = Promise.all(FACES.map(function (face) {
      if (!pendingFaces[face.weight]) {
        pendingFaces[face.weight] = loadFace(face, 0, null);
        pendingFaces[face.weight].catch(function () { delete pendingFaces[face.weight]; });
      }
      return pendingFaces[face.weight];
    }))
      .then(function () {
        // 再走一次 document.fonts.load，確保該字級/字重真的可用（而不是只有「檔案下載完」）
        return Promise.all(
          FACES.map(function (face) {
            return document.fonts.load(fontShorthand(face.weight));
          })
        );
      })
      .then(function () {
        var allReady = FACES.every(function (face) {
          return document.fonts.check(fontShorthand(face.weight));
        });
        if (!allReady) throw new Error("字體檔已下載，但瀏覽器回報無法使用該字重");
        setState({ status: "ready", error: null });
        pending = null;
      })
      .catch(function (err) {
        pending = null;
        setState({ status: "failed", error: err.message || String(err) });
        throw err;
      });
    return pending;
  }

  window.FontLoader = {
    FONT_FAMILY: FONT_FAMILY,
    load: load,
    getState: function () { return state; },
    isReady: function () { return state.status === "ready"; },
    subscribe: function (fn) { listeners.push(fn); },
  };
})();
