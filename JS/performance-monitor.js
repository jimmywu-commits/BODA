(function () {
  'use strict';

  var CHANNEL = 'boda-performance-v1';
  var LIMIT = 6000;
  var VERSION = 1;
  var channel = null;
  var sessionId = newSessionId();
  var events = [];
  var sources = Object.create(null);
  var dropped = 0;
  var received = 0;
  var startedAt = 0;
  var wantedRecording = false;
  var pendingConnection = false;
  var dirty = true;
  var lastSilent = false;
  var pendingExport = null;
  var exportSync = null;
  var ui = Object.create(null);
  var labels = {
    resource: '資源', longtask: '長任務', lag: '延遲', memory: 'JS heap', frame: 'iframe',
    workflow: '流程完成', 'workflow-start': '流程開始', navigation: '頁面載入',
    error: '錯誤', interaction: '操作', lifecycle: '頁面狀態', mark: '步驟標記'
  };
  var markNames = { upload: '上傳工單／圖片', exposure: '切換曝光資源', background: '更換背景', shadow: '調整商品影子', activity: '切換活動頁', export: '匯出檔案' };

  function newSessionId() {
    return 'boda-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  function byId(id) { return document.getElementById(id); }
  function put(id, value) { if (ui[id]) ui[id].textContent = String(value); }
  function finite(value, fallback) { var n = Number(value); return isFinite(n) ? n : (fallback == null ? 0 : fallback); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clock(value) {
    var date = new Date(value || Date.now());
    return date.toLocaleTimeString('zh-TW', { hour12: false });
  }
  function duration(value) {
    var n = finite(value);
    return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 1 : 2) + ' s' : Math.round(n) + ' ms';
  }
  function bytes(value) {
    var n = finite(value);
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MiB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KiB';
    return Math.round(n) + ' B';
  }
  function cleanUrl(value) {
    var text = String(value == null ? '' : value);
    if (/^(data|blob):/i.test(text)) return '[已移除圖片／二進位資料]';
    return text.replace(/[?#].*$/, '').slice(0, 1200);
  }
  function cleanString(value) {
    var text = String(value);
    if (/^(data|blob):/i.test(text) || /;base64,/i.test(text)) return '[已移除圖片／二進位資料]';
    return text.replace(/(?:https?:\/\/|file:\/\/\/)[^\s<>"']+/gi, cleanUrl).slice(0, 1600);
  }
  function sanitize(value, depth, key) {
    if (depth > 6) return '[過深資料已省略]';
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return /url|href|resource|^src$/i.test(key || '') ? cleanUrl(value) : cleanString(value);
    if (Array.isArray(value)) return value.slice(0, 300).map(function (item) { return sanitize(item, depth + 1, key); });
    if (typeof value === 'object') {
      var out = {};
      Object.keys(value).slice(0, 80).forEach(function (name) {
        if (/^(?:__proto__|prototype|constructor|image|images|baseSrc|dataUrl|baseUrl|buffer|body|text|content|html|stack|textContent|innerHTML|outerHTML|canvas|fileContent|workbook|rows|fields|filename|fileName|workOrderName|activityName|errorMessage|message)$/i.test(name)) return;
        out[name] = sanitize(value[name], depth + 1, name);
      });
      return out;
    }
    return undefined;
  }
  function shorten(value) {
    var safe = cleanUrl(value);
    try { var parsed = new URL(safe, location.href); return decodeURIComponent(parsed.pathname).replace(/^.*\/(js|JS|fonts|html|img)\//, '$1/'); }
    catch (_) { return safe; }
  }
  function notice(text) {
    ui['action-notice'].textContent = text;
    ui['action-notice'].hidden = !text;
  }
  function post(action, extra) {
    if (!channel) return false;
    var message = { type: 'boda-perf-control', action: action, sessionId: sessionId, options: { resourceDetails: true } };
    Object.keys(extra || {}).forEach(function (key) { message[key] = extra[key]; });
    channel.postMessage(message);
    return true;
  }
  function sourceFor(message) {
    var key = String(message.sourceId || 'main').slice(0, 120);
    if (!sources[key] && Object.keys(sources).length >= 64) {
      var oldest = Object.keys(sources).sort(function (a, b) { return sources[a].lastSeen - sources[b].lastSeen; })[0];
      delete sources[oldest];
    }
    if (!sources[key]) sources[key] = { id: key, hello: {}, status: {}, lastSeen: 0, events: 0 };
    sources[key].lastSeen = Date.now();
    return sources[key];
  }
  function addEvent(raw, source, envelopeTime) {
    if (!raw || typeof raw !== 'object') return;
    var event = sanitize(raw, 0, '');
    event.kind = String(event.kind || 'lifecycle');
    event.name = event.kind === 'resource' ? cleanUrl(event.name || '') : cleanString(event.name || '');
    event.sourceId = source.id;
    event.receivedAt = finite(envelopeTime, Date.now());
    if (event.receivedAt < 100000000000) event.receivedAt = Date.now();
    events.push(event);
    source.events++;
    received++;
    if (events.length > LIMIT) { var extra = events.length - LIMIT; events.splice(0, extra); dropped += extra; }
  }
  function receive(event) {
    var message = event && event.data;
    if (!message || message.type !== 'boda-perf') return;
    if (String(message.sessionId || '') !== sessionId) return;
    var source = sourceFor(message);
    pendingConnection = false;
    if (message.kind === 'event') addEvent(message.data, source, message.time);
    else if (message.kind === 'batch') {
      var batch = message.data && message.data.events;
      if (Array.isArray(batch)) batch.slice(0, 300).forEach(function (item) { addEvent(item, source, message.time); });
    } else if (message.kind === 'hello') {
      source.hello = sanitize(message.data || {}, 0, '');
      if (message.data && typeof message.data.recording === 'boolean') wantedRecording = message.data.recording;
    } else if (message.kind === 'status') {
      source.status = sanitize(message.data || {}, 0, '');
      if (message.data && typeof message.data.recording === 'boolean') wantedRecording = message.data.recording;
      if (!startedAt && message.data && message.data.startedAt) startedAt = finite(message.data.startedAt);
    }
    dirty = true;
    if (pendingExport && message.kind === 'status' && finite(message.time) >= pendingExport.requestedAt) {
      pendingExport.waiting.delete(source.id);
      if (!pendingExport.waiting.size) finishExport(false);
    }
  }
  function allSources() { return Object.keys(sources).map(function (key) { return sources[key]; }); }
  function stats() {
    var result = { longTasks: 0, longTaskMs: 0, maxLongTask: 0, maxLag: 0, resourceCount: 0, transferBytes: 0, zeroTransfer: 0, likelyCached: 0, workflows: Object.create(null), workflowCount: 0, memory: null, maxHeap: 0, frames: null, maxFrames: 0, resources: [], resourceGroups: Object.create(null), sdkDropped: 0, errors: 0 };
    events.forEach(function (event) {
      var detail = event.detail || {};
      if (event.kind === 'longtask') {
        result.longTasks++; result.longTaskMs += finite(event.duration); result.maxLongTask = Math.max(result.maxLongTask, finite(event.duration));
      } else if (event.kind === 'lag') result.maxLag = Math.max(result.maxLag, finite(detail.lag, finite(detail.delay, finite(event.duration))));
      else if (event.kind === 'resource') {
        result.resourceCount++; result.transferBytes += finite(detail.transferSize);
        if (finite(detail.transferSize) === 0) {
          result.zeroTransfer++;
          if (finite(detail.decodedBodySize) > 0 || finite(detail.encodedBodySize) > 0) result.likelyCached++;
        }
        result.resources.push(event);
        var resourceUrl = cleanUrl(event.name || detail.url || '未提供網址');
        if (!result.resourceGroups[resourceUrl]) result.resourceGroups[resourceUrl] = { url: resourceUrl, count: 0, totalDuration: 0, maxDuration: 0, transferBytes: 0, maxEncodedBytes: 0 };
        var group = result.resourceGroups[resourceUrl];
        group.count++; group.totalDuration += finite(event.duration); group.maxDuration = Math.max(group.maxDuration, finite(event.duration));
        group.transferBytes += finite(detail.transferSize); group.maxEncodedBytes = Math.max(group.maxEncodedBytes, finite(detail.encodedBodySize));
      } else if (event.kind === 'memory') {
        if (detail.usedJSHeapSize != null) result.memory = detail;
        else if (event.usedJSHeapSize != null) result.memory = event;
        result.maxHeap = Math.max(result.maxHeap, finite(result.memory && result.memory.usedJSHeapSize));
      } else if (event.kind === 'frame') {
        if (detail.count != null || detail.total != null) result.frames = detail;
        result.maxFrames = Math.max(result.maxFrames, finite(detail.count, finite(detail.total)));
      } else if (event.kind === 'workflow' && event.duration != null) {
        var name = event.name || '未命名流程';
        if (!result.workflows[name]) result.workflows[name] = { name: name, count: 0, total: 0, max: 0 };
        var workflow = result.workflows[name];
        workflow.count++; workflow.total += finite(event.duration); workflow.max = Math.max(workflow.max, finite(event.duration)); result.workflowCount++;
      } else if (event.kind === 'error') result.errors++;
    });
    /* SDK 統計包含已截斷的事件；單一主要來源時採其累計，避免把抽樣表當完整紀錄。 */
    var connected = allSources();
    connected.forEach(function (source) {
      var status = source.status || {}, metrics = status.metrics || {};
      var types = status.capabilities && status.capabilities.entryTypes;
      if (Array.isArray(types)) result.longTaskSupported = !!result.longTaskSupported || types.indexOf('longtask') >= 0;
      result.sdkDropped += finite(metrics.dropped);
      if (status.memory && status.memory.usedJSHeapSize != null) result.memory = status.memory;
      if (status.frames && status.frames.count != null) result.frames = status.frames;
      result.maxHeap = Math.max(result.maxHeap, finite(metrics.maxHeap), finite(status.memory && status.memory.usedJSHeapSize));
      result.maxFrames = Math.max(result.maxFrames, finite(metrics.maxFrames), finite(status.frames && status.frames.count));
      if (connected.length === 1) {
        result.longTasks = Math.max(result.longTasks, finite(metrics.longTasks));
        result.longTaskMs = Math.max(result.longTaskMs, finite(metrics.longTaskMs));
        result.maxLag = Math.max(result.maxLag, finite(metrics.maxLag));
        result.resourceCount = Math.max(result.resourceCount, finite(metrics.resources));
        result.transferBytes = Math.max(result.transferBytes, finite(metrics.transferBytes));
        result.zeroTransfer = Math.max(result.zeroTransfer, finite(metrics.resourceZeroTransfer));
        result.workflowCount = Math.max(result.workflowCount, finite(metrics.workflowCount));
        result.errors = Math.max(result.errors, finite(metrics.errors));
      }
    });
    result.resources.sort(function (a, b) { return finite(b.duration) - finite(a.duration); });
    result.repeatedResources = Object.keys(result.resourceGroups).map(function (key) { return result.resourceGroups[key]; }).filter(function (item) { return item.count > 1; }).sort(function (a, b) { return b.count - a.count || b.totalDuration - a.totalDuration; });
    return result;
  }
  function insights(data) {
    var result = [];
    var largest = data.resources.filter(function (event) { return finite((event.detail || {}).transferSize) > 0; }).sort(function (a, b) {
      return finite((b.detail || {}).transferSize) - finite((a.detail || {}).transferSize);
    })[0];
    if (largest) result.push({ title: '最大單筆已知傳輸', observation: shorten(largest.name) + ' · ' + bytes((largest.detail || {}).transferSize) + ' · ' + duration(largest.duration), lead: '可優先檢查是否需要在進站時載入，或可延後、壓縮。傳輸量 0 的項目無法據此排名大小。' });
    if (data.repeatedResources.length) {
      var repeat = data.repeatedResources[0];
      result.push({ title: '同一資源出現多次', observation: shorten(repeat.url) + ' · ' + repeat.count + ' 次 · 已知累計傳輸 ' + bytes(repeat.transferBytes), lead: '已去除 query／hash 後計數。可能來自不同 iframe、重新整理或參數版本；僅此數字不能判定快取失效。' });
    }
    var workflows = Object.keys(data.workflows).map(function (key) { return data.workflows[key]; }).sort(function (a, b) { return b.max - a.max; });
    if (workflows.length) result.push({ title: '最慢的完成流程', observation: workflows[0].name + ' · 最慢 ' + duration(workflows[0].max) + ' · ' + workflows[0].count + ' 次', lead: '對照同時間的步驟標記、長任務與資源，確認時間花在下載、解碼或重繪；流程耗時本身不能區分原因。' });
    if (data.longTasks || data.maxLag) result.push({ title: '操作卡頓線索', observation: '長任務 ' + data.longTasks + ' 次 · 最高延遲 ' + duration(data.maxLag), lead: '可優先比對操作時間點。背景分頁節流、系統負載與開啟開發工具都可能影響結果，不能直接等同 CPU 過弱。' });
    if (data.frames) result.push({ title: '同時存在的畫布框架', observation: '目前 ' + finite(data.frames.count) + ' 個 iframe · 已知最高 ' + data.maxFrames + ' 個', lead: 'iframe 數持續增加時，可檢查是否保留了離開的預覽。數量不等於實際記憶體；須搭配 heap 與操作結果判讀。' });
    return result;
  }
  function rowsOrEmpty(id, rows, columns, emptyText) {
    ui[id].innerHTML = rows.length ? rows.join('') : '<tr><td colspan="' + columns + '" class="empty">' + esc(emptyText) + '</td></tr>';
  }
  function render() {
    var currentSources = allSources();
    var silent = wantedRecording && currentSources.length > 0 && currentSources.every(function (source) { return Date.now() - source.lastSeen > 20000; });
    if (silent !== lastSilent) { lastSilent = silent; dirty = true; }
    if (!dirty) return;
    dirty = false;
    var list = allSources(), count = list.length, data = stats();
    var connected = count > 0;
    put('connection-status', silent ? '超過 20 秒未收到回應' : connected ? (wantedRecording ? '正在紀錄' : '已連接 · 紀錄已暫停') : (pendingConnection ? '等待 BODA 回應' : '尚未連接'));
    ui['connection-dot'].className = 'dot ' + (silent ? 'waiting' : connected ? 'connected' : pendingConnection ? 'waiting' : '');
    put('connection-note', connected ? count + ' 個來源 · 最近回應 ' + clock(Math.max.apply(null, list.map(function (source) { return source.lastSeen; }))) : (pendingConnection ? '請在同一網站的 BODA 頁面繼續操作；舊頁若尚未載入監測程式，需重新整理。' : '請先開啟 BODA，或連接同一網站中已載入監測程式的 BODA。'));
    if (silent) put('connection-note', 'BODA 可能正在忙碌、受到背景節流或已關閉；最後收到的紀錄仍可匯出。');
    put('session-label', '工作階段 ' + sessionId);
    put('capture-note', '已接收 ' + received.toLocaleString() + ' 筆 · 保留 ' + events.length.toLocaleString() + ' 筆' + ((dropped || data.sdkDropped) ? ' · 已截斷 ' + (dropped + data.sdkDropped).toLocaleString() + ' 筆（含 SDK 未傳送）' : ''));
    ui['toggle-recording'].disabled = !connected;
    ui['take-snapshot'].disabled = !connected;
    if (ui['mark-step']) ui['mark-step'].disabled = !connected || !wantedRecording;
    put('toggle-recording', wantedRecording ? '暫停紀錄' : '繼續紀錄');
    ui['export-json'].disabled = !!pendingExport || (!connected && !events.length);
    ui['export-csv'].disabled = !!pendingExport || (!connected && !events.length);
    put('metric-longtask', connected || events.length ? data.longTasks.toLocaleString() + ' 次' : '—');
    put('metric-longtask-note', '累計 ' + duration(data.longTaskMs) + ' · 已收事件最長 ' + duration(data.maxLongTask));
    if (data.longTaskSupported === false && !data.longTasks) {
      put('metric-longtask', '無法取得');
      put('metric-longtask-note', '瀏覽器未提供 Long Task，請搭配延遲與流程耗時');
    }
    put('metric-lag', connected || events.length ? duration(data.maxLag) : '—');
    put('metric-memory', data.memory ? bytes(data.memory.usedJSHeapSize) : (connected ? '無法取得' : '—'));
    put('metric-memory-note', data.memory ? '已知最高 ' + bytes(data.maxHeap) + ' · JS heap 上限 ' + bytes(data.memory.jsHeapSizeLimit) : '瀏覽器未提供 JS heap，仍可比較長任務與延遲');
    put('metric-frames', data.frames ? String(finite(data.frames.count, finite(data.frames.total))) : '—');
    put('metric-frames-note', data.frames ? '可讀取 ' + finite(data.frames.sameOrigin) + ' · 不可讀 ' + finite(data.frames.inaccessible) + (data.frames.limited ? ' · 已達掃描上限' : '') : '等待畫布現況');
    var clues = insights(data);
    ui['insight-list'].innerHTML = clues.length ? clues.map(function (clue) {
      return '<article class="insight"><h3>' + esc(clue.title) + '</h3><p><strong>觀察：</strong>' + esc(clue.observation) + '</p><p class="subtle"><strong>檢查方向：</strong>' + esc(clue.lead) + '</p></article>';
    }).join('') : '<p class="empty">有量測資料後，這裡會整理較大的資源、重複載入與較慢的流程。</p>';
    put('resource-count', data.resourceCount.toLocaleString() + ' 筆');
    put('resource-transfer', bytes(data.transferBytes));
    put('resource-cache', data.likelyCached + ' 筆（推估）');
    put('resource-scope', data.zeroTransfer + ' 筆傳輸量為 0');
    rowsOrEmpty('resource-rows', data.resources.slice(0, 12).map(function (event) {
      var url = event.name || (event.detail || {}).url || '';
      return '<tr><td class="path" title="' + esc(url) + '">' + esc(shorten(url)) + '</td><td class="num">' + esc(duration(event.duration)) + '</td><td class="num">' + esc(bytes((event.detail || {}).transferSize)) + '</td></tr>';
    }), 3, '開始紀錄後，這裡會顯示載入最慢的資源。');
    var workflows = Object.keys(data.workflows).map(function (key) { return data.workflows[key]; }).sort(function (a, b) { return b.max - a.max; });
    put('workflow-count', data.workflowCount.toLocaleString() + ' 筆');
    rowsOrEmpty('workflow-rows', workflows.slice(0, 60).map(function (workflow) {
      return '<tr><td>' + esc(workflow.name) + '</td><td class="num">' + workflow.count + '</td><td class="num">' + esc(duration(workflow.total / workflow.count)) + '</td><td class="num">' + esc(duration(workflow.max)) + '</td></tr>';
    }), 4, '尚未收到完成的流程量測。');
    var filter = ui['event-filter'].value;
    var visible = events.filter(function (event) { return filter === 'all' || event.kind === filter; });
    put('event-count', visible.length.toLocaleString() + ' 筆 · 顯示最近 100 筆');
    rowsOrEmpty('event-rows', visible.slice(-100).reverse().map(function (event) {
      var value = event.duration != null ? duration(event.duration) : '—', detail = event.detail || {};
      if (event.kind === 'memory' && detail.usedJSHeapSize != null) value = bytes(detail.usedJSHeapSize);
      if (event.kind === 'frame' && detail.count != null) value = detail.count + ' 個';
      return '<tr><td>' + esc(clock(event.time > 100000000000 ? event.time : (event.at > 100000000000 ? event.at : event.receivedAt))) + '</td><td>' + esc(labels[event.kind] || event.kind) + '</td><td class="event-name">' + esc(event.kind === 'resource' ? shorten(event.name) : (event.kind === 'mark' ? markNames[event.name] || event.name : event.name)) + '</td><td class="num">' + esc(value) + '</td><td>' + esc(event.sourceId.slice(-12)) + '</td></tr>';
    }), 5, '尚無符合篩選的事件。請到 BODA 重現載入或操作卡頓。');
    put('source-count', count + ' 個來源');
    ui['source-list'].innerHTML = count ? list.map(function (source) {
      var hello = source.hello || {}, hardware = hello.hardware || {}, status = source.status || {};
      return '<div class="source-card"><div><strong>' + esc(hello.title || 'BODA') + '</strong><small>' + esc(cleanUrl(hello.url || '網址未提供')) + '</small><small>來源 ' + esc(source.id) + '</small></div><div class="source-meta">邏輯核心 ' + esc(hardware.hardwareConcurrency || '未提供') + ' · 裝置記憶體 ' + esc(hardware.deviceMemory ? hardware.deviceMemory + ' GiB（約略）' : '未提供') + '<br>收到 ' + source.events + ' 筆 · ' + (status.recording === false ? '已暫停' : '最後回應 ' + esc(clock(source.lastSeen))) + '</div></div>';
    }).join('') : '<p class="empty">尚未收到 BODA 的連線資訊。</p>';
  }
  function resetLocal() {
    if (pendingExport) { clearTimeout(pendingExport.timer); pendingExport = null; }
    exportSync = null;
    events = []; sources = Object.create(null); dropped = 0; received = 0; startedAt = Date.now(); dirty = true;
  }
  function finishExport(timedOut) {
    if (!pendingExport) return;
    var request = pendingExport;
    clearTimeout(request.timer);
    exportSync = { requestedAt: request.requestedAt, completedAt: Date.now(), timedOut: !!timedOut,
      pendingSources: Array.from(request.waiting) };
    pendingExport = null;
    request.write();
    if (timedOut) notice('已匯出最後收到的紀錄；BODA 尚未回應現況要求，報告已註記同步逾時。');
    dirty = true;
  }
  function requestExport(write) {
    if (pendingExport) return;
    var waiting = allSources().map(function (source) { return source.id; });
    if (!waiting.length || !channel) { write(); return; }
    pendingExport = { requestedAt: Date.now(), waiting: new Set(waiting), write: write, timer: null };
    pendingExport.timer = setTimeout(function () { finishExport(true); }, 2000);
    post('snapshot');
    notice('正在取得 BODA 最後的事件與現況，最多等候 2 秒。');
    dirty = true;
  }
  function download(text, mime, extension) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'BODA效能紀錄_' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + extension;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    notice('已下載效能紀錄。分享前請確認網址路徑與環境資訊。');
  }
  function snapshot() {
    var data = stats();
    return {
      format: 'boda-performance-recording', version: VERSION, exportedAt: new Date().toISOString(), sessionId: sessionId,
      startedAt: startedAt, recording: wantedRecording,
      exportSync: exportSync,
      limitations: ['JS heap 並非整體 RAM', '0 傳輸量可能為快取或跨來源計時限制', '僅量測載入監測程式的同來源頁面', 'URL query/hash 與內容欄位已移除', '重複資源、流程與排名根據保留事件，截斷後明細可能不完整', '背景分頁節流不可直接當成 CPU 卡頓', '硬體資訊為瀏覽器估計值，不是電腦是否合格的判準'],
      eventRetention: { limit: LIMIT, received: received, retained: events.length, monitorDropped: dropped, sdkDropped: data.sdkDropped, truncated: !!(dropped || data.sdkDropped) },
      summary: { longTasks: data.longTasks, longTaskSupported: data.longTaskSupported, longTaskMs: data.longTaskMs, maxLag: data.maxLag, resources: data.resourceCount, transferBytes: data.transferBytes, zeroTransfer: data.zeroTransfer, possibleCache: data.likelyCached, workflowCount: data.workflowCount, errors: data.errors, memory: data.memory, maxHeap: data.maxHeap, frames: data.frames, maxFrames: data.maxFrames },
      insights: insights(data), workflows: Object.keys(data.workflows).map(function (key) { return data.workflows[key]; }), repeatedResources: data.repeatedResources.slice(0, 100),
      sources: allSources(), events: events.slice()
    };
  }
  function csvCell(value) {
    var str = String(value == null ? '' : value);
    /* 避免外部資源名稱被 Excel 當成公式。 */
    if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
    return '"' + str.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    var data = stats(), record = snapshot();
    var rows = [['BODA 效能摘要', new Date().toISOString()], ['工作階段', sessionId], ['JS heap 不是整體 RAM'], ['事件保留上限', LIMIT], ['已接收事件', received], ['UI 移除舊事件', dropped], ['SDK 未傳送事件', data.sdkDropped], ['長任務次數', data.longTasks], ['長任務總耗時 ms', data.longTaskMs], ['最大延遲 ms', data.maxLag], ['資源數', data.resourceCount], ['已知傳輸 bytes', data.transferBytes], ['0 傳輸資源（快取或計時限制）', data.zeroTransfer], ['JS heap bytes', data.memory ? data.memory.usedJSHeapSize : '瀏覽器未提供'], ['iframe 數', data.frames ? finite(data.frames.count, finite(data.frames.total)) : '未提供'], [], ['流程', '次數', '平均 ms', '最大 ms']];
    Object.keys(data.workflows).forEach(function (key) { var item = data.workflows[key]; rows.push([key, item.count, Math.round(item.total / item.count), Math.round(item.max)]); });
    rows.push([], ['慢速資源（僅已保留明細）', '耗時 ms', '傳輸 bytes']);
    data.resources.slice(0, 30).forEach(function (event) { rows.push([event.name, finite(event.duration), finite((event.detail || {}).transferSize)]); });
    rows.push([], ['重複資源（已去除 query/hash）', '出現次數', '累計傳輸 bytes', '單次最大耗時 ms']);
    data.repeatedResources.slice(0, 100).forEach(function (item) { rows.push([item.url, item.count, item.transferBytes, item.maxDuration]); });
    rows.push([], ['判讀線索', '觀察', '檢查方向（原因待確認）']);
    insights(data).forEach(function (item) { rows.push([item.title, item.observation, item.lead]); });
    rows.push([], ['截斷狀態', record.eventRetention.truncated ? '事件已截斷，逐筆明細不完整；SDK 累計統計仍可能完整' : '未截斷']);
    if (exportSync) rows.push(['匯出同步', exportSync.timedOut ? '逾時：保留最後收到的紀錄，部分近期事件可能尚未送達' : '所有已連線來源已回傳現況']);
    download('\ufeff' + rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n'), 'text/csv;charset=utf-8', 'csv');
  }
  function init() {
    document.querySelectorAll('[id]').forEach(function (element) { ui[element.id] = element; });
    if (typeof BroadcastChannel !== 'function' || location.protocol === 'file:') {
      notice(location.protocol === 'file:' ? '請透過同一個 HTTPS 網站或 localhost 開啟本頁與 BODA。file:// 的跨視窗通訊來源不穩定，無法可靠監測。' : '此瀏覽器不支援 BroadcastChannel，請使用新版 Chrome、Edge 或 Firefox。');
      ui['open-app'].disabled = true; ui['connect-app'].disabled = true;
      render(); return;
    }
    try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = receive; }
    catch (_) { notice('無法建立同來源監測連線，請檢查瀏覽器的隱私設定。'); ui['open-app'].disabled = true; ui['connect-app'].disabled = true; render(); return; }
    ui['open-app'].addEventListener('click', function () {
      post('stop');
      resetLocal(); sessionId = newSessionId(); wantedRecording = true; pendingConnection = true;
      var opened = window.open('./index.html?bodaPerf=1&bodaPerfSession=' + encodeURIComponent(sessionId), '_blank');
      try { if (opened) opened.opener = null; } catch (_) {}
      notice(opened ? '請在 BODA 完成需要測量的操作，再回來匯出紀錄。' : '瀏覽器阻擋了新視窗。請允許彈出視窗後再試。');
      if (!opened) { pendingConnection = false; wantedRecording = false; }
      dirty = true;
    });
    ui['connect-app'].addEventListener('click', function () {
      if (!startedAt) startedAt = Date.now();
      wantedRecording = true; pendingConnection = true; post('start'); dirty = true;
      notice('已送出連線要求。同來源且已載入監測程式的 BODA 會回傳資訊；舊頁可能需要重新整理。');
    });
    ui['toggle-recording'].addEventListener('click', function () { wantedRecording = !wantedRecording; post(wantedRecording ? 'start' : 'stop'); dirty = true; });
    ui['take-snapshot'].addEventListener('click', function () { post('snapshot'); notice('已要求 BODA 回傳目前的記憶體、iframe 與累計統計。'); });
    ui['clear-recording'].addEventListener('click', function () { post('clear'); resetLocal(); post('snapshot'); notice('已清除本次紀錄；BODA 作品與工單保持原狀。'); });
    if (ui['mark-step']) ui['mark-step'].addEventListener('click', function () {
      var step = ui['step-marker'].value;
      if (!Object.prototype.hasOwnProperty.call(markNames, step)) return;
      post('mark', { name: step }); notice('已標記「' + markNames[step] + '」，請切回 BODA 執行這一步。');
    });
    ui['export-json'].addEventListener('click', function () { requestExport(function () { download(JSON.stringify(snapshot(), null, 2), 'application/json;charset=utf-8', 'json'); }); });
    ui['export-csv'].addEventListener('click', function () { requestExport(exportCsv); });
    ui['event-filter'].addEventListener('change', function () { dirty = true; });
    window.addEventListener('pagehide', function () { if (channel) { post('stop'); channel.close(); channel = null; } });
    window.addEventListener('pageshow', function (event) {
      if (!event.persisted || channel) return;
      try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = receive; }
      catch (_) { notice('請重新整理本頁以恢復監測連線。'); return; }
      wantedRecording = false; pendingConnection = false; dirty = true;
      notice('監測頁已恢復；請按「連接已開啟的 BODA」繼續紀錄。');
    });
    render(); setInterval(render, 1000);
  }
  init();
})();
