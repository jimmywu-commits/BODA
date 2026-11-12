'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rootPath = path.resolve(__dirname, '..');
const engine = fs.readFileSync(path.join(rootPath, 'core', 'core-engine.js'), 'utf8');
const bundle = fs.readFileSync(path.join(rootPath, 'blocks', 'catalogue.bundle.js'), 'utf8');
const renderer = fs.readFileSync(path.join(rootPath, 'core', 'schema-renderer.js'), 'utf8');
const release = engine.match(/var BN_BLOCKS_RELEASE = '([^']+)'/)[1];

function harness(options = {}) {
  const scripts = [], requests = [], registrations = [], warnings = [];
  let active = 0, maxActive = 0;
  const baseURI = options.baseURI || 'https://example.test/BODA/index.html';
  const document = {
    baseURI, currentScript: null,
    getElementById() { return null; },
    createElement() { return { remove() {} }; },
    head: { appendChild(script) {
      scripts.push(script);
      setTimeout(() => {
        if (options.bundleFailure) { script.onerror(); return; }
        document.currentScript = script;
        vm.runInContext(bundle, context);
        document.currentScript = null;
        script.onload();
      }, 0);
    } }
  };
  const sandbox = {
    document, URL, Promise, setTimeout, clearTimeout, AbortController,
    console: { error: (...args) => warnings.push(args), warn: (...args) => warnings.push(args) },
    fetch: async (url, init) => {
      requests.push({ url, init }); active++; maxActive = Math.max(active, maxActive);
      await new Promise(resolve => setTimeout(resolve, 2));
      const file = new URL(url).pathname.split('/').slice(-2).join('/');
      const body = new URL(url).pathname.endsWith('/index.js')
        ? 'window._bn_blocks_manifest_cb(' + JSON.stringify(options.ids || []) + ');'
        : JSON.stringify({ id: file.split('/')[0], name: 'fresh-source' });
      active--;
      return { ok: !options.missingId || !url.includes('/' + options.missingId + '/'), status: 404, text: async () => body };
    }
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(engine, context);
  sandbox.BNSchemaRenderer = { registerFromSchema(schema) {
    registrations.push(schema);
    sandbox.BNCore.registerBlock({ id: schema.id, schema, render() { return ''; } });
    schema.__rendererMutation = true;
  } };
  return { context, scripts, requests, registrations, warnings, maxActive: () => maxActive };
}

(async function () {
  const app = harness();
  const progress = [], callbacks = [];
  const one = app.context.bnLoadAllBlocks(result => callbacks.push(result), 'blocks/', value => progress.push(value));
  const two = app.context.bnLoadAllBlocks(null, 'blocks/');
  const result = await one; await two;
  assert.equal(result.total, 107); assert.equal(result.succeeded, 107); assert.equal(result.source, 'bundle');
  assert.equal(callbacks.length, 1); assert.equal(app.scripts.length, 1); assert.equal(app.requests.length, 0);
  assert.equal(app.registrations.length, 107, 'concurrent callers reuse already registered blocks');
  const catalogue = app.context.BN_BLOCK_CATALOGUES['https://example.test/BODA/blocks/'];
  const schemaIds = catalogue.ids;
  schemaIds.forEach((id, index) => {
    const original = JSON.parse(fs.readFileSync(path.join(rootPath, 'blocks', id, 'block.json'), 'utf8'));
    assert.equal(JSON.stringify(catalogue.schemas[index]), JSON.stringify(original), 'bundle preserves exact source schema: ' + id);
    assert.equal(catalogue.schemas[index].__rendererMutation, undefined, 'registration cannot mutate cached data');
  });
  assert.equal(progress.at(-1).loaded, 107); assert.equal(progress.at(-1).succeeded, 107);
  await app.context.bnLoadAllBlocks(null, 'blocks/'); assert.equal(app.scripts.length, 1);

  const ids = Array.from({ length: 12 }, (_, i) => 'fixture_' + i);
  const fallback = harness({ bundleFailure: true, ids });
  const fallbackResult = await fallback.context.bnLoadAllBlocks(null, 'blocks/');
  assert.equal(fallbackResult.succeeded, 12); assert.equal(fallbackResult.source, 'source');
  assert.equal(fallback.requests.length, 13); assert.ok(fallback.maxActive() <= 6);
  fallback.requests.forEach(request => {
    assert.equal(request.init.cache, 'default'); assert.ok(request.url.includes('?v=' + release));
    assert.ok(!request.url.includes('refresh=') && !request.url.includes('?t='));
  });
  await fallback.context.bnLoadAllBlocks(null, 'blocks/');
  assert.equal(fallback.scripts.length, 2, 'bundle failure permits a later retry');

  const fresh = harness({ ids, missingId: 'fixture_5' });
  let finished = 0;
  const freshResult = await fresh.context.bnLoadAllBlocks(() => finished++, 'blocks/', null, { forceRefresh: true });
  assert.equal(fresh.scripts.length, 0, 'explicit refresh bypasses the generated bundle');
  assert.equal(freshResult.total, 12); assert.equal(freshResult.succeeded, 11); assert.equal(finished, 1);
  assert.ok(fresh.maxActive() <= 6);
  fresh.requests.forEach(request => { assert.equal(request.init.cache, 'reload'); assert.ok(request.url.includes('&refresh=')); });
  const invalid = harness({ bundleFailure: true, ids: ['../escape'] });
  const invalidResult = await invalid.context.bnLoadAllBlocks(null, 'blocks/');
  assert.equal(invalidResult.total, 0); assert.equal(invalid.requests.length, 1, 'reject unsafe manifest paths');

  const local = harness({ baseURI: 'file:///E:/GitHub/BODA/index.html' });
  assert.equal((await local.context.bnLoadAllBlocks(null, 'blocks/')).succeeded, 107);
  assert.ok(local.scripts[0].src.startsWith('file:///E:/GitHub/BODA/blocks/catalogue.bundle.js?v='));

  /* Evaluate the real font-face injection for localhost, file:// and Pages.
     The rest of the schema renderer only declares functions until registration. */
  const scenarios = [
    ['http://localhost:8000/BODA/index.html', 'http://localhost:8000/BODA/shopee/fonts/'],
    ['http://127.0.0.1:8000/index.html', 'http://127.0.0.1:8000/shopee/fonts/'],
    ['file:///E:/GitHub/BODA/index.html', 'file:///E:/GitHub/BODA/shopee/fonts/'],
    ['https://jimmywu-commits.github.io/BODA/index.html', 'https://jimmywu-commits.github.io/shopee/fonts/']
  ];
  for (const [url, expectedBase] of scenarios) {
    const styles = [], location = new URL(url);
    const sandbox = { URL, location, window: null, document: { baseURI: url, currentScript: { src: new URL('core/schema-renderer.js?v=test', url).href }, getElementById() { return null; }, createElement() { return {}; }, head: { appendChild(node) { styles.push(node); } } } };
    sandbox.window = sandbox;
    vm.runInNewContext(renderer, sandbox);
    const css = styles.find(node => node.id === 'bn-fontface').textContent;
    for (const [weight, file] of [[400, 'Regular'], [500, 'Medium'], [700, 'Bold']]) {
      assert.ok(css.includes('font-weight:' + weight));
      assert.ok(css.includes(expectedBase + 'ShopeeNotoSans(content)-' + file + '.woff2?v=20261111-fonts1'));
    }
    assert.ok(!css.includes('.ttf'), 'previews must use the shared WOFF2 files');
  }
  console.log('PASS: 107 exact schemas, one bundle/zero JSON fetches, coalescing/reuse, immutable catalogue, source fallback/retry, 6-request bound, force refresh, partial failure, file://, shared WOFF2 paths and weights');
})().catch(error => { console.error(error); process.exitCode = 1; });
