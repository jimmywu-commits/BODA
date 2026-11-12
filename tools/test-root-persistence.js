'use strict';

/* Run: node tools/test-root-persistence.js
 * Executes the actual named persistence functions from index.html in a VM,
 * together with the real save queue and asset snapshot implementation. Only
 * the codec's asynchronous disk boundary and unrelated rendering are stubbed.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const codecSource = fs.readFileSync(path.join(root, 'JS', 'state-asset-codec.js'), 'utf8');
const queueSource = fs.readFileSync(path.join(root, 'JS', 'save-queue.js'), 'utf8');
const ownershipSource = fs.readFileSync(path.join(root, 'JS', 'storage-ownership.js'), 'utf8');
const turns = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const plain = value => JSON.parse(JSON.stringify(value));

function actualFunction(name) {
  const match = new RegExp('\\bfunction\\s+' + name + '\\s*\\(').exec(indexSource);
  assert.ok(match, 'Actual root function exists: ' + name);
  // Let the JavaScript parser find the first complete declaration. This also
  // handles braces inside comments, regexes and strings without a custom lexer.
  for (let end = indexSource.indexOf('}', match.index); end >= 0; end = indexSource.indexOf('}', end + 1)) {
    const candidate = indexSource.slice(match.index, end + 1);
    try { new vm.Script('(' + candidate + ')'); return candidate; } catch (_) {}
  }
  throw new Error('Cannot extract actual root function: ' + name);
}

function actualClickHandler(marker) {
  const at = indexSource.indexOf(marker);
  assert.ok(at >= 0, 'Actual root click handler exists: ' + marker);
  const start = indexSource.indexOf('function', at + marker.length);
  for (let end = indexSource.indexOf('}', start); end >= 0; end = indexSource.indexOf('}', end + 1)) {
    const candidate = indexSource.slice(start, end + 1);
    try { new vm.Script('(' + candidate + ')'); return candidate; } catch (_) {}
  }
  throw new Error('Cannot extract actual root click handler: ' + marker);
}

function actualDeclaration(name) {
  const match = new RegExp('^[ \\t]*var\\s+' + name + '\\s*=[^\\r\\n]+;', 'm').exec(indexSource);
  assert.ok(match, 'Actual root configuration exists: ' + name);
  return match[0];
}

const functionNames = [
  'getImportAssetStore', 'withDraftStorageOwnership', 'importIdbPut', 'importIdbGet', 'getImportSaveQueue', 'waitForPersistenceWrites',
  'queueImportStateSave', 'newImportImageLayoutId', 'importOnlyImageLayout',
  'currentImportImageLayout', 'applyPersistedImportImageLayout',
  'beginImportImageLayoutDocument', 'saveImportImageLayout', 'restoreImportImageLayout',
  'buildImportStateSavePayload', 'importStateFitsLocalStorage', 'saveImportState',
  'normalizeImportState', 'loadImportState', 'applyImportState', 'loadImportStateFromIdb',
  'cloneImportImagePartLayerOrder', 'getBottomAssetStore', 'bottomPersistPut',
  'bottomPersistGet', 'getBottomSaveQueue', 'clearBottomPersistDraft', 'buildBottomPersistPayload', 'flushBottomPersist', 'queueBottomPersist',
  'restoreBottomPersist', 'importUploadStateFields', 'importUploadsForBottomPersist',
  'importUploadFromPersist', 'getBottomStateForSync', 'rememberBottomWorkOrder',
  'extractEmbeddedBottomState', 'buildImportedWorkOrderXlsxFile', 'freezeAutosave', 'isToolKey', 'clearToolStorage',
  'clearImportCanvasContent', 'deepClearAll'
];
const actualSource = [
  ...['IMPORT_STORAGE_KEY', 'IMPORT_IMAGE_LAYOUT_STORAGE_KEY', 'IMPORT_IDB_NAME',
    'IMPORT_IDB_STORE', 'BOTTOM_PERSIST_DB', 'BOTTOM_PERSIST_STORE', 'RESET_KEEP_KEYS', 'RESET_IDB'].map(actualDeclaration),
  ...functionNames.map(actualFunction)
].join('\n');

function fixture(options = {}) {
  const timers = new Map(), local = new Map(), localWrites = [], statuses = [], rendered = [], stringifyInputs = [];
  const stores = {
    activity: { writes: [], reads: 0, clears: 0, creates: [], data: null },
    bottom: { writes: [], reads: 0, clears: 0, creates: [], data: null }
  };
  let timerId = 0;
  const context = {
    Promise, Blob, ArrayBuffer, Uint8Array, Date, Math,
    navigator: { locks: options.locks || { request(name, settings, callback) { return Promise.resolve(callback({ name })); } } },
    console: { warn() {}, log() {} },
    JSON: { parse: JSON.parse, stringify(value, ...args) { stringifyInputs.push(value); return JSON.stringify(value, ...args); } },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    localStorage: { getItem: key => local.get(key) || null,
      setItem(key, value) { localWrites.push({ key, value }); local.set(key, value); }, removeItem: key => local.delete(key) },
    document: { getElementById: () => null },
    currentImportColumns: [], currentImportWorkbook: null, currentImportWorkbookBuffer: null,
    currentImportWorkbookName: '', currentImportHasBottomWorkOrder: false,
    currentImportSource: 'saved', currentGeneratorSignature: '', currentImportImageLayoutId: '',
    importImageLayoutSavedAt: 0, importImageLayoutEditRevision: 0, importPersistDisabled: false,
    importAssetStore: null, importSaveQueue: null, importPersistReadFailed: false, importReadFailureSnapshot: null,
    importStateSaveTimer: null, importStateRestorePending: false, importStateSaveAfterRestore: false,
    importResourceRenderPending: false, importResourceShadowPending: false,
    importResourceShadowCommit: false, importResourceShadowExposure: false,
    importResourceLastShadowError: null,
    importShadowReapplyRunning: false, importShadowQueuedRequest: null,
    importImageUndoStack: [], importImageRedoStack: [], importImageGestureBefore: null,
    blocksLoadedForImport: true,
    bottomPersistTimer: null, bottomPersistRestoring: false, bottomAssetStore: null, bottomSaveQueue: null,
    bottomPersistReadFailed: false, bottomPersistFailureRevision: 0, bottomPersistRestorePending: false,
    bottomPersistSaveAfterRestore: false, bottomPersistEditRevision: 0,
    bottomPersistParsedJson: '', bottomPersistParsedState: null,
    latestBottomWorkOrder: null, bottomWorkOrderVersion: 0, bottomSharedStateJson: '',
    bottomLastEditedStateJson: '', bottomGeneratorStateJson: '', bottomStandaloneStateJson: '',
    bottomWorkOrderNeedsParserAuthority: false, importBottomPreviewResult: null,
    bottomBridgeReady: false, bottomPreviewBridgeReady: false, standaloneBottomBridgeReady: false,
    currentPaletteTab: '', uploadedImages: [],
    imageState: { weights: {}, offsets: {} },
    captureImportImageHistoryState() { return context.imageState; },
    reportPersistenceStatus(scope, status) { statuses.push({ scope, ...status }); },
    renderImportColumns(columns) { rendered.push(columns); },
    renderImageGallery() { rendered.push('gallery'); },
    importShadowGeometryFromState() {},
    syncBottomAfterImportAction(reason) { rendered.push(reason); },
    dispatchBottomPreviewForExport() { rendered.push('bottom-preview'); },
    bottomStateFromLayoutTemplate() { return ''; },
    appLoadingUpdate() {},
    applyImportColumnsToWorkbook() { return 3; }
  };
  context.BNImageLayout = {
    setState(value) { context.imageState = value; },
    setWeights(value) { context.imageState.weights = value; },
    setOffsets(value) { context.imageState.offsets = value; }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(ownershipSource, context, { filename: 'JS/storage-ownership.js' });
  vm.runInContext(codecSource, context, { filename: 'JS/state-asset-codec.js' });
  const snapshot = context.BodaStateAssets.snapshot;
  context.BodaStateAssets.create = options => {
    const store = options.dbName === 'boda-import-persist' ? stores.activity :
      options.dbName === 'boda-bottom-persist' ? stores.bottom : null;
    assert.ok(store, 'Root must use the existing project database names');
    store.creates.push(options);
    return {
      get() { store.reads++; return store.getHandler ? store.getHandler() : Promise.resolve(store.data); },
      put(value) { store.writes.push(value); return store.putHandler ? store.putHandler(value) : Promise.resolve({ assetCount: 1 }); },
      clear() { store.clears++; return store.clearHandler ? store.clearHandler() : Promise.resolve(); }
    };
  };
  const snapshots = [];
  context.BodaStateAssets.snapshot = (value, options) => { snapshots.push({ value, options }); return snapshot(value, options); };
  vm.runInContext(queueSource, context, { filename: 'JS/save-queue.js' });
  vm.runInContext(actualSource, context, { filename: 'index.html actual persistence functions' });
  return { context, stores, timers, local, localWrites, statuses, rendered, stringifyInputs, snapshots,
    runTimer(ms) {
      const entry = Array.from(timers).find(([, timer]) => timer.ms === ms);
      assert.ok(entry, 'Expected root debounce timer: ' + ms);
      timers.delete(entry[0]); entry[1].fn();
    }
  };
}

function column(text, image = 'data:image/png;base64,AAAA') {
  return { blockId: 'subarea_A_1', header: '主區', band: 1, guarantee: true,
    data: { title: text, productImg: image }, _imageOrder: ['productImg'],
    _imagePartLayerOrder: { productImg: [1, 0] }, _dynamicRowRows: [1, 2],
    _xlsxBindings: [{ address: 'C9', targetKey: 'title', label: '品名' }] };
}

function checkStoreConfiguration(store) {
  assert.equal(store.creates.length, 1, 'Root must reuse its codec instance');
  const options = store.creates[0];
  assert.equal(options.dbVersion, 2, 'Existing databases must be upgraded through the v2 codec');
  assert.equal(options.stateStore, 'kv'); assert.equal(options.assetStore, 'assets'); assert.equal(options.key, 'current');
}

async function activityWiringChecks() {
  const f = fixture(), c = f.context;
  const image = 'data:image/png;base64,' + 'A'.repeat(1100000);
  c.currentImportColumns = [column('保存完整編輯', image)];
  c.imageState = { weights: { 'imp-mount-0::productImg': 1.4, 'preview-mount-0::productImg': 9 },
    offsets: { 'imp-mount-0::productImg': { x: 12, y: 15 } } };
  c.saveImportState(); await c.getImportSaveQueue().flush();
  const saved = f.stores.activity.writes[0];
  assert.equal(saved.columns[0].data.productImg, image, 'Root delegates image extraction to the codec without lossy stripping');
  assert.equal(saved.columns[0].data.title, '保存完整編輯');
  assert.deepEqual(plain(saved.columns[0].imagePartLayerOrder), { productImg: [1, 0] });
  assert.deepEqual(plain(saved.columns[0].xlsxBindings), [{ address: 'C9', targetKey: 'title', label: '品名' }]);
  assert.deepEqual(plain(saved.imageZoomWeights), { 'imp-mount-0::productImg': 1.4 });
  assert.equal(f.local.has(c.IMPORT_STORAGE_KEY), false, 'Large image states must not enter the localStorage fallback');
  assert.equal(f.stringifyInputs.some(value => value && value.columns), false, 'The large activity state must be rejected before JSON.stringify');
  assert.ok(f.snapshots.every(call => call.options.shareBinary === true));
  checkStoreConfiguration(f.stores.activity);

  const old = fixture(), original = column('舊版活動頁', 'data:image/png;base64,BBBB');
  old.stores.activity.data = { version: 2, ts: 500, source: 'xlsx', imageLayoutId: 'old-project',
    imageZoomWeights: { 'imp-mount-0::productImg': 1.7 }, imageOffsets: {},
    columns: [{ ...original, imageOrder: original._imageOrder, imagePartLayerOrder: original._imagePartLayerOrder,
      dynamicRowRows: original._dynamicRowRows, xlsxBindings: original._xlsxBindings }] };
  assert.equal(await old.context.loadImportStateFromIdb(), true);
  assert.equal(old.context.currentImportColumns[0].data.title, '舊版活動頁');
  assert.equal(old.context.currentImportColumns[0].data.productImg, original.data.productImg);
  assert.equal(old.context.currentImportColumns[0]._xlsxBindings[0].address, 'C9');
  assert.equal(old.context.imageState.weights['imp-mount-0::productImg'], 1.7);
  old.context.saveImportState(); await old.context.getImportSaveQueue().flush();
  assert.equal(old.stores.activity.writes.length, 0, 'A restored baseline must not immediately rewrite unchanged images');
  checkStoreConfiguration(old.stores.activity);
  old.local.set(old.context.IMPORT_STORAGE_KEY, JSON.stringify([original]));
  const legacyLocal = old.context.loadImportState();
  assert.equal(legacyLocal.version, 1); assert.equal(legacyLocal.columns[0].data.title, '舊版活動頁');
  console.log('PASS actual activity wiring uses codec v2, preserves image/layout data, loads old states and avoids large local JSON');
}

async function lazyDerivedPersistenceChecks() {
  const f = fixture(), c = f.context;
  c.currentImportColumns = [column('尚未烘焙但已保存的模型')];
  c.importResourceShadowPending = true;
  c.importResourceRenderPending = true;
  c.saveImportState(); await c.getImportSaveQueue().flush();
  const saved = f.stores.activity.writes[0];
  assert.equal(saved.pendingDerivedAssets, true, 'A model-only save must remember unfinished derived pixels');
  assert.equal(saved.columns[0].data.title, '尚未烘焙但已保存的模型');
  assert.equal(f.rendered.length, 0, 'Persisting the canonical model must not force hidden canvas work');
  assert.equal(JSON.parse(f.local.get(c.IMPORT_STORAGE_KEY)).pendingDerivedAssets, true,
    'The small local fallback must retain pending-derived state too');
  const normalized = c.normalizeImportState(saved);
  assert.equal(normalized.pendingDerivedAssets, true);
  assert.equal(c.normalizeImportState({ columns: [] }).pendingDerivedAssets, false, 'Legacy drafts default to fully derived');
  c.importResourceShadowPending = false;
  c.importShadowReapplyRunning = true;
  assert.equal(c.buildImportStateSavePayload().pendingDerivedAssets, true, 'An in-flight bake is not a completed derived state');
  c.importShadowReapplyRunning = false;
  c.importShadowQueuedRequest = {};
  assert.equal(c.buildImportStateSavePayload().pendingDerivedAssets, true, 'Queued shadow work is saved as pending too');
  c.importShadowQueuedRequest = null;
  assert.equal(c.buildImportStateSavePayload().pendingDerivedAssets, false);
  const direct = fixture(); direct.context.applyImportState(normalized);
  assert.equal(direct.context.importResourceRenderPending, true);
  assert.equal(direct.context.importResourceShadowPending, true);
  assert.equal(direct.context.importResourceShadowCommit, true);
  assert.equal(direct.context.importResourceShadowExposure, true);
  assert.equal(direct.rendered.length, 0, 'Applying restored model state does not render by itself');
  const restored = fixture(), r = restored.context;
  r.blocksLoadedForImport = false;
  restored.stores.activity.data = { ...saved, ts: Date.now() + 1000 };
  assert.equal(await r.loadImportStateFromIdb(), true);
  assert.equal(r.importResourceShadowPending, true, 'Codec/normalization/readback preserves the pending work marker');
  assert.equal(r.currentImportColumns[0].data.title, '尚未烘焙但已保存的模型');
  assert.equal(restored.rendered.length, 0, 'Startup restore with unloaded blocks stays model-only');
  r.saveImportState(); await r.getImportSaveQueue().flush();
  assert.equal(restored.stores.activity.writes.length, 0, 'Restoring a pending-derived baseline does not rewrite an unchanged model');
  r.applyImportState({ columns: [column('已完成烘焙')], pendingDerivedAssets: false });
  assert.equal(r.importResourceShadowPending, false);
  assert.equal(r.importResourceShadowCommit, false);
  assert.equal(r.importResourceShadowExposure, false);
  console.log('PASS lazy model backups and restore retain pending-derived markers without forcing canvas work');
}

async function bottomWiringChecks() {
  const f = fixture(), c = f.context, buffer = new Uint8Array([8, 9, 10]).buffer;
  const state = { banners: [{ slots: [{ text: '吸底', logoSrc: 'data:image/png;base64,CCCC' }] }] };
  const value = { workOrderName: '工單.xlsx', workOrderBuffer: buffer, bottomState: JSON.stringify(state), images: [] };
  await c.bottomPersistPut(value);
  const packed = f.stores.bottom.writes[0];
  assert.equal('bottomState' in packed, false, 'Nested JSON must be unpacked so the codec can see its image fields');
  assert.deepEqual(plain(packed.bottomStateData), state);
  assert.equal(packed.workOrderBuffer, buffer, 'Root passes the immutable workbook buffer to the codec without another clone');
  assert.equal(value.bottomState, JSON.stringify(state), 'Packing must not mutate the public portable state');
  assert.equal('bottomStateData' in value, false);
  await c.bottomPersistPut(value);
  assert.equal(f.stores.bottom.writes[1].bottomStateData, packed.bottomStateData, 'Unchanged bottom JSON reuses its parsed object');
  f.stores.bottom.data = { ...packed };
  const roundTrip = await c.bottomPersistGet();
  assert.equal(roundTrip.bottomState, value.bottomState); assert.equal('bottomStateData' in roundTrip, false);
  f.stores.bottom.data = { ...value };
  assert.equal((await c.bottomPersistGet()).bottomState, value.bottomState, 'Legacy raw nested JSON remains readable');
  checkStoreConfiguration(f.stores.bottom);

  c.uploadedImages = [{ name: '商品.png', url: 'data:image/png;base64,SHADOW', baseUrl: 'data:image/png;base64,ORIGINAL',
    logoUrl: 'data:image/png;base64,LOGO', shadowGeom: { width: 100 }, sourceRevision: 'r1' }];
  c.latestBottomWorkOrder = { name: '工單.xlsx', buffer };
  c.bottomSharedStateJson = value.bottomState; c.currentImportHasBottomWorkOrder = true;
  c.flushBottomPersist(); await c.getBottomSaveQueue().flush();
  const queued = f.stores.bottom.writes.at(-1);
  assert.equal(queued.workOrderBuffer, buffer, 'The queue snapshot must share immutable original workbook bytes');
  assert.equal(queued.images[0].url, c.uploadedImages[0].baseUrl);
  assert.equal(queued.images[0].shadowUrl, c.uploadedImages[0].url);
  assert.equal(queued.images[0].logoUrl, c.uploadedImages[0].logoUrl);
  assert.equal(queued.images[0].orig, true);
  assert.ok(f.snapshots.every(call => call.options.shareBinary === true));
  console.log('PASS actual bottom wiring exposes nested images to codec, preserves public JSON and shares immutable workbook bytes');
}

async function lazyWorkbookChecks() {
  const f = fixture(), c = f.context, buffer = new Uint8Array([20, 21, 22]).buffer, calls = [];
  f.stores.bottom.data = { savedAt: 100, workOrderName: '原始工單.xlsx', workOrderBuffer: buffer,
    bottomState: '{"banners":[{"slots":[{"text":"保留"}]}]}', hasBottomWorkOrder: true,
    images: [{ name: 'logo.png', url: 'data:image/png;base64,AAAA', orig: true, shadowUrl: 'data:image/png;base64,BBBB' }] };
  c.requireBodaDependencies = names => {
    calls.push('dependency:' + names.join(','));
    c.ExcelJS = { Workbook: class {
      constructor() { calls.push('workbook'); this.xlsx = {
        load: bytes => { assert.equal(bytes, buffer); calls.push('parse'); return Promise.resolve(this); },
        writeBuffer: () => { calls.push('write'); return Promise.resolve(new Uint8Array([1, 2]).buffer); }
      }; }
    } };
    return Promise.resolve();
  };
  assert.equal(await c.restoreBottomPersist(), true);
  assert.deepEqual(calls, [], 'Startup restoration must not load ExcelJS or parse the workbook');
  assert.equal(c.currentImportWorkbook, null); assert.equal(c.currentImportWorkbookBuffer, buffer);
  assert.equal(c.latestBottomWorkOrder.buffer, buffer); assert.equal(c.currentImportWorkbookName, '原始工單.xlsx');
  assert.equal(c.uploadedImages[0].baseUrl, 'data:image/png;base64,AAAA');
  assert.equal(c.uploadedImages[0].url, 'data:image/png;base64,BBBB');
  assert.equal(c.currentImportHasBottomWorkOrder, true);
  assert.equal(c.bottomWorkOrderNeedsParserAuthority, false);
  c.flushBottomPersist(); await c.getBottomSaveQueue().flush();
  assert.equal(f.stores.bottom.writes.length, 0, 'Restoring bottom content must establish a no-op baseline');
  c.currentImportColumns = [column('回填')];
  const file = await c.buildImportedWorkOrderXlsxFile();
  assert.deepEqual(calls, ['dependency:excel', 'workbook', 'parse', 'write']);
  assert.ok(file.filename.startsWith('原始工單_回填_')); assert.ok(file.blob instanceof Blob);
  assert.deepEqual(Array.from(new Uint8Array(buffer)), [20, 21, 22]);
  console.log('PASS restored original XLSX stays unparsed and shared until the actual workbook export needs ExcelJS');
}

async function readFailureChecks() {
  const activity = fixture(), a = activity.context, read = deferred();
  activity.stores.activity.getHandler = () => read.promise;
  const restoring = a.loadImportStateFromIdb();
  a.saveImportState(); read.reject(new Error('cannot read previous activity draft'));
  assert.equal(await restoring, false); await turns();
  assert.equal(a.importPersistReadFailed, true); assert.equal(a.getImportSaveQueue().getStatus().state, 'paused');
  a.saveImportState(); await turns();
  assert.equal(activity.stores.activity.writes.length, 0, 'A read failure is not an empty database and must never save startup defaults');

  const bottom = fixture(), b = bottom.context, bottomRead = deferred();
  bottom.stores.bottom.getHandler = () => bottomRead.promise;
  const restoringBottom = b.restoreBottomPersist();
  b.flushBottomPersist(); bottomRead.reject(new Error('cannot read previous bottom draft'));
  assert.equal(await restoringBottom, false); await turns();
  assert.equal(b.bottomPersistReadFailed, true); assert.equal(b.getBottomSaveQueue().getStatus().state, 'paused');
  b.flushBottomPersist(); await turns();
  assert.equal(bottom.stores.bottom.writes.length, 0);

  activity.stores.activity.getHandler = () => Promise.resolve({ version: 2, ts: 999, columns: [column('讀取重試後保留')] });
  assert.equal(await a.loadImportStateFromIdb(), true); await a.getImportSaveQueue().flush();
  assert.ok(activity.stores.activity.writes.every(value => value.columns.length && value.columns[0].data.title === '讀取重試後保留'),
    'Read retry success must discard the held startup snapshot before resuming writes');
  bottom.stores.bottom.getHandler = () => Promise.resolve({ savedAt: 999, bottomState: '{"text":"讀取重試後保留"}', images: [] });
  assert.equal(await b.restoreBottomPersist(), true); await b.getBottomSaveQueue().flush();
  assert.ok(bottom.stores.bottom.writes.every(value => value.bottomStateData && value.bottomStateData.text === '讀取重試後保留'),
    'Bottom read retry must not flush the blank snapshot that was held during failure');
  console.log('PASS root read failures pause both writers and recovery cannot flush stale startup defaults');
}

async function lateRestoreChecks() {
  const f = fixture(), c = f.context, read = deferred();
  f.stores.activity.getHandler = () => read.promise;
  c.currentImportColumns = [column('目前專案')];
  const restoring = c.loadImportStateFromIdb();
  c.currentImportColumns = [column('新工單')]; c.beginImportImageLayoutDocument(true);
  read.resolve({ ts: 1000, columns: [column('舊工單')] });
  assert.equal(await restoring, false); assert.equal(c.currentImportColumns[0].data.title, '新工單');

  const moving = fixture(), r = deferred();
  moving.stores.activity.getHandler = () => r.promise;
  moving.context.currentImportColumns = [column('操作中')];
  const loading = moving.context.loadImportStateFromIdb();
  moving.context.importImageLayoutEditRevision++;
  r.resolve({ ts: 1000, columns: [column('過期編輯')] });
  assert.equal(await loading, false); assert.equal(moving.context.currentImportColumns[0].data.title, '操作中');

  const bottom = fixture(), oldBottom = deferred();
  bottom.stores.bottom.getHandler = () => oldBottom.promise;
  const pending = bottom.context.restoreBottomPersist();
  bottom.context.bottomSharedStateJson = '{"text":"新的吸底編輯"}'; bottom.context.queueBottomPersist();
  oldBottom.resolve({ bottomState: '{"text":"舊的吸底編輯"}', savedAt: 1 });
  assert.equal(await pending, false); assert.equal(JSON.parse(bottom.context.bottomSharedStateJson).text, '新的吸底編輯');
  console.log('PASS delayed root restoration cannot overwrite a new workbook or image/bottom edits made while reading');
}

async function readEditProtectionChecks() {
  // Data edits do not replace the columns array or increment the image-layout
  // revision, so the actual root read-start snapshot must protect them too.
  const initial = fixture(), initialRead = deferred(), a = initial.context;
  a.currentImportColumns = [column('read-start')]; a.currentImportImageLayoutId = 'same-project';
  initial.stores.activity.getHandler = () => initialRead.promise;
  const loading = a.loadImportStateFromIdb();
  a.currentImportColumns[0].data.title = 'typed-during-first-read'; a.saveImportState();
  initialRead.resolve({ ts: 1000, columns: [column('stored-old-text')] });
  assert.equal(await loading, false);
  await a.getImportSaveQueue().flush();
  assert.equal(a.currentImportColumns[0].data.title, 'typed-during-first-read');
  assert.ok(initial.stores.activity.writes.every(value => value.columns[0].data.title === 'typed-during-first-read'));

  const failed = fixture(), c = failed.context, firstRead = deferred();
  c.currentImportColumns = [column('before-failed-read')]; c.currentImportImageLayoutId = 'failure-project';
  failed.stores.activity.getHandler = () => firstRead.promise;
  const failing = c.loadImportStateFromIdb();
  c.currentImportColumns[0].data.title = 'typed-before-read-failed'; c.importImageLayoutEditRevision++;
  c.saveImportState(); firstRead.reject(new Error('first read failed after editing'));
  assert.equal(await failing, false); assert.equal(c.importPersistReadFailed, true);
  assert.equal(c.getImportSaveQueue().getStatus().state, 'paused');
  assert.equal(failed.stores.activity.writes.length, 0, 'Editing geometry during a failed same-project read must not bypass the hold');
  const retryFailure = deferred(); failed.stores.activity.getHandler = () => retryFailure.promise;
  const failedRetry = c.loadImportStateFromIdb();
  retryFailure.reject(new Error('second read failed'));
  assert.equal(await failedRetry, false);
  failed.stores.activity.getHandler = () => Promise.resolve({ ts: 1000, columns: [column('old-disk-state')] });
  assert.equal(await c.loadImportStateFromIdb(), false, 'Repeated read failures must preserve the original read-start comparison');
  await c.getImportSaveQueue().flush();
  assert.equal(c.currentImportColumns[0].data.title, 'typed-before-read-failed');
  assert.ok(failed.stores.activity.writes.every(value => value.columns[0].data.title === 'typed-before-read-failed'));

  const afterFailure = fixture(), d = afterFailure.context;
  d.currentImportColumns = [column('before-error')];
  afterFailure.stores.activity.getHandler = () => Promise.reject(new Error('temporarily unavailable'));
  await d.loadImportStateFromIdb();
  d.currentImportColumns[0].data.title = 'typed-after-failure'; d.saveImportState();
  afterFailure.stores.activity.getHandler = () => Promise.resolve({ ts: 1000, columns: [column('old-state')] });
  assert.equal(await d.loadImportStateFromIdb(), false); await d.getImportSaveQueue().flush();
  assert.equal(d.currentImportColumns[0].data.title, 'typed-after-failure');
  assert.equal(afterFailure.stores.activity.writes.at(-1).columns[0].data.title, 'typed-after-failure');

  const retrying = fixture(), e = retrying.context, retryRead = deferred();
  e.currentImportColumns = [column('unchanged-after-failure')];
  retrying.stores.activity.getHandler = () => Promise.reject(new Error('first failure'));
  await e.loadImportStateFromIdb();
  retrying.stores.activity.getHandler = () => retryRead.promise;
  const retry = e.loadImportStateFromIdb();
  e.currentImportColumns[0].data.title = 'typed-during-retry'; e.saveImportState();
  retryRead.resolve({ ts: 1000, columns: [column('old-state')] });
  assert.equal(await retry, false); await e.getImportSaveQueue().flush();
  assert.equal(e.currentImportColumns[0].data.title, 'typed-during-retry');
  assert.equal(retrying.stores.activity.writes.at(-1).columns[0].data.title, 'typed-during-retry');

  const bottom = fixture(), b = bottom.context, oldBottom = deferred();
  b.bottomSharedStateJson = '{"text":"read-start"}';
  bottom.stores.bottom.getHandler = () => oldBottom.promise;
  const readingBottom = b.restoreBottomPersist();
  b.bottomSharedStateJson = '{"text":"edited-before-failed-read"}'; b.queueBottomPersist(); b.flushBottomPersist();
  oldBottom.reject(new Error('bottom read failed'));
  assert.equal(await readingBottom, false); assert.equal(b.bottomPersistReadFailed, true);
  bottom.stores.bottom.getHandler = () => Promise.reject(new Error('bottom retry failed'));
  await b.restoreBottomPersist();
  bottom.stores.bottom.getHandler = () => Promise.resolve({ savedAt: 1000, bottomState: '{"text":"old-bottom"}', images: [] });
  assert.equal(await b.restoreBottomPersist(), false); await b.getBottomSaveQueue().flush();
  assert.equal(JSON.parse(b.bottomSharedStateJson).text, 'edited-before-failed-read');
  assert.equal(bottom.stores.bottom.writes.at(-1).bottomStateData.text, 'edited-before-failed-read');
  console.log('PASS first-read, failure and retry edits survive both successful reads and repeated read errors');
}

async function latestAndNewProjectChecks() {
  const f = fixture(), c = f.context, releases = [];
  f.stores.activity.putHandler = () => new Promise(resolve => releases.push(resolve));
  c.currentImportColumns = [column('first')]; c.saveImportState(); await turns();
  c.currentImportColumns[0].data.title = 'middle'; c.saveImportState();
  c.currentImportColumns[0].data.title = 'latest'; c.saveImportState();
  c.currentImportColumns[0].data.title = 'not-enqueued';
  releases.shift()(); await turns();
  assert.equal(f.stores.activity.writes.length, 2); assert.equal(f.stores.activity.writes[1].columns[0].data.title, 'latest');
  releases.shift()(); await c.getImportSaveQueue().flush();

  c.currentImportColumns[0].data.title = 'old-active'; c.saveImportState(); await turns();
  c.currentImportColumns[0].data.title = 'old-pending'; c.saveImportState();
  const oldId = c.currentImportImageLayoutId;
  c.importPersistReadFailed = true; c.beginImportImageLayoutDocument(false);
  assert.equal(c.importPersistReadFailed, false); assert.notEqual(c.currentImportImageLayoutId, oldId);
  c.currentImportColumns = [column('new-project')]; c.saveImportState();
  releases.shift()(); await turns();
  assert.equal(f.stores.activity.writes.at(-1).columns[0].data.title, 'new-project');
  assert.equal(f.stores.activity.writes.some(value => value.columns[0].data.title === 'old-pending'), false);
  releases.shift()(); await c.getImportSaveQueue().flush();

  const bottom = fixture(), b = bottom.context, bottomReleases = [];
  bottom.stores.bottom.putHandler = () => new Promise(resolve => bottomReleases.push(resolve));
  b.bottomSharedStateJson = '{"text":"first"}'; b.flushBottomPersist(); await turns();
  b.bottomSharedStateJson = '{"text":"middle"}'; b.flushBottomPersist();
  b.bottomSharedStateJson = '{"text":"latest"}'; b.flushBottomPersist();
  bottomReleases.shift()(); await turns();
  assert.equal(bottom.stores.bottom.writes.length, 2); assert.equal(bottom.stores.bottom.writes[1].bottomStateData.text, 'latest');
  bottomReleases.shift()(); await b.getBottomSaveQueue().flush();
  b.getBottomSaveQueue().hold(new Error('old unreadable bottom'));
  b.bottomSharedStateJson = '{"text":"old-pending"}'; b.flushBottomPersist();
  const original = new Uint8Array([31, 32]).buffer;
  b.rememberBottomWorkOrder('new.xlsx', original, true, { getWorksheet: () => null });
  new Uint8Array(original)[0] = 99;
  await turns(); b.flushBottomPersist(); await turns();
  assert.equal(b.bottomPersistReadFailed, false);
  assert.notEqual(b.latestBottomWorkOrder.buffer, original, 'The newly imported original is owned once before later immutable sharing');
  assert.deepEqual(Array.from(new Uint8Array(b.latestBottomWorkOrder.buffer)), [31, 32]);
  assert.equal(bottom.stores.bottom.writes.at(-1).workOrderName, 'new.xlsx');
  assert.equal(bottom.stores.bottom.writes.some(value => value.bottomStateData && value.bottomStateData.text === 'old-pending'), false);
  bottomReleases.shift()(); await b.getBottomSaveQueue().flush();
  console.log('PASS real root queues coalesce latest edits, freeze metadata and discard previous-project pending work');
}

async function resetChecks() {
  const f = fixture(), c = f.context, activityWrite = deferred(), bottomWrite = deferred();
  f.stores.activity.putHandler = () => activityWrite.promise;
  f.stores.bottom.putHandler = () => bottomWrite.promise;
  c.currentImportColumns = [column('old-active')]; c.saveImportState();
  c.bottomSharedStateJson = '{"text":"old-active"}'; c.flushBottomPersist(); await turns();
  c.currentImportColumns[0].data.title = 'old-pending'; c.saveImportState();
  c.bottomSharedStateJson = '{"text":"old-pending"}'; c.flushBottomPersist();
  c.queueImportStateSave(); c.queueBottomPersist();
  let frozen = false;
  const freezing = c.freezeAutosave().then(() => { frozen = true; });
  assert.equal(c.__bodaResetting, true); assert.equal(c.importPersistDisabled, true);
  assert.equal(f.timers.size, 0, 'Reset must cancel root debounce timers');
  await turns(); assert.equal(frozen, false, 'Reset freeze must wait for active codec writes');
  activityWrite.resolve(); bottomWrite.resolve(); await turns();
  await freezing; assert.equal(frozen, true);
  assert.equal(f.stores.activity.writes.length, 1, 'Reset must prevent queued activity work from reopening a database after deletion');
  assert.equal(f.stores.bottom.writes.length, 1, 'Reset must prevent queued bottom work from reopening a database after deletion');
  c.saveImportState(); c.flushBottomPersist(); await turns();
  assert.equal(f.stores.activity.writes.length, 1); assert.equal(f.stores.bottom.writes.length, 1);
  console.log('PASS actual full-reset autosave freeze cancels debounce and pending work before database removal');
}

async function actualDeletionGateChecks() {
  for (const mode of ['full-reset', 'clear-cache']) {
    const f = fixture(), c = f.context;
    const activityOpen = deferred(), activityCommit = deferred();
    const bottomOpen = deferred(), bottomCommit = deferred(), exposureIdle = deferred();
    const opened = [], deleted = []; let reloaded = false, exposureWaits = 0;
    f.stores.activity.putHandler = () => activityOpen.promise.then(() => { opened.push('activity'); return activityCommit.promise; });
    f.stores.bottom.putHandler = () => bottomOpen.promise.then(() => { opened.push('bottom'); return bottomCommit.promise; });
    const exposureWindow = { _bnStatePlugin: { whenIdle() { exposureWaits++; return exposureIdle.promise; } } };
    c.document.getElementById = id => id === 'exposure-frame' ? { contentWindow: exposureWindow } : null;
    c.confirm = () => true;
    c.sessionStorage = { removeItem() {} };
    c.WO_CACHE_KEYS = ['wo_test'];
    c.history = { replaceState() {} };
    c.location = { pathname: '/BODA/index.html', search: '', reload() { reloaded = true; } };
    c.indexedDB = { deleteDatabase(name) {
      deleted.push(name);
      const request = {};
      Promise.resolve().then(() => { if (request.onsuccess) request.onsuccess(); });
      return request;
    } };
    c.currentImportColumns = [column('active-before-open')]; c.saveImportState();
    c.bottomSharedStateJson = '{"text":"active-before-open"}'; c.flushBottomPersist();
    // Both queues already own an active snapshot, but their codec work has not
    // even reached the async writer/open operation when the user clicks reset.
    assert.equal(f.stores.activity.writes.length, 0); assert.equal(f.stores.bottom.writes.length, 0);
    c.currentImportColumns[0].data.title = 'pending-must-not-return'; c.saveImportState();
    c.bottomSharedStateJson = '{"text":"pending-must-not-return"}'; c.flushBottomPersist();
    const marker = mode === 'full-reset' ? "resetButton.addEventListener('click'," :
      "document.getElementById('btn-clear-cache').addEventListener('click',";
    vm.runInContext('window.__actualResetClick = (' + actualClickHandler(marker) + ');', c);
    c.__actualResetClick(); await turns();
    assert.deepEqual(opened, []); assert.deepEqual(deleted, []);
    assert.equal(reloaded, false, mode + ' must not reload before in-flight writes settle');
    assert.equal(f.stores.activity.writes.length, 1); assert.equal(f.stores.bottom.writes.length, 1);
    activityOpen.resolve(); bottomOpen.resolve(); await turns();
    assert.deepEqual(opened, ['activity', 'bottom']); assert.deepEqual(deleted, [], mode + ' must await commits after open');
    activityCommit.resolve(); await turns();
    assert.deepEqual(deleted, [], mode + ' must wait for both root writers');
    bottomCommit.resolve(); await turns();
    if (mode === 'full-reset') {
      assert.deepEqual(deleted, [], 'Full reset must also await the existing exposure writer');
      assert.equal(exposureWaits, 1); assert.equal(exposureWindow._bnClearingState, true);
      exposureIdle.resolve(); await turns();
      assert.deepEqual(deleted, ['boda-import-persist', 'boda-bottom-persist', 'bn_editor_state_db', 'hbn-color-tool']);
    } else assert.deepEqual(deleted, ['boda-import-persist', 'boda-bottom-persist']);
    assert.equal(reloaded, true);
    assert.equal(f.stores.activity.writes.length, 1, mode + ' must discard the activity snapshot queued before reset');
    assert.equal(f.stores.bottom.writes.length, 1, mode + ' must discard the bottom snapshot queued before reset');
  }
  console.log('PASS actual reset/cache clicks await writers before open/commit and exposure idle before deleting databases');
}

function sharedLockManager() {
  const names = new Set();
  return { request(name, options, callback) {
    if (names.has(name)) return Promise.resolve(callback(null));
    names.add(name); return Promise.resolve(callback({ name })).finally(() => names.delete(name));
  } };
}

async function actualMultiTabOwnershipChecks() {
  for (const scope of ['activity', 'bottom']) {
    const locks = sharedLockManager(), primary = fixture({ locks }), secondary = fixture({ locks });
    const a = primary.context, b = secondary.context;
    if (scope === 'activity') {
      await a.importIdbGet(); await b.loadImportStateFromIdb();
      b.currentImportColumns = [column('follower-must-not-overwrite')]; b.saveImportState();
    } else {
      await a.bottomPersistGet(); await b.restoreBottomPersist();
      b.bottomSharedStateJson = '{"text":"follower-must-not-overwrite"}'; b.flushBottomPersist();
    }
    await turns();
    assert.equal(secondary.stores[scope].reads, 0, 'Actual ' + scope + ' startup acquires ownership before entering the disk read');
    assert.equal(secondary.stores[scope].writes.length, 0);
    assert.equal(secondary.statuses.at(-1).state, 'paused');
    assert.equal(secondary.statuses.at(-1).noAutomaticRetry, true, 'Ownership conflicts remain visible and are not retried as quota failures');
    const guarded = scope === 'activity' ? b.getImportAssetStore() : b.getBottomAssetStore();
    await assert.rejects(guarded.clear(), error => error.name === 'StorageOwnershipError');
    assert.equal(secondary.stores[scope].clears, 0);
  }
  for (const mode of ['full-reset', 'clear-cache']) {
    const locks = sharedLockManager(), primary = fixture({ locks }), secondary = fixture({ locks });
    // Full reset must reject even when only a later nested key is held; no
    // earlier ownership acquisition may partially clear or freeze this page.
    await primary.context.BodaStorageOwnership.create(mode === 'full-reset' ? 'bn_editor_state_db:current' : 'boda-bottom-persist:current').acquire();
    const c = secondary.context, deleted = [], alerts = [], removed = [];
    c.confirm = () => true; c.alert = message => alerts.push(message);
    c.WO_CACHE_KEYS = ['wo_test']; c.sessionStorage = { removeItem: key => removed.push(key) };
    c.localStorage.removeItem = key => removed.push(key);
    c.indexedDB = { deleteDatabase: name => { deleted.push(name); return {}; } };
    c.location = { reload() { throw new Error('Conflict must not reload unsaved edits'); } };
    const marker = mode === 'full-reset' ? "resetButton.addEventListener('click'," : "document.getElementById('btn-clear-cache').addEventListener('click',";
    vm.runInContext('window.__actualResetClick = (' + actualClickHandler(marker) + ');', c);
    c.__actualResetClick(); await turns();
    assert.deepEqual(deleted, [], mode + ' cannot enqueue deferred destructive deletion while another tab owns a draft');
    assert.deepEqual(removed, [], mode + ' cannot delete shared localStorage before checking every owner');
    assert.notEqual(c.__bodaResetting, true, mode + ' cannot freeze this tab after rejecting the reset');
    assert.equal(alerts.length, 1); assert.match(alerts[0], /另一個分頁/);
  }
  console.log('PASS actual root multi-tab reads/writes/clear are guarded; reset and clear-cache refuse conflicts before freeze, localStorage removal or database deletion');
}

function canvasClearFixture(options) {
  const f = fixture(options), c = f.context, events = [], removed = [], posted = [], log = {};
  c.currentImportColumns = [column('keep-until-owned')]; c.uploadedImages = [{ src: 'keep-image' }];
  c.importTheme = { main: 'keep-color' }; c.IMPORT_COLOR_ITEMS = [{ key: 'main' }];
  c.isPreviewAllCanvasActive = () => false; c.confirm = () => true;
  c.BNCore = { getBlock: () => true, defaultData: () => ({ title: 'default-title' }) };
  c.ensureBlocksLoaded = callback => { events.push('blocks-requested'); f.finishBlocks = callback; };
  c.BNImageLayout.hideTransformControls = () => events.push('hide-controls');
  c.beginImportImageLayoutDocument = () => events.push('new-document');
  c.saveImportImageLayout = () => events.push('image-layout');
  c.readSharedEndorserTextColor = () => ''; c.lineIcon = () => '';
  c.appLoadingFinish = message => events.push(message); c.setUploadStepState = () => {};
  c.localStorage.removeItem = key => removed.push(key);
  c.document.getElementById = id => id === 'exposure-frame' ? { contentWindow: { postMessage: message => posted.push(message) } } : log;
  c.broadcastBottomImageAssets = () => events.push('bottom-assets');
  return Object.assign(f, { events, removed, posted, log });
}

async function canvasClearOwnershipChecks() {
  for (const method of ['clearImportCanvasContent', 'deepClearAll']) {
    for (const conflictKey of ['boda-import-persist:current', 'boda-bottom-persist:current', 'bn_editor_state_db:current']) {
      const locks = sharedLockManager(), owner = fixture({ locks }), f = canvasClearFixture({ locks }), c = f.context;
      await owner.context.BodaStorageOwnership.create(conflictKey).acquire();
      const originalColumns = plain(c.currentImportColumns), originalImages = c.uploadedImages;
      assert.equal(await c[method](), false);
      assert.deepEqual(plain(c.currentImportColumns), originalColumns, method + ' cannot clear local canvas data on conflict');
      assert.equal(c.uploadedImages, originalImages); assert.equal(c.importTheme.main, 'keep-color');
      assert.deepEqual(f.removed, []); assert.deepEqual(f.posted, []);
      assert.equal(f.events.includes('blocks-requested'), false); assert.equal(f.events.includes('hide-controls'), false);
      assert.equal(f.stores.bottom.clears, 0); assert.equal(f.stores.activity.writes.length, 0);
      assert.equal(f.statuses.at(-1).noAutomaticRetry, true);
    }
    const f = canvasClearFixture(), c = f.context, clearing = deferred(), saving = deferred(), bottomSave = deferred();
    f.stores.bottom.clearHandler = () => clearing.promise;
    f.stores.activity.putHandler = () => saving.promise;
    f.stores.bottom.putHandler = () => bottomSave.promise;
    c.broadcastBottomImageAssets = () => { c.bottomSharedStateJson = '{"text":"updated-after-clear"}'; c.flushBottomPersist(); };
    let finished = false;
    const operation = c[method]().then(value => { finished = true; return value; });
    await turns(); assert.equal(finished, false); assert.equal(f.stores.bottom.clears, 0);
    assert.equal(c.currentImportColumns[0].data.title, 'keep-until-owned', method + ' waits for the actual block callback');
    f.finishBlocks(); await turns();
    assert.equal(f.stores.bottom.clears, 1); assert.equal(f.stores.activity.writes.length, 1);
    assert.equal(finished, false, method + ' cannot finish before bottom clear and activity commit');
    saving.resolve(); await turns(); assert.equal(finished, false);
    clearing.resolve(); await turns();
    assert.equal(f.stores.bottom.writes.length, 1); assert.equal(finished, false, method + ' also waits for new pending bottom edits to commit');
    bottomSave.resolve(); assert.equal(await operation, true);
    assert.equal(c.currentImportColumns[0].data.title, 'default-title');
    assert.equal(f.posted.length, 1); assert.equal(f.events.at(-1), method === 'deepClearAll' ? '所有資料已重置' : '畫面內容已清除');
    // Rejections inside the asynchronous block callback must reject the
    // operation, not leave an ownership run permanently active.
    const broken = canvasClearFixture(); broken.context.BNCore.defaultData = () => { throw new Error('bad template'); };
    const failed = broken.context[method](); await turns(); broken.finishBlocks();
    assert.equal(await failed, false); assert.match(broken.log.textContent, /bad template/);
    const failedClear = canvasClearFixture();
    failedClear.stores.bottom.clearHandler = () => Promise.reject(new Error('disk unavailable'));
    const incomplete = failedClear.context[method](); await turns(); failedClear.finishBlocks();
    assert.equal(await incomplete, false); assert.match(failedClear.log.textContent, /吸底暫存未能清除/);
    assert.equal(failedClear.events.includes('畫面內容已清除'), false);
    assert.equal(failedClear.events.includes('所有資料已重置'), false);
  }
  const preview = canvasClearFixture({ locks: { request() { throw new Error('Pure preview should not request ownership'); } } });
  preview.context.isPreviewAllCanvasActive = () => true; let previewed = false;
  preview.context.showPreviewAllDefaults = () => { previewed = true; };
  preview.context.clearImportCanvasContent(); assert.equal(previewed, true);
  assert.deepEqual(preview.removed, []); assert.deepEqual(preview.posted, []);
  console.log('PASS clear-canvas/deep-clear guard all three stores before mutation, await block callback and both save queues, surface errors and preserve local-only preview');
}

async function bottomDraftClearChecks() {
  const f = fixture(), c = f.context, activeWrite = deferred(), cleared = deferred();
  f.stores.bottom.putHandler = () => f.stores.bottom.writes.length === 1 ? activeWrite.promise : Promise.resolve();
  f.stores.bottom.clearHandler = () => cleared.promise;
  c.bottomSharedStateJson = '{"text":"old-active"}'; c.flushBottomPersist(); await turns();
  c.bottomSharedStateJson = '{"text":"old-pending"}'; c.flushBottomPersist();
  const clearing = c.clearBottomPersistDraft();
  c.bottomSharedStateJson = '{"text":"new-during-active"}'; c.flushBottomPersist(); await turns();
  assert.equal(f.stores.bottom.clears, 0, 'Bottom draft clear must wait even if codec preparation has not committed');
  assert.equal(f.stores.bottom.writes.length, 1);
  activeWrite.resolve(); await turns();
  assert.equal(f.stores.bottom.clears, 1); assert.equal(f.stores.bottom.writes.length, 1, 'New pending edits must remain held while clear is in progress');
  c.bottomSharedStateJson = '{"text":"new-during-clear"}'; c.flushBottomPersist(); await turns();
  assert.equal(f.stores.bottom.writes.length, 1);
  cleared.resolve(); assert.equal(await clearing, true); await c.getBottomSaveQueue().flush();
  assert.equal(f.stores.bottom.writes.length, 2);
  assert.equal(f.stores.bottom.writes[1].bottomStateData.text, 'new-during-clear');
  assert.equal(f.stores.bottom.writes.some(value => value.bottomStateData.text === 'old-pending'), false);

  const failed = fixture(), b = failed.context, clearFailure = deferred();
  failed.stores.bottom.clearHandler = () => clearFailure.promise;
  const failedClear = b.clearBottomPersistDraft(); await turns();
  b.bottomSharedStateJson = '{"text":"unsaved-user-edit"}'; b.flushBottomPersist();
  clearFailure.reject(new Error('cannot clear bottom draft'));
  assert.equal(await failedClear, false); await turns();
  assert.equal(failed.stores.bottom.writes.length, 0);
  assert.equal(b.getBottomSaveQueue().getStatus().state, 'paused');
  assert.equal(b.getBottomSaveQueue().getStatus().pending, true, 'A clear failure must retain the user edit for explicit recovery');
  assert.ok(failed.statuses.some(status => status.scope === 'bottom' && status.state === 'paused' && /cannot clear/.test(status.error)),
    'The existing visible persistence status must report draft-clear failures');
  console.log('PASS actual bottom draft clear waits for writers, resumes latest new edits only after clear and visibly holds failures');
}

async function workbookOwnershipRaceChecks() {
  const f = fixture(), c = f.context, embeddedA = deferred(), embeddedB = deferred();
  let parses = 0;
  c.extractEmbeddedBottomState = () => (++parses === 1 ? embeddedA.promise : embeddedB.promise);
  c.rememberBottomWorkOrder('A.xlsx', new Uint8Array([1]).buffer, true);
  const previous = c.latestBottomWorkOrder;
  c.rememberBottomWorkOrder('B.xlsx', new Uint8Array([2]).buffer, true);
  const latest = c.latestBottomWorkOrder;
  embeddedA.resolve('{"text":"A"}'); await turns();
  assert.equal(c.latestBottomWorkOrder, latest);
  assert.equal(latest.bottomState, undefined, 'A slow earlier workbook callback must not fill the newer workbook state');
  assert.equal(previous.bottomState, undefined);
  embeddedB.resolve('{"text":"B"}'); await turns();
  assert.equal(latest.bottomState, '{"text":"B"}');

  const exporting = fixture(), x = exporting.context, loaded = deferred();
  const firstBuffer = new Uint8Array([11]).buffer, newBuffer = new Uint8Array([12]).buffer;
  x.currentImportColumns = [column('export')]; x.currentImportWorkbookBuffer = firstBuffer;
  x.ExcelJS = { Workbook: class { constructor() { this.xlsx = { load: () => loaded.promise }; } } };
  const oldExport = x.buildImportedWorkOrderXlsxFile();
  x.currentImportWorkbookBuffer = newBuffer; loaded.resolve({ xlsx: {} });
  await assert.rejects(oldExport, /工單已變更/);
  assert.equal(x.currentImportWorkbook, null, 'A late export parse must not adopt the workbook after its project changed');
  console.log('PASS older embedded-state callbacks and lazy XLSX parses cannot claim a newer workbook');
}

(async () => {
  await activityWiringChecks();
  await lazyDerivedPersistenceChecks();
  await bottomWiringChecks();
  await lazyWorkbookChecks();
  await readFailureChecks();
  await lateRestoreChecks();
  await readEditProtectionChecks();
  await latestAndNewProjectChecks();
  await resetChecks();
  await actualDeletionGateChecks();
  await actualMultiTabOwnershipChecks();
  await canvasClearOwnershipChecks();
  await bottomDraftClearChecks();
  await workbookOwnershipRaceChecks();
  console.log('All actual root persistence checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
