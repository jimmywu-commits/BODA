/* Hold an origin-wide Web Lock before reading a mutable draft. A tab which
   loses ownership must reload, not retry writing its potentially stale copy. */
(function (root) {
  'use strict';
  if (root.BodaStorageOwnership) return;
  var owners = new Map();
  function conflict(message, reason) {
    var error = new Error(message);
    error.name = 'StorageOwnershipError'; error.code = reason;
    error.noAutomaticRetry = true;
    return error;
  }
  function create(name) {
    name = String(name);
    if (owners.has(name)) return owners.get(name);
    var acquisition = null, releaseLock = null, failure = null, owned = false, released = false, active = 0;
    function finishRelease() {
      if (released && !active && releaseLock) { releaseLock(); releaseLock = null; }
    }
    function acquire() {
      if (failure) return Promise.reject(failure);
      if (released) return Promise.reject(conflict('本頁已釋放暫存權限，請重新載入再編輯。', 'released'));
      if (acquisition) return acquisition;
      acquisition = new Promise(function (resolve, reject) {
        if (!root.navigator || !root.navigator.locks || !root.navigator.locks.request) {
          failure = conflict('瀏覽器無法提供多分頁暫存保護，自動暫存已停用；請下載備份，並改用支援 Web Locks 的瀏覽器。', 'unsupported');
          reject(failure); return;
        }
        try {
          var request = root.navigator.locks.request('boda-draft:' + name, { mode: 'exclusive', ifAvailable: true }, function (lock) {
            if (!lock || released) {
              failure = conflict('另一個分頁正在編輯此工具的暫存。本頁不會覆寫；請先下載本頁備份，關閉另一頁，再重新載入本頁。', 'other-tab');
              reject(failure); return;
            }
            owned = true;
            return new Promise(function (release) { releaseLock = release; resolve(); });
          });
          Promise.resolve(request).catch(function (error) {
            if (!failure) failure = conflict('無法取得暫存寫入權限，請下載備份後重新載入。' + (error && error.message ? ' ' + error.message : ''), 'lock-failed');
            owned = false; reject(failure);
          });
        } catch (error) {
          failure = conflict('無法取得暫存寫入權限，請下載備份後重新載入。', 'lock-failed');
          reject(failure);
        }
      });
      return acquisition;
    }
    function check() {
      return acquire().then(function () {
        if (!owned || released) throw failure || conflict('暫存權限已失效，請重新載入。', 'released');
      });
    }
    var owner = {
      acquire: check,
      run: function (operation) {
        return check().then(function () {
          if (released) throw conflict('暫存權限已失效，請重新載入。', 'released');
          active++;
          return Promise.resolve().then(operation).then(function (value) {
            active--; finishRelease(); return value;
          }, function (error) { active--; finishRelease(); throw error; });
        });
      },
      release: function () {
        released = true; owned = false;
        finishRelease();
      },
      status: function () { return { owned: owned, released: released, error: failure ? failure.message : '', reason: failure ? failure.code : '' }; }
    };
    owners.set(name, owner);
    return owner;
  }
  function wrap(store, name) {
    var owner = create(name), result = {};
    Object.keys(store).forEach(function (key) { result[key] = store[key]; });
    ['get', 'put', 'clear'].forEach(function (method) {
      if (typeof store[method] !== 'function') return;
      result[method] = function () {
        var args = arguments;
        return owner.run(function () { return store[method].apply(store, args); });
      };
    });
    result.ownership = owner;
    return result;
  }
  /* Do not release on visibilitychange: hidden tabs may still write. A bfcache
     restored page remains read-only until reloaded, preventing stale replay. */
  if (root.addEventListener) root.addEventListener('pagehide', function () { owners.forEach(function (owner) { owner.release(); }); });
  root.BodaStorageOwnership = { create: create, wrap: wrap };
})(typeof window !== 'undefined' ? window : globalThis);
