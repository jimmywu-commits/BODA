/*
 * 圖像化素材選單。
 *
 * 取代原本的 <select>：下拉選單只有檔名，「shoes」和「hoodie」在腦中要先翻譯成圖，
 * 素材一多就只能一個一個試。這裡直接給縮圖。
 *
 * 做成「按鈕 + 浮動面板」而不是每一格內嵌一個縮圖網格：一份吸底圖最多 5 格，
 * 素材有 20 幾個，內嵌就是 100 多張縮圖塞進側邊面板，捲不完也找不到。
 * 浮動面板同一時間只會開一個，而且可以做得比欄位寬。
 *
 * 縮圖刻意畫在淺色底上：素材是橘色 + 透明鏤空，深色面板底下鏤空處會看不出形狀，
 * 淺底才和最終輸出的白色區塊一致。
 */
(function () {
  var TILE = 56;
  var open = null; // { panel, cleanup }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") node.className = attrs[k];
      else if (k === "onClick") node.addEventListener("click", attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function iconThumbSrc(icon) {
    // 縮圖一律用素材原始外觀，不套配色濾鏡——這裡要回答的是「這是哪一張圖」，
    // 不是「它套色之後長怎樣」。套色後全部變成同一個橘，反而更難分辨。
    if (icon.src) return icon.src;
    if (icon.svg) return window.ColorTheme.svgToDataUri(window.ColorTheme.ensureSvgSize(icon.svg));
    return null;
  }

  function close() {
    if (!open) return;
    open.cleanup();
    if (open.panel.parentNode) open.panel.parentNode.removeChild(open.panel);
    open = null;
  }

  function buildTile(icon, isSelected, onPick) {
    var tile = el("button", {
      class: "icon-tile" + (isSelected ? " selected" : ""),
      title: icon.displayName + (icon.type === "logo" ? "（LOGO：保持原色）" : ""),
      onClick: function () { onPick(icon.id); },
    });

    var src = iconThumbSrc(icon);
    if (src) {
      var img = el("img", { src: src, alt: icon.displayName, draggable: "false" });
      tile.appendChild(img);
    } else {
      tile.appendChild(el("span", { class: "icon-tile-fallback" }, ["?"]));
    }

    tile.appendChild(el("span", { class: "icon-tile-name" }, [icon.displayName]));
    if (icon.type === "logo") tile.appendChild(el("span", { class: "icon-tile-badge" }, ["LOGO"]));
    return tile;
  }

  /*
   * anchor 是被點的那顆按鈕。面板用 fixed 定位掛在 body 上而不是塞進卡片裡，
   * 因為側邊面板有 overflow:auto，塞在裡面會被裁掉。
   */
  function place(panel, anchor) {
    var r = anchor.getBoundingClientRect();
    panel.style.visibility = "hidden";
    document.body.appendChild(panel);
    var pw = panel.offsetWidth;
    var ph = panel.offsetHeight;

    // 嵌入工單生成器時，主頁的素材庫標題、等級與頁簽會覆蓋 iframe 上緣。
    // 彈窗不能放進這段保留區，否則吸底頁簽開啟 icon/logo 時第一排會被切掉。
    var safeTop = 8;
    if (document.documentElement.classList.contains("embed-generator")) {
      var hostTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--host-panel-top"));
      if (isFinite(hostTop)) safeTop = Math.max(safeTop, hostTop + 8);
    }
    var safeBottom = 8;
    var availableHeight = Math.max(120, window.innerHeight - safeTop - safeBottom);
    if (ph > availableHeight) {
      panel.style.maxHeight = availableHeight + "px";
      ph = panel.offsetHeight;
    }

    var left = Math.min(r.left, window.innerWidth - pw - 8);
    if (left < 8) left = 8;

    // 下方放不下就翻到上方；上下都放不下就貼齊安全區並讓面板自己捲動
    var top = r.bottom + 6;
    if (top + ph > window.innerHeight - safeBottom) {
      var above = r.top - ph - 6;
      top = above >= safeTop ? above : Math.max(safeTop, window.innerHeight - ph - safeBottom);
    }

    panel.style.left = Math.round(left) + "px";
    panel.style.top = Math.round(top) + "px";
    panel.style.visibility = "";
  }

  /*
   * library：目前素材庫；selectedId：目前這一格選的；onPick(idOrNull)：選好之後的回呼。
   * onPick 會自動關閉面板，呼叫端不用管。
   */
  function openPicker(anchor, library, selectedId, onPick) {
    close();

    var panel = el("div", { class: "icon-picker" });

    var head = el("div", { class: "icon-picker-head" });
    var search = el("input", { type: "text", placeholder: "搜尋素材名稱…" });
    head.appendChild(search);
    head.appendChild(
      el("button", { class: "mini", onClick: function () { pick(null); } }, ["清除"])
    );
    panel.appendChild(head);

    var grid = el("div", { class: "icon-grid" });
    panel.appendChild(grid);

    var empty = el("div", { class: "icon-picker-empty" }, ["找不到符合的素材"]);
    empty.hidden = true;
    panel.appendChild(empty);

    function pick(id) {
      close();
      onPick(id);
    }

    function renderGrid(keyword) {
      grid.innerHTML = "";
      var kw = (keyword || "").trim().toLowerCase();
      var shown = 0;
      library.forEach(function (icon) {
        if (kw && icon.displayName.toLowerCase().indexOf(kw) < 0) return;
        grid.appendChild(buildTile(icon, icon.id === selectedId, pick));
        shown++;
      });
      empty.hidden = shown > 0;
    }

    renderGrid("");
    search.addEventListener("input", function (e) { renderGrid(e.target.value); });

    place(panel, anchor);
    search.focus();

    // 點面板以外、按 Esc、捲動或改變視窗大小都關閉（位置是算好的，捲動後就不對了）
    function onDocDown(e) {
      if (panel.contains(e.target) || anchor.contains(e.target)) return;
      close();
    }
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); close(); anchor.focus(); }
    }
    /*
     * 捲動要關閉的是「面板外面」的捲動——側邊面板捲了，算好的 fixed 座標就不對了。
     * 但 .icon-grid 自己也會捲（素材一多就一定超出），而 scroll 這裡是捕獲階段，
     * 面板內部的捲動同樣收得到。不排除就會變成「一滾滑鼠選單就消失」，
     * 素材少的時候網格不溢出所以看不出來，加到 20 幾個之後就整個選不了。
     */
    function onScroll(e) {
      if (panel.contains(e.target)) return;
      close();
    }
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    // 用捕獲階段才收得到側邊面板內部的捲動（scroll 不會冒泡）
    document.addEventListener("scroll", onScroll, true);

    open = {
      panel: panel,
      cleanup: function () {
        document.removeEventListener("mousedown", onDocDown, true);
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("resize", close);
        document.removeEventListener("scroll", onScroll, true);
      },
    };
  }

  /*
   * 每一格上那顆「目前選了什麼」的按鈕。點下去開選單。
   */
  function buildTrigger(library, selectedId, onPick) {
    var icon = null;
    for (var i = 0; i < library.length; i++) {
      if (library[i].id === selectedId) { icon = library[i]; break; }
    }

    var btn = el("button", {
      class: "icon-trigger" + (icon ? "" : " empty"),
      title: icon ? "目前：" + icon.displayName + "（點擊更換）" : "點擊選擇 icon / LOGO",
    });

    var box = el("span", { class: "icon-trigger-thumb" });
    if (icon) {
      var src = iconThumbSrc(icon);
      if (src) box.appendChild(el("img", { src: src, alt: "", draggable: "false" }));
    }
    btn.appendChild(box);

    btn.appendChild(
      el("span", { class: "icon-trigger-label" }, [
        icon ? (icon.type === "logo" ? "[LOGO] " : "") + icon.displayName : "（未選 icon / LOGO）",
      ])
    );
    btn.appendChild(el("span", { class: "icon-trigger-caret" }, ["▾"]));

    btn.addEventListener("click", function () {
      openPicker(btn, library, selectedId, onPick);
    });
    return btn;
  }

  window.IconPicker = {
    TILE: TILE,
    buildTrigger: buildTrigger,
    open: openPicker,
    close: close,
    isOpen: function () { return !!open; },
  };
})();
