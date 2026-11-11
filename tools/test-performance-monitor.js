'use strict';

/* Real-browser SDK checks without loading BODA's images, fonts or editor iframes.
 * Run: node tools/test-performance-monitor.js
 * Optional: BODA_TEST_BROWSER=/absolute/path/to/chrome-or-edge
 * Requires Node 22+ (built-in WebSocket) and a local Chrome/Edge installation.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sdkPath = path.join(root, 'JS', 'performance-agent.js');
const channelName = 'boda-performance-v1';
const sessionId = 'performance-sdk-test';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function findBrowser() {
  const candidates = [
    process.env.BODA_TEST_BROWSER,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  const browser = candidates.find(candidate => fs.existsSync(candidate));
  if (!browser) throw new Error('Chrome/Edge not found. Set BODA_TEST_BROWSER to its executable path.');
  return browser;
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.errors = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') {
        this.errors.push(message.params.exceptionDetails.text + ': ' +
          (message.params.exceptionDetails.exception?.description || ''));
      }
    });
    socket.addEventListener('close', () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Chrome debugging connection closed'));
      }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('Chrome debugging connection failed')), { once: true });
    });
    return new CDP(socket);
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Chrome command timed out: ' + method));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function until(read, description, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let value;
  do {
    value = await read();
    if (value) return value;
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for ' + description);
}

const fixture = `<!doctype html><meta charset="utf-8"><title>Performance SDK fixture</title>
<script>
window.__originalFetch = window.fetch;
window.__originalMethods = {storage: Storage.prototype.setItem, idb: IDBDatabase.prototype.transaction,
  toDataURL: HTMLCanvasElement.prototype.toDataURL, toBlob: HTMLCanvasElement.prototype.toBlob};
window.__probe = { timers: new Set(), intervals: new Set(), observers: new Set() };
const originalSetTimeout = window.setTimeout.bind(window);
const originalClearTimeout = window.clearTimeout.bind(window);
const originalSetInterval = window.setInterval.bind(window);
const originalClearInterval = window.clearInterval.bind(window);
window.setTimeout = function(fn, ms, ...args) {
  let id;
  const callback = typeof fn === 'function' ? function(...values) {
    window.__probe.timers.delete(id); return fn.apply(this, values);
  } : fn;
  id = originalSetTimeout(callback, ms, ...args); window.__probe.timers.add(id); return id;
};
window.clearTimeout = function(id) { window.__probe.timers.delete(id); return originalClearTimeout(id); };
window.setInterval = function(...args) { const id = originalSetInterval(...args); window.__probe.intervals.add(id); return id; };
window.clearInterval = function(id) { window.__probe.intervals.delete(id); return originalClearInterval(id); };
if (window.PerformanceObserver) {
  const NativeObserver = window.PerformanceObserver;
  window.PerformanceObserver = class extends NativeObserver {
    observe(options) { const result = super.observe(options); window.__probe.observers.add(this); return result; }
    disconnect() { window.__probe.observers.delete(this); return super.disconnect(); }
  };
}
</script><script src="/JS/performance-agent.js"></script><p>Isolated fixture</p>`;

async function main() {
  assert.ok(fs.existsSync(sdkPath), 'Missing JS/performance-agent.js');
  assert.equal(typeof WebSocket, 'function', 'Use Node 22+ with built-in WebSocket');
  const browserPath = findBrowser();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'boda-perf-test-'));
  let browser;
  let browserCDP;
  const pages = [];
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    requests.push(url.pathname);
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/JS/performance-agent.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(fs.readFileSync(sdkPath));
    } else if (url.pathname === '/fixture.html' || url.pathname === '/child.html') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(url.pathname === '/child.html' ? fixture.replace('<script src="/JS/performance-agent.js"></script>', '') : fixture);
    } else if (url.pathname === '/controller.html') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><meta charset="utf-8"><title>Monitor controller fixture</title>');
    } else if (['/performance-monitor.html', '/JS/performance-monitor.js', '/CSS/performance-monitor.css'].includes(url.pathname)) {
      response.setHeader('Content-Type', url.pathname.endsWith('.html') ? 'text/html; charset=utf-8' : url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css');
      response.end(fs.readFileSync(path.join(root, url.pathname.slice(1))));
    } else if (url.pathname === '/probe.json') {
      response.setHeader('Content-Type', 'application/json');
      response.end('{"ok":true}');
    } else { response.statusCode = 404; response.end('Not found'); }
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = spawn(browserPath, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
      '--user-data-dir=' + profile, 'about:blank'
    ], { stdio: 'ignore', windowsHide: true });
    let launchError;
    browser.on('error', error => { launchError = error; });
    const portFile = path.join(profile, 'DevToolsActivePort');
    const debug = await until(() => {
      if (launchError) throw launchError;
      if (browser.exitCode !== null) throw new Error('Chrome exited before its debugger was ready: ' + browser.exitCode);
      if (!fs.existsSync(portFile)) return false;
      const lines = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
      return lines.length > 1 && lines;
    }, 'Chrome debugger');
    const debugOrigin = 'http://127.0.0.1:' + debug[0];
    browserCDP = await CDP.connect('ws://127.0.0.1:' + debug[0] + debug[1]);
    async function page(url) {
      const target = await browserCDP.send('Target.createTarget', { url: 'about:blank' });
      const targets = await (await fetch(debugOrigin + '/json/list')).json();
      const targetInfo = targets.find(item => item.id === target.targetId);
      const connection = await CDP.connect(targetInfo.webSocketDebuggerUrl);
      pages.push(connection);
      await connection.send('Runtime.enable');
      await connection.send('Page.enable');
      await connection.send('Page.navigate', { url });
      await until(() => connection.evaluate('location.href === ' + JSON.stringify(url) + ' && document.readyState === "complete"'), 'fixture page load');
      return connection;
    }
    const controller = await page(origin + '/controller.html');
    await controller.evaluate(`window.__messages = []; window.__channel = new BroadcastChannel(${JSON.stringify(channelName)});
      window.__channel.onmessage = e => window.__messages.push(e.data);`);
    const app = await page(origin + '/fixture.html');
    await until(() => app.evaluate('!!window.BodaPerf'), 'SDK global');
    const state = () => app.evaluate(`({recording: BodaPerf.recording(), fetchUnchanged: fetch === __originalFetch,
      methodsUnchanged: Storage.prototype.setItem === __originalMethods.storage &&
        IDBDatabase.prototype.transaction === __originalMethods.idb &&
        HTMLCanvasElement.prototype.toDataURL === __originalMethods.toDataURL &&
        HTMLCanvasElement.prototype.toBlob === __originalMethods.toBlob,
      timers: __probe.timers.size, intervals: __probe.intervals.size, observers: __probe.observers.size})`);
    const control = (action, options = {}, session = sessionId) => controller.evaluate(
      `__channel.postMessage(${JSON.stringify({ type: 'boda-perf-control', action, sessionId: session, options })})`);
    const messages = () => controller.evaluate('__messages');
    const eventList = async () => (await messages()).flatMap(message => message.kind === 'batch' ? message.data?.events || [] : []);
    const log = label => console.log('PASS ' + label);

    await delay(250);
    assert.deepEqual(await state(), { recording: false, fetchUnchanged: true, methodsUnchanged: true, timers: 0, intervals: 0, observers: 0 });
    await app.evaluate('fetch("/probe.json?token=inactive-secret").then(r=>r.json())');
    await delay(100);
    assert.equal((await eventList()).length, 0, 'Inactive SDK must not record resource events');
    log('inactive SDK leaves fetch, timers and performance observers untouched');

    await control('start');
    await until(async () => (await state()).recording, 'BroadcastChannel start');
    assert.equal((await state()).fetchUnchanged, true, 'SDK must never patch fetch');
    assert.equal((await state()).methodsUnchanged, false, 'Active instrumentation should observe storage and canvas methods');
    await app.evaluate(`window.__workflowEnd = BodaPerf.begin('fixture.import', {count:2});
      BodaPerf.event('workflow','fixture.change',{count:1,text:'private-event-text',value:'private-event-value',content:'private-event-content'});`);
    const response = await app.evaluate('fetch("/probe.json?token=private-token#private-fragment").then(r=>r.json())');
    assert.deepEqual(response, { ok: true }, 'Fetch response must remain unchanged');
    await app.evaluate(`new Promise(resolve => setTimeout(() => {
      const deadline = performance.now() + 1150; while (performance.now() < deadline) {}
      __workflowEnd({count:2}); __workflowEnd({count:2}); resolve();
    }, 0))`);
    const wrapperResult = await app.evaluate(`(async () => {
      localStorage.setItem('fixture', 'sensitive-user-content' + 'x'.repeat(100000));
      const storageOK = localStorage.getItem('fixture').startsWith('sensitive-user-content');
      const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 1000;
      const dataURL = canvas.toDataURL();
      const blob = await new Promise(resolve => canvas.toBlob(resolve));
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('boda-perf-fixture', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('items');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('items', 'readwrite');
          tx.objectStore('items').put('private-record-content', 'key');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onabort = () => reject(tx.error);
        };
      });
      return {storageOK, dataURL: dataURL.startsWith('data:image/png;base64,'), blobOK: blob instanceof Blob && blob.size > 0};
    })()`);
    assert.deepEqual(wrapperResult, { storageOK: true, dataURL: true, blobOK: true }, 'Storage and canvas wrappers must preserve native results');
    await delay(1400);
    await control('snapshot');
    const events = await until(async () => {
      const list = await eventList();
      return list.some(item => item.kind === 'resource') && list.some(item => item.name === 'fixture.import') && list;
    }, 'resource and workflow events');
    assert.ok(events.some(item => item.kind === 'workflow' && item.name === 'fixture.import' && item.duration >= 0), 'Completed workflow must have a nonnegative duration');
    assert.ok(events.some(item => item.name === 'fixture.change'), 'Explicit workflow events must arrive');
    assert.equal(events.filter(item => item.kind === 'workflow' && item.name === 'fixture.import').length, 1, 'Workflow end must be idempotent');
    for (const name of ['storage.webStorage.write', 'storage.indexedDB.transaction', 'canvas.toDataURL', 'canvas.toBlob']) {
      assert.ok(events.some(item => item.name === name), 'Active SDK must record ' + name);
    }
    assert.ok(events.some(item => item.kind === 'lag'), 'Blocked main thread must produce lag telemetry');
    const supportsLongTask = await app.evaluate('PerformanceObserver.supportedEntryTypes.includes("longtask")');
    if (supportsLongTask) assert.ok(events.some(item => item.kind === 'longtask'), 'Supported browsers must observe the deliberate long task');
    const serialized = JSON.stringify(await messages());
    for (const secret of ['private-token', 'private-fragment', 'inactive-secret', 'sensitive-user-content', 'private-record-content', 'private-event-text', 'private-event-value', 'private-event-content']) {
      assert.ok(!serialized.includes(secret), 'Telemetry must omit sensitive URL content: ' + secret);
    }
    const source = (await messages()).find(message => message.kind === 'batch');
    assert.equal(source.type, 'boda-perf');
    assert.equal(source.sessionId, sessionId);
    assert.equal(typeof source.sourceId, 'string');
    log('same-origin channel controls resource, lag, supported long-task and workflow telemetry');
    log('telemetry removes URL query strings and fragments');

    await app.evaluate(`new Promise(resolve => {
      const frame=document.createElement('iframe'); frame.id='test-child'; frame.onload=resolve;
      frame.src='/child.html?private=child-query'; document.body.appendChild(frame);
    })`);
    await until(() => app.evaluate('document.getElementById("test-child").contentWindow.__probe.observers.size > 0'), 'same-origin child observers');
    await app.evaluate(`(async () => {
      const child=document.getElementById('test-child').contentWindow;
      await child.eval('fetch("/probe.json?private=child-resource").then(r=>r.json())');
      const canvas=child.document.createElement('canvas'); canvas.width=16; canvas.height=16;
      await new Promise(resolve=>canvas.toBlob(resolve));
    })()`);
    await control('snapshot');
    await until(async () => (await eventList()).some(item => item.name === 'canvas.toBlob' && item.frame?.endsWith('/child.html')), 'child canvas telemetry');
    await until(async () => (await eventList()).some(item => item.kind === 'resource' && item.frame?.endsWith('/child.html')), 'child resource telemetry');
    await app.evaluate(`const child=document.getElementById('test-child').contentWindow;
      window.__detachedChild={probe:child.__probe,storage:child.Storage.prototype,canvas:child.HTMLCanvasElement.prototype,original:child.__originalMethods};
      document.getElementById('test-child').remove();`);
    await app.evaluate(`new Promise(resolve => {
      const frame=document.createElement('iframe'); frame.id='test-child'; frame.onload=resolve;
      frame.src='/child.html'; document.body.appendChild(frame);
    })`);
    await until(() => app.evaluate('__detachedChild.probe.observers.size === 0 && __detachedChild.storage.setItem === __detachedChild.original.storage && __detachedChild.canvas.toBlob === __detachedChild.original.toBlob'), 'detached child instrumentation cleanup');
    await until(() => app.evaluate('document.getElementById("test-child").contentWindow.__probe.observers.size > 0'), 'second child observers');
    await app.evaluate(`new Promise(resolve => {
      const frame=document.createElement('iframe'); frame.id='cross-origin-child'; frame.onload=resolve;
      frame.src=${JSON.stringify(origin.replace('127.0.0.1', 'localhost') + '/child.html')}; document.body.appendChild(frame);
    })`);
    await until(() => app.evaluate('BodaPerf.snapshot().frames.inaccessible >= 1'), 'cross-origin frame reporting');
    log('same-origin child resources/canvas are observed; detached children are released and cross-origin frames are counted');

    await control('stop', {}, 'unrelated-session');
    await delay(100);
    assert.equal((await state()).recording, true, 'Another session must not stop an active recording');
    await control('stop');
    await until(async () => !(await state()).recording, 'BroadcastChannel stop');
    await delay(100);
    assert.deepEqual(await state(), { recording: false, fetchUnchanged: true, methodsUnchanged: true, timers: 0, intervals: 0, observers: 0 }, 'Stop must disconnect all active work and restore native methods');
    assert.equal(await app.evaluate(`(() => { const child=document.getElementById('test-child').contentWindow;
      return child.__probe.observers.size===0 && child.Storage.prototype.setItem===child.__originalMethods.storage &&
      child.HTMLCanvasElement.prototype.toBlob===child.__originalMethods.toBlob; })()`), true, 'Stop must restore child prototypes and disconnect their observers');
    const stoppedCount = (await eventList()).length;
    await app.evaluate('BodaPerf.event("workflow","after.stop",{}); fetch("/probe.json?token=stopped-secret")');
    await delay(300);
    assert.equal((await eventList()).length, stoppedCount, 'Stopped SDK must not emit new events');
    log('session boundaries prevent unrelated stop; stop disconnects observers and timers');

    await control('start');
    await until(async () => (await state()).recording, 'restart');
    await app.evaluate('BodaPerf.event("workflow","restart.once",{})');
    await control('stop');
    await until(async () => !(await state()).recording, 'second stop');
    await delay(150);
    assert.equal((await eventList()).filter(item => item.name === 'restart.once').length, 1, 'Restart must not duplicate events');
    assert.equal((await state()).fetchUnchanged, true);
    log('restart records each event once and preserves native fetch');

    await control('start');
    await until(async () => (await state()).recording, 'bounded recording');
    await app.evaluate('for(let i=0;i<8300;i++) BodaPerf.event("workflow","bounded",{i})');
    const snapshot = await app.evaluate('BodaPerf.snapshot()');
    assert.ok(snapshot && typeof snapshot === 'object', 'Snapshot must be JSON serializable');
    assert.doesNotThrow(() => JSON.stringify(snapshot));
    assert.equal(snapshot.eventLimit, 8000);
    assert.ok(snapshot.metrics.events <= 8000, 'Recorded event count must not exceed 8000');
    assert.ok(snapshot.pending <= 400, 'The unsent event queue must remain bounded');
    assert.ok(snapshot.metrics.dropped > 0, 'Overflow must be reported rather than retaining every event');
    await control('snapshot');
    await until(() => app.evaluate('BodaPerf.snapshot().pending === 0'), 'initial queue drain');
    for (let batch = 0; batch < 22; batch++) {
      await app.evaluate('for(let i=0;i<380;i++) BodaPerf.event("workflow","event.budget",{i})');
      await control('snapshot');
      await until(() => app.evaluate('BodaPerf.snapshot().pending === 0'), 'bounded queue drain');
    }
    const fullBudget = await app.evaluate('BodaPerf.snapshot()');
    assert.equal(fullBudget.metrics.events, 8000, 'The total session event budget must stop at 8000 even when queues are drained');
    assert.ok(fullBudget.metrics.dropped > snapshot.metrics.dropped);
    await control('stop');
    await until(async () => !(await state()).recording, 'bounded recording stop');
    log('snapshot is JSON serializable and event queue overflow is bounded and reported');

    const optedIn = await page(origin + '/fixture.html?bodaPerf=1&bodaPerfSession=query-session');
    await until(() => optedIn.evaluate('!!window.BodaPerf && BodaPerf.recording()'), 'query opt-in');
    assert.equal(await optedIn.evaluate('fetch === __originalFetch'), true);
    await optedIn.evaluate('BodaPerf.stop()');
    log('explicit query opt-in starts monitoring without patching fetch');

    const asyncBoundary = await app.evaluate(`(async () => {
      BodaPerf.start({sessionId:'async-before'});
      const finishOldWorkflow = BodaPerf.begin('previous.session.workflow');
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
      const encoded = new Promise(resolve => canvas.toBlob(resolve));
      BodaPerf.stop();
      BodaPerf.start({sessionId:'async-after'});
      finishOldWorkflow();
      const blob = await encoded;
      const current = BodaPerf.snapshot();
      BodaPerf.stop();
      return {blobOK:blob instanceof Blob, workflowCount:current.metrics.workflowCount};
    })()`);
    assert.equal(asyncBoundary.blobOK, true, 'In-flight canvas callbacks must still complete normally');
    assert.equal(asyncBoundary.workflowCount, 0, 'Callbacks and workflow endings from an earlier session must not enter the next recording');
    log('in-flight callbacks and workflow completions cannot cross recording session boundaries');

    const monitor = await page(origin + '/performance-monitor.html');
    await monitor.evaluate(`window.__downloadBlobs = [];
      const createURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { __downloadBlobs.push(blob); return createURL(blob); };
      document.addEventListener('click', e => { if(e.target.closest('a[download]')) e.preventDefault(); }, true);
      document.getElementById('connect-app').click();`);
    await until(async () => (await state()).recording, 'actual monitor connects to fixture SDK');
    await until(() => monitor.evaluate('!document.getElementById("export-json").disabled'), 'monitor connection UI');
    async function exportedBlob(button, json = false) {
      await until(() => monitor.evaluate('!document.getElementById(' + JSON.stringify(button) + ').disabled'), 'enabled export button');
      const before = await monitor.evaluate('__downloadBlobs.length');
      await monitor.evaluate('document.getElementById(' + JSON.stringify(button) + ').click()');
      await until(() => monitor.evaluate('__downloadBlobs.length > ' + before), 'monitor export download', 6000);
      return monitor.evaluate('__downloadBlobs.at(-1).text()' + (json ? '.then(JSON.parse)' : ''));
    }
    await app.evaluate('window.__uiEnd = BodaPerf.begin("fixture.ui.workflow",{count:1}); __uiEnd()');
    await monitor.evaluate('document.getElementById("take-snapshot").click()');
    await until(() => monitor.evaluate('document.getElementById("workflow-rows").textContent.includes("fixture.ui.workflow")'), 'monitor workflow table');
    const exported = await exportedBlob('export-json', true);
    assert.equal(exported.format, 'boda-performance-recording');
    assert.ok(exported.events.some(item => item.name === 'fixture.ui.workflow' && item.kind === 'workflow'));
    assert.ok(Array.isArray(exported.sources) && exported.sources.length > 0);
    assert.ok(exported.summary.workflowCount > 0);
    assert.ok(exported.eventRetention.retained <= 6000);
    assert.equal(exported.exportSync.timedOut, false, 'Connected SDK sources must acknowledge the final export snapshot');
    assert.deepEqual(exported.exportSync.pendingSources, []);
    log('actual monitor connects, renders workflow data and exports valid JSON');

    const uiSession = exported.sessionId;
    await monitor.evaluate('document.getElementById("step-marker").value="background"; document.getElementById("mark-step").click()');
    await monitor.evaluate('document.getElementById("take-snapshot").click()');
    await until(async () => (await messages()).some(item => item.type === 'boda-perf-control' && item.action === 'mark' && item.name === 'background' && item.sessionId === uiSession), 'workflow marker command');
    await monitor.evaluate('document.getElementById("step-marker").value="unapproved"; document.getElementById("mark-step").click()');
    await delay(100);
    assert.ok(!(await messages()).some(item => item.type === 'boda-perf-control' && item.action === 'mark' && item.name === 'unapproved'), 'Marker values must use the predefined choices');
    await controller.evaluate(`__channel.postMessage(${JSON.stringify({ type: 'boda-perf', kind: 'batch', sourceId: 'ui-privacy-fixture', sessionId: uiSession, time: Date.now(), data: { events: [{ kind: 'resource', name: origin + '/private.png?secret=ui-query#ui-hash', time: Date.now(), duration: 10, detail: { url: origin + '/private.png?secret=ui-query#ui-hash', image: 'data:image/png;base64,private-image', workbook: 'private-workbook', message: 'private-message' } }] } })})`);
    await delay(100);
    const privateExport = await exportedBlob('export-json');
    for (const secret of ['ui-query', 'ui-hash', 'private-image', 'private-workbook', 'private-message']) {
      assert.ok(!privateExport.includes(secret), 'UI JSON must remove sensitive input: ' + secret);
    }
    const timedOutExport = JSON.parse(privateExport);
    assert.equal(timedOutExport.exportSync.timedOut, true, 'An unresponsive fixture source must be recorded as an export timeout');
    assert.ok(timedOutExport.exportSync.pendingSources.includes('ui-privacy-fixture'));
    const csv = await exportedBlob('export-csv');
    assert.ok(csv.includes('fixture.ui.workflow') && csv.includes('JS heap'));
    assert.ok(!csv.includes('ui-query'));
    log('monitor marker choices are bounded; JSON/CSV export removes sensitive URL and content fields');

    fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
    for (const viewport of [
      { width: 1280, height: 900, filename: 'performance-monitor-preview.png' },
      { width: 390, height: 844, filename: 'performance-monitor-preview-narrow.png' }
    ]) {
      await monitor.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
      await delay(150);
      const screenshot = await monitor.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(root, 'tmp', viewport.filename), Buffer.from(screenshot.data, 'base64'));
      const dimensions = await monitor.evaluate('({scroll:document.documentElement.scrollWidth,width:innerWidth})');
      assert.ok(dimensions.scroll <= dimensions.width, 'Monitor must not overflow the viewport horizontally at ' + viewport.width + 'px');
    }
    log('monitor fits desktop and narrow viewports; preview screenshots saved in tmp/');

    await controller.evaluate(`for(let batch=0; batch<32; batch++) __channel.postMessage({
      type:'boda-perf', kind:'batch', sourceId:'ui-bound-fixture', sessionId:${JSON.stringify(uiSession)}, time:Date.now(),
      data:{events:Array.from({length:200}, (_,i)=>({kind:'workflow',name:'ui.bound',time:Date.now(),duration:1,detail:{i:batch*200+i}}))}
    });`);
    await until(() => monitor.evaluate('parseInt(document.getElementById("event-count").textContent.replace(/,/g,""),10) === 6000'), 'monitor retention limit');
    const limited = await exportedBlob('export-json', true);
    assert.equal(limited.eventRetention.limit, 6000);
    assert.equal(limited.events.length, 6000);
    assert.ok(limited.eventRetention.monitorDropped > 0 && limited.eventRetention.truncated);
    await monitor.evaluate('document.getElementById("toggle-recording").click()');
    await until(async () => !(await state()).recording, 'actual monitor pause');
    assert.equal((await state()).methodsUnchanged, true);
    log('monitor retains at most 6000 events, reports truncation and can pause the SDK');
    const opened = await monitor.evaluate(`window.open = (url, target) => { window.__opened = {url,target}; return {}; };
      document.getElementById('open-app').click(); __opened`);
    assert.equal(opened.target, '_blank', 'Open BODA must create a fresh tab instead of reloading existing work');
    assert.equal(new URL(opened.url, origin).searchParams.get('bodaPerf'), '1');
    assert.ok(new URL(opened.url, origin).searchParams.get('bodaPerfSession'));
    log('open BODA uses a new tab with explicit monitoring opt-in');

    assert.ok(requests.every(item => ['/controller.html', '/fixture.html', '/child.html', '/JS/performance-agent.js', '/probe.json', '/favicon.ico', '/performance-monitor.html', '/JS/performance-monitor.js', '/CSS/performance-monitor.css'].includes(item)), 'Test must not load heavyweight editor resources');
    for (const connection of pages) assert.deepEqual(connection.errors, [], 'Fixture must have no uncaught JavaScript exceptions');
    console.log('Performance monitor SDK browser checks passed. Browser: ' + path.basename(browserPath));
  } finally {
    if (browserCDP) {
      try { await browserCDP.send('Browser.close'); } catch (_) { /* Browser closes its debugging socket first. */ }
    }
    for (const page of pages) page.close();
    if (browserCDP) browserCDP.close();
    if (browser && browser.exitCode === null) {
      await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(3000)]);
      if (browser.exitCode === null) browser.kill();
    }
    await new Promise(resolve => server.close(resolve));
    const resolvedProfile = path.resolve(profile);
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolvedProfile.startsWith(tempRoot) && path.basename(resolvedProfile).startsWith('boda-perf-test-'), 'Temporary profile cleanup must stay inside the OS temp directory');
    fs.rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
