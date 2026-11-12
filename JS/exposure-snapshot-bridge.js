/* Complete exposure backups without creating another editor just to read state. */
(function (root) {
  'use strict';
  var staged = null;
  var generation = 0;
  var applying = null;
  var savedStore = null;
  function frameWindow(frame) {
    try { return frame && frame.contentWindow; } catch (_) { return null; }
  }
  function getPlugin(frame) {
    try { var win = frameWindow(frame); return win && win._bnStatePlugin; } catch (_) { return null; }
  }
  function portableResult(state, note) {
    return Promise.resolve(root.BodaStateAssets && typeof root.BodaStateAssets.toPortable === 'function' ? root.BodaStateAssets.toPortable(state) : state).then(function (portable) {
      return { state: portable, note: note || '' };
    });
  }
  function readyPlugin(frame) {
    var deadline = Date.now() + 15000;
    return new Promise(function (resolve, reject) {
      function check() {
        var plugin = getPlugin(frame);
        if (plugin && typeof plugin.collect === 'function' && typeof plugin.apply === 'function') {
          Promise.resolve(typeof plugin.whenReady === 'function' ? plugin.whenReady() : null).then(function () { resolve(plugin); }, reject);
        } else if (Date.now() >= deadline) reject(new Error('曝光編輯器尚未就緒，完整編輯資料仍保留等待還原'));
        else root.setTimeout(check, 60);
      }
      check();
    });
  }
  function collect(options) {
    options = options || {};
    if (staged) return portableResult(staged, '');
    var plugin = getPlugin(options.frame);
    if (plugin) {
      return readyPlugin(options.frame).then(function (ready) {
        var win = frameWindow(options.frame);
        /* Pull current live-canvas geometry before collecting the portable
           snapshot. Backup remains available when local storage is full. */
        return Promise.resolve(win && typeof win._bnSyncLayoutSnapshot === 'function' ? win._bnSyncLayoutSnapshot(1600) : null).then(function () {
          var state = ready.collect();
          if (state) state._bodaProjectId = options.projectId || state._bodaProjectId || '';
          return portableResult(state, '');
        });
      });
    }
    if (!root.BodaStateAssets) return Promise.resolve({ state: null, note: '曝光編輯器未開啟，且無法讀取保存的曝光編輯資料。' });
    if (!savedStore) savedStore = root.BodaStorageOwnership.wrap(root.BodaStateAssets.create({ dbName: 'bn_editor_state_db', stateStore: 'states', assetStore: 'assets', key: 'current', dbVersion: 2 }), 'bn_editor_state_db:current');
    return savedStore.get().then(function (state) {
      if (!state) return { state: null, note: '' };
      if (state._bodaProjectId && state._bodaProjectId === options.projectId)
        return portableResult(state, '');
      return { state: null, note: '保存的曝光編輯未能確認屬於目前專案；請開啟曝光資源確認後再建立完整備份。' };
    });
  }
  function stage(state) {
    generation++;
    staged = state && typeof state === 'object' ? state : null;
    root.__bodaPendingExposureRestore = !!staged;
  }
  function apply(frame, options) {
    options = options || {};
    if (!staged) return Promise.resolve(false);
    if (applying) return applying;
    var state = staged;
    var version = generation;
    applying = readyPlugin(frame).then(function (plugin) {
      if (version !== generation) return false;
      state._bodaProjectId = options.projectId || state._bodaProjectId || '';
      plugin.apply(state, { source: 'upload', forceColors: true });
      if (typeof plugin.markDirty === 'function') plugin.markDirty();
      // Once applied, the canonical editor owns the state. A storage failure must
      // not replay this old snapshot over edits made after the restore.
      staged = null;
      root.__bodaPendingExposureRestore = false;
      if (typeof plugin.flush === 'function') return Promise.resolve(plugin.flush({ force: true })).then(function () { return true; }, function (error) {
        error.restoreApplied = true;
        throw error;
      });
      return true;
    });
    return applying.then(function (value) {
      applying = null;
      if (staged && version !== generation) return apply(frame, options);
      return value;
    }, function (error) { applying = null; throw error; });
  }
  root.BodaExposureSnapshots = { collect: collect, stage: stage, apply: apply,
    pending: function () { return !!staged; }, clear: function () { stage(null); } };
})(window);
