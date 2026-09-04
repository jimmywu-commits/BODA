(function () {
  var TextLimit = window.TextLimit;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === "onClick") node.addEventListener("click", attrs[key]);
      else if (key === "class") node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function section(title) {
    var node = el("div", { class: "panel-section" });
    if (title) node.appendChild(el("h3", {}, [title]));
    return node;
  }

  function note(text) {
    return el("div", { class: "note" }, [text]);
  }

  /*
   * 剛好 5 字 = 橘色（提醒已達上限），超過 5 字 = 紅色（配合輸入框的紅框）。
   * 兩者要分得開，不然「剛好用滿」跟「已經超了」會長得一樣。
   */
  function counterClass(used) {
    if (used > TextLimit.MAX_UNITS) return "counter over";
    if (used >= TextLimit.MAX_UNITS) return "counter full";
    return "counter";
  }

  /*
   * 檔期文字輸入框的紅框與提示。
   *
   * 字級縮到 LAYOUT.dateFontMin 就不再縮——再小就看不清楚——所以超長的字會真的溢出
   * 107px 的框。這是刻意的訊號（和「文字超過 5 字」同一套語彙），但一定要講出來。
   *
   * 抽成模組層級的函式而不是包在 buildSlotCard 裡：除了打字之外，undo/redo、
   * 載入存檔也會改到 iconText，那些路徑同樣要能同步這個狀態。
   */
  function applyDateFit(input, value) {
    if (!input) return;
    var fit = window.LayoutEngine.measureDateText(value || "");
    input.classList.toggle("over-limit", !fit.fits);
    input.title = fit.fits
      ? "會以 ShopeeNotoSans Bold 畫在 icon 的位置（" + fit.fontSize + "px）"
      : "太長了：縮到最小的 " + fit.fontSize + "px 仍然超出 107px 的框，畫面上會溢出到隔壁";
  }

  function makeIconId() {
    return "custom-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
  }

  function findLibraryIcon(library, iconId) {
    for (var i = 0; i < library.length; i++) {
      if (library[i].id === iconId) return library[i];
    }
    return null;
  }

  /*
   * 編輯目前這一顆的圖（裁切 / 外擴透明邊 / 去背）。
   * 編輯結果一律變成新的自訂點陣素材再套回這一顆，不會改到原本資料庫裡那筆
   *（別的欄位可能還在用同一顆 icon）。
   */
  function openEditorFor(store, Actions, ui, rerender, index) {
    var state = store.getState();
    var slot = window.Selectors.activeBanner(state).slots[index];
    var icon = slot && slot.iconId ? findLibraryIcon(state.library, slot.iconId) : null;
    if (!icon) return;

    var src = window.ColorTheme.getIconSourceUri(icon, window.ColorTheme.GRAY);

    window.ImageEditor.open(
      src,
      function (editedDataUrl) {
        var newIcon = {
          id: makeIconId(),
          displayName: icon.displayName + "（編輯）",
          type: icon.type,
          src: editedDataUrl,
          custom: true,
        };
        // 加素材＋套用算同一件事，合併成一步 undo
        store.beginBatch();
        store.dispatch(Actions.addLibraryIcon(newIcon));
        store.dispatch(Actions.setSlotIcon(index, newIcon.id));
        store.endBatch();

        ui.uploadMessage = "";
        rerender();
      },
      function (err) {
        ui.uploadMessage = "圖片編輯失敗：" + err.message;
        rerender();
      }
    );
  }

  /* ---------------- 分頁（多條吸底圖） ---------------- */

  function buildBannerTabs(state, store, Actions, tabbar) {
    tabbar.innerHTML = "";

    state.banners.forEach(function (banner, index) {
      var isActive = index === state.activeBannerIndex;
      var label = window.Selectors.bannerLabel(index);
      var meta = window.Selectors.bannerMeta(banner);

      var tab = el("button", {
        class: "banner-tab" + (isActive ? " active" : ""),
        title: label + "（" + meta + "）",
        onClick: function () { store.dispatch(Actions.setActiveBanner(index)); },
      });
      tab.appendChild(el("span", { class: "banner-tab-label" }, [label]));
      tab.appendChild(el("span", { class: "banner-tab-meta" }, [meta]));

      // 只剩一個分頁時不給關，否則會沒有東西可編輯
      if (state.banners.length > 1) {
        tab.appendChild(
          el("span", {
            class: "banner-tab-close",
            title: "刪除這條",
            onClick: function (e) {
              e.stopPropagation();
              if (!window.confirm("確定刪除「" + label + "」？可以用 Ctrl+Z 復原。")) return;
              store.dispatch(Actions.removeBanner(index));
            },
          }, ["×"])
        );
      }
      tabbar.appendChild(tab);
    });

    tabbar.appendChild(
      el("button", {
        class: "banner-tab banner-tab-add",
        title: "新增一條吸底圖",
        onClick: function () { store.dispatch(Actions.addBanner()); },
      }, ["＋"])
    );

    // 復原/重做是跨分頁的全域操作，跟著分頁列走
    var tools = el("div", { class: "tabbar-tools" });
    var undoBtn = el(
      "button",
      { class: "mini", title: "復原（Ctrl+Z）", onClick: function () { store.undo(); } },
      ["↩ 復原"]
    );
    var redoBtn = el(
      "button",
      { class: "mini", title: "重做（Ctrl+Y / Ctrl+Shift+Z）", onClick: function () { store.redo(); } },
      ["↪ 重做"]
    );
    undoBtn.setAttribute("data-history", "undo");
    redoBtn.setAttribute("data-history", "redo");
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
    tools.appendChild(undoBtn);
    tools.appendChild(redoBtn);
    tabbar.appendChild(tools);
  }

  /* ---------------- 匯入 ---------------- */

  /*
   * 兩支匯入處理函式刻意抽出來、不寫在按鈕的事件裡：
   * 開場的「上傳工單」對話框（startupDialog.js）要走的是**同一條路**。
   * 若讓對話框自己去呼叫 WorkOrderImporter，就會有兩份「解析完之後要做什麼」的邏輯，
   * 而其中一份不會更新 ui.importMessage / importDetail——使用者從對話框匯入
   * 就看不到那份逐項核對清單，那正是匯入最需要的東西。
   *
   * onDone 是給對話框用的：成功才關閉，失敗要留在原地把錯誤顯示出來。
   */
  function importWorkOrderFile(store, Actions, ui, rerender, file, onDone) {
    if (!file) return;
    ui.importMessage = "正在讀取工單…";
    ui.importDetail = [];
    rerender();

    window.WorkOrderImporter.parseFile(
      file,
      function (blocks) {
        var built = window.WorkOrderImporter.toBanners(blocks, store.getState().library);

        // 整份匯入算一步 undo，按錯可以 Ctrl+Z 整個退回
        store.beginBatch();
        store.dispatch(Actions.setBanners(built.banners, 0));
        store.endBatch();

        ui.importMessage =
          "已從工單匯入 " + built.banners.length + " 條吸底圖（" +
          built.banners.map(function (b) { return b.slots.length + " 格"; }).join("、") +
          "）。按錯可用 Ctrl+Z 整個退回。";
        ui.importDetail = window.WorkOrderImporter.summarise(blocks).concat(built.notes);
        rerender();
        if (onDone) onDone(null);
      },
      function (err) {
        ui.importMessage = "工單匯入失敗：" + err.message;
        ui.importDetail = [];
        rerender();
        if (onDone) onDone(err);
      }
    );
  }

  function loadProjectFile(store, Actions, ui, rerender, file, onDone) {
    if (!file) return;
    window.ProjectFile.readFile(
      file,
      function (data) {
        // 載入存檔會連發數個 action，合併成單一步 undo
        ui.importDetail = [];
        var warnings;
        try {
          store.beginBatch();
          warnings = window.ProjectFile.applyToStore(store, Actions, data);
        } catch (e) {
          store.endBatch();
          ui.importMessage = "載入進度失敗：" + e.message;
          rerender();
          if (onDone) onDone(e);
          return;
        }
        store.endBatch();

        ui.importMessage = warnings.length
          ? "已載入進度，但有以下狀況：" + warnings.join("；")
          : "已載入進度存檔（存檔時間 " + (data.savedAt || "未知") + "）。";
        rerender();
        if (onDone) onDone(null);
      },
      function (err) {
        ui.importMessage = "載入進度失敗：" + err.message;
        rerender();
        if (onDone) onDone(err);
      }
    );
  }

  function buildImportSection(store, Actions, ui, rerender) {
    var node = section("匯入");

    // 藏起來的真實 file input，由下面那顆橘色大按鈕觸發（原生 file input 太小、樣式也改不動）
    var orderInput = el("input", {
      type: "file",
      accept: ".xlsx,.xlsm,.csv",
      style: "display:none;",
    });
    orderInput.addEventListener("change", function (e) {
      importWorkOrderFile(store, Actions, ui, rerender, e.target.files && e.target.files[0]);
      orderInput.value = "";
    });
    node.appendChild(orderInput);
    node.appendChild(
      el("button", { class: "primary block", onClick: function () { orderInput.click(); } }, [
        "📋 匯入工單（xlsx / csv）",
      ])
    );

    /* 嵌入 BODA 時，可以直接取用主工具「匯入工單」最近選過的同一份 xlsx。
       真正解析仍呼叫上面的 importWorkOrderFile，不複製任何工單格式判斷。 */
    if (window.BottomParentBridge && window.BottomParentBridge.isEmbedded()) {
      node.appendChild(
        el("button", {
          class: "block",
          style: "margin-top:6px;",
          title: "把主工具『匯入工單』最近選過的 xlsx 同步到吸底工具",
          onClick: function () {
            ui.importMessage = "正在向主工具取得最近匯入的工單…";
            rerender();
            window.BottomParentBridge.requestLatestWorkOrder().then(function (result) {
              if (!result || result.status === "empty") {
                ui.importMessage = (result && result.message) || "主工具目前尚未匯入 xlsx；也可以直接使用上方按鈕選檔。";
                rerender();
              }
            }).catch(function (err) {
              ui.importMessage = "同步主工具工單失敗：" + (err && err.message ? err.message : err);
              rerender();
            });
          },
        }, ["↻ 同步主工具最近匯入的工單"])
      );
      node.appendChild(note("主工具匯入 xlsx 後，第一次切到吸底也會自動帶入；這裡仍可獨立選擇其他工單。"));
    }

    // ── 載入進度存檔 ──
    var projectInput = el("input", { type: "file", accept: ".json", style: "display:none;" });
    projectInput.addEventListener("change", function (e) {
      loadProjectFile(store, Actions, ui, rerender, e.target.files && e.target.files[0]);
      projectInput.value = "";
    });
    node.appendChild(projectInput);
    node.appendChild(
      el(
        "button",
        {
          class: "block",
          style: "margin-top:6px;",
          title: "載入之前匯出 zip 裡的「" + window.ProjectFile.FILENAME + "」，接續編輯",
          onClick: function () { projectInput.click(); },
        },
        ["📂 載入進度存檔（JSON）"]
      )
    );

    if (ui.importMessage) node.appendChild(note(ui.importMessage));

    /*
     * 逐條列出偵測到什麼、哪些沒對上——匯入不能只說「成功」，要能核對。
     * 但那是「匯入當下核對一次」的資訊，之後就變雜訊，所以預設收合。
     * 用原生 <details> 而不是自己做開合：狀態由瀏覽器管，面板重繪也不會意外展開。
     */
    if (ui.importDetail && ui.importDetail.length) {
      var box = el("details", { class: "import-detail-box" });
      box.appendChild(
        el("summary", {}, ["匯入明細（" + ui.importDetail.length + " 項）"])
      );
      var list = el("ul", { class: "import-detail" });
      ui.importDetail.forEach(function (line) {
        list.appendChild(el("li", {}, [line]));
      });
      box.appendChild(list);
      node.appendChild(box);
    }
    return node;
  }

  /* ---------------- 反白顏色 ---------------- */

  function buildAccentColorSection(banner, store, Actions) {
    var node = section("反白顏色（這條）");
    var row = el("div", { class: "btn-row" });
    [
      { key: "orange", label: "橘色", hex: window.ColorTheme.ACCENT_COLORS.orange },
      { key: "red", label: "紅色", hex: window.ColorTheme.ACCENT_COLORS.red },
    ].forEach(function (opt) {
      var selected = banner.accentColor === opt.key;

      /*
       * 未選取時「不」把文字染成品牌色——#d0011b 這種深色放在深灰底上幾乎看不到。
       * 改成用一顆色塊表示顏色、文字維持正常高對比；選取時才整顆填色配白字。
       */
      var btn = el("button", {
        class: "accent-btn" + (selected ? " selected" : ""),
        onClick: function () { store.dispatch(Actions.setAccentColor(opt.key)); },
        style: selected ? "background:" + opt.hex + ";border-color:" + opt.hex + ";" : "",
      });
      btn.appendChild(
        el("span", { class: "accent-chip", style: "background:" + opt.hex + ";" })
      );
      btn.appendChild(document.createTextNode(opt.label + "  " + opt.hex));
      row.appendChild(btn);
    });
    node.appendChild(row);
    return node;
  }

  /* ---------------- 畫質 ---------------- */

  function buildSharpenSection(state, store, Actions) {
    var node = section("畫質（全部分頁）");
    var on = !!state.sharpen;

    var row = el("div", { class: "btn-row" });
    row.appendChild(
      el(
        "button",
        {
          class: "block" + (on ? " primary" : ""),
          title: "對 icon 與文字各做一次 unsharp mask，效果類似 PS 的「環迴增值法（更銳利）」與銳利文字消除鋸齒",
          onClick: function () { store.dispatch(Actions.setSharpen(!on)); },
        },
        [on ? "✓ 已開啟補銳化" : "補銳化（關閉中）"]
      )
    );
    node.appendChild(row);
    node.appendChild(
      note(
        on
          ? "同時作用在 icon 與文字上，預覽與匯出一致。PS 的文字會把筆畫吸附到像素格線，" +
            "瀏覽器畫的不會，這個開關就是補這一段。若邊緣出現白色光暈就關掉。"
          : "關閉後文字與 icon 會比 PS 做的軟一點——瀏覽器畫文字沒有 hinting，" +
            "而 icon 框只有 107×58。建議維持開啟。"
      )
    );
    return node;
  }

  /* ---------------- 模板顆數 ---------------- */

  function buildSlotCountSection(banner, store, Actions) {
    var node = section("模板顆數");
    var row = el("div", { class: "btn-row" });
    [2, 3, 4, 5].forEach(function (n) {
      var btn = el(
        "button",
        { onClick: function () { store.dispatch(Actions.setSlotCount(n)); } },
        [String(n) + " 顆"]
      );
      if (banner.slots.length === n) btn.classList.add("primary");
      row.appendChild(btn);
    });
    node.appendChild(row);
    return node;
  }

  /* ---------------- 單顆的上傳流程 ---------------- */

  /*
   * 上傳後的就地確認表單。
   *
   * 型別（icon / LOGO）不用下拉選單，直接做成兩顆會送出的按鈕：選型別和確認本來就是
   * 同一個決定，拆成「先選再按確認」多一步而且看不出差別。按鈕底色刻意等於該型別實際
   * 會渲染出來的顏色（icon = 品牌橘、LOGO = 規範灰 #848484），顏色本身就是說明。
   */
  function buildInlineUploadForm(state, store, Actions, ui, rerender, index) {
    var pending = ui.pendingUpload;
    var form = el("div", { class: "inline-upload" });
    form.appendChild(el("div", { class: "inline-upload-title" }, ["新上傳的圖，請選擇型別："]));

    var nameInput = el("input", { type: "text", placeholder: "顯示名稱" });
    nameInput.value = pending.displayName;
    nameInput.addEventListener("input", function (e) { pending.displayName = e.target.value; });
    form.appendChild(nameInput);

    /*
     * currentColor 提示改成無條件顯示。
     * 舊版只在型別 === icon 時才出現，靠下拉的 change 事件重繪觸發；現在點按鈕就直接送出，
     * 使用者根本沒有「選完型別、看到提示、再確認」的中間狀態，只能事前講。
     */
    if (pending.svg && pending.svg.indexOf("currentColor") < 0) {
      form.appendChild(note("這個 SVG 沒有用 currentColor，選「一般 icon」時換色會改用整片染色處理。"));
    }

    function commit(type) {
      var icon = {
        id: makeIconId(),
        // 讀當下的 DOM 值而不是 pending.displayName：中文輸入法還在組字時，
        // input 事件同步過來的字串可能是半成品。
        displayName: nameInput.value.trim() || "未命名",
        type: type,
        custom: true,
      };
      if (pending.svg) icon.svg = pending.svg;
      if (pending.src) icon.src = pending.src;

      // 加進素材庫＋套用到這一顆是同一件事，合併成一步 undo（與圖片編輯流程一致）
      store.beginBatch();
      store.dispatch(Actions.addLibraryIcon(icon));
      store.dispatch(Actions.setSlotIcon(index, icon.id));
      store.endBatch();

      ui.pendingUpload = null;
      // 上傳的圖只活在這次工作階段，重新整理就沒了。講明白，不要讓人以為它進了素材庫。
      ui.uploadMessage =
        "「" + icon.displayName + "」已套用。上傳的圖只留在這次編輯，重新整理就會消失" +
        "（匯出的進度存檔仍然含這張圖）。要永久收進素材庫，請把檔案放進 img/ 後重跑 " +
        "tools/build-icon-manifest.js。";
      rerender();
    }

    var typeRow = el("div", { class: "type-row" });
    typeRow.appendChild(
      el(
        "button",
        {
          class: "type-btn type-icon",
          title: "一般 icon：反白時自動套用橘/紅，未選中時轉灰 #848484。加入素材庫並立刻套用到第 " + (index + 1) + " 顆。",
          onClick: function () { commit("icon"); },
        },
        ["加為一般 icon"]
      )
    );
    typeRow.appendChild(
      el(
        "button",
        {
          class: "type-btn type-logo",
          title: "廠商 LOGO：永遠不套橘/紅，反白時保持原色、未選中時轉灰。加入素材庫並立刻套用到第 " + (index + 1) + " 顆。",
          onClick: function () { commit("logo"); },
        },
        ["加為廠商 LOGO"]
      )
    );
    form.appendChild(typeRow);

    var cancelRow = el("div", { class: "cancel-row" });
    cancelRow.appendChild(
      el(
        "button",
        {
          class: "mini",
          title: "丟棄這張圖，不加入素材庫",
          onClick: function () {
            ui.pendingUpload = null;
            rerender();
          },
        },
        ["取消"]
      )
    );
    form.appendChild(cancelRow);

    return form;
  }


  /*
   * 圖片的來源可以是面板「上傳」按鈕，也可以是畫布上的「未選圖」框拖入。
   * 兩條路徑共用這個入口，才不會一邊有去白邊／型別確認、另一邊漏掉。
   */
  function stageImageUpload(file, index, ui, rerender, fromDrop) {
    if (!file || !(/\.(svg|png|jpe?g)$/i.test(file.name || "") || /^image\//.test(file.type || ""))) {
      ui.uploadMessage = "請拖入 SVG、PNG 或 JPG 圖片。";
      rerender();
      return;
    }

    var baseName = (file.name || "未命名").replace(/\.[^.]+$/, "");
    var isSvg = /\.svg$/i.test(file.name || "") || file.type === "image/svg+xml";
    var reader = new FileReader();

    reader.onload = function (ev) {
      var originalSrc = ev.target.result;
      function stage(src) {
        ui.pendingUpload = {
          slotIndex: index,
          displayName: baseName,
          svg: isSvg ? originalSrc : null,
          src: isSvg ? null : src,
        };
        ui.uploadMessage = fromDrop
          ? "已放入第 " + (index + 1) + " 格，請選擇要作為一般 icon 或廠商 LOGO。"
          : "";
        rerender();
      }

      /* 點陣圖先裁掉外圍透明／白邊；彩色底圖由裁切器判定為非白底，會完整保留。 */
      if (!isSvg && window.ImageEditor && typeof window.ImageEditor.trimWhiteBorder === "function") {
        window.ImageEditor.trimWhiteBorder(originalSrc)
          .then(function (result) { stage(result && result.src ? result.src : originalSrc); })
          .catch(function () { stage(originalSrc); });
      } else {
        stage(originalSrc);
      }
    };
    reader.onerror = function () {
      ui.uploadMessage = "讀取檔案失敗。";
      rerender();
    };

    if (isSvg) reader.readAsText(file);
    else reader.readAsDataURL(file);
  }
  /* ---------------- 每一顆的內容卡 ---------------- */

  function buildSlotCard(state, banner, store, Actions, ui, rerender, slot, index) {
    var isActive = index === banner.activeSlotIndex;
    var card = el("div", { class: "slot-card" + (isActive ? " active" : "") });

    var head = el("div", { class: "slot-head" });
    head.appendChild(
      el(
        "button",
        {
          class: isActive ? "primary" : "",
          onClick: function () { store.dispatch(Actions.setActiveSlot(index)); },
        },
        [isActive ? "● 反白中" : "○ 設為反白"]
      )
    );
    head.appendChild(el("span", { class: "slot-no" }, ["#" + (index + 1)]));
    card.appendChild(head);

    var iconRow = el("div", { class: "icon-row" });

    /*
     * icon 區有兩種模式，互斥：
     *  - 文字模式（9.9 / 10.10 這類檔期數字）：直接給輸入框，打字即時反映到畫布
     *  - 圖片模式：圖像化素材選單 + 上傳 + 編輯
     * 切換靠「T 文字」與「× 改回選圖」兩顆按鈕。
     *
     * 判斷用 != null 而不是看字串是否為空：空字串仍然算文字模式，
     * 否則使用者把 9.9 刪掉準備改打 10.10 時，輸入框會在游標底下消失。
     */
    if (slot.iconText != null) {
      var dateInput = el("input", {
        type: "text",
        class: "date-input",
        placeholder: "例如 9.9",
        title: "會以 ShopeeNotoSans Bold 畫在 icon 的位置",
      });
      dateInput.setAttribute("data-icon-text-index", String(index));
      dateInput.value = slot.iconText;

      applyDateFit(dateInput, slot.iconText);

      // 和下方文字框同一套 IME 保護：組字中不要讓全域 Ctrl+Z 攔截
      dateInput.addEventListener("compositionstart", function () { ui.composing = true; });
      dateInput.addEventListener("compositionend", function (e) {
        ui.composing = false;
        store.dispatch(Actions.setSlotIconText(index, e.target.value));
      });
      dateInput.addEventListener("input", function (e) {
        if (ui.composing) return;
        store.dispatch(Actions.setSlotIconText(index, e.target.value));
      });
      iconRow.appendChild(dateInput);

      iconRow.appendChild(
        el(
          "button",
          {
            class: "mini upload-btn",
            title: "清掉文字，改回用圖片",
            onClick: function () { store.dispatch(Actions.setSlotIconText(index, null)); },
          },
          ["× 改回選圖"]
        )
      );
      card.appendChild(iconRow);
    } else {
      iconRow.appendChild(
        window.IconPicker.buildTrigger(state.library, slot.iconId, function (iconId) {
          store.dispatch(Actions.setSlotIcon(index, iconId || null));
        })
      );

    var hiddenFile = el("input", {
      type: "file",
      accept: ".svg,.png,.jpg,.jpeg",
      style: "display:none;",
    });
    hiddenFile.addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      stageImageUpload(file, index, ui, rerender, false);
      hiddenFile.value = "";
    });
    iconRow.appendChild(hiddenFile);

      iconRow.appendChild(
        el(
          "button",
          {
            class: "mini upload-btn",
            title: "上傳圖片並套用到第 " + (index + 1) + " 顆",
            onClick: function () { hiddenFile.click(); },
          },
          ["⬆ 上傳"]
        )
      );

      // 改用文字（9.9 / 10.10 這類檔期數字）取代圖
      iconRow.appendChild(
        el(
          "button",
          {
            class: "mini upload-btn",
            title: "改用文字取代圖，例如 9.9、10.10（ShopeeNotoSans Bold）",
            onClick: function () {
              store.dispatch(Actions.setSlotIconText(index, "9.9"));
              // dispatch 會同步重繪出輸入框，直接聚焦並全選，按完就能改字
              var box = document.querySelector('input[data-icon-text-index="' + index + '"]');
              if (box) { box.focus(); box.select(); }
            },
          },
          ["T 文字"]
        )
      );

      if (slot.iconId) {
        iconRow.appendChild(
          el(
            "button",
            {
              class: "mini upload-btn",
              title: "裁切 / 外擴透明邊 / 去白底",
              onClick: function () { openEditorFor(store, Actions, ui, rerender, index); },
            },
            ["✏ 編輯"]
          )
        );
      }
      card.appendChild(iconRow);
    }

    /*
     * 只套這一格到其他分頁。上面那顆「整組套用」之後，通常還要單獨改掉不一樣的那顆，
     * 改完再用這顆推出去比重按一次整組套用安全——整組會把已經手動改過的其他格也蓋掉。
     * 一樣只有兩條以上才出現。
     */
    if (state.banners.length > 1) {
      var copyRow = el("div", { class: "copy-row" });
      copyRow.appendChild(
        el(
          "button",
          {
            class: "mini",
            title:
              "把第 " + (index + 1) + " 格的 icon 複製到其他 " + (state.banners.length - 1) +
              " 條分頁的第 " + (index + 1) + " 格。文案不會被動到。",
            onClick: function () {
              store.dispatch(Actions.copySlotIconToAll(index));
              ui.applyMessage =
                "已把第 " + (index + 1) + " 格的 icon 套用到其他 " +
                (state.banners.length - 1) + " 條分頁的同一格。";
              rerender();
            },
          },
          ["⧉ 這格套到其他分頁"]
        )
      );
      card.appendChild(copyRow);
    }

    // 這一顆正在等待確認的上傳
    if (ui.pendingUpload && ui.pendingUpload.slotIndex === index) {
      card.appendChild(buildInlineUploadForm(state, store, Actions, ui, rerender, index));
    }

    // 文字 + 字數
    var textRow = el("div", { class: "text-row" });
    var input = el("input", { type: "text", placeholder: "文字（上限 5 字）" });
    input.setAttribute("data-slot-index", String(index));
    input.value = slot.text;

    /*
     * 中文輸入法（注音/倉頡等）修正：
     * 組字期間（compositionstart ~ compositionend）完全不 dispatch，
     * 否則每按一個鍵就會更新 state，配合面板重繪會把輸入框整個換掉，
     * 導致 IME 組字被打斷、注音符號卡在欄位裡選不了字。
     */
    input.addEventListener("compositionstart", function () {
      ui.composing = true;
    });
    input.addEventListener("compositionend", function (e) {
      ui.composing = false;
      store.dispatch(Actions.setSlotText(index, e.target.value));
    });
    input.addEventListener("input", function (e) {
      if (ui.composing) return; // 組字中的注音符號不進 state
      store.dispatch(Actions.setSlotText(index, e.target.value));
    });
    textRow.appendChild(input);

    var used = TextLimit.countUnits(slot.text);
    if (used > TextLimit.MAX_UNITS) input.classList.add("over-limit");

    var counter = el(
      "span",
      { class: counterClass(used) },
      [TextLimit.format(used) + "/" + TextLimit.MAX_UNITS]
    );
    counter.setAttribute("data-counter-index", String(index));
    textRow.appendChild(counter);
    card.appendChild(textRow);

    // 位置與顏色一律由模板與配色規則決定，不提供手動微調（拖曳與改色都已移除）
    return card;
  }

  /*
   * 「整組 icon 套到其他分頁」。
   *
   * 多條吸底圖之間常常只差一顆 icon，其餘完全相同——但每一條的文案是工單匯入的、
   * 各自不同。所以真正需要的是「只同步 icon、不動文案」：
   * 在這一條把圖選好（廠商 LOGO 只要上傳一次），一鍵推到其他頁，再手動改掉不同的那顆。
   *
   * 只有兩條以上才出現。單條時這顆按鈕沒有任何作用，留著只會讓人以為自己漏了什麼。
   */
  function buildApplyIconsSection(state, banner, store, Actions, ui, rerender) {
    if (state.banners.length < 2) return null;

    var others = state.banners.length - 1;
    // 對方比較少格就只套得到的部分——先算出來寫進按鈕的說明，不要等按下去才發現少套
    var covered = 0;
    var shortfall = 0;
    state.banners.forEach(function (b, i) {
      if (i === state.activeBannerIndex) return;
      var n = Math.min(b.slots.length, banner.slots.length);
      covered += n;
      shortfall += Math.max(0, banner.slots.length - b.slots.length);
    });

    var node = section("套用到其他分頁");
    node.appendChild(
      el(
        "button",
        {
          class: "block",
          title: "把這一條每一格的 icon（或檔期文字）複製到其他 " + others + " 條的同一格。文案不會被動到。",
          onClick: function () {
            store.dispatch(Actions.copyIconsToAll());
            ui.applyMessage =
              "已把這條的 icon 套用到其他 " + others + " 條分頁（共 " + covered + " 格）。" +
              (shortfall ? "其中 " + shortfall + " 格因為對方顆數較少而沒有套到。" : "") +
              "文案沒有被動到，按錯可用 Ctrl+Z 退回。";
            rerender();
          },
        },
        ["⧉ 把這條的 icon 全部套到其他 " + others + " 條"]
      )
    );
    node.appendChild(
      note(
        "只搬 icon 與檔期文字，下方的文案完全不動（那是工單匯入的內容）。" +
          "來源是空的那一格會把對方也清空——語意是「讓其他頁跟這頁一樣」。"
      )
    );
    if (ui.applyMessage) node.appendChild(note(ui.applyMessage));
    return node;
  }

  function buildSlotsSection(state, banner, store, Actions, ui, rerender) {
    var node = section("每顆內容（點「設為反白」決定這張圖反白哪一顆）");
    banner.slots.forEach(function (slot, index) {
      node.appendChild(buildSlotCard(state, banner, store, Actions, ui, rerender, slot, index));
    });
    if (ui.uploadMessage) node.appendChild(note(ui.uploadMessage));
    return node;
  }

  /* ---------------- 批次匯出（釘在面板底部） ---------------- */

  function buildExportSection(state, banner, store, ui, rerender) {
    var node = el("div", { class: "panel-section export-section" });

    /* 工單生成器的「吸底」頁簽不另開一套「匯出變體」流程；
       一律回到主工具的下載全部，才會與副區、MSBN、工單試算表一起輸出。 */
    var isGeneratorEmbed = new URLSearchParams(window.location.search).get("embed") === "generator";
    if (isGeneratorEmbed) {
      var parentExportBtn = el("button", { class: "primary block" }, ["⬇ 下載全部"]);
      parentExportBtn.addEventListener("click", function () {
        if (window.BottomParentBridge && window.BottomParentBridge.requestGeneratorDownloadAll) {
          window.BottomParentBridge.requestGeneratorDownloadAll();
        }
      });
      node.appendChild(parentExportBtn);
      return node;
    }

    var n = banner.slots.length;
    var bannerCount = state.banners.length;

    // 超字不擋匯出，但一定要講——捲到底部時上面的紅框已經看不到了
    var over = TextLimit.overSlots(banner.slots);
    var warn = el("div", { class: "over-warning" }, [
      over.length
        ? "⚠ 第 " + over.join("、") + " 格超過 " + TextLimit.MAX_UNITS + " 字，仍會照原樣匯出"
        : "",
    ]);
    warn.setAttribute("data-over-warning", "1");
    warn.hidden = !over.length;
    node.appendChild(warn);

    // 只匯目前這一條——日常是編一條匯一條，不該不小心吐出一堆圖
    var btn = el("button", { class: "primary block" }, [
      "匯出「" + window.Selectors.bannerLabel(state.activeBannerIndex) + "」的 " + n + " 張變體圖",
    ]);
    btn.addEventListener("click", function () {
      btn.setAttribute("disabled", "disabled");
      ui.exportStatus = "匯出中…";
      rerender();
      window.ExportBatch.exportAll(store)
        .then(function (results) {
          return window.ExportBatch.downloadAsZip(
            results,
            window.Selectors.bannerLabel(state.activeBannerIndex),
            store
          );
        })
        .then(function () {
          ui.exportStatus = "已下載 " + n + " 張 PNG（zip，內含進度存檔）。";
          rerender();
        })
        .catch(function (err) {
          ui.exportStatus = "匯出失敗：" + err.message;
          rerender();
        });
    });
    node.appendChild(btn);

    if (bannerCount > 1) {
      var total = state.banners.reduce(function (sum, b) { return sum + b.slots.length; }, 0);
      var allBtn = el("button", { class: "block", style: "margin-top:6px;" }, [
        "匯出全部 " + bannerCount + " 條（共 " + total + " 張，依分頁分資料夾）",
      ]);
      allBtn.addEventListener("click", function () {
        allBtn.setAttribute("disabled", "disabled");
        ui.exportStatus = "匯出全部分頁中…";
        rerender();
        window.ExportBatch.exportAllBanners(store)
          .then(function (groups) {
            return window.ExportBatch.downloadAllBannersAsZip(groups, "吸底圖", store);
          })
          .then(function () {
            ui.exportStatus = "已下載 " + bannerCount + " 條、共 " + total + " 張 PNG（zip）。";
            rerender();
          })
          .catch(function (err) {
            ui.exportStatus = "匯出失敗：" + err.message;
            rerender();
          });
      });
      node.appendChild(allBtn);
    }

    if (ui.exportStatus) node.appendChild(note(ui.exportStatus));
    return node;
  }

  /* ---------------- 掛載 ---------------- */

  function mount(container, store, Actions) {
    // 純 UI 狀態（不屬於圖的內容），放在 closure 裡
    var ui = {
      importMessage: "",
      importDetail: [],
      uploadMessage: "",
      exportStatus: "",
      applyMessage: "",
      pendingUpload: null,
      composing: false,
    };

    var tabbar = document.getElementById("tabbar");

    container.innerHTML = "";
    var scrollArea = el("div", { id: "panel-scroll" });
    var footer = el("div", { id: "panel-footer" });
    container.appendChild(scrollArea);
    container.appendChild(footer);

    function renderAll() {
      var state = store.getState();

      // 重繪前記住聚焦的輸入框與游標位置，重繪後復原
      var focusInfo = null;
      var activeEl = document.activeElement;
      if (activeEl && activeEl.tagName === "INPUT" && scrollArea.contains(activeEl)) {
        focusInfo = {
          slotIndex: activeEl.getAttribute("data-slot-index"),
          selectionStart: activeEl.selectionStart,
          selectionEnd: activeEl.selectionEnd,
        };
      }

      var banner = window.Selectors.activeBanner(state);

      /*
       * 素材選單是 fixed 定位掛在 body 上、位置對齊某一顆按鈕算出來的。
       * 重繪會把那顆按鈕整個換掉，留著選單就會浮在原地指向已經不存在的東西。
       */
      window.IconPicker.close();

      buildBannerTabs(state, store, Actions, tabbar);

      scrollArea.innerHTML = "";
      var isGeneratorEmbed = window.BottomParentBridge &&
        window.BottomParentBridge.isEmbedded &&
        window.BottomParentBridge.isEmbedded() &&
        new URLSearchParams(location.search).get("embed") === "generator";
      if (!isGeneratorEmbed) {
        scrollArea.appendChild(buildImportSection(store, Actions, ui, renderAll));
      }
      scrollArea.appendChild(buildAccentColorSection(banner, store, Actions));
      scrollArea.appendChild(buildSlotCountSection(banner, store, Actions));
      scrollArea.appendChild(buildSharpenSection(state, store, Actions));
      scrollArea.appendChild(buildSlotsSection(state, banner, store, Actions, ui, renderAll));
      /*
       * 「整組套用」排在最後一格下面，不排在所有格子上面。
       * 它的前提是「這一條已經全部選好了」，放在上面等於在還沒選圖時就先問要不要套用，
       * 而且使用者選完最後一格時視線已經在面板底部，往上找按鈕是多的一步。
       */
      var applySection = buildApplyIconsSection(state, banner, store, Actions, ui, renderAll);
      if (applySection) scrollArea.appendChild(applySection);

      footer.innerHTML = "";
      footer.appendChild(buildExportSection(state, banner, store, ui, renderAll));

      if (focusInfo && focusInfo.slotIndex != null) {
        var toFocus = scrollArea.querySelector(
          'input[data-slot-index="' + focusInfo.slotIndex + '"]'
        );
        if (toFocus) {
          toFocus.focus();
          try {
            toFocus.setSelectionRange(focusInfo.selectionStart, focusInfo.selectionEnd);
          } catch (e) {
            /* 部分 input type 不支援 setSelectionRange，忽略 */
          }
        }
      }
    }

    /*
     * 打字時只更新字數計數器，不重建任何 DOM——輸入框節點必須存活，
     * 否則中文輸入法的組字會被打斷（這是先前注音無法輸入的根因）。
     */
    function syncHistoryButtons() {
      var u = tabbar.querySelector('[data-history="undo"]');
      var r = tabbar.querySelector('[data-history="redo"]');
      if (u) u.disabled = !store.canUndo();
      if (r) r.disabled = !store.canRedo();
    }

    /*
     * 打字時只碰計數器、復原鈕與分頁摘要這幾個節點，絕不重建輸入框——
     * 輸入框一旦被換掉，中文輸入法的組字就會被打斷。
     */
    function syncTextRow(state, index) {
      syncHistoryButtons(); // 打字第一個字之後「復原」就該亮起來

      // 第一格的文案會出現在分頁上，跟著更新（分頁跟輸入框是不同節點，不影響組字）
      if (index === 0) {
        var activeTab = tabbar.querySelector(".banner-tab.active .banner-tab-meta");
        if (activeTab) {
          activeTab.textContent = window.Selectors.bannerMeta(
            window.Selectors.activeBanner(state)
          );
        }
      }

      var slot = window.Selectors.activeBanner(state).slots[index];
      if (!slot) return;

      var input = scrollArea.querySelector('input[data-slot-index="' + index + '"]');
      // 只有在超過字數被截斷、與畫面不一致時才回寫，避免干擾正常輸入
      if (input && input.value !== slot.text) input.value = slot.text;

      var used = TextLimit.countUnits(slot.text);

      // 紅框要即時跟著打字變化（這裡只切 class，不重建節點，才不會打斷 IME 組字）
      if (input) input.classList.toggle("over-limit", used > TextLimit.MAX_UNITS);

      var counter = scrollArea.querySelector('[data-counter-index="' + index + '"]');
      if (counter) {
        counter.textContent = TextLimit.format(used) + "/" + TextLimit.MAX_UNITS;
        counter.className = counterClass(used);
      }

      syncOverLimitWarning(state);
    }

    /*
     * 檔期文字那一列：同樣只回寫值與紅框，不重建節點（IME 保護）。
     * 值也要回寫，因為 undo/redo 與載入存檔都會改到 iconText 而不經過輸入框。
     */
    function syncDateRow(state, index) {
      var slot = window.Selectors.activeBanner(state).slots[index];
      if (!slot) return;
      var box = scrollArea.querySelector('input[data-icon-text-index="' + index + '"]');
      if (!box) return;
      if (box.value !== slot.iconText) box.value = slot.iconText == null ? "" : slot.iconText;
      applyDateFit(box, slot.iconText);
    }

    // 匯出區的超字提醒。捲到底部要按匯出時，上面的紅框已經看不到了
    function syncOverLimitWarning(state) {
      var warn = footer.querySelector("[data-over-warning]");
      if (!warn) return;
      var over = TextLimit.overSlots(window.Selectors.activeBanner(state).slots);
      warn.textContent = over.length
        ? "⚠ 第 " + over.join("、") + " 格超過 " + TextLimit.MAX_UNITS + " 字，仍會照原樣匯出"
        : "";
      warn.hidden = !over.length;
    }

    store.subscribe(function (state, action) {
      if (action && action.type === Actions.types.SET_SLOT_TEXT) {
        syncTextRow(state, action.index);
        return;
      }

      /*
       * 檔期文字（9.9 / 10.10）打字時同樣不能重建 DOM，否則中文輸入法組字會被打斷、
       * 游標也會跑掉。畫布是另一個 subscriber，會自己更新，這裡什麼都不用做。
       * 但「文字模式 ↔ 圖片模式」的切換（輸入框 ↔ 素材選單）那一列必須重建。
       * 模式看 text 是不是 null，不是看空不空——空字串仍然是文字模式。
       */
      if (action && action.type === Actions.types.SET_SLOT_ICON_TEXT) {
        var box = scrollArea.querySelector('input[data-icon-text-index="' + action.index + '"]');
        if (!!box === (action.text != null)) {
          syncDateRow(state, action.index);
          return;
        }
      }

      renderAll();
    });

    /*
     * 全域 Ctrl+Z / Ctrl+Y。
     *
     * 這裡刻意攔截並 preventDefault，連游標在文字框裡也一樣走我們的 undo：
     * 輸入框的原生 undo 只會還原 input.value，state 不會跟著回去，兩邊就對不上了。
     * store 那邊已經把同一欄的連續打字合併成一步，所以體感跟一般編輯器一致。
     *
     * 兩個必要的例外：
     *  1. 注音/倉頡組字中（ui.composing）不能攔，Ctrl 組合鍵是輸入法自己的。
     *  2. 圖片編輯器開著時交給它自己的 undo，兩層歷史不能打架。
     */
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (ui.composing) return;
      if (window.ImageEditor && window.ImageEditor.isOpen()) return;

      var k = e.key ? e.key.toLowerCase() : "";
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        store.redo();
      }
    });

    renderAll();

    /*
     * 開場對話框要能匯入工單／載入存檔，但那兩件事的後續（更新訊息、展開核對清單、
     * 併成一步 undo）全都綁在這裡的 ui 與 renderAll 上。與其把它們複製一份出去，
     * 不如把入口交出去——對話框只負責選檔與顯示錯誤，做事的仍然是面板自己。
     */
    return {
      importWorkOrder: function (file, onDone) {
        importWorkOrderFile(store, Actions, ui, renderAll, file, onDone);
      },
      loadProject: function (file, onDone) {
        loadProjectFile(store, Actions, ui, renderAll, file, onDone);
      },
      stageImageUpload: function (file, index) {
        stageImageUpload(file, index, ui, renderAll, true);
      },
    };
  }

  window.PanelUI = { mount: mount };
})();
