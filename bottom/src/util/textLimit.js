/*
 * 文字字數限制：建議上限 5 字，中文（全形）算 1 字、英文/數字/符號（半形）算 0.5 字。
 *
 * 這是「軟性警告」不是硬性阻擋：超過仍然打得進去、畫布也照畫，
 * 只是輸入框會轉成紅框、計數變紅、匯出區出現提醒。
 * 理由是實務上偶爾就是需要塞超過規範的字，擋死會讓人繞路（改到別的工具做）反而更糟。
 *
 * truncate() 保留著沒有刪：之後若要改回硬擋，或需要「產生檔名用的短字串」時還用得到。
 * 目前正式流程沒有任何一處呼叫它——超字一律原樣保留。
 */
(function () {
  var MAX_UNITS = 5;

  // CJK 統一漢字、擴充A、相容漢字、CJK 標點、全形英數與標點
  var FULL_WIDTH = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;

  function unitOf(ch) {
    return FULL_WIDTH.test(ch) ? 1 : 0.5;
  }

  function countUnits(text) {
    var total = 0;
    var str = text || "";
    for (var i = 0; i < str.length; i++) total += unitOf(str.charAt(i));
    return total;
  }

  function truncate(text, limit) {
    var max = limit == null ? MAX_UNITS : limit;
    var str = text || "";
    var total = 0;
    var out = "";
    for (var i = 0; i < str.length; i++) {
      var next = total + unitOf(str.charAt(i));
      if (next > max) break;
      total = next;
      out += str.charAt(i);
    }
    return out;
  }

  // 3 → "3"、2.5 → "2.5"（避免顯示成 3.0）
  function format(n) {
    return n % 1 === 0 ? String(n) : n.toFixed(1);
  }

  function isOver(text) {
    return countUnits(text) > MAX_UNITS;
  }

  // 回傳超字的欄位序號（1-based），給匯出區的提醒用
  function overSlots(slots) {
    var out = [];
    (slots || []).forEach(function (slot, i) {
      if (isOver(slot.text)) out.push(i + 1);
    });
    return out;
  }

  window.TextLimit = {
    MAX_UNITS: MAX_UNITS,
    countUnits: countUnits,
    truncate: truncate,
    format: format,
    isOver: isOver,
    overSlots: overSlots,
  };
})();
