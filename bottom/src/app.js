(function () {
  var statusEl = document.getElementById("font-status");
  var canvasEl = document.getElementById("konva-container");
  var zoomBarEl = document.getElementById("zoom-bar");

  /*
   * 素材庫只有版控過的 img/（經 tools/build-icon-manifest.js 產生成 manifest.js）。
   * 上傳的圖只活在這次工作階段，重新整理就沒了——刻意不做 localStorage 留存：
   * 留存會讓每個人的下拉選單長得不一樣、而且無從清理，
   * 素材的唯一正式來源就應該是 img/ 這份看得到、進得了版控的資料夾。
   * 這次上傳的圖仍然會內嵌進匯出的「進度存檔.json」，交接不會掉圖。
   */
  window.store.dispatch(window.Actions.setLibrary(window.ICON_LIBRARY.slice()));

  function mountApp() {
    statusEl.hidden = true;
    canvasEl.hidden = false;
    zoomBarEl.hidden = false;

    /*
     * 縮放列要顯示目前倍率，所以先建一個轉接函式當回呼；
     * ZoomBar 掛好之後再把真正的更新函式接上去（mount 期間就會觸發第一次 fit()）。
     */
    var onScaleChange = null;
    var mounted = window.CanvasRenderer.mount(
      "konva-container",
      window.store,
      window.Actions,
      function (scale) {
        if (onScaleChange) onScaleChange(scale);
      }
    );

    onScaleChange = window.ZoomBar.mount(
      document.getElementById("zoom-bar"),
      mounted.viewport
    );
    onScaleChange(mounted.viewport.getScale());

    var panel = window.PanelUI.mount(document.getElementById("panel"), window.store, window.Actions);

    /*
     * 開場的「上傳工單」對話框放在最後，而且是在字體閘門通過之後才會走到這裡——
     * 所以它不需要自己再預載一次字體，也不可能出現字體閃爍。
     * 它拿到的是面板交出來的匯入入口，走的是跟面板按鈕完全相同的那條路。
     */
    window.StartupDialog.mount(panel);
  }

  function showFailure(err) {
    statusEl.hidden = false;
    canvasEl.hidden = true;
    zoomBarEl.hidden = true;
    statusEl.innerHTML = "";

    var title = document.createElement("p");
    title.className = "font-status-main error";
    title.textContent = "字體載入失敗，已停止繪製";
    statusEl.appendChild(title);

    var detail = document.createElement("p");
    detail.className = "font-status-sub";
    detail.innerHTML =
      "原因：" + (err && err.message ? err.message : "未知錯誤") + "<br />" +
      "依規範不能用系統預設字體頂替（會產出錯誤字體的圖），因此這裡不繪製也不開放匯出。<br />" +
      "請確認網路可連到 jimmywu-commits.github.io 後重試。";
    statusEl.appendChild(detail);

    var retry = document.createElement("button");
    retry.className = "primary";
    retry.textContent = "重新載入字體";
    retry.addEventListener("click", start);
    statusEl.appendChild(retry);
  }

  function start() {
    statusEl.hidden = false;
    canvasEl.hidden = true;
    zoomBarEl.hidden = true;
    statusEl.innerHTML =
      '<div class="spinner"></div>' +
      '<p class="font-status-main">正在載入 ShopeeNotoSans 字體…</p>' +
      '<p class="font-status-sub">首次載入約 10MB，需要幾秒鐘。<br />' +
      "依規範必須等字體完全就緒才會繪製，以免匯出成錯誤字體。</p>";

    window.FontLoader.load().then(mountApp).catch(showFailure);
  }

  start();
})();
