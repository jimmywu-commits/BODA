(function () {
  var ColorTheme = window.ColorTheme;

  function findLibraryIcon(library, iconId) {
    for (var i = 0; i < library.length; i++) {
      if (library[i].id === iconId) return library[i];
    }
    return null;
  }

  /*
   * 批次匯出時每一張的 active slot 都不同，同一顆 icon 在不同張裡可能是反白版、也可能是灰版，
   * 兩種顏色的圖都要先載好，匯出當下才畫得出來（渲染是同步的，不能等圖片才載）。
   * 廠商 LOGO 與點陣圖 icon 是靠濾鏡改外觀、圖檔本身只有一份，所以只需要載一次。
   */
  function collectRequiredDataUris(view) {
    var uris = [];
    view.slots.forEach(function (slot) {
      var icon = slot.iconId ? findLibraryIcon(view.library, slot.iconId) : null;
      if (!icon) return;

      if (icon.type === "logo" || ColorTheme.needsTintFilter(icon)) {
        uris.push(ColorTheme.getIconSourceUri(icon, null));
        return;
      }

      var activeColor =
        ColorTheme.ACCENT_COLORS[view.accentColor] || ColorTheme.ACCENT_COLORS.orange;
      uris.push(ColorTheme.getIconSourceUri(icon, activeColor));
      uris.push(ColorTheme.getIconSourceUri(icon, ColorTheme.GRAY));
    });

    return uris.filter(function (uri, index) {
      return uris.indexOf(uri) === index;
    });
  }

  function loadImageAsync(dataUri) {
    return new Promise(function (resolve) {
      window.IconImageCache.loadImage(dataUri, function (img) {
        resolve({ uri: dataUri, ok: !!img });
      });
    });
  }

  /*
   * 載不進來的圖一律中止匯出，跟字體那道防線同樣的理由：
   * 缺一顆 icon 的 PNG 看起來仍然「像成品」，很容易就這樣發出去。
   * 寧可不給檔，也不給缺圖的檔。
   */
  async function preloadOrThrow(uris) {
    var loaded = await Promise.all(uris.map(loadImageAsync));
    var failed = loaded.filter(function (r) { return !r.ok; });
    if (failed.length) {
      throw new Error(
        "有 " + failed.length + " 個 icon 圖檔無法載入（最常見原因是 SVG 少了 xmlns 屬性），" +
          "為避免匯出缺圖的成品，已中止匯出。"
      );
    }
  }

  function withOffscreenStage(width, height, fn) {
    var container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-99999px";
    container.style.top = "0";
    document.body.appendChild(container);

    var stage = new Konva.Stage({ container: container, width: width, height: height });
    var layer = new Konva.Layer();
    stage.add(layer);

    try {
      return fn(stage, layer);
    } finally {
      stage.destroy();
      document.body.removeChild(container);
    }
  }

  /*
   * 產生 N 張變體圖：同一條吸底圖，只把 activeSlotIndex 換成 0..N-1 各畫一次、各截一張圖。
   * 用的是另外開的離屏 stage，不會動到畫面上使用者正在編輯的那個 canvas。
   */
  function renderAllVariants(view, width, height) {
    return withOffscreenStage(width, height, function (stage, layer) {
      var results = [];
      for (var i = 0; i < view.slots.length; i++) {
        var frame = Object.assign({}, view, { activeSlotIndex: i });
        // 不傳 isPreview，匯出的圖才不會出現預覽假字與空 icon 虛線框
        window.CanvasRenderer.renderToLayer(layer, frame);
        // 上方 20px 沒有畫任何東西，所以匯出的 PNG 那一段會是透明的
        results.push({ index: i, dataUrl: stage.toDataURL({ pixelRatio: 1 }) });
      }
      return results;
    });
  }

  function assertFontReady() {
    // 防呆：字體沒 100% 就緒就匯出，產出的會是系統預設字體的廢圖，而且不一定看得出來。
    // 寧可中止並明確報錯，也不要交出錯誤字體的檔案。
    if (!window.FontLoader.isReady()) {
      throw new Error("字體尚未載入完成，為避免匯出成錯誤字體，已中止匯出。");
    }
  }

  // 匯出單一條（給「目前分頁」用）
  async function exportView(view) {
    assertFontReady();
    await preloadOrThrow(collectRequiredDataUris(view));
    return renderAllVariants(view, window.LAYOUT.canvasWidth, window.LAYOUT.canvasHeight);
  }

  async function exportAll(store) {
    return exportView(window.Selectors.viewState(store.getState()));
  }

  // 匯出全部分頁：回傳 [{ bannerIndex, label, results }]
  async function exportAllBanners(store) {
    assertFontReady();
    var state = store.getState();

    var views = state.banners.map(function (banner) {
      return window.Selectors.viewState(state, banner);
    });

    // 所有分頁用到的圖一次載完，之後每條的渲染都是同步的
    var uris = [];
    views.forEach(function (v) {
      collectRequiredDataUris(v).forEach(function (u) {
        if (uris.indexOf(u) < 0) uris.push(u);
      });
    });
    await preloadOrThrow(uris);

    return views.map(function (view, i) {
      return {
        bannerIndex: i,
        label: window.Selectors.bannerLabel(i),
        results: renderAllVariants(view, window.LAYOUT.canvasWidth, window.LAYOUT.canvasHeight),
      };
    });
  }

  function dataUrlToUint8Array(dataUrl) {
    var base64 = dataUrl.split(",")[1];
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function safeName(text) {
    return (text || "").replace(/[\\/:*?"<>|]/g, "");
  }

  function slotFileLabel(view, index) {
    var slot = view.slots[index];
    var text = safeName(slot && slot.text ? slot.text : "");
    return text ? index + 1 + "-" + text : String(index + 1);
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /*
   * 進度存檔一律含「全部分頁」，即使這次只匯出目前這一條。
   * 存檔的用途是接續編輯，只存一條的話回來就少了其他分頁。
   */
  async function downloadAsZip(results, filenamePrefix, store) {
    var prefix = filenamePrefix || "吸底圖";
    var view = window.Selectors.viewState(store.getState());
    var zip = new JSZip();

    results.forEach(function (r, idx) {
      zip.file(prefix + "-" + slotFileLabel(view, idx) + ".png", dataUrlToUint8Array(r.dataUrl));
    });
    zip.file(window.ProjectFile.FILENAME, window.ProjectFile.serialize(store.getState()));

    triggerDownload(await zip.generateAsync({ type: "blob" }), prefix + ".zip");
  }

  async function downloadAllBannersAsZip(groups, filenamePrefix, store) {
    var prefix = filenamePrefix || "吸底圖";
    var state = store.getState();
    var zip = new JSZip();

    groups.forEach(function (group) {
      var view = window.Selectors.viewState(state, state.banners[group.bannerIndex]);
      var folder = zip.folder(safeName(group.label));
      group.results.forEach(function (r, idx) {
        folder.file(
          group.label + "-" + slotFileLabel(view, idx) + ".png",
          dataUrlToUint8Array(r.dataUrl)
        );
      });
    });
    zip.file(window.ProjectFile.FILENAME, window.ProjectFile.serialize(state));

    triggerDownload(await zip.generateAsync({ type: "blob" }), prefix + "-全部分頁.zip");
  }

  window.ExportBatch = {
    exportAll: exportAll,
    exportView: exportView,
    exportAllBanners: exportAllBanners,
    downloadAsZip: downloadAsZip,
    downloadAllBannersAsZip: downloadAllBannersAsZip,
    collectRequiredDataUris: collectRequiredDataUris,
  };
})();
