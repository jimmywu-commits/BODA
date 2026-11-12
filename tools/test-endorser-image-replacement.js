'use strict';

// Behavioral fixtures execute the production handlers and geometry/serialization helpers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.resolve(__dirname, '../shopee/js');
const editor = fs.readFileSync(path.join(base, 'bn-editor-plugin.js'), 'utf8');
const runtime = fs.readFileSync(path.join(base, 'layout-runtime.js'), 'utf8');
new vm.Script(editor);
new vm.Script(runtime);
function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Missing production section: ' + start);
  return source.slice(a, b);
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

async function modelReplacement() {
  const context = {
    Promise, Date, Math,
    loadImg: src => Promise.resolve({ src }),
    autoTrim: img => ({ src: img.src + '-sign-trim', ratio: 5 }),
    endorserAlphaTrim: img => ({ src: img.src + '-photo-trim', ratio: 2 }),
    ENDORSER_LABEL: { _bnEndorserPhoto: 'photo', _bnEndorserSign: 'sign' }
  };
  vm.createContext(context);
  vm.runInContext(section(editor, '    function makeEndorserSlotFromSrc(', '    /* ── 工單匯入時分辨'), context);
  for (const key of ['_bnEndorserPhoto', '_bnEndorserSign']) {
    const previous = { id: key + '-existing', aboveMain: true,
      layouts: { one: { left: 300, top: 40, width: 100, height: 200, frameRatio: .5 } },
      meta: { rotate: 35 } };
    const before = plain(previous);
    const replacement = await context.makeEndorserSlotFromSrc(key, 'new-source', 'new.png', previous);
    assert.equal(replacement.id, previous.id);
    assert.equal(replacement.layouts, previous.layouts, 'Late snapshots must still reach the retained layout map');
    assert.equal(replacement.aboveMain, true);
    assert.equal(replacement.ratio, key.endsWith('Sign') ? 5 : 2, 'Model keeps the new natural image ratio');
    assert.equal(replacement.meta.rotate, 0, 'A genuinely new image starts unrotated');
    assert.deepEqual(plain(previous), before, 'Preparing a replacement must not mutate the old object');
    const fresh = await context.makeEndorserSlotFromSrc(key, 'first-source', 'first.png', null);
    assert.deepEqual(plain(fresh.layouts), {});
    assert.notEqual(fresh.id, previous.id);
  }
  console.log('PASS photo/sign replacement retains model identity, layout maps and stacking');
}

function runtimeFixture() {
  const messages = [], timers = [], animationFrames = [], preloads = [];
  const calls = { create: 0, defaultLayout: 0, arrange: 0, assign: 0 };
  const boxes = {};
  const note = { style: { left: '190px', top: '70px', display: '', fontSize: '20px' },
    textContent: '代言人', offsetWidth: 80, offsetHeight: 20,
    _bnLayoutSrc: 'one', _bnLayout: { manual: true, src: 'one', noteRel: { to: 'sign', x: 0, y: -1.5 } } };
  const geom = { CW: 1000, CH: 400, ZW: 600, ZH: 300, ZX: 0, ZY: 0, em: 20, portrait: false };
  function makeBox(slot, id, src, ratio, rect) {
    let source = src;
    const img = { style: { transform: 'rotate(12deg)' }, naturalWidth: ratio * 200, naturalHeight: 200,
      getAttribute: name => name === 'src' ? source : null };
    Object.defineProperty(img, 'src', { get: () => source, set: value => { source = value; calls.assign++; } });
    const box = {
      dataset: { slot, id, ratio: String(ratio), imageRatio: String(ratio), rotate: '25',
        aboveMain: '0', manualLayout: '1', endorser: slot.endsWith('Sign') ? 'sign' : 'photo' },
      style: { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' },
      _bnLayoutSrc: 'one', eventToken: {},
      querySelector: selector => selector === 'img' ? img : null,
      classList: { contains: name => name === 'bn-endorser-box' },
      getBoundingClientRect() { return { left: parseFloat(this.style.left), top: parseFloat(this.style.top),
        width: parseFloat(this.style.width), height: parseFloat(this.style.height) }; }
    };
    boxes[slot] = box;
    return box;
  }
  const photo = makeBox('_bnEndorserPhoto', 'photo-1', 'old-photo', .5, { left: 300, top: 40, width: 100, height: 200 });
  const sign = makeBox('_bnEndorserSign', 'sign-1', 'old-sign', 3, { left: 190, top: 100, width: 90, height: 30 });
  const zone = { style: {}, dataset: { endorserAuto: '0' },
    querySelector(selector) { const match = /data-slot="([^"]+)"/.exec(selector); return match ? boxes[match[1]] || null : null; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 300 }) };
  const context = {
    console, Math, JSON, Number, isFinite,
    _bnEndorserTemplate: true, _bnEndorserMasterTemplate: true, _bnEndorserNoteState: { text: '代言人' },
    getProductZone: () => zone, getEndorserBox: slot => boxes[slot] || null,
    getEndorserNoteEl: () => note, getCurrentBnId: () => 'one',
    endorserGeom: () => geom, endorserNoteBaseFontSize: () => 20,
    getProductSyncArea: () => ({ left: 0, top: 0, width: 600, height: 300, mode: 'cta-safe' }),
    syncCharGradientOverlay() {}, applyCharacterZ() {}, refreshEndorserNoteColorSoon() {}, refreshEndorserNoteColor() {},
    fitEndorser() {}, markEndorserNoteManual() {}, postEndorserNoteLayout() {},
    repostEndorserCompanions() {}, repostEndorserNote() {},
    setTimeout(fn) { timers.push(fn); },
    Image: function Image() { preloads.push(this); },
    createEndorserBox(slot, data) { calls.create++; return makeBox(slot, data.id, data.src, data.ratio, { left: 0, top: 0, width: 20, height: 20 }); },
    applyDefaultEndorserLayout() { calls.defaultLayout++; }, endorserSetDefaultBase() {},
    window: { getComputedStyle: () => ({ width: '600px', height: '300px' }),
      requestAnimationFrame: fn => animationFrames.push(fn), parent: { postMessage: data => messages.push(plain(data)) } }
  };
  vm.createContext(context);
  const load = (start, end) => vm.runInContext(section(runtime, start, end), context);
  load('  function endorserBoxRect(', '  /* 預設擺法');
  load('  function endorserImgRatio(', '  /* 沒有存過位置時的預設擺法');
  load('  function endorserNoteRectFromLayout(', '  /* 文字區（自動配合時');
  load('  function arrangeEndorser(){', '  function positionEndorserNote(');
  load('  function postCharacterLayout(', '  function scheduleCharLayoutPost(');
  load('  function applySavedCharLayout(', '  function postCharacterLayout(');
  load('  function applyEndorserNoteMessage(', '  /* 代言人小字自動黑白字');
  load('  function updateEndorserImage(', '  /* ── 代言人小字 ──');
  photo._bnFrame = context.endorserFrameFromRect(context.endorserBoxRect(photo), geom);
  sign._bnTextRel = context.endorserSignRelFromRects(context.endorserBoxRect(sign), context.endorserBoxRect(photo), geom.em);
  const actualArrange = context.arrangeEndorser;
  context.arrangeEndorser = function () { calls.arrange++; return actualArrange(); };
  const handler = vm.runInContext('(function(e){' + section(runtime, "    if (e.data.type === 'bn-endorser-add')", "    if (e.data.type === 'bn-endorser-remove')") + '})', context);
  return { context, photo, sign, note, zone, boxes, calls, messages,
    handle: data => handler({ data: { type: 'bn-endorser-add', ...data } }),
    preloads,
    flushFrames() { while (animationFrames.length) animationFrames.shift()(); },
    finishImage(index, width, height, error) {
      preloads[index].naturalWidth = width; preloads[index].naturalHeight = height;
      if (error) preloads[index].onerror(); else preloads[index].onload();
    },
    flush() { while (timers.length) timers.shift()(); } };
}

function runtimeReplacement() {
  const f = runtimeFixture();
  const frames = () => plain({ photo: f.photo.style, sign: f.sign.style, note: f.note.style });
  const before = frames(), token = f.photo.eventToken, frameBase = f.photo._bnFrame, signBase = f.sign._bnTextRel;
  f.handle({ slot: '_bnEndorserPhoto', id: 'photo-1', src: 'new-landscape-photo', ratio: 2, rotate: 0, aboveMain: true,
    layoutById: { one: { left: 1, top: 2, width: 3, height: 4 } } });
  assert.deepEqual(frames(), before, 'Replacing the photo must preserve every current frame and companion');
  assert.equal(f.photo.eventToken, token);
  assert.equal(f.photo._bnFrame, frameBase);
  assert.equal(f.sign._bnTextRel, signBase);
  assert.equal(f.photo.dataset.ratio, '0.5');
  assert.equal(f.photo.dataset.imageRatio, '2');
  assert.equal(f.photo.dataset.rotate, '0');
  assert.equal(f.photo.querySelector('img').src, 'new-landscape-photo');
  assert.equal(f.photo.querySelector('img').style.transform, '');
  assert.equal(f.calls.create, 0);
  assert.equal(f.calls.arrange, 0, 'Replacement must not invoke the automatic placement pipeline');
  f.handle({ slot: '_bnEndorserSign', id: 'sign-1', src: 'new-square-sign', ratio: 1, rotate: 0 });
  assert.equal(f.sign.dataset.ratio, '3');
  assert.equal(f.sign.dataset.imageRatio, '1');
  assert.deepEqual(frames(), before);
  const assigned = f.calls.assign;
  f.handle({ slot: '_bnEndorserPhoto', id: 'photo-1', src: 'new-landscape-photo', ratio: 2, rotate: 0, aboveMain: true });
  assert.equal(f.calls.assign, assigned, 'Identical replay must not reload the image');
  f.context.arrangeEndorser();
  f.context.applyEndorserNoteMessage({ text: '代言人', color: '#ffffff', layoutById: { one: plain(f.note._bnLayout) } });
  assert.deepEqual(frames(), before, 'Later arrange/note replay must retain both frames despite new natural ratios');
  f.flush();
  assert.ok(f.messages.every(message => message.snapshotOnly === true));
  const photoLayout = f.messages.find(message => message.id === 'photo-1').layout;
  const signLayout = f.messages.find(message => message.id === 'sign-1').layout;
  assert.equal(photoLayout.frameRatio, .5);
  assert.equal(signLayout.frameRatio, 3);

  // Simulate the saved layout being restored with the new natural image ratios.
  f.photo.dataset.ratio = '2'; f.sign.dataset.ratio = '1';
  Object.assign(f.photo.style, { left: '0px', top: '0px', width: '20px', height: '10px' });
  Object.assign(f.sign.style, { left: '0px', top: '0px', width: '20px', height: '20px' });
  assert.equal(f.context.applyEndorserBoxLayout(f.photo, f.zone, plain(photoLayout)), true);
  assert.equal(f.context.applyEndorserBoxLayout(f.sign, f.zone, plain(signLayout)), true);
  f.context.arrangeEndorser();
  assert.deepEqual(frames(), before, 'Save/restore must preserve frame aspect as well as position');
  const legacyPhoto = plain(photoLayout); delete legacyPhoto.frameRatio;
  f.photo.dataset.ratio = '2';
  f.context.applyEndorserBoxLayout(f.photo, f.zone, legacyPhoto);
  f.context.arrangeEndorser();
  assert.deepEqual(frames(), before, 'Existing snapshots can recover frame aspect from saved width/height');
  f.handle({ slot: '_bnEndorserPhoto', id: 'genuinely-different-photo', src: 'other-photo', ratio: .8 });
  assert.equal(f.calls.create, 1, 'A different identity must still use the normal new-object path');
  assert.equal(f.calls.defaultLayout, 1);
  console.log('PASS in-place replacement, stale replay, late arrange/note, and save/restore preserve photo/sign frames');
}

function deferredImageUpdates() {
  const f = runtimeFixture();
  const snapshot = () => plain({ photo: f.photo.style, sign: f.sign.style, note: f.note.style,
    src: f.photo.querySelector('img').src, ratio: f.photo.dataset.ratio, imageRatio: f.photo.dataset.imageRatio,
    rotate: f.photo.dataset.rotate, messages: f.messages });
  f.context.updateEndorserImage(f.photo, { src: 'obsolete-rotation', keepScale: true, rotate: 90 });
  f.handle({ slot: '_bnEndorserPhoto', id: 'photo-1', src: 'replacement-photo', ratio: 2, rotate: 0 });
  const replacement = snapshot();
  f.finishImage(0, 400, 100);
  f.flushFrames();
  assert.deepEqual(snapshot(), replacement, 'An older preload must not overwrite a replacement or its companions');

  f.context.updateEndorserImage(f.photo, { src: 'obsolete-queued-frame', keepScale: true, rotate: 20 });
  f.finishImage(1, 400, 100); // Already queued in requestAnimationFrame when the replacement arrives.
  f.handle({ slot: '_bnEndorserPhoto', id: 'photo-1', src: 'newest-replacement', ratio: 1, rotate: 0 });
  const newest = snapshot();
  f.flushFrames();
  assert.deepEqual(snapshot(), newest, 'The guard must also cover an already queued animation callback');

  f.context.updateEndorserImage(f.photo, { src: 'older-edit', rotate: 10 });
  f.context.updateEndorserImage(f.photo, { src: 'latest-edit', rotate: 30 });
  f.finishImage(3, 120, 200); f.flushFrames();
  const latest = snapshot();
  assert.equal(latest.src, 'latest-edit');
  f.finishImage(2, 500, 100); f.flushFrames();
  assert.deepEqual(snapshot(), latest, 'Out-of-order edits must publish only the newest image');

  f.context.updateEndorserImage(f.photo, { src: 'failed-old-image', rotate: 50 });
  f.handle({ slot: '_bnEndorserPhoto', id: 'photo-1', src: 'replacement-after-failure', ratio: .8, rotate: 0 });
  const afterFailure = snapshot();
  f.finishImage(4, 0, 0, true);
  assert.deepEqual(snapshot(), afterFailure, 'A stale error fallback must not restore an old source');

  f.context.updateEndorserImage(f.photo, { src: 'removed-slot-edit', rotate: 50 });
  f.handle({ slot: '_bnEndorserPhoto', id: 'different-photo-id', src: 'different-photo', ratio: .8 });
  const newBox = f.boxes._bnEndorserPhoto, newFrame = plain(newBox.style);
  f.finishImage(5, 300, 100); f.flushFrames();
  assert.equal(newBox.querySelector('img').src, 'different-photo');
  assert.deepEqual(plain(newBox.style), newFrame, 'A detached old box cannot rearrange the new live slot');
  console.log('PASS delayed load, queued animation, out-of-order edits, errors and removed slots reject stale image updates');
}

(async function () {
  await modelReplacement();
  runtimeReplacement();
  deferredImageUpdates();
})().catch(error => { console.error(error); process.exitCode = 1; });
