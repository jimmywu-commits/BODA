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

    /* 給主工具嵌入模式的「顯示」下拉使用；只控制檢視倍率，不影響匯出尺寸。 */
    window.BottomViewport = mounted.viewport;
    onScaleChange = window.ZoomBar.mount(
      document.getElementById("zoom-bar"),
      mounted.viewport
    );
    onScaleChange(mounted.viewport.getScale());

    var panel = window.PanelUI.mount(document.getElementById("panel"), window.store, window.Actions);
    var isStandaloneEmbed = new URLSearchParams(location.search).get("embed") === "standalone";
    if (isStandaloneEmbed) {
      var panelEl = document.getElementById("panel");
      var hostLevel = document.createElement("div");
      hostLevel.id = "bottom-host-level";
      hostLevel.innerHTML = '<label for="bottom-host-level-select">等級</label><select id="bottom-host-level-select" aria-label="吸底等級"></select>';
      panelEl.insertBefore(hostLevel, panelEl.firstChild);
      var hostLevelSelect = hostLevel.querySelector("select");
      window.BottomHostLevel = {
        setOptions: function (items) {
          var current = hostLevelSelect.value;
          hostLevelSelect.innerHTML = (items || []).map(function (item) {
            return '<option value="' + String(item.id || "").replace(/"/g, "&quot;") + '">' + String(item.label || item.id || "") + '</option>';
          }).join("");
          if (current) hostLevelSelect.value = current;
        },
        setValue: function (id) { if (id != null) hostLevelSelect.value = String(id); }
      };
      hostLevelSelect.addEventListener("change", function () {
        if (window.BottomParentBridge && window.BottomParentBridge.requestLevelChange) window.BottomParentBridge.requestLevelChange(hostLevelSelect.value);
      });

    }
    // 畫布「未選圖」框拖放與面板上傳共用同一套圖片處理流程。
    window.BottomImageUpload = panel && panel.stageImageUpload ? panel.stageImageUpload : null;

    /* 嵌入主工具時先啟動 postMessage 橋；父頁送來的 xlsx 仍走 panel.importWorkOrder，
       因此和手動匯入共用完全相同的解析、核對訊息與 undo 行為。 */
    if (window.BottomParentBridge) window.BottomParentBridge.mount(panel);

    /* 單獨開啟 bottom/index.html 時保留原本的開場工單對話框；嵌入 BODA 時工具列
       已經直接放在左欄，並會自動接主工具工單，不再用 Modal 擋住畫布。 */
    if (!window.BottomParentBridge || !window.BottomParentBridge.isEmbedded()) {
      window.StartupDialog.mount(panel);
    }
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
