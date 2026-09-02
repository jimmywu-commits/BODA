/*
 * 吸底等級預設。
 *
 * 主工具只需傳入目前等級；工單生成器吸底與主選單吸底會走同一條規則：
 * - 名稱含 BOD → BOD LOGO、紅色反白。
 * - 名稱含 MDD → MDD LOGO、紅色反白。
 * - 其餘所有等級 → #U4e3b#U6703#U5834.png、橘色反白。
 * 第一顆下方文字均預設為「主會場」。
 *
 * LOGO 正式素材位置：bottom/img/BOD LOGO.PNG、bottom/img/MDD LOGO.PNG。
 * 日後以正式 PNG 覆蓋同名檔案，再執行 bottom/tools/build-icon-manifest.js 即可。
 */
(function () {
  var PRESETS = {
    default: { iconId: 'u4e3bu6703u5834', label: '主會場', accentColor: 'orange', type: 'icon' },
    bod: { iconId: 'bod-logo', label: '主會場', accentColor: 'red', type: 'logo' },
    mdd: { iconId: 'mdd-logo', label: '主會場', accentColor: 'red', type: 'logo' }
  };

  function presetForLevel(levelId) {
    var id = String(levelId || '').toLowerCase();
    if (id.indexOf('bod') !== -1) return PRESETS.bod;
    if (id.indexOf('mdd') !== -1) return PRESETS.mdd;
    return PRESETS.default;
  }

  function hasIcon(library, id) {
    return (library || []).some(function (item) { return item && item.id === id; });
  }

  function applyLevel(levelId) {
    if (!window.store || !window.Actions) return false;
    var state = window.store.getState();
    var preset = presetForLevel(levelId);
    if (!hasIcon(state.library, preset.iconId)) return false;

    var changed = false;
    var banners = state.banners.map(function (banner) {
      var slots = banner.slots;
      var bannerChanged = banner.accentColor !== preset.accentColor;

      if (slots[0]) {
        var first = slots[0];
        if (first.iconId !== preset.iconId || first.iconText !== null || first.type !== preset.type || first.text !== preset.label) {
          slots = banner.slots.slice();
          slots[0] = Object.assign({}, first, {
            iconId: preset.iconId,
            iconText: null,
            type: preset.type,
            text: preset.label
          });
          bannerChanged = true;
        }
      }

      if (!bannerChanged) return banner;
      changed = true;
      return Object.assign({}, banner, { accentColor: preset.accentColor, slots: slots });
    });

    if (!changed) return false;
    window.store.beginBatch();
    window.store.dispatch(window.Actions.setBanners(banners, state.activeBannerIndex));
    window.store.endBatch();
    return true;
  }

  window.BottomLevelPreset = { applyLevel: applyLevel, presetForLevel: presetForLevel };
})();
