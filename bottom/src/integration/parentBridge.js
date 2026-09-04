/*
 * BODA 主工具 ↔ 吸底編輯器橋接。
 *
 * 原則：橋接只負責「把同一份 File 送進來」，不解析工單、不改 state。
 * 真正的格式偵測仍由 workOrderImporter.js 與 PanelUI.importWorkOrder 處理，
 * 所以獨立開啟、面板手動選檔、主工具自動同步三條路的結果完全一致。
 */
(function () {
  var panelApi = null;
  var mounted = false;
  var seq = 0;
  var pending = {};
  /* 收到父頁同步時，store 仍會發出 change；這個旗標避免它再被誤判為使用者編輯而回傳，造成兩個入口無限互相覆蓋。 */
  var parentStateSyncDepth = 0;

  function isEmbedded() {
    var embed = new URLSearchParams(location.search).get("embed");
    return (embed === "generator" || embed === "standalone" || embed === "import-preview") && window.parent !== window;
  }
  function isImportPreview() {
    return new URLSearchParams(location.search).get("embed") === "import-preview";
  }
  function isGeneratorEmbed() {
    return new URLSearchParams(location.search).get("embed") === "generator";
  }


  function post(message) {
    if (!isEmbedded()) return false;
    try {
      window.parent.postMessage(Object.assign({ source: "BODA_BOTTOM" }, message || {}), "*");
      return true;
    } catch (e) {
      return false;
    }
  }

  function syncHostLevelControl(levelId, options) {
    var control = window.BottomHostLevel;
    if (!control) return;
    if (options && control.setOptions) control.setOptions(options);
    if (levelId != null && control.setValue) control.setValue(levelId);
  }
  function serializeStateForBridge(state) {
    if (window.ProjectFile && typeof window.ProjectFile.serializeForSync === "function") {
      return window.ProjectFile.serializeForSync(state);
    }
    return window.ProjectFile.serialize(state);
  }

  function makeFile(buffer, name) {
    var type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    try {
      return new File([buffer], name || "工單.xlsx", { type: type });
    } catch (e) {
      var blob = new Blob([buffer], { type: type });
      blob.name = name || "工單.xlsx";
      return blob;
    }
  }

  function finishRequest(id, result, error) {
    if (!id || !pending[id]) return;
    var p = pending[id];
    delete pending[id];
    clearTimeout(p.timer);
    if (error) p.reject(error);
    else p.resolve(result);
  }

  function sendPreviewImage(sourceMessage) {
    if (!isImportPreview() || !window.ExportBatch || !window.Selectors || !window.store) return;
    var view = window.Selectors.viewState(window.store.getState());
    window.ExportBatch.exportView(view).then(function (results) {
      var index = Math.max(0, Math.min(results.length - 1, Number(view.activeSlotIndex) || 0));
      var result = results[index] || results[0];
      if (!result || !result.dataUrl) throw new Error("吸底成品沒有可輸出的圖片");
      post({ type: "PREVIEW_IMAGE", workOrderVersion: Number(sourceMessage && sourceMessage.workOrderVersion) || 0, dataUrl: result.dataUrl, width: window.LAYOUT.canvasWidth, height: window.LAYOUT.canvasHeight });
    }).catch(function (err) {
      post({ type: "PREVIEW_IMAGE_ERROR", workOrderVersion: Number(sourceMessage && sourceMessage.workOrderVersion) || 0, message: err && err.message ? err.message : String(err) });
    });
  }

  /* 主工具「下載全部」會要求吸底自己輸出所有分頁圖片。
     由吸底 iframe 直接建立 ZIP，可沿用和面板按鈕完全相同的渲染流程，
     也避免把多張大型 data URL 再透過 postMessage 複製回主頁。 */
  function exportAllForParent(msg) {
    if (!isGeneratorEmbed() || !window.ExportBatch || !window.store) {
      post({
        type: "EXPORT_RESULT",
        requestId: msg && msg.requestId || "",
        ok: false,
        message: "吸底匯出器尚未就緒"
      });
      return;
    }

    /* 先送出目前畫面最後一份 state；主頁會在收到 EXPORT_RESULT 前用它建立工單試算表。 */
    post({ type: "STATE", state: serializeStateForBridge(window.store.getState()) });
    window.ExportBatch.exportAllBanners(window.store)
      .then(function (groups) {
        return window.ExportBatch.downloadAllBannersAsZip(
          groups,
          msg && msg.filenamePrefix || "BODA工單_吸底圖",
          window.store
        ).then(function () {
          return groups;
        });
      })
      .then(function (groups) {
        var imageCount = (groups || []).reduce(function (sum, group) {
          return sum + ((group && group.results) || []).length;
        }, 0);
        post({
          type: "EXPORT_RESULT",
          requestId: msg && msg.requestId || "",
          ok: true,
          bannerCount: (groups || []).length,
          imageCount: imageCount,
          message: "吸底圖片 ZIP 已下載"
        });
      })
      .catch(function (err) {
        post({
          type: "EXPORT_RESULT",
          requestId: msg && msg.requestId || "",
          ok: false,
          message: err && err.message ? err.message : String(err)
        });
      });
  }
  function importFromParent(msg) {
    if (!panelApi || !msg.buffer) {
      finishRequest(msg.requestId, null, new Error("吸底工具尚未完成載入"));
      return;
    }
    var file = makeFile(msg.buffer, msg.name);
    /* 這是父頁提供的檔案與既有編輯狀態，不是本入口的新編輯。
       匯入過程產生的 store change 不得再轉送回父頁。 */
    parentStateSyncDepth++;
    panelApi.importWorkOrder(file, function (err) {
      try {
        if (!err && msg.bottomState) applyStateFromParent({ state: msg.bottomState, requestId: msg.requestId || "" });
        if (!err) applyLevelPreset(msg.levelId);
        if (!err && window.StartupDialog && window.StartupDialog.close) window.StartupDialog.close();
        if (!err) sendPreviewImage(msg);
        post({
          type: "IMPORT_RESULT",
          requestId: msg.requestId || "",
          ok: !err,
          name: msg.name || "工單.xlsx",
          message: err ? (err.message || String(err)) : "已同步工單"
        });
        if (err) finishRequest(msg.requestId, null, err);
        else finishRequest(msg.requestId, { status: "imported", name: msg.name || "工單.xlsx" });
      } finally {
        parentStateSyncDepth = Math.max(0, parentStateSyncDepth - 1);
      }
    });
  }

  function applyStateFromParent(msg) {
    if (!window.ProjectFile || !window.store || !window.Actions || !msg || msg.state == null) return;
    /* 相同狀態不需要重新建立面板；這能保住正在輸入的游標與開啟中的 ICON 選單。 */
    if (typeof msg.state === "string" && msg.state === serializeStateForBridge(window.store.getState())) return;
    parentStateSyncDepth++;
    try {
      var data = typeof msg.state === "string" ? window.ProjectFile.parse(msg.state) : msg.state;
      window.store.beginBatch();
      var warnings = window.ProjectFile.applyToStore(window.store, window.Actions, data);
      window.store.endBatch();
      post({ type: "STATE_APPLIED", requestId: msg.requestId || "", warnings: warnings || [] });
    } catch (e) {
      try { window.store.endBatch(); } catch (ignore) {}
      post({ type: "STATE_APPLY_ERROR", requestId: msg.requestId || "", message: e && e.message ? e.message : String(e) });
    } finally {
      parentStateSyncDepth = Math.max(0, parentStateSyncDepth - 1);
    }
  }

  function applyLevelPreset(levelId) {
    if (!levelId || !window.BottomLevelPreset || !window.store) return false;
    if (!window.BottomLevelPreset.applyLevel(levelId)) return false;
    /* 工單匯入期間會暫停一般 STATE 回傳；等級預設仍須主動送回，
       才能讓另一個吸底入口使用同一份最新狀態。 */
    post({
      type: "LEVEL_PRESET_STATE",
      levelId: String(levelId),
      state: serializeStateForBridge(window.store.getState())
    });
    return true;
  }
  function onMessage(event) {
    if (!isEmbedded() || event.source !== window.parent) return;
    var msg = event.data || {};
    if (msg.source !== "BODA_PARENT") return;

    if (msg.type === "HOST_LAYOUT") {
      var top = Math.max(0, Number(msg.panelTop) || 0);
      var width = Math.max(280, Number(msg.panelWidth) || 340);
      var toolbarHeight = Math.max(0, Number(msg.canvasToolbarHeight) || 0);
      document.documentElement.style.setProperty("--host-panel-top", top + "px");
      document.documentElement.style.setProperty("--host-panel-width", width + "px");
      document.documentElement.style.setProperty("--host-canvas-toolbar-height", toolbarHeight + "px");
    } else if (msg.type === "VIEWPORT_ZOOM") {
      var scale = Number(msg.scale);
      if (isFinite(scale) && window.BottomViewport && typeof window.BottomViewport.zoomTo === "function") {
        window.BottomViewport.zoomTo(scale);
      }
    } else if (msg.type === "WORKORDER_FILE") {
      importFromParent(msg);
    } else if (msg.type === "BOTTOM_LEVEL_OPTIONS") {
      syncHostLevelControl(null, msg.levels || []);
    } else if (msg.type === "BOTTOM_LEVEL") {
      syncHostLevelControl(msg.levelId);
      if (applyLevelPreset(msg.levelId) && isImportPreview()) sendPreviewImage(msg);
    } else if (msg.type === "BOTTOM_STATE") {
      applyStateFromParent(msg);
    } else if (msg.type === "EXPORT_ALL") {
      exportAllForParent(msg);
    } else if (msg.type === "NO_WORKORDER") {
      finishRequest(msg.requestId, {
        status: "empty",
        message: msg.message || "主工具目前沒有可同步的工單。"
      });
    }
  }

  function mount(api) {
    panelApi = api;
    if (!mounted) {
      mounted = true;
      window.addEventListener("message", onMessage);
    }
    if (isEmbedded()) post({ type: "READY" });
    if (isEmbedded() && window.ProjectFile && window.store) {
      /* 初始 state 只供父頁記錄，不應拿預設畫面覆蓋另一個吸底入口的編輯結果。 */
      post({ type: "STATE", state: serializeStateForBridge(window.store.getState()), initial: true });
      window.store.subscribe(function (state, action) {
        /* 收到父頁同步時不要再回傳，否則兩個 iframe 會互相重繪。 */
        if (parentStateSyncDepth > 0) return;
        /* store 變更代表使用者實際編輯，交給父頁同步另一個入口。 */
        post({
          type: "STATE",
          state: serializeStateForBridge(state || window.store.getState()),
          changed: true,
          actionType: action && action.type || ""
        });
      });
    }
  }

  function requestLatestWorkOrder() {
    if (!isEmbedded()) return Promise.resolve({ status: "empty", message: "目前不是嵌入主工具模式。" });
    var id = "bottom-request-" + Date.now() + "-" + (++seq);
    return new Promise(function (resolve, reject) {
      pending[id] = {
        resolve: resolve,
        reject: reject,
        timer: setTimeout(function () {
          if (!pending[id]) return;
          delete pending[id];
          reject(new Error("主工具沒有回應，請改用上方按鈕直接選擇工單。"));
        }, 8000)
      };
      if (!post({ type: "REQUEST_LATEST_WORKORDER", requestId: id })) {
        finishRequest(id, null, new Error("無法連線到主工具"));
      }
    });
  }

  window.BottomParentBridge = {
    mount: mount,
    isEmbedded: isEmbedded,
    requestLatestWorkOrder: requestLatestWorkOrder,
    requestLevelChange: function (levelId) { return post({ type: "LEVEL_CHANGE_REQUEST", levelId: String(levelId || "") }); },
    requestGeneratorDownloadAll: function () { return post({ type: "REQUEST_GENERATOR_DOWNLOAD_ALL" }); }
  };
})();
