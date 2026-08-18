(function () {
  var TYPES = {
    SET_SLOT_COUNT: "SET_SLOT_COUNT",
    SET_SLOT_TEXT: "SET_SLOT_TEXT",
    SET_SLOT_ICON: "SET_SLOT_ICON",
    SET_SLOT_ICON_TEXT: "SET_SLOT_ICON_TEXT",
    SET_ACTIVE_SLOT: "SET_ACTIVE_SLOT",
    // 把 icon 套到其他分頁（只搬 icon 區，文案完全不動）
    COPY_ICONS_TO_ALL: "COPY_ICONS_TO_ALL",
    COPY_SLOT_ICON_TO_ALL: "COPY_SLOT_ICON_TO_ALL",
    SET_LIBRARY: "SET_LIBRARY",
    ADD_LIBRARY_ICON: "ADD_LIBRARY_ICON",
    SET_ACCENT_COLOR: "SET_ACCENT_COLOR",
    SET_SHARPEN: "SET_SHARPEN",

    // 多條吸底圖（分頁）
    ADD_BANNER: "ADD_BANNER",
    REMOVE_BANNER: "REMOVE_BANNER",
    SET_ACTIVE_BANNER: "SET_ACTIVE_BANNER",
    SET_BANNERS: "SET_BANNERS",
  };

  window.Actions = {
    types: TYPES,

    setSlotCount: function (count) {
      return { type: TYPES.SET_SLOT_COUNT, count: count };
    },
    setSlotText: function (index, text) {
      return { type: TYPES.SET_SLOT_TEXT, index: index, text: text };
    },
    setSlotIcon: function (index, iconId) {
      return { type: TYPES.SET_SLOT_ICON, index: index, iconId: iconId };
    },
    // 用文字（9.9、10.10 這類檔期數字）代替 icon，與 setSlotIcon 互斥
    setSlotIconText: function (index, text) {
      return { type: TYPES.SET_SLOT_ICON_TEXT, index: index, text: text };
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
  };
})();
