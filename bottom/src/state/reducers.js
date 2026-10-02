/*
 * State 形狀：
 *   {
 *     banners: [ { id, activeSlotIndex, accentColor, slots: [...] } ],  ← 一個分頁一條吸底圖
 *     activeBannerIndex: 0,
 *     library: [...]   ← 素材庫跨分頁共用，不必每個分頁各存一份
 *   }
 *
 * 所有「欄位層級」的 action（文字/icon/反白/位移）都只作用在目前分頁，
 * 由 updateActive() 統一處理，個別 case 不用自己找分頁。
 */
(function () {
  var TYPES = window.Actions.types;
  var MIN_SLOTS = 2;
  var MAX_SLOTS = 5;
  var RESERVED_MAIN_VENUE_TEXT = "主會場";
  var FIRST_SLOT_ONLY_ICON_IDS = {
    u4e3bu6703u5834: true, // 主會場 Home icon
    "bod-logo": true,     // 今日旗艦店
    "mdd-logo": true,     // 品牌旗艦
  };

  function sanitizeSlotText(index, text) {
    var value = String(text == null ? "" : text);
    return Number(index) === 0 ? value : value.split(RESERVED_MAIN_VENUE_TEXT).join("");
  }

  function findLibraryIcon(library, iconId) {
    for (var i = 0; i < (library || []).length; i++) {
      if (library[i].id === iconId) return library[i];
    }
    return null;
  }

  function isFirstSlotOnlyIcon(library, iconOrId) {
    var icon = iconOrId && typeof iconOrId === "object"
      ? iconOrId : findLibraryIcon(library, iconOrId);
    var id = icon ? icon.id : iconOrId;
    return !!(FIRST_SLOT_ONLY_ICON_IDS[id] || (icon && icon.firstSlotOnly));
  }

  function sanitizeBannerSlot(library, slot, index) {
    var text = sanitizeSlotText(index, slot && slot.text);
    var iconId = slot && slot.iconId;
    if (Number(index) > 0 && isFirstSlotOnlyIcon(library, iconId)) iconId = null;
    if (slot && slot.text === text && slot.iconId === iconId) return slot;
    return Object.assign({}, slot || createSlot(index), {
      text: text,
      iconId: iconId,
      type: iconId ? (slot.type || findIconType(library, iconId)) : "icon",
    });
  }

  function sanitizeBanner(library, banner) {
    if (!banner || !Array.isArray(banner.slots)) return banner;
    var changed = false;
    var slots = banner.slots.map(function (slot, index) {
      var sanitized = sanitizeBannerSlot(library, slot, index);
      if (sanitized !== slot) changed = true;
      return sanitized;
    });
    return changed ? Object.assign({}, banner, { slots: slots }) : banner;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function createSlot(index) {
    return {
      id: "slot-" + index,
      type: "icon",
      text: "",
      iconId: null,
      /*
       * icon 區的模式旗標，同時也是內容：
       *   null → 圖片模式（用 iconId）
       *   字串 → 文字模式（9.9 / 10.10 這類檔期數字），**包含空字串**
       *
       * 空字串必須算文字模式。若用「字串是否為空」判斷模式，使用者把 9.9 全部刪掉
       * 準備改打 10.10 的那一瞬間，輸入框會在游標底下消失。
       */
      iconText: null,
    };
  }

  function resizeSlots(slots, count) {
    var next = slots.slice(0, count);
    for (var i = next.length; i < count; i++) {
      next.push(createSlot(i));
    }
    return next;
  }

  var bannerSeq = 0;

  function createBanner(slotCount) {
    bannerSeq++;
    return {
      id: "banner-" + bannerSeq,
      activeSlotIndex: 0,
      accentColor: "orange",
      slots: resizeSlots([], clamp(slotCount || MAX_SLOTS, MIN_SLOTS, MAX_SLOTS)),
    };
  }

  function findIconType(library, iconId) {
    for (var i = 0; i < library.length; i++) {
      if (library[i].id === iconId) return library[i].type;
    }
    return "icon";
  }

  function updateSlotAt(slots, index, updater) {
    return slots.map(function (slot, i) {
      return i === index ? updater(slot) : slot;
    });
  }

  // 只改目前分頁，其餘分頁維持同一個物件參考（undo 的快照才不會多複製）
  function updateActive(state, updater) {
    return Object.assign({}, state, {
      banners: state.banners.map(function (banner, i) {
        return i === state.activeBannerIndex ? updater(banner) : banner;
      }),
    });
  }

  function updateActiveSlot(state, index, updater) {
    return updateActive(state, function (banner) {
      return Object.assign({}, banner, {
        slots: updateSlotAt(banner.slots, index, updater),
      });
    });
  }

  /*
   * 一格的「icon 區內容」＝這三個欄位，要搬就三個一起搬。
   *
   *  - iconId / type 是圖片模式用的（type 決定配色規則：icon 套橘紅、logo 保留原色）
   *  - iconText 是文字模式用的（9.9 / 10.10）
   *
   * **slot.text（下方那行文案）絕對不在裡面。** 跨分頁套用 icon 的前提就是
   * 文案各自不同（那是工單匯入的結果），碰它等於把匯入的東西洗掉。
   */
  function iconFieldsOf(slot) {
    return { iconId: slot.iconId, type: slot.type, iconText: slot.iconText };
  }

  function isSlotLinked(slot) {
    return !slot || slot.linked !== false;
  }

  function propagateLinkedIcon(state, slotIndex) {
    var src = state.banners[state.activeBannerIndex];
    if (!src || !src.slots[slotIndex] || !isSlotLinked(src.slots[slotIndex])) return state;
    var srcFields = iconFieldsOf(src.slots[slotIndex]);
    return Object.assign({}, state, {
      banners: state.banners.map(function (banner, i) {
        if (i === state.activeBannerIndex) return banner;
        var slot = banner.slots[slotIndex];
        if (!slot || !isSlotLinked(slot)) return banner;
        return Object.assign({}, banner, {
          slots: updateSlotAt(banner.slots, slotIndex, function (s) {
            return Object.assign({}, s, srcFields);
          }),
        });
      }),
    });
  }

  function propagateLinkedText(state, slotIndex) {
    var src = state.banners[state.activeBannerIndex];
    if (!src || !src.slots[slotIndex] || !isSlotLinked(src.slots[slotIndex])) return state;
    var text = src.slots[slotIndex].text;
    return Object.assign({}, state, {
      banners: state.banners.map(function (banner, i) {
        if (i === state.activeBannerIndex) return banner;
        var slot = banner.slots[slotIndex];
        if (!slot || !isSlotLinked(slot)) return banner;
        return Object.assign({}, banner, {
          slots: updateSlotAt(banner.slots, slotIndex, function (s) {
            return Object.assign({}, s, { text: sanitizeSlotText(slotIndex, text) });
          }),
        });
      }),
    });
  }

  window.INITIAL_STATE = {
    banners: [createBanner(MAX_SLOTS)],
    activeBannerIndex: 0,
    library: [],
    /*
     * 補銳化預設開啟。
     *
     * canvas 的 fillText 沒有 hinting，Photoshop 的文字消除鋸齒會把筆畫吸附到像素格線，
     * 所以同樣 22px 的中文，PS 出來的比較利——這是光柵化器的差異，沒有 API 可以要求。
     * 唯一能補的就是銳化，實測說明文字的中間調像素比例 0.51 → 0.426（-16.5%），
     * 且沒有出現暗側溢出。
     *
     * 先前預設關閉的理由是「會吃掉低對比細節」，那個現象其實是舊的灰階映射把
     * LOGO 壓進 [132, 185] 這段窄區間造成的。改成覆蓋率映射（跨滿 [132, 255]）之後
     * 重量一次：低對比條紋的振幅 17.81 → 19.00，銳化反而是放大而不是吃掉。
     */
    sharpen: true,
  };

  window.rootReducer = function (state, action) {
    state = state || window.INITIAL_STATE;

    switch (action.type) {
      case TYPES.SET_SLOT_COUNT: {
        var count = clamp(action.count, MIN_SLOTS, MAX_SLOTS);
        return updateActive(state, function (banner) {
          return Object.assign({}, banner, {
            slots: resizeSlots(banner.slots, count),
            activeSlotIndex: clamp(banner.activeSlotIndex, 0, count - 1),
          });
        });
      }

      case TYPES.SET_SLOT_TEXT: {
        var sanitizedText = sanitizeSlotText(action.index, action.text);
        var next = updateActiveSlot(state, action.index, function (slot) {
          return Object.assign({}, slot, { text: sanitizedText });
        });
        if (state.banners.length > 1) next = propagateLinkedText(next, action.index);
        return next;
      }

      /*
       * icon 與「文字代替 icon」互斥：一格的 icon 區只能是圖或字，不能兩者都有。
       * 互斥在 reducer 這裡強制，不交給 UI —— 只要有第二個地方能 dispatch
       *（工單匯入、載入存檔），靠 UI 自律遲早會出現「圖蓋在字上面」的狀態。
       */
      case TYPES.SET_SLOT_ICON: {
        var selectedIconId = Number(action.index) > 0 && isFirstSlotOnlyIcon(state.library, action.iconId)
          ? null : action.iconId;
        var iconType = findIconType(state.library, selectedIconId);
        var next = updateActiveSlot(state, action.index, function (slot) {
          return Object.assign({}, slot, {
            iconId: selectedIconId,
            type: iconType,
            iconText: selectedIconId ? null : slot.iconText,
          });
        });
        if (state.banners.length > 1) next = propagateLinkedIcon(next, action.index);
        return next;
      }

      case TYPES.SET_SLOT_ICON_TEXT: {
        var iconText = action.text == null ? null : String(action.text);
        var next = updateActiveSlot(state, action.index, function (slot) {
          if (iconText == null) return Object.assign({}, slot, { iconText: null });
          return Object.assign({}, slot, {
            iconText: iconText,
            iconId: null,
            type: "icon",
          });
        });
        if (state.banners.length > 1) next = propagateLinkedIcon(next, action.index);
        return next;
      }

      case TYPES.SET_ACTIVE_SLOT: {
        return updateActive(state, function (banner) {
          return Object.assign({}, banner, {
            activeSlotIndex: clamp(action.index, 0, banner.slots.length - 1),
          });
        });
      }

      /*
       * 把目前這條的 icon 套到其他所有分頁。
       *
       * 兩個刻意的取捨：
       *
       * 1. **來源是空的也照搬**（等於把對方那一格清空）。語意是「讓其他頁跟這頁一樣」，
       *    不是「把有值的補過去」。規則單純、結果可預期，而且錯了就是一次 Ctrl+Z。
       *    若改成跳過空格，使用者反而沒有辦法用這顆按鈕清掉多餘的 icon。
       * 2. **不動顆數。** 對方比較少格就只套得到的部分，多的格子留著。
       *    順手改顆數會連帶改版面，那是另一件事，應該由「模板顆數」自己決定。
       */
      case TYPES.COPY_ICONS_TO_ALL: {
        var srcBanner = state.banners[state.activeBannerIndex];
        if (!srcBanner || state.banners.length < 2) return state;
        return Object.assign({}, state, {
          banners: state.banners.map(function (banner, i) {
            if (i === state.activeBannerIndex) return banner;
            return Object.assign({}, banner, {
              slots: banner.slots.map(function (slot, k) {
                var from = srcBanner.slots[k];
                return from ? Object.assign({}, slot, iconFieldsOf(from)) : slot;
              }),
            });
          }),
        });
      }

      case TYPES.COPY_SLOT_ICON_TO_ALL: {
        var srcSlot =
          state.banners[state.activeBannerIndex] &&
          state.banners[state.activeBannerIndex].slots[action.index];
        if (!srcSlot || state.banners.length < 2) return state;
        return Object.assign({}, state, {
          banners: state.banners.map(function (banner, i) {
            if (i === state.activeBannerIndex) return banner;
            if (!banner.slots[action.index]) return banner; // 對方沒有這一格就跳過
            return Object.assign({}, banner, {
              slots: updateSlotAt(banner.slots, action.index, function (slot) {
                return Object.assign({}, slot, iconFieldsOf(srcSlot));
              }),
            });
          }),
        });
      }

      case TYPES.TOGGLE_SLOT_LINK: {
        var activeBnr = state.banners[state.activeBannerIndex];
        var targetSlot = activeBnr && activeBnr.slots[action.index];
        if (!targetSlot) return state;
        var wasLinked = isSlotLinked(targetSlot);
        var next = updateActiveSlot(state, action.index, function (s) {
          return Object.assign({}, s, { linked: !wasLinked });
        });
        if (!wasLinked && state.banners.length > 1) {
          next = propagateLinkedIcon(next, action.index);
          next = propagateLinkedText(next, action.index);
        }
        return next;
      }

      case TYPES.SET_ACCENT_COLOR: {
        return updateActive(state, function (banner) {
          return Object.assign({}, banner, { accentColor: action.color });
        });
      }

      // 全域渲染偏好，不走 updateActive——它不屬於任何一條分頁
      case TYPES.SET_SHARPEN: {
        return Object.assign({}, state, { sharpen: action.on });
      }

      /* ── 素材庫（跨分頁共用） ── */

      case TYPES.SET_LIBRARY: {
        return Object.assign({}, state, { library: action.icons });
      }

      case TYPES.ADD_LIBRARY_ICON: {
        return Object.assign({}, state, {
          library: state.library.concat([action.icon]),
        });
      }

      /* ── 分頁 ── */

      case TYPES.ADD_BANNER: {
        var added = state.banners.concat([createBanner(MAX_SLOTS)]);
        return Object.assign({}, state, {
          banners: added,
          activeBannerIndex: added.length - 1,
        });
      }

      case TYPES.DUPLICATE_BANNER: {
        var srcBnr = state.banners[action.index];
        if (!srcBnr) return state;
        bannerSeq++;
        var clonedSlots = srcBnr.slots.map(function (s) {
          return Object.assign({}, s, { linked: undefined });
        });
        var cloned = Object.assign({}, srcBnr, {
          id: "banner-" + bannerSeq,
          slots: clonedSlots,
        });
        var dup = state.banners.slice();
        dup.splice(action.index + 1, 0, cloned);
        return Object.assign({}, state, {
          banners: dup,
          activeBannerIndex: action.index + 1,
        });
      }

      case TYPES.REMOVE_BANNER: {
        if (state.banners.length <= 1) return state; // 至少留一個分頁
        var remaining = state.banners.filter(function (_, i) {
          return i !== action.index;
        });
        return Object.assign({}, state, {
          banners: remaining,
          activeBannerIndex: clamp(state.activeBannerIndex, 0, remaining.length - 1),
        });
      }

      case TYPES.SET_ACTIVE_BANNER: {
        return Object.assign({}, state, {
          activeBannerIndex: clamp(action.index, 0, state.banners.length - 1),
        });
      }

      case TYPES.SET_BANNERS: {
        if (!action.banners || !action.banners.length) return state;
        var sanitizedBanners = action.banners.map(function (banner) {
          return sanitizeBanner(state.library, banner);
        });
        return Object.assign({}, state, {
          banners: sanitizedBanners,
          activeBannerIndex: clamp(action.activeIndex, 0, sanitizedBanners.length - 1),
        });
      }

      default:
        return state;
    }
  };

  window.SLOT_LIMITS = { MIN_SLOTS: MIN_SLOTS, MAX_SLOTS: MAX_SLOTS };
  window.BottomSlotRules = {
    sanitizeText: sanitizeSlotText,
    isFirstSlotOnlyIcon: function (iconOrId, library) {
      return isFirstSlotOnlyIcon(library || [], iconOrId);
    },
  };
  window.BannerFactory = { create: createBanner, createSlot: createSlot, resizeSlots: resizeSlots };
})();
