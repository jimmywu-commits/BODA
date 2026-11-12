'use strict';

/* Controlled local cold-start comparison. Not a GitHub Pages or weak-PC test.
 * node tools/benchmark-startup.js --phase=before --runs=3
 * node tools/benchmark-startup.js --phase=after --runs=3
 * Requires Node 22+ and Chrome/Edge; optional BODA_TEST_BROWSER executable.
 * /before/ reads tmp/perf-baseline first, then unchanged files from the root.
 * /after/ reads current files. Each run has a new profile and cleared cache.
 * cdnjs's three pinned packages are fulfilled from matching local vendor files.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const baseline = path.join(root, 'tmp', 'perf-baseline');
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const outputDirectory = args['output-dir'] ? path.resolve(root, args['output-dir']) : path.join(root, 'output', 'performance');
if (!outputDirectory.startsWith(root + path.sep)) throw new Error('Output directory must stay inside BODA');
const phase = args.phase || 'before';
const runCount = Number(args.runs || 3);
if (!['before', 'after'].includes(phase) || !Number.isInteger(runCount) || runCount < 1 || runCount > 10) {
  throw new Error('Use --phase=before|after --runs=1..10');
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pinned = new Map([
  ['https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js', 'JS/vendor/exceljs-4.4.0.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.13/html-to-image.min.js', 'JS/vendor/html-to-image-1.11.13.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'JS/vendor/jszip-3.10.1.min.js']
]);
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

function findBrowser() {
  const candidates = [process.env.BODA_TEST_BROWSER,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
  const result = candidates.find(file => fs.existsSync(file));
  if (!result) throw new Error('Chrome/Edge not found; set BODA_TEST_BROWSER.');
  return result;
}
class CDP {
  constructor(socket) {
    this.socket = socket; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
      } else (this.handlers.get(message.method) || []).forEach(handler => handler(message.params));
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Chrome connection closed')); }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    return new CDP(socket);
  }
  on(method, handler) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(handler); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timed out: ' + method)); }, 10000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}
async function until(read, title, timeout = 10000) {
  const deadline = Date.now() + timeout;
  do { const value = await read(); if (value) return value; await delay(50); } while (Date.now() < deadline);
  throw new Error('Timed out waiting for ' + title);
}
function safeFile(directory, relative) {
  const file = path.resolve(directory, relative);
  return file.startsWith(path.resolve(directory) + path.sep) ? file : null;
}
function isFile(file) { return file && fs.existsSync(file) && fs.statSync(file).isFile(); }
function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null;
}

async function run(browserPath, origin, number, serverRecords) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'boda-startup-benchmark-'));
  let browser, browserCDP, page;
  const requests = new Map(), errors = [], logs = [], mapped = [], blocked = [];
  let browserVersion = null, ready = null, timeout = null;
  const startedRecords = serverRecords.length;
  try {
    browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-component-update', '--window-size=1366,900',
      '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, 'about:blank'],
    { stdio: 'ignore', windowsHide: true });
    let launchError; browser.on('error', error => { launchError = error; });
    const portFile = path.join(profile, 'DevToolsActivePort');
    const debug = await until(() => {
      if (launchError) throw launchError;
      if (browser.exitCode !== null) throw new Error('Chrome exited: ' + browser.exitCode);
      return isFile(portFile) && fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    }, 'Chrome debugger');
    const debugOrigin = 'http://127.0.0.1:' + debug[0];
    browserCDP = await CDP.connect('ws://127.0.0.1:' + debug[0] + debug[1]);
    browserVersion = await browserCDP.send('Browser.getVersion');
    const target = await browserCDP.send('Target.createTarget', { url: 'about:blank' });
    const targets = await (await fetch(debugOrigin + '/json/list')).json();
    page = await CDP.connect(targets.find(item => item.id === target.targetId).webSocketDebuggerUrl);
    page.on('Runtime.exceptionThrown', params => errors.push({ text: params.exceptionDetails.text, description: params.exceptionDetails.exception?.description || '', url: params.exceptionDetails.url || '' }));
    page.on('Log.entryAdded', params => { if (params.entry.level === 'error') logs.push({ source: params.entry.source, text: params.entry.text, url: params.entry.url || '' }); });
    page.on('Network.requestWillBeSent', params => requests.set(params.requestId, { url: params.request.url, type: params.type, method: params.request.method, timestamp: params.timestamp }));
    page.on('Network.responseReceived', params => { const item = requests.get(params.requestId); if (item) Object.assign(item, { status: params.response.status, mimeType: params.response.mimeType, fromDiskCache: params.response.fromDiskCache || false }); });
    page.on('Network.loadingFinished', params => { const item = requests.get(params.requestId); if (item) item.encodedDataLength = params.encodedDataLength; });
    page.on('Network.loadingFailed', params => { const item = requests.get(params.requestId); if (item) item.failed = params.errorText; });
    page.on('Fetch.requestPaused', params => {
      const file = pinned.get(params.request.url.replace(/[?#].*$/, ''));
      if (file) {
        const body = fs.readFileSync(path.join(root, file));
        mapped.push({ url: params.request.url, file, bytes: body.length });
        page.send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/javascript; charset=utf-8' }, { name: 'Timing-Allow-Origin', value: '*' }, { name: 'Cache-Control', value: 'public, max-age=3600' }], body: body.toString('base64') }).catch(error => errors.push({ text: 'CDN mapping failed', description: error.message }));
      } else {
        blocked.push(params.request.url);
        page.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      }
    });
    await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Network.enable'); await page.send('Log.enable');
    await page.send('Network.clearBrowserCache'); await page.send('Network.clearBrowserCookies');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
    /* Only outside HTTPS is intercepted. Loopback HTTP remains native, so a
       107-request baseline does not incur 107 extra CDP continuation roundtrips. */
    await page.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*', requestStage: 'Request' }] });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'performance.setResourceTimingBufferSize(3000);' });
    const url = origin + '/' + phase + '/index.html#upload';
    await page.send('Page.navigate', { url });
    try {
      ready = await until(() => page.evaluate(`(() => {
        const view=document.querySelector('#views > .view.active');
        const complete=document.readyState==='complete' && window.blocksLoadedForImport===true && view && view.id==='view-upload' && (!window.APP_LOADING || !APP_LOADING.active);
        return complete ? {observedAtMs:performance.now(),activeView:view.id,blocks:window.BNCore?BNCore.getBlocks().length:null} : null;
      })()`), 'upload view, all registered blocks and finished initial loading', 30000);
    } catch (error) { timeout = error.message; }
    await delay(500);
    const timing = await page.evaluate(`(() => {
      const nav=performance.getEntriesByType('navigation')[0];
      return {navigation:nav?nav.toJSON():null,resources:performance.getEntriesByType('resource').map(e=>({name:e.name,initiatorType:e.initiatorType,duration:e.duration,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,decodedBodySize:e.decodedBodySize,responseStatus:e.responseStatus})),
        state:{readyState:document.readyState,activeView:document.querySelector('#views > .view.active')?.id||null,blocksLoaded:window.blocksLoadedForImport===true,blocks:window.BNCore?BNCore.getBlocks().length:null,loading:window.APP_LOADING?APP_LOADING.active:null,heap:performance.memory?performance.memory.usedJSHeapSize:null},
        userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory||null,observedAtMs:performance.now()};
    })()`);
    const network = Array.from(requests.values());
    const unmappedExternal = network.filter(item => /^https?:/i.test(item.url) && !item.url.startsWith(origin + '/') && !pinned.has(item.url.replace(/[?#].*$/, ''))).map(item => item.url);
    const resources = timing.resources, nav = timing.navigation;
    const local = serverRecords.slice(startedRecords);
    const total = (key) => resources.reduce((sum, entry) => sum + (Number(entry[key]) || 0), Number(nav?.[key]) || 0);
    const fontsEmbed = network.filter(item => /\/JS\/fonts-embed\.js(?:[?#]|$)/.test(item.url));
    const blockJson = network.filter(item => /\/blocks\/[^/]+\/block\.json(?:[?#]|$)/.test(item.url));
    const catalogue = network.filter(item => /\/blocks\/catalogue\.bundle\.js(?:[?#]|$)/.test(item.url));
    return { number, phase, valid: !timeout && errors.length === 0 && timing.state.blocks === 107 &&
        network.every(item => !(item.status >= 400) && !item.failed) && blocked.length === 0 && unmappedExternal.length === 0,
      timeout, browserVersion, ready, state: timing.state,
      metrics: { domContentLoadedMs: nav?.domContentLoadedEventEnd || null, loadMs: nav?.loadEventEnd || null,
        appReadyObservedMs: ready?.observedAtMs || null, observedAtMs: timing.observedAtMs,
        requestCount: network.length, httpErrors: network.filter(item => item.status >= 400).length,
        failedRequests: network.filter(item => item.failed).length, encodedBodyBytesKnown: total('encodedBodySize'), transferBytesKnown: total('transferSize'),
        localServedBodyBytes: local.reduce((sum, item) => sum + item.bytes, 0), cdnMappedBodyBytes: mapped.reduce((sum, item) => sum + item.bytes, 0),
        fontsEmbedRequests: fontsEmbed.length, sourceBlockJsonRequests: blockJson.length, catalogueRequests: catalogue.length },
      mainHtml: local.find(item => item.relative === 'index.html') || null,
      mappedExternal: mapped, blockedExternal: blocked, unmappedExternal, runtimeErrors: errors, consoleErrors: logs, network, resourceTiming: resources, navigationTiming: nav };
  } finally {
    if (browserCDP) { try { await browserCDP.send('Browser.close'); } catch (_) {} }
    if (page) page.close(); if (browserCDP) browserCDP.close();
    if (browser && browser.exitCode === null) {
      await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(3000)]);
      if (browser.exitCode === null) browser.kill();
    }
    const resolved = path.resolve(profile), temp = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(temp) || !path.basename(resolved).startsWith('boda-startup-benchmark-')) throw new Error('Unsafe profile cleanup path');
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
async function main() {
  if (typeof WebSocket !== 'function') throw new Error('Use Node 22+ with built-in WebSocket.');
  if (!isFile(path.join(baseline, 'index.html'))) throw new Error('Missing baseline tmp/perf-baseline/index.html; no numbers were measured.');
  const browserPath = findBrowser(), serverRecords = [];
  const server = http.createServer((request, response) => {
    let url; try { url = new URL(request.url, 'http://localhost'); } catch (_) { response.writeHead(400).end(); return; }
    if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const match = /^\/(before|after)\/(.*)$/.exec(url.pathname);
    if (!match) { response.writeHead(404).end('Not found'); return; }
    let relative; try { relative = decodeURIComponent(match[2] || 'index.html'); } catch (_) { response.writeHead(400).end(); return; }
    const snapshotFile = safeFile(baseline, relative), currentFile = safeFile(root, relative);
    const fromSnapshot = match[1] === 'before' && isFile(snapshotFile);
    const file = fromSnapshot ? snapshotFile : currentFile;
    if (!isFile(file)) { serverRecords.push({ phase: match[1], relative, status: 404, bytes: 0 }); response.writeHead(404).end('Not found'); return; }
    const body = fs.readFileSync(file);
    serverRecords.push({ phase: match[1], relative, status: 200, bytes: body.length, source: fromSnapshot ? 'snapshot' : 'current-fallback' });
    response.setHeader('Content-Type', mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream');
    response.setHeader('Content-Length', body.length); response.setHeader('Cache-Control', 'public, max-age=3600');
    response.end(body);
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const results = [];
    for (let number = 1; number <= runCount; number++) {
      const result = await run(browserPath, origin, number, serverRecords); results.push(result);
      console.log(phase + ' ' + number + '/' + runCount + ': ' + JSON.stringify({ valid: result.valid, ...result.metrics, runtimeErrors: result.runtimeErrors.length, timeout: result.timeout }));
    }
    const valid = results.filter(result => result.valid);
    const medians = Object.fromEntries(Object.keys(results[0].metrics).map(key => [key, median(valid.map(result => result.metrics[key]))]));
    const report = { format: 'boda-controlled-startup-benchmark', version: 1, generatedAt: new Date().toISOString(), phase,
      conditions: { source: 'local uncompressed HTTP, 127.0.0.1', scenario: 'fresh profile, #upload, no work order or uploaded images',
        viewport: { width: 1366, height: 900, deviceScaleFactor: 1 }, cache: 'new profile and cleared browser cache for every run; normal cache behavior during navigation',
        cpuThrottling: 'none', networkThrottling: 'none', externalNetwork: 'cdnjs pinned versions fulfilled from local vendor; other HTTPS blocked; any unmapped external request invalidates the run; loopback HTTP is not intercepted',
        readyCondition: 'document complete + 107 registered blocks + view-upload + initial loading hidden; 50ms observation interval',
        baseline: 'tmp/perf-baseline snapshot first; other files fall back to current root',
        limitations: ['Not weak-machine simulation or GitHub Pages transfer timing', 'Uncompressed loopback bytes differ from server gzip/brotli transfer', 'Resource Timing sizes are browser-known values; zero is not proof of cache hit', 'App-ready timing is observed with up to about 50ms polling granularity', 'Snapshot does not duplicate every unchanged binary asset'] },
      browser: browserPath, baselineIndexSHA256: digest(path.join(baseline, 'index.html')), currentIndexSHA256: digest(path.join(root, 'index.html')),
      runCount, validRunCount: valid.length, medians, results };
    fs.mkdirSync(outputDirectory, { recursive: true });
    const output = path.join(outputDirectory, 'startup-' + phase + '.json'); fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log('Saved ' + output); console.log('MEDIANS ' + JSON.stringify(medians));
    const otherFile = path.join(outputDirectory, 'startup-' + (phase === 'after' ? 'before' : 'after') + '.json');
    if (phase === 'after' && isFile(otherFile)) {
      const before = JSON.parse(fs.readFileSync(otherFile, 'utf8'));
      const changes = Object.fromEntries(Object.keys(medians).map(key => [key, { before: before.medians[key], after: medians[key], reductionPercent: before.medians[key] > 0 && medians[key] != null ? (1 - medians[key] / before.medians[key]) * 100 : null }]));
      fs.writeFileSync(path.join(outputDirectory, 'startup-comparison.json'), JSON.stringify({ generatedAt: new Date().toISOString(), valid: before.validRunCount === before.runCount && valid.length === runCount, conditions: report.conditions, beforeFile: 'startup-before.json', afterFile: 'startup-after.json', changes }, null, 2));
    }
    if (valid.length !== runCount) process.exitCode = 1;
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
