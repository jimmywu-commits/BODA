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

  function isEmbedded() {
    return document.documentElement.classList.contains("embed-generator") && window.parent !== window;
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

  function importFromParent(msg) {
    if (!panelApi || !msg.buffer) {
      finishRequest(msg.requestId, null, new Error("吸底工具尚未完成載入"));
      return;
    }
    var file = makeFile(msg.buffer, msg.name);
    panelApi.importWorkOrder(file, function (err) {
      if (!err && window.StartupDialog && window.StartupDialog.close) window.StartupDialog.close();
      post({
        type: "IMPORT_RESULT",
        requestId: msg.requestId || "",
        ok: !err,
        name: msg.name || "工單.xlsx",
        message: err ? (err.message || String(err)) : "已同步工單"
      });
      if (err) finishRequest(msg.requestId, null, err);
      else finishRequest(msg.requestId, { status: "imported", name: msg.name || "工單.xlsx" });
    });
  }

  function onMessage(event) {
    if (!isEmbedded() || event.source !== window.parent) return;
    var msg = event.data || {};
    if (msg.source !== "BODA_PARENT") return;

    if (msg.type === "HOST_LAYOUT") {
      var top = Math.max(0, Number(msg.panelTop) || 0);
      var width = Math.max(280, Number(msg.panelWidth) || 340);
      document.documentElement.style.setProperty("--host-panel-top", top + "px");
      document.documentElement.style.setProperty("--host-panel-width", width + "px");
    } else if (msg.type === "WORKORDER_FILE") {
      importFromParent(msg);
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
    requestLatestWorkOrder: requestLatestWorkOrder
  };
})();
