/*
 * State 從「一條吸底圖」改成「多條分頁」之後，畫布渲染器與匯出模組其實不在乎分頁這件事——
 * 它們只需要「要畫的那一條」加上共用的素材庫。
 *
 * 這一層把兩者接起來：viewState() 產生一個扁平的視圖物件，形狀跟改版前一模一樣，
 * 所以 canvas.js / exportBatch.js 只要改取值那一行，內部邏輯完全不用動。
 */
(function () {
  function activeBanner(state) {
    return state.banners[state.activeBannerIndex] || state.banners[0];
  }

  function viewState(state, banner) {
    var b = banner || activeBanner(state);
    return {
      slots: b.slots,
      activeSlotIndex: b.activeSlotIndex,
      accentColor: b.accentColor,
      library: state.library,
      // 全域偏好，但要跟著視圖一起送進渲染器——匯出走的是同一個 view，
      // 所以預覽開了銳化、匯出就一定也開，不會有兩套結果
      sharpen: !!state.sharpen,
    };
  }

  /*
   * 檔名／資料夾名用的短標籤：只編號。
   * 刻意不帶文案——檔名要穩定，不能因為改了一個字就整批換名。
   */
  function bannerLabel(index) {
    return "吸底 " + (index + 1);
  }

  // 分頁上顯示的補充資訊：顆數 + 第一格文案（沒填就只有顆數）
  function bannerMeta(banner) {
    var meta = banner.slots.length + "格";
    var first = banner.slots[0] && banner.slots[0].text;
    if (first) meta += " · " + first;
    return meta;
  }

  /*
   * 畫面上有沒有「會被覆蓋就可惜」的東西：多開了分頁，或任何一格有文字／圖／檔期字。
   * 拖曳匯入前要不要先確認、自動暫存要不要留著，都看這個。
   */
  function hasContent(state) {
    if (state.banners.length > 1) return true;
    return state.banners.some(function (banner) {
      return banner.slots.some(function (slot) {
        return !!(slot.text || slot.iconId || slot.iconText != null);
      });
    });
  }

  // 素材在所有分頁裡被幾格用到（移除素材前要講清楚會清空幾格）
  function iconUsageCount(state, iconId) {
    var count = 0;
    state.banners.forEach(function (banner) {
      banner.slots.forEach(function (slot) {
        if (slot.iconId === iconId) count++;
      });
    });
    return count;
  }

  window.Selectors = {
    hasContent: hasContent,
    iconUsageCount: iconUsageCount,
    activeBanner: activeBanner,
    viewState: viewState,
    bannerLabel: bannerLabel,
    bannerMeta: bannerMeta,
  };
})();
