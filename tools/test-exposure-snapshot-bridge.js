'use strict';

/* Run: node tools/test-exposure-snapshot-bridge.js
 * Standalone VM regression checks; no browser, storage database or editor frame
 * is created. Deferred promises make readiness and restore races deterministic.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'JS', 'exposure-snapshot-bridge.js'), 'utf8');
const ownershipSource = fs.readFileSync(path.join(__dirname, '..', 'JS', 'storage-ownership.js'), 'utf8');
const turns = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture(extra = {}) {
  const timers = [];
  const context = { Promise, Date,
    navigator: { locks: { request(name, options, callback) { return Promise.resolve(callback({ name })); } } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, ...extra };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(ownershipSource, context, { filename: 'storage-ownership.js' });
  vm.runInContext(source, context, { filename: 'exposure-snapshot-bridge.js' });
  return { api: context.BodaExposureSnapshots, context, timers };
}

function editor(plugin, sync) {
  return { contentWindow: { _bnStatePlugin: plugin, _bnSyncLayoutSnapshot: sync } };
}

function assertUploadOptions(options) {
  assert.ok(options, 'An explicit backup upload must pass apply options');
  assert.equal(options.source, 'upload', 'A portable backup restore is an explicit upload');
  assert.equal(options.forceColors, true, 'The backup must restore its saved colors');
}

async function liveCollectChecks() {
  const ready = deferred(), synced = deferred(), calls = [];
  const state = { products: [{ id: 'p', layouts: { 7: { left: 42 } } }] };
  const f = fixture({ BodaStateAssets: { create() { throw new Error('A live frame must not read an old stored snapshot'); } } });
  const frame = editor({
    whenReady() { calls.push('ready'); return ready.promise; },
    collect() { calls.push('collect'); return state; }, apply() {}
  }, timeout => { calls.push('sync:' + timeout); return synced.promise; });
  const collecting = f.api.collect({ frame, projectId: 'project-current' });
  assert.deepEqual(calls, ['ready']);
  await turns(); assert.deepEqual(calls, ['ready'], 'Collect must wait for the editor startup restore');
  ready.resolve(); await turns();
  assert.deepEqual(calls, ['ready', 'sync:1600']);
  synced.resolve();
  const result = await collecting;
  assert.deepEqual(calls, ['ready', 'sync:1600', 'collect']);
  assert.equal(result.state, state);
  assert.equal(state._bodaProjectId, 'project-current');
  assert.equal(result.note, '');

  const pending = { products: [{ id: 'from-upload' }] };
  f.api.stage(pending);
  assert.equal((await f.api.collect({ frame, projectId: 'project-current' })).state, pending);
  assert.equal(calls.length, 3, 'An unapplied portable snapshot remains authoritative for another backup');

  const failed = fixture(), reason = new Error('startup restore failed');
  const failingFrame = editor({ whenReady: () => Promise.reject(reason), collect() { throw new Error('must not collect'); }, apply() {} });
  await assert.rejects(failed.api.collect({ frame: failingFrame }), error => error === reason);
  console.log('PASS live collection waits for readiness and current layout synchronization; staged backup stays authoritative');
}

async function storedCollectChecks() {
  let saved = { _bodaProjectId: 'project-a', products: [{ id: 'saved' }] }, creates = 0, reads = 0;
  const f = fixture({ BodaStateAssets: { create(options) {
    creates++;
    assert.equal(options.dbName, 'bn_editor_state_db');
    assert.equal(options.stateStore, 'states'); assert.equal(options.assetStore, 'assets');
    assert.equal(options.key, 'current'); assert.equal(options.dbVersion, 2);
    return { get: () => { reads++; return Promise.resolve(saved); } };
  } } });
  const matching = await f.api.collect({ projectId: 'project-a' });
  assert.equal(matching.state, saved); assert.equal(matching.note, '');
  const other = await f.api.collect({ projectId: 'project-b' });
  assert.equal(other.state, null); assert.ok(other.note.length > 0, 'A different project must produce a visible incomplete-backup note');
  saved = { products: [{ id: 'unidentified-legacy' }] };
  const unknown = await f.api.collect({ projectId: 'project-a' });
  assert.equal(unknown.state, null); assert.ok(unknown.note.length > 0);
  saved = null;
  const absent = await f.api.collect({ projectId: 'project-a' });
  assert.equal(absent.state, null); assert.equal(absent.note, '');
  assert.equal(creates, 1, 'Saved-state access reuses one store without mounting an editor');
  assert.equal(reads, 4);
  assert.equal('document' in f.context, false, 'Stored backup checks need no DOM or hidden editor');
  const unavailable = await fixture().api.collect({ projectId: 'project-a' });
  assert.equal(unavailable.state, null); assert.ok(unavailable.note.length > 0);
  console.log('PASS unopened exposure includes stored data only for a matching project and reports unsafe or unavailable fallbacks');
}

async function storedOwnershipChecks() {
  const held = new Set(); let lockRequests = 0, reads = 0;
  const navigator = { locks: { request(name, options, callback) {
    lockRequests++;
    if (held.has(name)) return Promise.resolve(callback(null));
    held.add(name); return Promise.resolve(callback({ name })).finally(() => held.delete(name));
  } } };
  const assets = { create: () => ({ get: async () => { reads++; return { _bodaProjectId: 'same-project', products: [] }; } }) };
  const primary = fixture({ navigator, BodaStateAssets: assets });
  await primary.api.collect({ projectId: 'same-project' });
  assert.equal(reads, 1); assert.equal(lockRequests, 1, 'Saved exposure backup must acquire the origin lock before opening storage');
  // An embedded editor must use this exact parent factory, not instantiate a
  // competing helper in its own window. Same-name ownership remains reusable.
  const sameDocument = primary.context.BodaStorageOwnership.wrap(assets.create(), 'bn_editor_state_db:current');
  await sameDocument.get(); assert.equal(lockRequests, 1);
  const follower = fixture({ navigator, BodaStateAssets: assets });
  await assert.rejects(follower.api.collect({ projectId: 'same-project' }), error => error.name === 'StorageOwnershipError');
  assert.equal(reads, 2, 'Conflicting backup cannot open storage or trigger a database upgrade');
  console.log('PASS stored exposure backups guard reads, share the parent owner with embedded editors and reject a different tab');
}

async function portableCollectionChecks() {
  const converting = deferred(), original = { image: 'blob:current-session' }, converted = { image: 'data:image/png;base64,AAAA' };
  const portableCalls = [];
  const staged = fixture({ BodaStateAssets: { toPortable(state) { portableCalls.push(state); return converting.promise; } } });
  staged.api.stage(original);
  let completed = false;
  const collecting = staged.api.collect({ projectId: 'project-a' }).then(result => { completed = true; return result; });
  await turns();
  assert.equal(completed, false, 'Portable backup collection must await blob conversion');
  assert.deepEqual(portableCalls, [original]);
  converting.resolve(converted);
  assert.equal((await collecting).state, converted);
  assert.equal(original.image, 'blob:current-session', 'Portable conversion must not replace the staged editor state');
  assert.equal(staged.api.pending(), true);

  const calls = [], live = { image: 'blob:live' };
  const f = fixture({ BodaStateAssets: { toPortable(state) { assert.equal(state, live); calls.push('portable'); return Promise.resolve(converted); } } });
  const frame = editor({
    whenReady() { calls.push('ready'); return Promise.resolve(); }, apply() {},
    collect() { calls.push('collect'); return live; }
  }, () => { calls.push('sync'); });
  assert.equal((await f.api.collect({ frame, projectId: 'project-a' })).state, converted);
  assert.deepEqual(calls, ['ready', 'sync', 'collect', 'portable']);

  let conversions = 0;
  const storedState = { _bodaProjectId: 'project-a', image: 'blob:restored-from-IDB' };
  const stored = fixture({ BodaStateAssets: {
    create: () => ({ get: () => Promise.resolve(storedState) }),
    toPortable(state) { assert.equal(state, storedState); conversions++; return Promise.resolve(converted); }
  } });
  assert.equal((await stored.api.collect({ projectId: 'project-a' })).state, converted);
  assert.equal((await stored.api.collect({ projectId: 'project-b' })).state, null);
  assert.equal(conversions, 1, 'An unsafe project fallback must not convert or export another project');
  const failure = new Error('cannot read blob image');
  const rejected = fixture({ BodaStateAssets: { toPortable: () => Promise.reject(failure) } });
  rejected.api.stage(original);
  await assert.rejects(rejected.api.collect(), error => error === failure);
  assert.equal(rejected.api.pending(), true, 'A conversion failure must retain the original pending restore');
  console.log('PASS staged, live and matching stored backups await portable image conversion and surface conversion failures');
}

async function applyChecks() {
  const ready = deferred(), persisted = deferred(), calls = [];
  const state = { _bodaProjectId: 'old-id', products: [{ id: 'restore-me' }] };
  const f = fixture();
  const frame = editor({
    whenReady() { calls.push('ready'); return ready.promise; }, collect() {},
    apply(value, options) { assert.equal(value, state); assertUploadOptions(options); calls.push('apply'); },
    markDirty() { calls.push('dirty'); },
    flush(options) { assert.equal(options.force, true); calls.push('flush'); return persisted.promise; }
  });
  f.api.stage(state);
  assert.equal(f.api.pending(), true); assert.equal(f.context.__bodaPendingExposureRestore, true);
  const applying = f.api.apply(frame, { projectId: 'new-id' });
  await turns(); assert.deepEqual(calls, ['ready']);
  ready.resolve(); await turns();
  assert.deepEqual(calls, ['ready', 'apply', 'dirty', 'flush']);
  assert.equal(state._bodaProjectId, 'new-id');
  assert.equal(f.api.pending(), false); assert.equal(f.context.__bodaPendingExposureRestore, false);
  let complete = false; applying.then(() => { complete = true; });
  await turns(); assert.equal(complete, false, 'Apply completion must await the explicit persistence flush');
  persisted.resolve(); assert.equal(await applying, true);
  assert.equal(await f.api.apply(frame), false, 'A completed restore is consumed exactly once');
  console.log('PASS restore waits for readiness, applies upload colors, marks dirty and awaits a forced flush');
}

async function failedFlushChecks() {
  const f = fixture(), failure = new Error('storage quota'), calls = [];
  const state = { products: [{ id: 'old-backup' }] };
  let live = null;
  const frame = editor({
    whenReady: () => Promise.resolve(),
    apply(value, options) { assertUploadOptions(options); calls.push('apply'); live = value; },
    collect: () => live,
    markDirty() { calls.push('dirty'); },
    flush() { calls.push('flush'); return Promise.reject(failure); }
  });
  f.api.stage(state);
  await assert.rejects(f.api.apply(frame, { projectId: 'project-a' }), error => error === failure && error.restoreApplied === true);
  assert.equal(f.api.pending(), false); assert.equal(f.context.__bodaPendingExposureRestore, false);
  live = { products: [{ id: 'user-edit-after-restore' }] };
  assert.equal(await f.api.apply(frame, { projectId: 'project-a' }), false);
  assert.equal((await f.api.collect({ frame, projectId: 'project-a' })).state, live);
  assert.deepEqual(calls, ['apply', 'dirty', 'flush'], 'A storage failure must not replay an old snapshot over later user edits');
  console.log('PASS failed flush identifies an already-applied restore and never replays its stale snapshot');
}

async function raceChecks() {
  const ready = deferred(), f = fixture(), applied = [];
  const first = { name: 'first' }, middle = { name: 'middle' }, latest = { name: 'latest' };
  const frame = editor({
    whenReady: () => ready.promise, collect() {},
    apply(value, options) { assertUploadOptions(options); applied.push(value); },
    flush: () => Promise.resolve()
  });
  f.api.stage(first);
  const firstRestore = f.api.apply(frame, { projectId: 'project-a' });
  f.api.stage(middle); const overlapping = f.api.apply(frame, { projectId: 'project-a' });
  f.api.stage(latest); ready.resolve();
  await Promise.all([firstRestore, overlapping]);
  assert.deepEqual(applied, [latest], 'Readiness delays and overlapping apply calls must select the latest staged backup');
  assert.equal(f.api.pending(), false);

  const writing = deferred(), duringFlush = fixture(), flushed = [];
  const frame2 = editor({
    collect() {}, whenReady: () => Promise.resolve(),
    apply(value, options) { assertUploadOptions(options); flushed.push(value); },
    flush: () => flushed.length === 1 ? writing.promise : Promise.resolve()
  });
  duringFlush.api.stage(first); const restoring = duringFlush.api.apply(frame2);
  await turns(); assert.deepEqual(flushed, [first]);
  duringFlush.api.stage(latest); writing.resolve();
  await restoring;
  assert.deepEqual(flushed, [first, latest], 'A newer upload staged during persistence must be applied after the current write');
  assert.equal(duringFlush.api.pending(), false);
  console.log('PASS newest staged restore wins before readiness and while an earlier restore is flushing');
}

async function legacyAndClearChecks() {
  const ready = deferred(), f = fixture(); let applies = 0, readyCalls = 0;
  const frame = editor({ whenReady: () => { readyCalls++; return ready.promise; }, collect() {}, apply() { applies++; } });
  const legacy = { version: 1, columns: [] };
  f.api.stage(legacy.exposureState);
  assert.equal(f.api.pending(), false); assert.equal(f.context.__bodaPendingExposureRestore, false);
  assert.equal(await f.api.apply(frame), false); assert.equal(readyCalls, 0);
  f.api.stage({ products: [{ id: 'obsolete' }] });
  const restoring = f.api.apply(frame);
  f.api.clear(); ready.resolve();
  assert.equal(await restoring, false); assert.equal(applies, 0);
  assert.equal(f.api.pending(), false); assert.equal(f.context.__bodaPendingExposureRestore, false);
  f.api.clear(); f.api.stage(null); f.api.stage('invalid legacy field');
  assert.equal(await f.api.apply(frame), false); assert.equal(applies, 0);
  console.log('PASS legacy backups without exposure data and clear during readiness safely cancel stale restoration');
}

(async () => {
  await liveCollectChecks();
  await storedCollectChecks();
  await storedOwnershipChecks();
  await portableCollectionChecks();
  await applyChecks();
  await failedFlushChecks();
  await raceChecks();
  await legacyAndClearChecks();
  console.log('All exposure snapshot bridge checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
