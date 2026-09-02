/*
 * 進度存檔（.json）。
 *
 * 設計取捨：上傳的 icon/LOGO 是 base64 data URI，只存在這台電腦的 localStorage。
 * 若存檔只記 iconId，換一台電腦（或清了瀏覽器快取）打開就會全部指向不存在的 icon，
 * 整張圖變成空框。所以這裡把「自訂素材本身」一起內嵌進 JSON——檔案會從幾 KB 變成
 * 數百 KB，但換來的是這份存檔真的能完整還原。
 *
 * 內建 icon（manifest.js 裡那些）不內嵌，只記 id：它們本來就在 git 版控裡，人人都有。
 *
 * 版本：
 *   v1 = 單條吸底圖（頂層直接是 slots）
 *   v2 = 多條分頁（banners 陣列）。讀 v1 檔時會自動包成單一分頁，舊存檔不會失效。
 */
(function () {
  var FORMAT = "sticky-banner-project";
  var VERSION = 2;
  var FILENAME = "進度存檔.json";

  function serializeBanner(banner) {
    return {
      slotCount: banner.slots.length,
      activeSlotIndex: banner.activeSlotIndex,
      accentColor: banner.accentColor,
      slots: banner.slots.map(function (slot) {
        return {
          text: slot.text || "",
          iconId: slot.iconId || null,
          // 用文字代替 icon（9.9 / 10.10）。null = 圖片模式，字串（含空字串）= 文字模式。
          // 舊存檔沒有這個欄位 → 讀回來是 undefined → 正規化成 null，等同舊行為
          iconText: slot.iconText == null ? null : slot.iconText,
        };
      }),
    };
  }

  function serializePayload(state, includeSavedAt) {
    var payload = {
      format: FORMAT,
      version: VERSION,
      activeBannerIndex: state.activeBannerIndex,
      // 銳化會改變匯出的像素，所以它是存檔的一部分——不然載回來的圖跟當初交出去的不一樣
      sharpen: !!state.sharpen,
      banners: state.banners.map(serializeBanner),
      // 只帶自訂素材；內建 icon 靠 id 對回 manifest 即可
      customIcons: state.library.filter(function (icon) {
        return icon.custom;
      }),
    };
    if (includeSavedAt) payload.savedAt = new Date().toISOString();
    return payload;
  }

  function serialize(state) {
    return JSON.stringify(serializePayload(state, true), null, 2);
  }

  /* iframe 雙向同步只比較真正的編輯內容；不能含 savedAt，
     否則每次序列化都會變成新 state，兩個入口就會無限互相重繪。 */
  function serializeForSync(state) {
    return JSON.stringify(serializePayload(state, false), null, 2);
  }

  function parse(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // 別把 "Unexpected token 'o'" 這種原始錯誤丟給使用者看
      throw new Error("這個檔案不是有效的 JSON，請確認選到的是進度存檔而不是別的檔案。");
    }
    if (!data || data.format !== FORMAT) {
      throw new Error("這不是本工具的進度存檔（format 不符）。");
    }
    if (data.version > VERSION) {
      throw new Error(
        "這份存檔是較新版本（v" + data.version + "）製作的，目前版本無法讀取，請更新工具。"
      );
    }

    // v1 沒有 banners，頂層直接是一條吸底圖 → 包成單一分頁
    if (!data.banners) {
      if (!Array.isArray(data.slots) || !data.slots.length) {
        throw new Error("存檔內容不完整，找不到欄位資料。");
      }
      data = Object.assign({}, data, {
        banners: [
          {
            slotCount: data.slotCount || data.slots.length,
            activeSlotIndex: data.activeSlotIndex || 0,
            accentColor: data.accentColor || "orange",
            slots: data.slots,
          },
        ],
        activeBannerIndex: 0,
      });
    }

    if (!Array.isArray(data.banners) || !data.banners.length) {
      throw new Error("存檔內容不完整，找不到任何吸底圖資料。");
    }
    return data;
  }

  function hasIcon(library, id) {
    for (var i = 0; i < library.length; i++) {
      if (library[i].id === id) return true;
    }
    return false;
  }

  /*
   * 套用存檔到 store。
   *
   * 分頁結構直接用 SET_BANNERS 一次換掉（分頁數不定，逐欄 dispatch 反而繞遠路），
   * 但每一欄的內容仍然走 reducer 的建構函式與防呆：文字過 TextLimit、顆數夾在 2~5、
   * activeSlotIndex 夾在範圍內。存檔被手改壞也不會產生非法 state。
   *
   * 回傳訊息陣列，讓 UI 可以把「有東西沒還原成功」明講出來，而不是默默吃掉。
   */
  function applyToStore(store, Actions, data) {
    var warnings = [];
    var LIMITS = window.SLOT_LIMITS;

    // 1. 先補齊自訂素材，後面判定 icon type 才查得到（logo/icon 配色規則不同）
    //    只進記憶體中的素材庫，不做任何本機留存——關掉分頁就沒了，跟直接上傳的行為一致
    (data.customIcons || []).forEach(function (icon) {
      if (!icon || !icon.id) return;
      if (hasIcon(store.getState().library, icon.id)) return;
      store.dispatch(Actions.addLibraryIcon(icon));
    });

    var library = store.getState().library;

    function findType(iconId) {
      for (var i = 0; i < library.length; i++) {
        if (library[i].id === iconId) return library[i].type;
      }
      return "icon";
    }

    // 2. 逐條分頁重建
    var banners = data.banners.map(function (raw, bi) {
      var count = Math.max(
        LIMITS.MIN_SLOTS,
        Math.min(LIMITS.MAX_SLOTS, raw.slotCount || (raw.slots || []).length)
      );
      var banner = window.BannerFactory.create(count);
      var rawSlots = raw.slots || [];

      var slots = banner.slots.map(function (slot, i) {
        var s = rawSlots[i] || {};
        var iconText = s.iconText == null ? null : String(s.iconText);
        // 互斥規則跟 reducer 一致：存檔被手改成兩者都有時，以文字為準
        var iconId = iconText != null ? null : s.iconId || null;

        if (iconId && !hasIcon(library, iconId)) {
          warnings.push(
            "第 " + (bi + 1) + " 條第 " + (i + 1) + " 欄的 icon（" + iconId + "）不存在，已留空"
          );
          iconId = null;
        }

        return Object.assign({}, slot, {
          // 不截斷：存檔存的是使用者當初真的打進去的字，載回來要一模一樣
          text: s.text || "",
          iconId: iconId,
          iconText: iconText,
          type: iconId ? findType(iconId) : "icon",
          // 舊存檔可能帶 offset（手動拖曳過的位置）。拖曳功能已移除，這裡刻意不還原，
          // 讓所有欄位都回到模板位置——否則畫面上會有一個偏掉、卻沒有任何方法歸位的格子。
        });
      });

      if (rawSlots.length > count) {
        warnings.push("第 " + (bi + 1) + " 條有 " + rawSlots.length + " 欄，超出上限的部分未套用");
      }

      return Object.assign({}, banner, {
        slots: slots,
        accentColor: raw.accentColor === "red" ? "red" : "orange",
        activeSlotIndex: Math.max(0, Math.min(count - 1, raw.activeSlotIndex || 0)),
      });
    });

    // v1 存檔沒有這個欄位 → undefined → false，等同舊行為
    store.dispatch(Actions.setSharpen(!!data.sharpen));
    store.dispatch(Actions.setBanners(banners, data.activeBannerIndex || 0));
    return warnings;
  }

  function readFile(file, onDone, onError) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        onDone(parse(ev.target.result));
      } catch (e) {
        onError(e);
      }
    };
    reader.onerror = function () {
      onError(new Error("讀取檔案失敗。"));
    };
    reader.readAsText(file);
  }

  window.ProjectFile = {
    FILENAME: FILENAME,
    VERSION: VERSION,
    serialize: serialize,
    serializeForSync: serializeForSync,
    parse: parse,
    applyToStore: applyToStore,
    readFile: readFile,
  };
})();
