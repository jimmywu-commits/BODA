(function () {
  var ColorTheme = window.ColorTheme;
  var IconImageCache = window.IconImageCache;
  var LayoutEngine = window.LayoutEngine;
  var renderGeneration = 0;

  /*
   * 空欄位在畫面上顯示的預覽假字。
   *
   * 「文字5字內」依規則剛好是 4.5 字（中文 4 + 數字 0.5），正好示範上限寬度不會超框。
   *
   * 【鐵律】假字只在畫面預覽出現，匯出時一定不能畫。
   * 匯出走的是同一個 render()，靠 isPreview 參數區分：畫面上的 stage 傳 true，
   * exportBatch 的離屏 stage 不傳（undefined → falsy），所以匯出的 PNG 永遠只有真實輸入的文字。
   */
  var PREVIEW_TEXT = "文字5字內";
  var PREVIEW_ICON_TEXT = "未選圖";
  var PREVIEW_OPACITY = 0.3;

  /*
   * 「輸出倍率」：一個場景單位最後會落在幾個實際輸出像素上。
   *
   * icon 的來源圖會先被降取樣到 box 尺寸 x 這個倍率（見 IconImageCache.getScaled），
   * 套濾鏡時的 node.cache({pixelRatio}) 也用同一個值。三者對齊之後，
   * 從來源圖到最終像素只有「我們自己那一次高品質降取樣」，Konva 一路都是 1:1。
   *
   * 匯出走的是 stage.toDataURL({pixelRatio: 1})，1200x150 就是最終像素，所以固定 1。
   * 之前這裡是 max(1, zoom) * dpr * 3（超取樣 3 倍再讓瀏覽器縮回去），
   * 對匯出反而有害：cache 3 倍再被 drawImage 一步縮回 1 倍，多吃一次低品質重新取樣。
   *
   * 預覽的倍率量化成 2 的次方，否則滾輪每動一格都會產生一份新尺寸的降取樣點陣圖。
   * 量化後一定 >= 實際顯示倍率，Konva 只會小幅縮小（<= 2 倍），雙線性夠用。
   */
  var RATIO_MAX = 8;
  var FILTERED_NAME = "filtered-icon";

  function outputRatio(layer, isPreview) {
    var dpr = window.devicePixelRatio || 1;
    if (!isPreview) return 1;
    var stage = layer.getStage ? layer.getStage() : null;
    var zoom = Math.max(1, stage ? Math.abs(stage.scaleX() || 1) : 1);
    return Math.min(RATIO_MAX, Math.pow(2, Math.ceil(Math.log(zoom) / Math.LN2)) * dpr);
  }

  function findLibraryIcon(library, iconId) {
    for (var i = 0; i < library.length; i++) {
      if (library[i].id === iconId) return library[i];
    }
    return null;
  }

  /*
   * 畫布範圍指示框。
   *
   * 可縮放之後 stage 不再等於 1200x150（它現在是整個檢視區），所以原本靠
   * #konva-container 的 CSS box-shadow 標出畫布邊界的做法失效了——那條線會框住整個檢視區。
   * 改成畫進場景裡，才會跟著縮放與平移一起動。
   *
   * 上方 20px 是透明區，底色與工作區同為 #848484，沒有這條線就看不出圖的實際範圍。
   * 只在預覽畫，匯出的 PNG 絕對不能有這條線。
   */
  function drawArtboard(layer) {
    var L = window.LAYOUT;
    layer.add(
      new Konva.Rect({
        x: 0,
        y: 0,
        width: L.canvasWidth,
        height: L.canvasHeight,
        fill: "#848484",
        stroke: "rgba(0,0,0,.45)",
        strokeWidth: 1,
        // 邊框粗細不隨縮放變化，放大到 800% 時才不會變成一條粗黑帶
        strokeScaleEnabled: false,
        listening: false,
      })
    );
  }

  function drawWhiteBlock(layer) {
    var L = window.LAYOUT;
    layer.add(
      new Konva.Rect({
        x: 0,
        y: LayoutEngine.whiteTop(),
        width: L.canvasWidth,
        height: L.whiteBlockHeight,
        fill: "#ffffff",
      })
    );
  }

  /*
   * 沒選 icon 時的虛線提示框。這整塊（含框線）都只在畫面預覽出現——
   * 匯出時若把虛線框畫進 PNG，交出去的就是一張帶著空框的廢圖。
   */
  function drawPlaceholderIcon(group, slotLayout, isActive, color, isPreview) {
    var L = window.LAYOUT;
    if (!isPreview) return;

    group.add(
      new Konva.Rect({
        x: slotLayout.iconX,
        y: slotLayout.iconY,
        width: slotLayout.iconBoxWidth,
        height: slotLayout.iconBoxHeight,
        fill: isActive ? color + "22" : "#eeeeee",
        stroke: isActive ? color : "#cccccc",
        strokeWidth: 1,
        dash: [4, 3],
        cornerRadius: 4,
      })
    );

    group.add(
      new Konva.Text({
        x: slotLayout.iconX,
        y: slotLayout.iconY,
        width: slotLayout.iconBoxWidth,
        height: slotLayout.iconBoxHeight,
        align: "center",
        verticalAlign: "middle",
        text: PREVIEW_ICON_TEXT,
        fontSize: 13,
        fontFamily: L.fontFamily,
        fill: isActive ? color : "#8f8f8f",
        opacity: 0.6,
        listening: false,
      })
    );
  }

  /*
   * 等比例縮放塞進 107x58 的框內（contain，不拉伸變形），再於框內置中。
   *
   * 尺寸與座標一律取整數：置中算出來的是 centerX - w/2 這種小數，落在半個像素上
   * 就一定會被重新取樣一次（不管有沒有濾鏡）。匯出的輸出倍率是 1，所以取整之後
   * 場景座標就等於 PNG 的像素座標，整條路徑變成像素對齊。
   * 取整會讓長寬比最多變 0.5px（107 上是 0.5%），肉眼看不出來，換到像素對齊很划算。
   */
  function fitIntoBox(naturalWidth, naturalHeight, slotLayout) {
    var natW = naturalWidth || 1;
    var natH = naturalHeight || 1;
    var scale = Math.min(slotLayout.iconBoxWidth / natW, slotLayout.iconBoxHeight / natH);
    var w = Math.max(1, Math.round(natW * scale));
    var h = Math.max(1, Math.round(natH * scale));
    return {
      x: Math.round(slotLayout.centerX - w / 2),
      y: Math.round(slotLayout.iconY + (slotLayout.iconBoxHeight - h) / 2),
      width: w,
      height: h,
    };
  }

  /*
   * 用文字代替 icon（9.9 / 10.10 這類檔期數字），畫在 icon 框的位置。
   *
   * 刻意做成即時的 Konva 文字，而不是先噴成 PNG 再當素材用：
   *  - 文字節點用 fill 上色，不需要 cache()、不需要濾鏡，是整個渲染器裡最銳利的一條路徑。
   *    噴成點陣圖就得走 cache + 單色覆蓋，白白吃掉一次重新取樣，而文字全是細筆畫最吃虧。
   *  - 9.9 → 10.10 → 11.11 是同一張圖一年做好幾次，改字比重做一張圖便宜太多。
   *  - 存檔只存幾個字，不是一段 base64。
   *
   * 字級固定（LAYOUT.dateFontSize），只有寬度或高度真的塞不下才等比縮小——
   * 理由見 templates.js 的註解。
   */
  /*
   * 文字的補銳化。
   *
   * canvas 的 fillText 是「無 hinting 的灰階 AA」：字形輪廓覆蓋到多少就給多少灰。
   * Photoshop 的文字消除鋸齒（銳利／明晰）會把筆畫吸附到像素格線上，
   * 所以同樣 22px 的中文，PS 出來的橫筆是乾淨的 1px，canvas 是跨兩列的 1.4px 灰帶。
   * 這是兩個光柵化器的差異，canvas 沒有任何 API 可以要求 hinting。
   *
   * 唯一能補的就是銳化：把半覆蓋的像素往「全墨」或「全底」推，
   * 效果接近 PS 的銳利 AA。文字的形狀完全存在 alpha 通道裡，
   * 而 createSharpenFilter 本來就會銳化 alpha（見 colorTheme.js），所以直接套得上。
   *
   * 走和 icon 同一條 cache + filter 的路，預覽與匯出自動一致，縮放也自動跟著 outputRatio。
   */
  function applyTextSharpen(node, layer, isPreview, sharpen) {
    if (!sharpen) return;
    var ratio = outputRatio(layer, isPreview);
    node.name(FILTERED_NAME);
    node.cache({ pixelRatio: ratio });
    node.filters([ColorTheme.createSharpenFilter(null, ratio)]);
  }

  function drawTextIcon(group, slotLayout, text, color, layer, isPreview, sharpen) {
    var L = window.LAYOUT;

    // 字級用和面板同一支 LayoutEngine.measureDateText()，兩邊算出來一定一致：
    // 面板靠它決定要不要亮紅框警告，畫布靠它決定畫多大，不能各算各的
    var fit = LayoutEngine.measureDateText(text);

    var node = new Konva.Text({
      text: text,
      fontSize: fit.fontSize,
      fontStyle: L.dateFontWeight,
      fontFamily: L.fontFamily,
      fill: color,
    });

    /*
     * 和 drawSlot 的說明文字一樣，不設 width 手動置中——設了會換行或靜默截字。
     *
     * 座標取整：字寬是量出來的小數（"10.10" 量到 104.44），置中後 x 會落在半個像素上，
     * 字形就被畫在像素之間、邊緣多一層灰。實測 "10.10" 的中間調像素比例
     * 0.272 → 0.255（-6.3%）。中文字寬是 22 的整數倍所以本來就對齊，
     * 這一段只對數字與英文有差，但代價是零。
     */
    node.x(Math.round(slotLayout.centerX - node.width() / 2));
    node.y(Math.round(slotLayout.iconY + (slotLayout.iconBoxHeight - node.height()) / 2));
    group.add(node);
    applyTextSharpen(node, layer, isPreview, sharpen);
  }

  function drawLibraryIcon(group, slotLayout, libraryIcon, color, isActive, layer, generation, isPreview, sharpen) {
    var dataUri = ColorTheme.getIconSourceUri(libraryIcon, color);

    IconImageCache.loadImage(dataUri, function (img) {
      // 圖片是非同步載入，載完時使用者可能已經切到別的模板/顆數，原本的 group 早就被銷毀。
      // （Konva 9 的 Node 沒有 isDestroyed()，只能靠自己的世代計數器判斷。）
      if (generation !== renderGeneration) return;

      // 圖檔載不進來（例如 SVG 少了 xmlns）。畫面上退回虛線框，讓人看得出這一格有問題；
      // 匯出那條路徑會在 exportBatch 直接擋下來，不會交出缺圖的成品。
      if (!img) {
        drawPlaceholderIcon(group, slotLayout, isActive, color, isPreview);
        layer.draw();
        return;
      }

      var box = fitIntoBox(img.naturalWidth || img.width, img.naturalHeight || img.height, slotLayout);

      /*
       * 關鍵一步：先自己把來源圖降到最終要用的像素數，再交給 Konva。
       * 交大圖給 Konva 的話，那次 5~6 倍的縮小是瀏覽器用 2x2 雙線性一步做完的，
       * 會混疊（見 IconImageCache 的說明）。這裡換成漸進減半，之後 Konva 一路 1:1。
       */
      var ratio = outputRatio(layer, isPreview);
      var source = IconImageCache.getScaled(dataUri, img, box.width * ratio, box.height * ratio);

      var node = new Konva.Image({
        image: source,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      });
      group.add(node);

      var filters = [];
      if (libraryIcon.type === "logo") {
        /*
         * 廠商 LOGO 不套紅/橘。未選取時做單色調映射（不是標準灰階，也不是純色填滿）——
         * 主色調精確落在 #848484，同時保留明暗結構讓人看得出 LOGO 內容。
         * 詳見 colorTheme.js 的 createLogoGrayFilter()。
         */
        if (!isActive) filters.push(ColorTheme.createLogoGrayFilter());
      } else if (ColorTheme.needsTintFilter(libraryIcon)) {
        /*
         * 點陣圖 icon（或沒寫 currentColor 的 SVG）做單色覆蓋。
         * 不用 Konva.Filters.RGB——那個會乘上原圖亮度，染出來是帶明暗的橘而不是單色。
         */
        filters.push(ColorTheme.createSolidTintFilter(color));
      }

      // 銳化一定要排在最後：單色覆蓋會把 RGB 抹平，先銳化等於白銳化
      if (sharpen) filters.push(ColorTheme.createSharpenFilter(null, ratio));

      if (filters.length) {
        // 快取倍率和降取樣後的來源圖同一個倍率，所以 cache 這一步是 1:1，不再多一次取樣
        node.name(FILTERED_NAME);
        node.cache({ pixelRatio: ratio });
        node.filters(filters);
      }

      layer.draw();
    });
  }

  /*
   * opts = { isPreview, sharpen, generation }：整次繪製共用的旗標，
   * 不再一顆一顆往下傳參數（原本已經到 10 個位置參數，加一個就沒人記得住順序）。
   *
   * 每一格的位置完全由模板決定，group 刻意不可拖曳：
   * 手動微調實務上幾乎沒人用，但因為 group 蓋在 icon 與文字上，
   * 只要在畫布上按著滑鼠移動就會把那一格挪走，而且挪掉之後畫面上看不出來已經偏了。
   * 拿掉之後畫布上的拖曳一律是平移視角（見 viewport.js），不會再動到成品。
   */
  function drawSlot(layer, slotState, slotLayout, isActive, accentColor, library, index, opts) {
    var isPreview = opts.isPreview;
    var generation = opts.generation;
    var L = window.LAYOUT;
    var group = new Konva.Group({ name: "slot-group" });

    var libraryIcon = slotState.iconId ? findLibraryIcon(library, slotState.iconId) : null;
    var color = ColorTheme.resolveSlotColor(slotState, accentColor, isActive);

    // 文字優先：reducer 已經保證 iconText 與 iconId 互斥，這裡的順序只是防禦
    if (slotState.iconText) {
      drawTextIcon(group, slotLayout, slotState.iconText, color, layer, isPreview, opts.sharpen);
    } else if (libraryIcon) {
      drawLibraryIcon(group, slotLayout, libraryIcon, color, isActive, layer, generation, isPreview, opts.sharpen);
    } else {
      drawPlaceholderIcon(group, slotLayout, isActive, color, isPreview);
    }

    // 有輸入就畫真實文字；沒輸入時只有預覽模式會畫半透明假字，匯出一律留空
    var hasText = !!slotState.text;
    var textToDraw = hasText ? slotState.text : isPreview ? PREVIEW_TEXT : "";

    /*
     * 超過 5 字不再截斷，所以文字有可能比這一格寬。這裡有兩個 Konva 的坑：
     *
     *  1. 預設 wrap:"word" 會換行，第二行會撐出這個垂直置中的固定高度框、往上撞到 icon。
     *  2. 改成 wrap:"none" 但仍給固定 width 的話，Konva 會把超出寬度的字「直接切掉」
     *     ——實測 14 字的文案只量到 176px（剛好塞進 180px 的框），字是被無聲砍掉的。
     *     那等於畫面上看起來沒超字，但實際上少了字，比換行更糟。
     *
     * 所以乾脆不給 width（Konva 視為 auto，不換行也不切字），自己算置中位置。
     * 文字會單行往左右溢出、逼近甚至碰到隔壁格——那正是「超字了」該有的樣子。
     */
    var textNode = new Konva.Text({
      y: slotLayout.textY,
      height: slotLayout.textHeight,
      verticalAlign: "middle",
      text: textToDraw,
      fontSize: L.fontSize,
      fontStyle: L.fontWeight,
      fontFamily: L.fontFamily,
      fill: color,
      opacity: hasText ? 1 : PREVIEW_OPACITY,
    });
    // 取整理由同 drawTextIcon：純中文本來就落在整數上，混英數的文案才有差
    textNode.x(Math.round(slotLayout.centerX - textNode.width() / 2));
    group.add(textNode);
    // 空白時畫的是預覽假字，銳化它沒有意義（也不會進匯出）
    if (hasText) applyTextSharpen(textNode, layer, isPreview, opts.sharpen);

    return group;
  }

  function render(layer, state, isPreview) {
    renderGeneration++;
    var opts = {
      generation: renderGeneration,
      isPreview: isPreview,
      // 銳化是全域渲染偏好，預覽與匯出走同一個值，所見即所得
      sharpen: !!state.sharpen,
    };

    layer.destroyChildren();
    if (isPreview) drawArtboard(layer);
    drawWhiteBlock(layer);

    state.slots.forEach(function (slot, index) {
      var slotLayout = LayoutEngine.getSlotLayout(state.slots.length, index);
      if (!slotLayout) return;
      var isActive = index === state.activeSlotIndex;
      layer.add(
        drawSlot(layer, slot, slotLayout, isActive, state.accentColor, state.library, index, opts)
      );
    });

    layer.draw();
  }

  window.CanvasRenderer = {
    /*
     * 給批次匯出用：對任一 layer + 任一(可能是假想的) state 重畫一次，不依賴 store 訂閱。
     * 這裡刻意不傳 isPreview，匯出的圖才不會出現預覽假字與空 icon 虛線框。
     */
    renderToLayer: render,

    mount: function (containerId, store, Actions, onScaleChange) {
      var container = document.getElementById(containerId);
      /*
       * stage 的尺寸是「檢視區」而不是「畫布」。
       * 可縮放之後兩者必須分開：stage 若還是 1200x150，放大後超出的部分會直接被裁掉。
       * 畫布本身的 1200x150 範圍改由 drawArtboard() 畫在場景裡。
       */
      var stage = new Konva.Stage({
        container: containerId,
        width: container.clientWidth,
        height: container.clientHeight,
      });
      var layer = new Konva.Layer();
      stage.add(layer);

      // 畫面上畫的永遠是「目前分頁」那一條；render() 本身不知道分頁的存在
      function draw(state) {
        render(layer, window.Selectors.viewState(state), true);
      }

      /*
       * 縮放停手之後整層重畫一次，讓 icon 用新倍率重新降取樣（原本只重做濾鏡快取，
       * 但現在來源圖本身就是依倍率縮好的，只重做快取會把小圖放大 → 反而變糊）。
       * 重畫在這裡是安全的：圖片都已經在 IconImageCache 裡，callback 是同步呼叫，不會閃。
       */
      var viewport = window.Viewport.attach(stage, container, onScaleChange, function () {
        draw(store.getState());
      });

      // 畫面上的 stage 才是預覽模式（會畫假字）
      store.subscribe(draw);
      draw(store.getState());
      // 檢視區尺寸的後續同步由 Viewport 的 ResizeObserver 負責（面板排版完會再校正一次）
      viewport.fit();

      return { stage: stage, layer: layer, viewport: viewport };
    },
  };
})();
