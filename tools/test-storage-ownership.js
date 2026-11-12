'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { spawn } = require('node:child_process');
const source = fs.readFileSync(path.join(__dirname, '../JS/storage-ownership.js'), 'utf8');
const queueSource = fs.readFileSync(path.join(__dirname, '../JS/save-queue.js'), 'utf8');
const pluginSource = fs.readFileSync(path.join(__dirname, '../shopee/js/bn-state-plugin.js'), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
class CDP {
  constructor(socket) {
    this.socket = socket; this.nextId = 1; this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    return new CDP(socket);
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Timed out: ' + method)); }, 15000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  }
  close() { this.socket.close(); }
}
async function until(read, name) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await delay(40); }
  throw new Error('Timed out: ' + name);
}
function makeContext(locks) {
  const listeners = {}, context = { Promise, Map, Error, navigator: locks ? { locks } : {}, setTimeout, clearTimeout,
    addEventListener: (name, callback) => { listeners[name] = callback; } };
  context.window = context; vm.createContext(context); vm.runInContext(source, context); vm.runInContext(queueSource, context);
  return { api: context.BodaStorageOwnership, queue: context.BodaSaveQueue, listeners };
}
async function unitChecks() {
  const held = new Set(); let requests = 0;
  const locks = { request(name, options, callback) {
    requests++; assert.equal(options.ifAvailable, true);
    if (held.has(name)) return Promise.resolve(callback(null));
    held.add(name); return Promise.resolve(callback({ name })).finally(() => held.delete(name));
  } };
  const a = makeContext(locks), b = makeContext(locks); let reads = 0, writes = 0, clears = 0;
  const store = { get: async () => { reads++; return { x: 1 }; }, put: async () => { writes++; }, clear: async () => { clears++; } };
  const primary = a.api.wrap(store, 'same'), follower = b.api.wrap(store, 'same');
  await primary.get(); await primary.put({ x: 2 });
  assert.equal(requests, 1, 'Lock is acquired before read and retained across edits');
  await assert.rejects(follower.get(), error => error.name === 'StorageOwnershipError' && error.code === 'other-tab');
  let statuses = [];
  const queue = b.queue.create({ retryDelay: 1, write: follower.put, onStatus: status => statuses.push(status) });
  queue.enqueue({ x: 3 }); await assert.rejects(queue.flush(), /另一個分頁/);
  assert.equal(statuses.at(-1).state, 'paused'); assert.equal(statuses.at(-1).noAutomaticRetry, true);
  assert.equal(writes, 1, 'Follower never writes, including through the actual save queue');
  assert.equal(reads, 1, 'Follower cannot read a draft and later silently overwrite it');
  a.listeners.pagehide(); await delay(0);
  await assert.rejects(primary.put({ x: 4 }), /釋放/);
  await assert.rejects(follower.put({ x: 5 }), /另一個分頁/, 'Losing tab must reload even after old owner exits');
  await assert.rejects(follower.clear(), /另一個分頁/); assert.equal(clears, 0);
  const c = makeContext(locks), reopened = c.api.wrap(store, 'same');
  await reopened.get(); await reopened.put({ x: 6 });
  assert.equal(writes, 2, 'A fresh tab can read the latest state after previous owner releases');
  const unrelated = b.api.wrap(store, 'independent'); await unrelated.get();
  assert.equal(b.api.create('independent'), unrelated.ownership, 'Same document reuses the store owner');
  const unsupported = makeContext(null).api.wrap(store, 'same');
  await assert.rejects(unsupported.put({}), error => error.code === 'unsupported' && error.noAutomaticRetry);
  const failedLocks = makeContext({ request() { return Promise.reject(new Error('denied')); } });
  await assert.rejects(failedLocks.api.create('failed').acquire(), error => error.code === 'lock-failed');
  const lateLocks = [];
  const late = makeContext({ request(name, options, callback) { return new Promise(resolve => lateLocks.push(() => resolve(callback({ name })))); } });
  const acquisition = late.api.create('late').acquire(); late.listeners.pagehide(); lateLocks[0]();
  await assert.rejects(acquisition, error => error.name === 'StorageOwnershipError');
  const slow = makeContext(locks), concurrent = makeContext(locks); let finishWrite;
  const activeStore = slow.api.wrap({ put: () => new Promise(resolve => { finishWrite = resolve; }) }, 'active-write');
  const writing = activeStore.put({}); await delay(0); slow.listeners.pagehide();
  await assert.rejects(concurrent.api.create('active-write').acquire(), error => error.code === 'other-tab', 'Pagehide cannot release an in-flight prepared write');
  finishWrite(); await writing; await delay(0);
  const afterWrite = makeContext(locks); await afterWrite.api.create('active-write').acquire(); afterWrite.listeners.pagehide();
  c.listeners.pagehide(); b.listeners.pagehide();
  console.log('PASS lock-before-read, single owner, sticky conflict, no retry storm, safe release, independent stores and unsupported fallback');
}
function extractFunction(sourceText, name, from = 0) {
  const match = new RegExp('\\bfunction\\s+' + name + '\\s*\\(').exec(sourceText.slice(from));
  const start = from + (match ? match.index : -1);
  assert.ok(match, 'Actual exposure function exists: ' + name);
  for (let end = sourceText.indexOf('}', start); end >= 0; end = sourceText.indexOf('}', end + 1)) {
    const candidate = sourceText.slice(start, end + 1);
    try { new vm.Script('(' + candidate + ')'); return candidate; } catch (_) {}
  }
  throw new Error('Cannot extract actual exposure function ' + name);
}
async function actualExposureIntegrationChecks() {
  const held = new Set();
  const locks = { request(name, options, callback) {
    if (held.has(name)) return Promise.resolve(callback(null));
    held.add(name); return Promise.resolve(callback({ name })).finally(() => held.delete(name));
  } };
  const primary = makeContext(locks), follower = makeContext(locks);
  await primary.api.create('bn_editor_state_db:current').acquire();
  function pluginContext(parentOwner) {
    let reads = 0, writes = 0, clears = 0, opens = 0;
    const errors = [], removed = [];
    const context = { Promise, setTimeout, clearTimeout, URL, URLSearchParams,
      parent: { BodaStorageOwnership: parentOwner },
      BodaStorageOwnership: { wrap() { throw new Error('Embedded editor must prefer parent ownership, not its own conflicting factory'); } },
      BodaStateAssets: { create: () => ({ get: async () => { reads++; return null; }, put: async () => { writes++; }, clear: async () => { clears++; } }) },
      confirm: () => true, showToast(message) { errors.push(message); }, publishSaveStatus(state, error) { errors.push(error.message); },
      localStorage: { removeItem: key => removed.push(key) }, sessionStorage: { removeItem: key => removed.push(key) },
      location: { reload() { throw new Error('Conflict must not reload'); } }
    };
    context.global = context; vm.createContext(context);
    vm.runInContext("var IDB_DB='bn_editor_state_db', IDB_STORE='states', IDB_KEY='current', stateCodecPromise=null, stateOwnershipPromise=null, saveInFlight=null;\n" +
      ['getStorageOwnership', 'withStorageOwnership', 'getStateCodec', 'idbGetState', 'idbSetState', 'idbClearState'].map(name => extractFunction(pluginSource, name)).join('\n'), context);
    context.openStateDb = () => { opens++; throw new Error('Rejected ownership must not open legacy storage'); };
    return { context, errors, removed, counts: () => ({ reads, writes, clears, opens }) };
  }
  const same = pluginContext(primary.api);
  await same.context.idbGetState(); await same.context.idbSetState({}); await same.context.idbClearState();
  assert.deepEqual(same.counts(), { reads: 1, writes: 1, clears: 1, opens: 0 }, 'Actual exposure read/write/clear reuse the exact parent owner held by a backup');
  const blocked = pluginContext(follower.api);
  for (const action of ['idbGetState', 'idbSetState', 'idbClearState']) {
    await assert.rejects(blocked.context[action]({}), error => error.name === 'StorageOwnershipError');
  }
  assert.deepEqual(blocked.counts(), { reads: 0, writes: 0, clears: 0, opens: 0 });
  // The standalone legacy fallback must be protected too, even without codec.
  blocked.context.getStateCodec = () => Promise.resolve(null);
  for (const action of ['idbGetState', 'idbSetState', 'idbClearState']) {
    await assert.rejects(blocked.context[action]({}), error => error.name === 'StorageOwnershipError');
  }
  assert.equal(blocked.counts().opens, 0);
  const marker = pluginSource.indexOf("clrBtn.addEventListener('click',");
  assert.ok(marker > 0);
  const start = pluginSource.indexOf('function', marker); let click = null;
  for (let end = pluginSource.indexOf('}', start); end >= 0; end = pluginSource.indexOf('}', end + 1)) {
    const candidate = pluginSource.slice(start, end + 1);
    try { new vm.Script('(' + candidate + ')'); click = candidate; break; } catch (_) {}
  }
  assert.ok(click); vm.runInContext('global.actualClearClick=(' + click + ');', blocked.context);
  blocked.context.actualClearClick(); for (let i = 0; i < 35; i++) await Promise.resolve();
  assert.deepEqual(blocked.removed, [], 'Exposure clear must refuse before touching shared localStorage');
  assert.notEqual(blocked.context._bnClearingState, true);
  assert.ok(blocked.errors.some(message => /另一個分頁/.test(message)));
  console.log('PASS actual exposure codec and legacy paths guard reads/writes/clear, prefer parent factory and reject destructive clear before mutations');
}
async function browserChecks() {
  const executable = [process.env.BODA_TEST_BROWSER,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(file => fs.existsSync(file));
  assert.ok(executable, 'Chrome/Edge required for real multi-document Web Locks test');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'boda-ownership-test-'));
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/tab') { response.end('<!doctype html><script>' + source + '</script>'); return; }
    response.end(`<!doctype html><body>RUNNING<script>
    (async function(){
      function check(value,message){if(!value)throw new Error(message);}
      function frame(){return new Promise(resolve=>{const f=document.createElement('iframe');f.src='/tab';f.onload=()=>resolve(f);document.body.appendChild(f);});}
      const a=await frame(), b=await frame();
      const one=a.contentWindow.BodaStorageOwnership.create('actual-draft'); await one.acquire();
      let rejected=false;try{await b.contentWindow.BodaStorageOwnership.create('actual-draft').acquire();}catch(e){rejected=e.code==='other-tab';}
      check(rejected,'Second document must be rejected');
      a.remove();
      // Browser destroys the first document and releases its Web Lock even
      // without any manually dispatched pagehide / application cleanup.
      const c=await frame(); await c.contentWindow.BodaStorageOwnership.create('actual-draft').acquire();
      rejected=false;try{await b.contentWindow.BodaStorageOwnership.create('actual-draft').acquire();}catch(e){rejected=e.code==='other-tab';}
      check(rejected,'Old follower must remain blocked after owner closes');
      await b.contentWindow.BodaStorageOwnership.create('different-draft').acquire();
      document.body.textContent='PASS real browser rejects a second document, releases destroyed-document locks, accepts fresh owners and keeps stale followers blocked';
    })().catch(error=>{document.body.textContent='FAIL '+error.stack;});
    </script>`);
  });
  let browser, control, page;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    let launchError; browser.on('error', error => { launchError = error; });
    const portFile = path.join(profile, 'DevToolsActivePort');
    const lines = await until(() => {
      if (launchError) throw launchError;
      if (browser.exitCode !== null) throw new Error('Browser exited before debugger was ready');
      return fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    }, 'browser debugger');
    control = await CDP.connect('ws://127.0.0.1:' + lines[0] + lines[1]);
    const target = await control.send('Target.createTarget', { url: 'http://127.0.0.1:' + server.address().port });
    const targets = await (await fetch('http://127.0.0.1:' + lines[0] + '/json/list')).json();
    page = await CDP.connect(targets.find(item => item.id === target.targetId).webSocketDebuggerUrl);
    const output = await until(async () => {
      const text = await page.evaluate('document.body && document.body.textContent');
      return text && /^(PASS|FAIL)/.test(text) ? text : null;
    }, 'browser ownership checks');
    assert.match(output, /^PASS real browser/, output);
    console.log('PASS real Chrome multi-document ownership, browser-release recovery, independent keys and stale-follower rejection');
  } finally {
    if (control) try { await control.send('Browser.close'); } catch (_) {}
    if (page) page.close(); if (control) control.close();
    if (browser && browser.exitCode === null) {
      await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(2000)]);
      if (browser.exitCode === null) browser.kill();
    }
    await new Promise(resolve => server.close(resolve));
    const target = path.resolve(profile);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('boda-ownership-test-'));
    for (let attempt = 0; attempt < 8; attempt++) {
      try { fs.rmSync(target, { recursive: true, force: true }); break; }
      catch (error) { if (attempt === 7) console.warn('Temporary profile still locked: ' + target); else await delay(250); }
    }
  }
}
(async () => { await unitChecks(); await actualExposureIntegrationChecks(); await browserChecks(); })().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
