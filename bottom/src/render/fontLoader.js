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
 * 代價要講清楚：兩個字重各約 11MB（gzip 後的實際傳輸量），首次開啟要下載約 22MB。
 * CDN 上沒有 woff2 版本（試過 .woff2 / .woff / .otf 都是 404），不然體積可以少八成。
 * 兩個都放進同一個 Promise.all，所以任一個載入失敗都會停在錯誤畫面——這是刻意的，
 * 「字重不對的圖」和「字體錯的圖」一樣是不能交出去的成品。
 */
(function () {
  var FONT_FAMILY = "ShopeeNotoSansContent";
  var BASE_URL = "https://jimmywu-commits.github.io/shopee/fonts/";

  var FACES = [
    { file: "ShopeeNotoSans%28content%29-Medium.ttf", weight: "500" },
    { file: "ShopeeNotoSans%28content%29-Bold.ttf", weight: "700" },
  ];

  var state = { status: "loading", error: null };
  var listeners = [];

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
    if (typeof window.FontFace === "undefined" || !document.fonts) {
      var msg = "這個瀏覽器不支援 FontFace API，無法保證字體正確，請改用 Chrome / Edge。";
      setState({ status: "failed", error: msg });
      return Promise.reject(new Error(msg));
    }

    setState({ status: "loading", error: null });

    var loads = FACES.map(function (face) {
      var descriptor = { weight: face.weight };
      var source = 'url("' + BASE_URL + face.file + '")';
      return new window.FontFace(FONT_FAMILY, source, descriptor).load().then(function (loaded) {
        document.fonts.add(loaded);
        return loaded;
      });
    });

    return Promise.all(loads)
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
      })
      .catch(function (err) {
        setState({ status: "failed", error: err.message || String(err) });
        throw err;
      });
  }

  window.FontLoader = {
    FONT_FAMILY: FONT_FAMILY,
    load: load,
    getState: function () { return state; },
    isReady: function () { return state.status === "ready"; },
    subscribe: function (fn) { listeners.push(fn); },
  };
})();
