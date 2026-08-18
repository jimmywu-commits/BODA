/*
 * 中央 store（Flux 調度式）＋ undo / redo 歷史。
 *
 * 歷史為什麼可以「直接存舊的 state 參考」而不用深拷貝：
 * 所有 reducer 都是純函式、不可變更新（Object.assign 產生新物件，沒改到舊的），
 * 所以舊的 state 物件永遠不會被後續操作污染，存參考就等於存快照。
 * 上傳的 base64 圖也因為結構共享只有一份，50 步歷史不會把記憶體吃爆。
 */
(function () {
  var HISTORY_LIMIT = 50;

  // 同一欄連續打字合併成一步。不合併的話 undo 會一個字一個字倒退，很難用。
  var COALESCE_MS = 700;

  // 這些不是「使用者的編輯行為」，不該進歷史
  var NON_UNDOABLE = {
    "@@INIT": true,
    SET_LIBRARY: true, // 開機載入內建 + localStorage 素材
  };

  function createStore(reducer, preloadedState) {
    var state = preloadedState;
    var listeners = [];

    var past = [];
    var future = [];
    var lastRecord = null; // { type, index, time } 用來判斷要不要合併

    // 批次：把一連串 dispatch 併成單一步歷史（例如載入進度存檔會連發十幾個 action）
    var batchDepth = 0;
    var batchBase = null;
    var batchTouched = false;

    function getState() {
      return state;
    }

    function notify(action) {
      listeners.slice().forEach(function (listener) {
        listener(state, action);
      });
    }

    function pushPast(snapshot) {
      past.push(snapshot);
      if (past.length > HISTORY_LIMIT) past.shift();
    }

    function record(prevState, action) {
      var TYPES = window.Actions.types;
      var now = Date.now();

      // 兩種都是「連續打字」，同一格短時間內的連打合併成一步 undo
      var isTyping =
        action.type === TYPES.SET_SLOT_TEXT || action.type === TYPES.SET_SLOT_ICON_TEXT;

      var coalesce =
        isTyping &&
        lastRecord &&
        lastRecord.type === action.type &&
        lastRecord.index === action.index &&
        now - lastRecord.time < COALESCE_MS;

      // 合併時不推新的一步——堆疊頂端那筆已經是「這一輪打字開始前」的狀態
      if (!coalesce) pushPast(prevState);

      future.length = 0;
      lastRecord = { type: action.type, index: action.index, time: now };
    }

    function dispatch(action) {
      var prev = state;
      var next = reducer(state, action);

      if (next !== prev && !NON_UNDOABLE[action.type]) {
        if (batchDepth > 0) batchTouched = true;
        else record(prev, action);
      }

      state = next;

      // 批次進行中先不通知，避免面板重繪十幾次；結束時統一發一次
      if (batchDepth === 0) notify(action);
      return action;
    }

    function beginBatch() {
      if (batchDepth === 0) {
        batchBase = state;
        batchTouched = false;
      }
      batchDepth++;
    }

    function endBatch() {
      if (batchDepth === 0) return;
      batchDepth--;
      if (batchDepth > 0) return;

      if (batchTouched && batchBase !== state) {
        pushPast(batchBase);
        future.length = 0;
      }
      batchBase = null;
      batchTouched = false;
      lastRecord = null; // 批次之後不跟後續打字合併
      notify({ type: "@@BATCH" });
    }

    function undo() {
      if (!past.length) return false;
      future.push(state);
      state = past.pop();
      lastRecord = null;
      notify({ type: "@@UNDO" });
      return true;
    }

    function redo() {
      if (!future.length) return false;
      pushPast(state);
      state = future.pop();
      lastRecord = null;
      notify({ type: "@@REDO" });
      return true;
    }

    function subscribe(listener) {
      listeners.push(listener);
      return function unsubscribe() {
        var idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }

    dispatch({ type: "@@INIT" });

    return {
      getState: getState,
      dispatch: dispatch,
      subscribe: subscribe,
      undo: undo,
      redo: redo,
      canUndo: function () { return past.length > 0; },
      canRedo: function () { return future.length > 0; },
      beginBatch: beginBatch,
      endBatch: endBatch,
      historyDepth: function () { return { past: past.length, future: future.length }; },
    };
  }

  window.createStore = createStore;
  window.store = createStore(window.rootReducer, window.INITIAL_STATE);
})();
