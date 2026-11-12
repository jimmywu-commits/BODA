'use strict';

/* Run: node tools/test-exposure-state-storage.js
 * Uses an isolated Chrome/Edge profile for real IndexedDB migration / rollback,
 * plus VM checks of the actual exposure plugin's queue and portable snapshots. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const codecSource = fs.readFileSync(path.join(root, 'JS/state-asset-codec.js'), 'utf8');
const pluginSource = fs.readFileSync(path.join(root, 'shopee/js/bn-state-plugin.js'), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const turns = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

function pluginFixture(codec, storageOverrides = {}, ownershipFactory) {
  const data = new Map(), writes = [], events = [], timers = [], intervals = [], warnings = [];
  const elements = new Map(), listeners = new Map();
  const localStorage = {
    getItem: key => data.get(key) || null,
    setItem: (key, value) => { writes.push({ key, value }); data.set(key, value); },
    removeItem: key => data.delete(key), ...storageOverrides
  };
  const context = {
    Promise, Map, WeakMap, WeakSet, URL, URLSearchParams, Blob,
    console: { log() {}, warn: (...args) => warnings.push(args) },
    document: { getElementById: key => elements.get(key) || null, querySelector: () => null,
      querySelectorAll: () => [], dispatchEvent: event => events.push(event),
      addEventListener: (type, fn) => listeners.set(type, fn), visibilityState: 'visible' },
    localStorage, location: { href: 'http://localhost/shopee/index.html', search: '' },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    setInterval: fn => { intervals.push(fn); return intervals.length; },
    addEventListener() {}, Event: class { constructor(type) { this.type = type; } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    BodaStateAssets: { create: () => codec }, parent: { currentImportImageLayoutId: 'project-storage-test' },
    // Ownership itself has real multi-tab coverage in test-storage-ownership.js.
    BodaStorageOwnership: ownershipFactory || {wrap:store=>store,create:()=>({run:operation=>Promise.resolve().then(operation)})}
  };
  context.window = context;
  vm.createContext(context);
  const marker = pluginSource.lastIndexOf('  ready(function(){');
  assert.ok(marker > 0, 'Plugin initialization marker is present');
  vm.runInContext(pluginSource.slice(0, marker) + `
    global.__storageTest = {strip:stripHeavyStateForLocalStorage,merge:mergeLightIntoFull,clear:idbClearState,
      collect:collectState,apply:applyState,autoSave:autoSave,load:autoLoad,flush:flushState,
      markDirty:markStateDirty,start:startAutoSave,whenReady:function(){return stateReady;},
      status:function(){return clone(saveStatus);},setCollect:function(fn){collectState=fn;},
      setApply:function(fn){applyState=fn;},setClock:function(now){saveRetryAt=now;}};
  })(window);`, context);
  return { context, api: context.__storageTest, data, writes, events, elements, listeners, timers, intervals, warnings };
}

async function pluginChecks() {
  const conflict=Object.assign(new Error('another tab owns this draft'),{name:'StorageOwnershipError',noAutomaticRetry:true});
  let ownershipAttempts=0,conflictWrites=0;
  const denied=pluginFixture({get:()=>{throw new Error('must not read before ownership');},put:()=>{conflictWrites++;}}, {}, {
    wrap:()=>({get:()=>{ownershipAttempts++;return Promise.reject(conflict);},put:()=>Promise.reject(conflict),clear:()=>Promise.reject(conflict)}),
    create:()=>({run:()=>Promise.reject(conflict)})
  });
  let appliedDenied=0;denied.api.setApply(()=>{appliedDenied++;});
  denied.data.set('bn_editor_state_v1',JSON.stringify({version:1,ts:1,products:[]}));
  await denied.api.load({startup:true});denied.api.markDirty();await denied.api.autoSave();
  await assert.rejects(denied.api.flush({force:true}),error=>error.noAutomaticRetry===true);
  await assert.rejects(denied.api.clear(),error=>error.noAutomaticRetry===true);
  assert.equal(appliedDenied,0,'ownership failure must not apply localStorage fallback');
  assert.equal(conflictWrites,0);assert.equal(ownershipAttempts,1);assert.equal(denied.api.status().noAutomaticRetry,true);
  console.log('PASS exposure ownership conflict blocks fallback restore/write/clear and manual or automatic stale retry');
  const image = 'data:image/png;base64,' + 'A'.repeat(1000000);
  const fixture = pluginFixture({ get: () => Promise.resolve(null), put: () => Promise.resolve({ assetCount: 1 }) });
  const original = { version: 1, ts: 1, products: [{ id: 'p', src: image, baseSrc: image,
    meta: { baseSrc: image, outputSrc: image, rotate: 12 }, layouts: { 7: { left: 44, width: 100 } } }],
    logos: [{ id: 'logo', src: image, baseSrc: image }], character: { src: image, meta: { baseSrc: image } } };
  const light = fixture.api.strip(original);
  assert.ok(JSON.stringify(light).length < 1000, 'Summary size must not scale with original image bytes');
  assert.equal(light.products[0].baseSrc, '__BN_IDB__');
  assert.equal(light.products[0].meta.baseSrc, '__BN_IDB__');
  assert.equal(original.products[0].src, image, 'Summary must not modify the live snapshot');
  light.ts = 2; light.products[0].meta.rotate = 30;
  const merged = fixture.api.merge(original, light);
  assert.equal(merged.products[0].meta.baseSrc, image, 'Light geometry must not overwrite full originals with placeholders');
  assert.equal(merged.products[0].meta.rotate, 30);
  assert.equal(merged.logos[0].baseSrc, image);
  assert.equal(merged.character.meta.baseSrc, image);
  console.log('PASS bounded light summary and original-preserving legacy merge');

  const pending = [], captured = [];
  let active = 0, maxActive = 0, x = 1, collects = 0;
  const queued = pluginFixture({ get: () => Promise.resolve(null), put: state => {
    captured.push(state); active++; maxActive = Math.max(maxActive, active);
    return new Promise(resolve => pending.push(() => { active--; resolve({ assetCount: 1 }); }));
  } });
  await queued.api.load({ startup: true }); await queued.api.whenReady();
  queued.api.setCollect(() => { collects++; return { version: 1, ts: collects, products: [{ src: image, baseSrc: image, x }] }; });
  queued.api.markDirty(); const first = queued.api.flush(); await turns();
  assert.equal(pending.length, 1);
  for (x = 2; x <= 10; x++) queued.api.markDirty();
  x = 10;
  assert.equal(queued.api.flush(), first, 'Concurrent saves share one queue promise');
  pending.shift()(); await turns();
  assert.equal(pending.length, 1); assert.equal(captured[1].products[0].x, 10);
  pending.shift()(); await first;
  assert.equal(maxActive, 1); assert.equal(collects, 2, 'Intermediate edits are coalesced to the latest snapshot');
  queued.api.start(); queued.intervals[0](); await turns(); await queued.api.autoSave();
  assert.equal(collects, 2, 'Idle periodic checks must not collect or rewrite unchanged state');
  assert.equal(queued.api.status().state, 'saved');
  assert.ok(queued.writes.every(write => write.key === 'bn_editor_state_v1' && write.value.length < 1000));
  assert.ok(queued.events.some(event => event.type === 'bn-state-save-status' && event.detail.state === 'saved'));
  queued.context._bnStateApplying = true;
  queued.listeners.get('input')({ type: 'input', isTrusted: true, target: { closest: () => ({}) } });
  assert.equal(queued.api.status().dirty, true, 'Actual user edits during restore stabilization must still become dirty');
  assert.equal(queued.timers.at(-1).ms, 2000);
  console.log('PASS single write queue, latest edit coalescing, idle no-op and visible save status');

  let attempts = 0, localAttempts = 0, fail = true;
  const failing = pluginFixture({ get: () => Promise.resolve(null), put: () => {
    attempts++; return fail ? Promise.reject(Object.assign(new Error('test quota'), { name: 'QuotaExceededError' })) : Promise.resolve({ assetCount: 1 });
  } }, { setItem: () => { localAttempts++; throw new Error('local quota'); } });
  await failing.api.load({ startup: true });
  failing.data.set('bn_editor_state_v1_full', 'old-successful-snapshot');
  failing.api.setCollect(() => ({ version: 1, ts: attempts + 1, products: [{ src: image, baseSrc: image }] }));
  failing.api.markDirty();
  for (let i = 0; i < 3; i++) { failing.api.setClock(0); await failing.api.autoSave(); }
  for (let i = 0; i < 10; i++) { failing.api.markDirty(); failing.api.setClock(0); await failing.api.autoSave(); }
  assert.equal(attempts, 3, 'Persistent failures stop after initial attempt and two automatic retries');
  assert.equal(localAttempts, 1, 'localStorage quota failures do not retry on every edit');
  assert.equal(failing.api.status().retryPaused, true);
  assert.equal(failing.warnings.length, 1, 'The same save failure must not flood the console');
  assert.equal(failing.data.get('bn_editor_state_v1_full'), 'old-successful-snapshot');
  fail = false; await failing.api.flush({ force: true });
  assert.equal(attempts, 4); assert.equal(localAttempts, 2); assert.equal(failing.api.status().state, 'saved');
  assert.equal(failing.data.has('bn_editor_state_v1_full'), false, 'Legacy full backup is retired only after IDB commit succeeds');
  console.log('PASS bounded failure retries, no full localStorage fallback and explicit recovery');

  let finishRead, applyCount = 0;
  const stale = pluginFixture({ get: () => new Promise(resolve => { finishRead = resolve; }) });
  stale.api.setApply(() => { applyCount++; });
  const restoring = stale.api.load({ startup: true }); await turns();
  stale.api.markDirty(); finishRead({ version: 1, ts: 1 }); await restoring; await stale.api.whenReady();
  assert.equal(applyCount, 0, 'Late startup restore must not overwrite new user edits');
  console.log('PASS ready Promise and protection from late startup restoration');

  let corruptedWrites = 0;
  const corrupt = pluginFixture({ get: () => Promise.reject(new Error('Missing image asset')),
    put: () => { corruptedWrites++; return Promise.resolve(); } });
  await corrupt.api.load({ startup: true });
  corrupt.api.markDirty(); await corrupt.api.autoSave();
  assert.equal(corruptedWrites, 0, 'Failed restoration must not let initialization overwrite the previous stored snapshot');
  assert.equal(corrupt.api.status().restoreFailed, true);
  corrupt.api.apply({ version: 1, products: [] }, { source: 'upload' });
  corrupt.context._bnStateApplying = false;
  corrupt.api.setCollect(() => ({ version: 1, products: [] }));
  await corrupt.api.flush(); assert.equal(corruptedWrites, 1);
  console.log('PASS failed restoration pauses writes until an explicit valid snapshot is applied');

  let stableWrites = 0;
  const stabilizing = pluginFixture({ get: () => Promise.resolve(null), put: () => { stableWrites++; return Promise.resolve(); } });
  await stabilizing.api.load({ startup: true });
  stabilizing.api.setCollect(() => ({ version: 1, products: [] }));
  stabilizing.api.markDirty(); stabilizing.context._bnStateApplying = true;
  const stableSave = stabilizing.api.flush(); await turns();
  assert.equal(stableWrites, 0, 'Manual flush must wait until applying the snapshot has stabilized');
  stabilizing.context._bnStateApplying = false;
  stabilizing.timers.findLast(timer => timer.ms === 100).fn(); await stableSave;
  assert.equal(stableWrites, 1); assert.equal(stabilizing.api.status().state, 'saved');
  console.log('PASS manual flush waits for apply stabilization and actual IDB completion');

  let finishWrite; const clearOrder = [];
  const clearing = pluginFixture({ get: () => Promise.resolve(null),
    put: () => { clearOrder.push('write'); return new Promise(resolve => { finishWrite = resolve; }); },
    clear: () => { clearOrder.push('clear'); return Promise.resolve(); } });
  await clearing.api.load({ startup: true });
  clearing.api.setCollect(() => ({ version: 1, products: [] }));
  clearing.api.markDirty(); const writing = clearing.api.flush(); await turns();
  clearing.context._bnClearingState = true; const cleared = clearing.api.clear(); await turns();
  assert.deepEqual(clearOrder, ['write']); finishWrite(); await writing; await cleared;
  assert.deepEqual(clearOrder, ['write', 'clear'], 'Clear must wait for outstanding saves so stale data cannot reappear afterwards');
  console.log('PASS clear waits for in-flight writes and prevents stale-state resurrection');

  const full = pluginFixture({ get: () => Promise.resolve(null), put: () => Promise.resolve() });
  const c = full.context;
  c.loadLayouts = () => [{ id: 7, file: 'HBN.html' }];
  c._bnProducts = [{ id: 'p', name: 'product', src: 'edited-image', baseSrc: 'original-image', ratio: 1.2,
    crop: { x: 3, y: 4, width: 50 }, meta: { baseSrc: 'original-image', rotate: 27, transientHelper: () => 'not part of a snapshot' },
    layouts: { 7: { left: 12, top: 15, width: 120, height: 100 } } }];
  c._bnLogos = [{ id: 'logo', src: 'logo-image', baseSrc: 'original-logo' }];
  c._bnLogoLayouts = { 7: { left: 14, top: 16, scale: 1.3 } };
  c._bnCharacter = { id: 'char', src: 'char-image', layouts: { 7: { left: 20, top: 30 } } };
  c._bnEndorserPhoto = { id: 'photo', src: 'photo-image', meta: { rotate: 13 }, layouts: { 7: { left: 11 } } };
  c._bnEndorserSign = { id: 'sign', src: 'sign-image', layouts: { 7: { width: 46 } } };
  const bg = { 7: { src: 'background-image', x: 7, y: 8, scale: 2 } };
  c._bnGetBgStates = () => bg; c._bnGetBgActiveId = () => 7;
  let restoredBg;
  c._bnSetBgStates = (states, active) => { restoredBg = { states, active }; };
  const snapshot = full.api.collect();
  assert.equal(snapshot._bodaProjectId, 'project-storage-test');
  assert.equal('transientHelper' in snapshot.products[0].meta, false, 'Snapshot clone retains legacy JSON-compatible filtering without serializing images');
  bg[7].x = 999; assert.equal(snapshot.background.states[7].x, 7, 'Collect must freeze geometry while image bytes remain shared immutable strings');
  c.loadLayouts = () => [{ id: 99, file: 'HBN.html' }];
  full.api.apply(snapshot, { source: 'upload', forceColors: true });
  assert.equal(c._bnProducts[0].layouts[99].left, 12);
  assert.equal(c._bnProducts[0].crop.x, 3); assert.equal(c._bnProducts[0].meta.rotate, 27);
  assert.equal(c._bnProducts[0].baseSrc, 'original-image');
  assert.equal(c._bnLogoLayouts[99].scale, 1.3); assert.equal(c._bnCharacter.layouts[99].left, 20);
  assert.equal(c._bnEndorserPhoto.meta.rotate, 13); assert.equal(c._bnEndorserSign.layouts[99].width, 46);
  assert.equal(restoredBg.states[99].x, 7); assert.equal(restoredBg.active, '99');
  console.log('PASS portable collect/apply preserves crop, rotation, layouts, characters, logos and backgrounds across layout IDs');
}

class CDP {
  constructor(socket) {
    this.socket = socket; this.nextId = 1; this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Browser closed')); }
      this.pending.clear();
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Timed out: ' + method)); }, 20000);
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

async function browserChecks() {
  const executable = [process.env.BODA_TEST_BROWSER,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean).find(file => fs.existsSync(file));
  assert.ok(executable, 'Chrome/Edge is required (or set BODA_TEST_BROWSER)');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'boda-state-test-'));
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><meta charset="utf-8"><title>Isolated state storage test</title>');
  });
  let browser, control, page;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    let launchError; browser.on('error', error => { launchError = error; });
    const portFile = path.join(profile, 'DevToolsActivePort');
    const lines = await until(() => {
      if (launchError) throw launchError;
      if (browser.exitCode !== null) throw new Error('Browser exited before debugger was ready');
      try {
        const lines = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
        return lines.length >= 2 && /^\d+$/.test(lines[0]) && lines[1].startsWith('/') ? lines : false;
      } catch (error) {
        if (['ENOENT', 'EBUSY', 'EPERM'].includes(error.code)) return false;
        throw error;
      }
    }, 'browser debugger');
    control = await CDP.connect('ws://127.0.0.1:' + lines[0] + lines[1]);
    const target = await control.send('Target.createTarget', { url: origin });
    const targets = await (await fetch('http://127.0.0.1:' + lines[0] + '/json/list')).json();
    page = await CDP.connect(targets.find(item => item.id === target.targetId).webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    await until(() => page.evaluate('document.readyState === "complete" && location.origin === ' + JSON.stringify(origin)), 'storage fixture');
    await page.evaluate(codecSource);
    const results = await page.evaluate(`(async function(){
      function check(value,message){if(!value)throw new Error(message);}
      function open(name,version,upgrade){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,version);r.onupgradeneeded=()=>upgrade&&upgrade(r.result);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
      function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||new Error('aborted'));});}
      async function inspect(name){const db=await open(name,2);const tx=db.transaction(['states','assets'],'readonly');const r=tx.objectStore('states').get('current'),a=tx.objectStore('assets').getAll();const done=txDone(tx);await done;db.close();return {state:r.result,assets:a.result};}
      const name='codec-migration-test';
      const image='data:image/png;base64,'+btoa('image-one');
      const other='data:image/png;base64,'+btoa('image-two');
      const svg='data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E';
      const legacy={version:1,ts:1,products:[{id:'p',src:image,baseSrc:image,meta:{baseSrc:image,rotate:21},crop:{x:3},layouts:{7:{left:15}}}],
        columns:[{data:{product:image+', '+other+', '+image}}],background:{src:image},svg:svg};
      let db=await open(name,1,db=>db.createObjectStore('states'));
      let tx=db.transaction('states','readwrite');tx.objectStore('states').put(legacy,'current');await txDone(tx);db.close();
      let codec=BodaStateAssets.create({dbName:name,stateStore:'states',assetStore:'assets',key:'current',dbVersion:2});
      check(JSON.stringify(await codec.get())===JSON.stringify(legacy),'Legacy raw state must hydrate without data loss');
      const migrated=await codec.put(legacy);let stored=await inspect(name);
      check(stored.assets.length===3,'Repeated data URLs must use one asset each');
      check(stored.assets.every(a=>a.blob instanceof Blob),'Assets must be stored as Blobs');
      check(!JSON.stringify(stored.state).includes('data:image/'),'State envelope must contain asset references, not image strings');
      check(JSON.stringify(await codec.get())===JSON.stringify(legacy),'Binary/list/SVG round trip must preserve exact portable values');
      legacy.ts=2;legacy.products[0].layouts[7].left=99;
      const second=await codec.put(legacy);check(second.convertedAssetCount===0,'Geometry-only edits must not reencode existing images');
      codec=BodaStateAssets.create({dbName:name,stateStore:'states',assetStore:'assets',key:'current',dbVersion:2});
      const reloaded=await codec.get();check(reloaded.products[0].layouts[7].left===99,'New codec instance restores saved geometry');
      check((await codec.put(reloaded)).convertedAssetCount===0,'Hydrated asset cache must reuse stored Blobs after reload');
      const before=await inspect(name);
      let rejected=false;try{await codec.put({version:1,ts:3,src:other,invalid:function(){}});}catch(e){rejected=true;}
      check(rejected,'Invalid new state must fail');
      const after=await inspect(name);check(JSON.stringify(after.state)===JSON.stringify(before.state),'Failed state write must preserve previous snapshot');
      check(after.assets.length===before.assets.length,'Failed write must roll back asset creation/deletion');
      await codec.put({version:1,ts:4,src:other});stored=await inspect(name);check(stored.assets.length===1,'Successful replacement must collect unreferenced old assets');
      const frozenInput={version:1,ts:5,src:other,geometry:{x:7},bytes:new Uint8Array([4,5]),buffer:new Uint8Array([6,7]).buffer,date:new Date('2026-11-11T00:00:00Z')};
      const queued=BodaStateAssets.snapshot(frozenInput,{shareBinary:true});check(queued!==frozenInput&&queued.geometry!==frozenInput.geometry&&queued.buffer===frozenInput.buffer,'Queue snapshot freezes metadata while intentionally sharing immutable source buffers');
      const isolated=BodaStateAssets.snapshot(frozenInput);check(isolated.buffer!==frozenInput.buffer&&isolated.bytes!==frozenInput.bytes,'Default snapshot isolates mutable source buffers');
      const freezing=codec.put(frozenInput);frozenInput.geometry.x=999;frozenInput.bytes[0]=99;new Uint8Array(frozenInput.buffer)[0]=99;frozenInput.date.setFullYear(2000);await freezing;
      const frozen=await codec.get();check(frozen.geometry.x===7&&frozen.bytes[0]===4&&new Uint8Array(frozen.buffer)[0]===6&&frozen.date.getFullYear()===2026,'put must freeze mutable geometry, buffers and dates at invocation');
      db=await open(name,2);tx=db.transaction('assets','readwrite');tx.objectStore('assets').delete(stored.state.assetIds[0]);await txDone(tx);db.close();
      rejected=false;try{await codec.get();}catch(e){rejected=/Missing image asset/.test(e.message);}check(rejected,'Missing asset must reject instead of restoring empty images');
      await codec.put({version:1,ts:5,src:other});check((await inspect(name)).assets.length===1,'Cached Blob must repair a missing asset on the next explicit save');
      const temporary=URL.createObjectURL(new Blob(['blob-image'],{type:'image/png'}));
      let portableFetches=0;const portableFetch=window.fetch;
      window.fetch=function(url){if(url===temporary)portableFetches++;return portableFetch.apply(this,arguments);};
      const portableInput={products:[{src:temporary,baseSrc:temporary,meta:{list:' '+temporary+', '+image+' ,'+temporary+' ',x:17}}],unchanged:svg};
      const portablePromise=BodaStateAssets.toPortable(portableInput);portableInput.products[0].meta.x=999;
      const portable=await portablePromise;window.fetch=portableFetch;
      const portableImage='data:image/png;base64,'+btoa('blob-image');
      check(portable.products[0].src===portableImage&&portable.products[0].baseSrc===portableImage,'Portable snapshots convert nested blob originals and outputs');
      check(portable.products[0].meta.list===' '+portableImage+', '+image+' ,'+portableImage+' ','Portable conversion preserves data URL headers and image-list whitespace');
      check(portable.unchanged===svg&&portable.products[0].meta.x===17&&portableInput.products[0].src===temporary,'Portable conversion freezes metadata and leaves input/existing data URLs unchanged');
      check(portableFetches===1,'Each unique portable blob URL must be fetched once');
      await codec.put({version:1,src:temporary,duplicate:temporary});URL.revokeObjectURL(temporary);
      rejected=false;try{await BodaStateAssets.toPortable({src:temporary});}catch(e){rejected=true;}check(rejected,'Revoked portable blob URLs must reject instead of silently dropping the image');
      const blobState=await codec.get();check(blobState.src==='data:image/png;base64,'+btoa('blob-image')&&blobState.src===blobState.duplicate,'Blob URLs must persist as portable images after original URL is revoked');
      check((await inspect(name)).assets.length===1,'Duplicate blob URLs must share one stored asset');
      await codec.clear();check(await codec.get()===null,'Clear removes the snapshot');check((await inspect(name)).assets.length===0,'Clear removes its image assets');
      const blockedName='codec-blocked-test';const blocker=await open(blockedName,1,db=>db.createObjectStore('states'));
      const blocked=BodaStateAssets.create({dbName:blockedName,stateStore:'states',assetStore:'assets',dbVersion:2});
      rejected=false;try{await blocked.get();}catch(e){rejected=e.name==='BlockedError';}check(rejected,'Older tabs blocking upgrade must fail visibly rather than wait forever');
      blocker.close();await blocked.get();
      return {legacyMigration:true,uniqueAssets:migrated.assetCount,geometryReencodes:second.convertedAssetCount,
        atomicRollback:true,garbageCollection:true,frozenSnapshot:true,missingAssetRejected:true,blobRoundTrip:true,portableBlobSnapshot:true,blockedUpgrade:true};
    })()`);
    assert.equal(results.uniqueAssets, 3); assert.equal(results.geometryReencodes, 0);
    console.log('PASS real-browser storage checks: ' + JSON.stringify(results));
  } finally {
    if (control) try { await control.send('Browser.close'); } catch (_) {}
    if (page) page.close(); if (control) control.close();
    if (browser && browser.exitCode === null) {
      await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(3000)]);
      if (browser.exitCode === null) browser.kill();
    }
    await new Promise(resolve => server.close(resolve));
    const target = path.resolve(profile), tempRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(target.startsWith(tempRoot) && path.basename(target).startsWith('boda-state-test-'));
    /* Windows renderer processes may release their profile shortly after the
       browser exits. Cleanup must not mask a more useful test failure. */
    for (let attempt = 0; attempt < 8; attempt++) {
      try { fs.rmSync(target, { recursive: true, force: true }); break; }
      catch (error) {
        if (attempt === 7) console.warn('Temporary browser profile is still locked: ' + target);
        else await delay(250);
      }
    }
  }
}

(async () => { await pluginChecks(); await browserChecks(); console.log('Exposure persistence checks passed.'); })()
  .catch(error => { console.error(error.stack || error); process.exitCode = 1; });
