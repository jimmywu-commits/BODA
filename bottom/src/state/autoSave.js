/*
 * 本機自動暫存：每次編輯後自動存到 localStorage，重新整理不會掉。
 *
 * 用的是和「進度存檔.json」完全相同的序列化格式（ProjectFile.serialize），
 * 所以即使手動匯出的 JSON 也能當暫存用、反過來也通。
 *
 * 寫入用 debounce（1 秒），避免連續打字時每個字都寫一次 localStorage。
 * 嵌入 BODA 時由父頁 IDB 唯一管理，不重複序列化／讀寫 localStorage。
 * 獨立模式先取得跨分頁鎖；不支援或被別頁占用時只停用暫存，保留手動備份。
 */
(function () {
  var KEY = "boda-bottom-autosave";
  var DEBOUNCE_MS = 1000;
  var timer = null;
  var parentManaged = false;
  try {
    var embed = new URLSearchParams(window.location.search).get('embed');
    parentManaged = window.parent !== window && !!window.parent.BodaStateAssets &&
      /^(generator|standalone|import-preview)$/.test(embed || '');
  } catch (_) {}
  var owner = null;

  function showStatus(message) {
    var notice = document.getElementById('bottom-autosave-warning');
    if (!message) { if (notice) notice.remove(); return; }
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'bottom-autosave-warning';
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:10000;padding:12px;background:#fff3cd;color:#663c00;border:1px solid #d39e00;border-radius:6px;font:14px sans-serif;';
      document.body.appendChild(notice);
    }
    notice.textContent = '自動暫存未完成：' + message + ' 請使用下載功能保存進度存檔。';
  }

  function withOwnership(operation) {
    if (!window.BodaStorageOwnership) return Promise.reject(new Error('暫存保護元件未載入，請重新載入頁面。'));
    if (!owner) owner = window.BodaStorageOwnership.create(KEY);
    return owner.run(operation);
  }

  /*
   * 空白狀態（剛打開、或按了「重設」）不存，直接把暫存刪掉。
   * 否則重設之後重新整理，會「還原」出一份空白暫存，開場的工單對話框也因此不出現。
   */
  function isPristine(state) {
    if (window.Selectors.hasContent(state)) return false;
    return !state.library.some(function (icon) { return icon.custom; });
  }

  function save(store) {
    if (parentManaged) return Promise.resolve();
    return withOwnership(function () {
      var state = store.getState();
      if (isPristine(state)) {
        localStorage.removeItem(KEY);
        showStatus('');
        return;
      }
      var json = window.ProjectFile.serialize(state);
      localStorage.setItem(KEY, json);
      showStatus('');
    }).catch(function (error) { showStatus(error.message || String(error)); });
  }

  function scheduleSave(store) {
    if (parentManaged) return;
    clearTimeout(timer);
    timer = setTimeout(function () { return save(store); }, DEBOUNCE_MS);
  }

  function restore(store, Actions) {
    if (parentManaged) return Promise.resolve(false);
    return withOwnership(function () {
    var raw;
    raw = localStorage.getItem(KEY);
    if (!raw) return false;
    try {
      var data = window.ProjectFile.parse(raw);
      store.beginBatch();
      try { window.ProjectFile.applyToStore(store, Actions, data); }
      finally { store.endBatch(); }
      return true;
    } catch (e) {
      // 暫存損壞，清掉重來
      try { localStorage.removeItem(KEY); } catch (_) {}
      showStatus('舊暫存無法還原，已停止使用損壞的資料。');
      return false;
    }
    }).catch(function (error) { showStatus(error.message || String(error)); return false; });
  }

  function clear() {
    clearTimeout(timer);
    if (parentManaged) return Promise.resolve();
    return withOwnership(function () { localStorage.removeItem(KEY); showStatus(''); })
      .catch(function (error) { showStatus(error.message || String(error)); });
  }

  function mount(store) {
    if (parentManaged) return;
    store.subscribe(function () {
      scheduleSave(store);
    });
  }

  window.BottomAutoSave = {
    mount: mount,
    restore: restore,
    clear: clear,
    isParentManaged: function () { return parentManaged; },
  };
})();
