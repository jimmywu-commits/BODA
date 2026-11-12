'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = { Promise, Blob, ArrayBuffer, Date, setTimeout, clearTimeout };
context.window = context;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../JS/save-queue.js'), 'utf8'), context);
const create = context.BodaSaveQueue.create;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const waitUntil = async predicate => {
  const end = Date.now() + 1500;
  while (!predicate()) { assert.ok(Date.now() < end, 'queue timed out'); await tick(); }
};
async function main() {
  const writes = [], completions = [], releases = [];
  let running = 0, peak = 0;
  const queue = create({ freeze: structuredClone, write(state) {
    writes.push(state); peak = Math.max(peak, ++running);
    return new Promise(resolve => releases.push(() => { running--; resolve(); }));
  }, onSaved: state => completions.push(state.value) });
  const edited = { value: 1, geometry: { x: 9 }, image: 'data:image/png;base64,AAAA' };
  queue.enqueue(edited); edited.geometry.x = 90;
  await tick();
  assert.equal(writes[0].geometry.x, 9, 'metadata is frozen when queued');
  queue.enqueue({ value: 2 }); queue.enqueue({ value: 3 });
  assert.deepEqual(completions, [], 'no successful ACK before commit');
  releases.shift()(); await waitUntil(() => writes.length === 2);
  assert.equal(writes[1].value, 3, 'intermediate pending states are discarded');
  assert.equal(peak, 1, 'writes never overlap');
  releases.shift()(); await queue.flush();
  assert.deepEqual(completions, [1, 3]);
  queue.enqueue({ value: 3, ts: 123 }); await queue.flush();
  assert.equal(writes.length, 2, 'timestamp-only update does not write again');

  let attempts = 0;
  const failed = create({ freeze: structuredClone, retryDelay: 2, write: () => {
    attempts++; return Promise.reject(new Error('quota exceeded'));
  }});
  failed.enqueue({ value: 'keep' });
  await assert.rejects(failed.flush(), /quota exceeded/);
  assert.equal(attempts, 3, 'initial write plus at most two automatic retries');
  assert.equal(failed.getStatus().state, 'paused');
  failed.enqueue({ value: 'latest' }); await tick();
  assert.equal(attempts, 3, 'new edits do not cause a retry storm after a storage failure');

  const stored = [];
  const held = create({ freeze: structuredClone, write: async state => stored.push(state) });
  held.hold(new Error('old draft unreadable'));
  held.enqueue({ value: 'edited' }); await tick();
  assert.equal(stored.length, 0, 'failed startup read cannot overwrite the old draft');
  held.resume(); await held.flush();
  assert.equal(stored[0].value, 'edited');

  const resetWrites = [], resetReleases = [];
  const reset = create({ freeze: structuredClone, write: state => {
    resetWrites.push(state); return new Promise(resolve => resetReleases.push(resolve));
  }});
  reset.enqueue({ project: 'old' }); await tick();
  reset.enqueue({ project: 'old-pending' }); reset.reset(); reset.enqueue({ project: 'new' });
  resetReleases.shift()(); await waitUntil(() => resetWrites.length === 2);
  assert.equal(resetWrites[1].project, 'new', 'reset discards pending work from the old project');
  resetReleases.shift()(); await reset.flush();
  console.log('PASS single writer, frozen metadata, latest pending, dirty-only saves, bounded retries, read-error hold and project reset');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
