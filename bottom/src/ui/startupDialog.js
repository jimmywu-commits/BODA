/*
 * 開場對話框：一進來（或重新整理後）先問「這次的工單」。
 *
 * 為什麼要有它：面板上的「📋 匯入工單」一直都在，但它排在右側面板最上方，
 * 新手第一眼看到的是畫布與一堆欄位，很容易就開始手動一格一格打字——
 * 而工單匯入本來可以一次把整份文案與 icon 帶進來。把它提到開場，
 * 等於把「最省事的作法」變成預設路徑。
 *
 * 三個刻意的設計：
 *
 * 1. **不自己解析檔案。** 選到檔之後呼叫 PanelUI 交出來的 importWorkOrder /
 *    loadProject，走的是面板上那兩顆按鈕完全一樣的路。否則「從對話框匯入」
 *    就看不到那份逐項核對清單（哪幾格素材沒對上），而那正是匯入最需要的東西。
 *
 * 2. **失敗不關閉。** 成功才關，失敗就把錯誤留在卡片上。若一律關閉，
 *    使用者只會看到對話框消失、畫面沒變，不知道是自己選錯檔還是工具壞了。
 *
 * 3. **「已顯示」只記在記憶體，不進 localStorage。** F5 就是新的一頁，
 *    使用者重新整理多半就是想重來一次。同一次頁面生命週期內不重複自動彈出。
 */
(function () {
  var OVERLAY_ID = "startup-overlay";
  var shown = false;
  var api = null; // PanelUI.mount() 交回來的匯入入口
  var overlay = null;
  var errBox = null;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") node.className = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function setError(msg) {
    if (errBox) errBox.textContent = msg || "";
  }

  function close() {
    if (overlay) overlay.classList.remove("open");
    shown = true;
  }

  function open() {
    if (overlay) overlay.classList.add("open");
  }

  /*
   * 兩支入口共用的收尾：成功關閉、失敗把訊息留在卡片上。
   * 面板那邊已經把完整錯誤寫進 ui.importMessage 了，這裡只需要一句話讓人知道發生什麼事。
   */
  function handler(fn, failPrefix) {
    return function (file) {
      if (!file) return;
      setError("");
      fn(file, function (err) {
        if (err) setError(failPrefix + "：" + (err.message || "未知錯誤"));
        else close();
      });
    };
  }

  function build() {
    var takeOrder = handler(function (f, cb) { api.importWorkOrder(f, cb); }, "工單匯入失敗");
    var takeProject = handler(function (f, cb) { api.loadProject(f, cb); }, "載入進度失敗");

    // ── 主按鈕：整塊都是 <label>，點哪裡都會開檔案選擇器
    var orderInput = el("input", {
      type: "file",
      accept: ".xlsx,.xlsm,.csv",
      class: "startup-file",
    });
    orderInput.addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = ""; // 先清空，選同一個檔第二次才會再觸發 change
      takeOrder(f);
    });

    var drop = el("label", { class: "startup-drop" }, [
      el("div", { class: "startup-drop-icon", text: "📊" }),
      el("div", { class: "startup-drop-title", text: "上傳工單 .xlsx" }),
      el("div", { class: "startup-drop-hint", text: "點擊選擇，或直接把檔案拖曳到這裡" }),
      orderInput,
    ]);

    // 拖曳：dragover 一定要 preventDefault，否則瀏覽器會直接用新分頁開啟那個檔案
    drop.addEventListener("dragover", function (e) {
      e.preventDefault();
      drop.classList.add("dragover");
    });
    drop.addEventListener("dragleave", function () { drop.classList.remove("dragover"); });
    drop.addEventListener("drop", function (e) {
      e.preventDefault();
      drop.classList.remove("dragover");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      // 副檔名先擋一次：.json 拖到工單框是很自然的誤操作，直接說清楚比丟解析錯誤好
      if (/\.json$/i.test(f.name)) {
        setError("這是進度存檔，請改用下方的「📂 載入進度存檔」。");
        return;
      }
      if (!/\.(xlsx|xlsm|csv)$/i.test(f.name)) {
        setError("只吃得下 .xlsx / .xlsm / .csv 的工單檔。");
        return;
      }
      takeOrder(f);
    });

    // ── 下方兩顆：略過 / 載入進度存檔
    var skip = el("button", { type: "button", class: "startup-minor", text: "略過" });
    skip.addEventListener("click", close);

    var projectInput = el("input", { type: "file", accept: ".json", class: "startup-file" });
    projectInput.addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = "";
      takeProject(f);
    });
    var loadProject = el("label", { class: "startup-minor" }, [
      el("span", { text: "📂 載入進度存檔" }),
      projectInput,
    ]);

    errBox = el("div", { class: "startup-error" });

    var card = el("div", { class: "startup-card", role: "dialog", "aria-modal": "true" }, [
      el("div", { class: "startup-title", text: "開始製作吸底圖" }),
      el("div", {
        class: "startup-sub",
        text: "上傳本次的工單 .xlsx，系統會自動帶入每一條吸底圖的文案與 icon 名稱。",
      }),
      drop,
      el("div", { class: "startup-minor-row" }, [skip, loadProject]),
      errBox,
    ]);

    overlay = el("div", { id: OVERLAY_ID }, [card]);

    // 點卡片外的空白 = 略過。卡片內部的點擊不能冒泡上來把自己關掉
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("open")) close();
    });

    document.body.appendChild(overlay);
  }

  window.StartupDialog = {
    /*
     * panelApi = PanelUI.mount() 的回傳值。
     * 由 app.js 在字體閘門通過、面板掛好之後才呼叫——這樣就不需要像別的專案那樣
     * 自己再預載一次字體並和逾時賽跑：能走到這裡，字體必定已經 100% 就緒。
     */
    mount: function (panelApi) {
      api = panelApi;
      if (!overlay) build();
      if (!shown) open();
    },
    open: function () { shown = false; open(); },
    close: close,
  };
})();
