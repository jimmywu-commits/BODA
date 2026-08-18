/*
 * 畫布縮放與平移（Alt + 滾輪縮放、拖曳空白處平移）。
 *
 * 為什麼一定要縮放 Konva 的 Stage，而不是對容器下 CSS transform：
 * CSS transform 放大的是「已經畫好的那張 1200x150 點陣圖」，越放大越糊——那正好抵銷掉
 * 這次要修的銳利度問題。縮放 Stage 則會讓文字（向量）與圖片以放大後的尺寸重新繪製，
 * 放大之後反而更清楚。
 *
 * 唯一的例外是點陣 icon：它的來源圖已經先被降取樣到目前倍率該有的像素數，
 * 放大時就不夠用了（套濾鏡的節點還多一層 cache() 點陣圖）。
 * 所以縮放停下來之後要整層重畫一次，用新倍率重新降取樣——見 onSettled。
 */
(function () {
  var MIN_SCALE = 0.25;
  var MAX_SCALE = 8;
  var WHEEL_STEP = 1.12; // 每一格滾輪的縮放倍數
  var FIT_PADDING = 32; // 「符合視窗」時畫布四周留的空隙（畫面像素）
  var RESETTLE_DELAY = 140; // 縮放停止多久之後用新倍率重畫

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function attach(stage, container, onChange, onSettled) {
    var settleTimer = null;
    // 使用者一旦自己縮放或平移過，檢視區尺寸改變就不能再自動重新符合視窗——
    // 那會把他正在看的細節位置洗掉
    var userAdjusted = false;

    function notify() {
      if (onChange) onChange(stage.scaleX());
    }

    /*
     * 用新倍率重畫很貴（要重新降取樣、重新光柵化、重跑濾鏡），滾輪每一格都做會卡。
     * 改成停手之後才做：縮放過程中畫面稍微軟，放開就變銳利。
     */
    function scheduleResettle() {
      if (!onSettled) return;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(function () {
        settleTimer = null;
        onSettled();
      }, RESETTLE_DELAY);
    }

    // 以某個畫面座標為錨點縮放：該點底下的畫布內容在縮放後仍停在同一個位置
    function zoomAt(nextScale, anchor) {
      var old = stage.scaleX();
      nextScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      if (Math.abs(nextScale - old) < 1e-6) return;

      var pointInCanvas = {
        x: (anchor.x - stage.x()) / old,
        y: (anchor.y - stage.y()) / old,
      };
      stage.scale({ x: nextScale, y: nextScale });
      stage.position({
        x: anchor.x - pointInCanvas.x * nextScale,
        y: anchor.y - pointInCanvas.y * nextScale,
      });
      stage.batchDraw();
      userAdjusted = true;
      scheduleResettle();
      notify();
    }

    function centerAnchor() {
      return { x: stage.width() / 2, y: stage.height() / 2 };
    }

    function zoomBy(factor) {
      zoomAt(stage.scaleX() * factor, centerAnchor());
    }

    function zoomTo(scale) {
      zoomAt(scale, centerAnchor());
    }

    // 讓整張 1200x150 完整落在檢視區裡並置中
    function fit() {
      var L = window.LAYOUT;
      var availW = stage.width() - FIT_PADDING * 2;
      var availH = stage.height() - FIT_PADDING * 2;
      if (availW <= 0 || availH <= 0) return;

      var scale = clamp(
        Math.min(availW / L.canvasWidth, availH / L.canvasHeight),
        MIN_SCALE,
        MAX_SCALE
      );
      stage.scale({ x: scale, y: scale });
      stage.position({
        x: (stage.width() - L.canvasWidth * scale) / 2,
        y: (stage.height() - L.canvasHeight * scale) / 2,
      });
      stage.batchDraw();
      scheduleResettle();
      notify();
    }

    function actualSize() {
      var L = window.LAYOUT;
      stage.scale({ x: 1, y: 1 });
      stage.position({
        x: (stage.width() - L.canvasWidth) / 2,
        y: (stage.height() - L.canvasHeight) / 2,
      });
      stage.batchDraw();
      userAdjusted = true;
      scheduleResettle();
      notify();
    }

    /*
     * 檢視區尺寸同步。
     *
     * 不能只在 window resize 時做：CanvasRenderer.mount() 跑在 PanelUI.mount() 之前，
     * 那個時間點分頁列還沒建出來，容器高度會多量到分頁列的高度（實測差 37px），
     * 於是 stage 比檢視區高、初始的「符合視窗」也算錯。ResizeObserver 會在版面
     * 真的定下來之後再補一次。
     */
    function syncSize() {
      var w = container.clientWidth;
      var h = container.clientHeight;
      if (!w || !h) return;
      if (w === stage.width() && h === stage.height()) return;
      stage.size({ width: w, height: h });
      // 使用者還沒自己調過視角，就順手重新置中；調過就只改尺寸，不動他的視角
      if (userAdjusted) stage.batchDraw();
      else fit();
    }

    if (typeof ResizeObserver === "function") {
      new ResizeObserver(syncSize).observe(container);
    } else {
      window.addEventListener("resize", syncSize);
    }

    container.addEventListener(
      "wheel",
      function (e) {
        /*
         * 只有 Alt + 滾輪縮放（與 PS 一致）。單獨滾輪改成平移畫布——
         * 這個工作區本來就不捲動，不接手的話單獨滾輪什麼事都不會發生。
         */
        e.preventDefault();
        var pointer = stage.getPointerPosition();
        if (e.altKey) {
          if (!pointer) return;
          zoomAt(stage.scaleX() * (e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP), pointer);
          return;
        }
        stage.position({ x: stage.x() - e.deltaX, y: stage.y() - e.deltaY });
        stage.batchDraw();
        userAdjusted = true;
      },
      { passive: false }
    );

    /*
     * 平移：直接把 stage 設成可拖曳。
     * 每一格的 group 已經不可拖曳（見 canvas.js 的 drawSlot），所以畫布上任何位置的
     * 拖曳都是平移視角，按在 icon 或文字上也一樣——不會再誤把某一格挪走。
     */
    stage.draggable(true);
    container.style.cursor = "grab";
    stage.on("dragstart", function () {
      container.style.cursor = "grabbing";
    });
    stage.on("dragend", function () {
      container.style.cursor = "grab";
      userAdjusted = true;
    });

    return {
      fit: fit,
      actualSize: actualSize,
      zoomIn: function () { zoomBy(WHEEL_STEP * WHEEL_STEP); },
      zoomOut: function () { zoomBy(1 / (WHEEL_STEP * WHEEL_STEP)); },
      zoomTo: zoomTo,
      getScale: function () { return stage.scaleX(); },
      MIN_SCALE: MIN_SCALE,
      MAX_SCALE: MAX_SCALE,
    };
  }

  window.Viewport = { attach: attach, MIN_SCALE: MIN_SCALE, MAX_SCALE: MAX_SCALE };
})();
