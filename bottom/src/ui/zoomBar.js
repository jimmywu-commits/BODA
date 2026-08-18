/*
 * 畫布右下角的縮放列。
 *
 * 只做「看得見、按得到」這件事——所有實際的縮放邏輯都在 render/viewport.js，
 * 這裡不持有任何狀態，倍率顯示完全由 viewport 的回呼推過來。
 */
(function () {
  function btn(label, title, onClick) {
    var b = document.createElement("button");
    b.className = "zoom-btn";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  function mount(host, viewport) {
    host.innerHTML = "";

    var readout = document.createElement("span");
    readout.className = "zoom-readout";
    readout.title = "目前檢視倍率（不影響匯出，匯出永遠是 1200×150）";

    host.appendChild(btn("−", "縮小", viewport.zoomOut));
    host.appendChild(readout);
    host.appendChild(btn("＋", "放大", viewport.zoomIn));
    host.appendChild(btn("100%", "以實際像素檢視（1 畫布像素 = 1 螢幕像素）", viewport.actualSize));
    host.appendChild(btn("符合視窗", "把整張圖縮到看得完", viewport.fit));

    var hint = document.createElement("span");
    hint.className = "zoom-hint";
    hint.textContent = "Alt + 滾輪縮放 · 拖曳空白處平移";
    host.appendChild(hint);

    // 回傳給 viewport 當 onChange 回呼
    return function (scale) {
      readout.textContent = Math.round(scale * 100) + "%";
    };
  }

  window.ZoomBar = { mount: mount };
})();
