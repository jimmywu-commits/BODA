(function () {
  var TYPES = {
    SET_SLOT_COUNT: "SET_SLOT_COUNT",
    SET_SLOT_TEXT: "SET_SLOT_TEXT",
    SET_SLOT_ICON: "SET_SLOT_ICON",
    SET_SLOT_ICON_TEXT: "SET_SLOT_ICON_TEXT",
    SET_SLOT_ICON_SCALE: "SET_SLOT_ICON_SCALE",
    SET_ACTIVE_SLOT: "SET_ACTIVE_SLOT",
    // 把 icon 套到其他分頁（只搬 icon 區，文案完全不動）
    COPY_ICONS_TO_ALL: "COPY_ICONS_TO_ALL",
    COPY_SLOT_ICON_TO_ALL: "COPY_SLOT_ICON_TO_ALL",
    SET_LIBRARY: "SET_LIBRARY",
    ADD_LIBRARY_ICON: "ADD_LIBRARY_ICON",
    REMOVE_LIBRARY_ICONS: "REMOVE_LIBRARY_ICONS",
    SET_ACCENT_COLOR: "SET_ACCENT_COLOR",
    SET_SHARPEN: "SET_SHARPEN",
    // 整頁回到剛打開的狀態（可 undo）
    RESET_ALL: "RESET_ALL",

    // 多條吸底圖（分頁）
    ADD_BANNER: "ADD_BANNER",
    DUPLICATE_BANNER: "DUPLICATE_BANNER",
    REMOVE_BANNER: "REMOVE_BANNER",
    SET_ACTIVE_BANNER: "SET_ACTIVE_BANNER",
    SET_BANNERS: "SET_BANNERS",
    TOGGLE_SLOT_LINK: "TOGGLE_SLOT_LINK",
    REMOVE_SLOT: "REMOVE_SLOT",
    MOVE_SLOT: "MOVE_SLOT",
  };

  window.Actions = {
    types: TYPES,

    setSlotCount: function (count) {
      return { type: TYPES.SET_SLOT_COUNT, count: count };
    },
    setSlotText: function (index, text) {
      return { type: TYPES.SET_SLOT_TEXT, index: index, text: text };
    },
    // 換圖時大小會回到 100%；opts.keepScale 給「編輯後換成新圖」用，那仍是同一張 LOGO
    setSlotIcon: function (index, iconId, opts) {
      return {
        type: TYPES.SET_SLOT_ICON,
        index: index,
        iconId: iconId,
        keepScale: !!(opts && opts.keepScale),
      };
    },
    // 用文字（9.9、10.10 這類檔期數字）代替 icon，與 setSlotIcon 互斥
    setSlotIconText: function (index, text) {
      return { type: TYPES.SET_SLOT_ICON_TEXT, index: index, text: text };
    },
    /*
     * 手動調整這一格圖片的大小（1 = 模板預設的 107x58 contain 大小）。
     * 存在格子上而不是素材上：同一張 LOGO 在不同吸底圖裡可以有不同大小。
     */
    setSlotIconScale: function (index, scale) {
      return { type: TYPES.SET_SLOT_ICON_SCALE, index: index, scale: scale };
    },
    setActiveSlot: function (index) {
      return { type: TYPES.SET_ACTIVE_SLOT, index: index };
    },
    /*
     * 把目前這條的 icon 套到其他所有分頁。
     * 一次做完是刻意的：多條吸底圖之間常常只差一顆 icon，
     * 「全部同步 → 手動改掉不同的那顆」比「逐頁逐格重選」快得多。
     */
    copyIconsToAll: function () {
      return { type: TYPES.COPY_ICONS_TO_ALL };
    },
    copySlotIconToAll: function (index) {
      return { type: TYPES.COPY_SLOT_ICON_TO_ALL, index: index };
    },
    setLibrary: function (icons) {
      return { type: TYPES.SET_LIBRARY, icons: icons };
    },
    addLibraryIcon: function (icon) {
      return { type: TYPES.ADD_LIBRARY_ICON, icon: icon };
    },
    // 只會移除自訂（上傳／編輯產生）的素材；用到它的格子一併清空
    removeLibraryIcons: function (ids) {
      return { type: TYPES.REMOVE_LIBRARY_ICONS, ids: ids || [] };
    },
    resetAll: function () {
      return { type: TYPES.RESET_ALL };
    },
    setAccentColor: function (color) {
      return { type: TYPES.SET_ACCENT_COLOR, color: color };
    },
    // 銳化是全域渲染偏好，不屬於任何一條分頁
    setSharpen: function (on) {
      return { type: TYPES.SET_SHARPEN, on: !!on };
    },

    addBanner: function () {
      return { type: TYPES.ADD_BANNER };
    },
    duplicateBanner: function (index) {
      return { type: TYPES.DUPLICATE_BANNER, index: index };
    },
    removeBanner: function (index) {
      return { type: TYPES.REMOVE_BANNER, index: index };
    },
    setActiveBanner: function (index) {
      return { type: TYPES.SET_ACTIVE_BANNER, index: index };
    },
    // 整批取代（工單匯入、載入進度存檔用）
    setBanners: function (banners, activeIndex) {
      return { type: TYPES.SET_BANNERS, banners: banners, activeIndex: activeIndex || 0 };
    },
    toggleSlotLink: function (index) {
      return { type: TYPES.TOGGLE_SLOT_LINK, index: index };
    },
    removeSlot: function (index) {
      return { type: TYPES.REMOVE_SLOT, index: index };
    },
    moveSlot: function (fromIndex, toIndex) {
      return { type: TYPES.MOVE_SLOT, fromIndex: fromIndex, toIndex: toIndex };
    },
  };
})();
