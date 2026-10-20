/*
 * 本機自動暫存：每次編輯後自動存到 localStorage，重新整理不會掉。
 *
 * 用的是和「進度存檔.json」完全相同的序列化格式（ProjectFile.serialize），
 * 所以即使手動匯出的 JSON 也能當暫存用、反過來也通。
 *
 * 寫入用 debounce（1 秒），避免連續打字時每個字都寫一次 localStorage。
 * localStorage 滿了就靜默放棄——這只是保護網，不應該影響正常使用。
 */
(function () {
  var KEY = "boda-bottom-autosave";
  var DEBOUNCE_MS = 1000;
  var timer = null;

  /*
   * 空白狀態（剛打開、或按了「重設」）不存，直接把暫存刪掉。
   * 否則重設之後重新整理，會「還原」出一份空白暫存，開場的工單對話框也因此不出現。
   */
  function isPristine(state) {
    if (window.Selectors.hasContent(state)) return false;
    return !state.library.some(function (icon) { return icon.custom; });
  }

  function save(store) {
    try {
      var state = store.getState();
      if (isPristine(state)) {
        localStorage.removeItem(KEY);
        return;
      }
      var json = window.ProjectFile.serialize(state);
      localStorage.setItem(KEY, json);
    } catch (e) {
      // localStorage 滿了或被停用，靜默放棄
    }
  }

  function scheduleSave(store) {
    clearTimeout(timer);
    timer = setTimeout(function () { save(store); }, DEBOUNCE_MS);
  }

  function restore(store, Actions) {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return false; }
    if (!raw) return false;
    try {
      var data = window.ProjectFile.parse(raw);
      store.beginBatch();
      window.ProjectFile.applyToStore(store, Actions, data);
      store.endBatch();
      return true;
    } catch (e) {
      // 暫存損壞，清掉重來
      try { localStorage.removeItem(KEY); } catch (_) {}
      return false;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  function mount(store) {
    store.subscribe(function () {
      scheduleSave(store);
    });
  }

  window.BottomAutoSave = {
    mount: mount,
    restore: restore,
    clear: clear,
  };
})();
