/* 用 jsdom 把 index.html 跑起來，驗證新的「維修」頁。

   重點驗這幾件事：
     1. nav 多了維修鈕、切過去頁面會出現
     2. 129 個版位都畫出來（含 blocks/index.js 沒列到的 21 個），未註冊的有標記
     3. 未註冊且內容重複的有被指認出來
     4. 「字數上限」文字模式真的按各欄位上限填字
     5. 維修頁的拖放能用（跟匯入頁共用同一套邏輯）
     6. 在維修頁操作不會污染匯入工單的暫存 —— 這是最重要的一條
     7. 篩選／縮放／顯示邊界等工具有作用
     8. 原本四個頁面沒被弄壞

   用法：node tools/test_maint_view.js
*/
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom');

const ROOT = path.resolve(__dirname, '..');
const results = [];
function check(name, ok, extra) {
  results.push({ name, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '  → ' + extra : ''}`);
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (e) => errors.push('console.error: ' + e));

function fakeFile(name, dataUrl) { return { name, type: 'image/png', __dataUrl: dataUrl }; }
function makeDataTransfer({ files = [], data = {} } = {}) {
  const types = [];
  if (files.length) types.push('Files');
  Object.keys(data).forEach((k) => types.push(k));
  return {
    types, files, dropEffect: '', effectAllowed: '',
    getData: (t) => (data[t] != null ? data[t] : ''),
    setData: (t, v) => { data[t] = v; },
  };
}

(async () => {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    if (/^https?:/.test(src) || src.indexOf('fonts-embed') !== -1) return '<script></script>';
    const p = path.join(ROOT, src);
    if (!fs.existsSync(p)) return '<script></script>';
    return '<script>' + fs.readFileSync(p, 'utf8').replace(/<\/script>/gi, '<\\/script>') + '</script>';
  });

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://localhost/index.html',
    virtualConsole: vc,
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url) => {
        const rel = String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^.*BODA\//, '').replace(/\?.*$/, '');
        const p = path.join(ROOT, rel);
        if (!fs.existsSync(p)) {
          return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(''), json: () => Promise.reject(new Error('404')) });
        }
        const txt = fs.readFileSync(p, 'utf8');
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(txt), json: () => Promise.resolve(JSON.parse(txt)) });
      };
      window.FileReader = class {
        readAsDataURL(f) { this.result = f.__dataUrl; setTimeout(() => { if (this.onload) this.onload(); }, 0); }
      };
    },
  });
  const { window } = dom;
  const doc = window.document;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(300);

  console.log('\n=== 1. nav 與頁面 ===');
  const realErrors = errors.filter((e) => e.indexOf('保留重試機會') === -1);
  check('載入沒有 JS 錯誤', realErrors.length === 0, realErrors.slice(0, 3).join(' / '));
  const navBtns = [...doc.querySelectorAll('#nav-rail .nav-item')].map((b) => b.getAttribute('data-view'));
  check('nav 有 5 個功能鈕，維修在最後', navBtns.length === 5 && navBtns[4] === 'maint', navBtns.join(', '));
  check('維修頁容器存在', !!doc.getElementById('view-maint'));

  /* 先在匯入工單放一筆資料，稍後要確認維修頁不會動到它 */
  await new Promise((r) => window.ensureBlocksLoaded(r));
  window.renderImportColumns([{ blockId: 'msbn_A_1_1', data: window.BNCore.defaultData('msbn_A_1_1'), header: 'x' }]);
  await sleep(100);
  window.currentImportColumns[0].data.name = '匯入頁原本的品名';
  window.saveImportState();
  const importSnapshot = window.localStorage.getItem('wo_import_state_v1');
  check('匯入工單有暫存資料可供比對', !!importSnapshot && importSnapshot.indexOf('匯入頁原本的品名') !== -1);

  console.log('\n=== 2. 切到維修頁、列出所有版位 ===');
  window.showView('maint');
  await sleep(600);
  check('維修頁是啟用狀態', doc.getElementById('view-maint').classList.contains('active'));
  const items = [...doc.querySelectorAll('#maint-list .mt-item')];
  check('列出的版位數 = 129', items.length === 129, items.length + ' 個');
  const unregItems = items.filter((i) => i.classList.contains('is-unreg'));
  check('未註冊的版位有標記出來', unregItems.length === 21, unregItems.length + ' 個');
  check('未註冊的有「未註冊」徽章', unregItems.every((i) => /未註冊/.test(i.querySelector('.mt-head').textContent)));
  check('每個版位都標了 id 與尺寸',
    items.every((i) => i.querySelector('.mt-id') && /\d+×\d+/.test(i.querySelector('.mt-size').textContent)));

  console.log('\n=== 3. 重複檔指認 ===');
  const dups = window.maintDuplicates;
  const dupCount = Object.keys(dups).length;
  /* 21 個未註冊的都是舊命名的殘檔，每一個都對得到同一張設計稿的已註冊版位。
     其中 5 個內容完全相同，其餘只差幾個圖層（促標框寬度、整份 zIndex 差 1 之類）。 */
  check('每個未註冊版位都配對到對應的已註冊版位', dupCount === 21, dupCount + ' / 21');
  const identical = Object.keys(dups).filter((id) => dups[id].diff === 0);
  check('其中內容完全相同的有 5 個', identical.length === 5, identical.join(', '));
  /* 驗配對是真的：說「完全相同」的，忽略底線鍵後必須真的一樣 */
  const designSig = (id) => {
    const b = window.BNCore.getBlock(id);
    return JSON.stringify(b.schema.layers, (k, v) => (k.charAt(0) === '_' ? undefined : v));
  };
  check('說「完全相同」的真的完全相同',
    identical.every((id) => designSig(id) === designSig(dups[id].twin)));
  check('說「有差異」的差異層數 > 0',
    Object.keys(dups).filter((id) => dups[id].diff > 0)
      .every((id) => designSig(id) !== designSig(dups[id].twin)));
  const warnText = doc.getElementById('maint-warn').textContent;
  check('警示框有出現並寫出配對結果',
    warnText.indexOf('blocks/index.js') !== -1 &&
    warnText.indexOf('subarea_A_1 → subarea_A_1_1') !== -1,
    warnText.slice(0, 40));

  console.log('\n=== 4. 字數上限文字 ===');
  const a11 = items.find((i) => i.getAttribute('data-block') === 'msbn_A_1_1');
  const a11idx = items.indexOf(a11);
  const a11col = window.maintColumns[a11idx];
  const def = window.BNCore.getBlock('msbn_A_1_1');
  const limited = def.fields.filter((f) => f.type === 'text' && f.maxLength);
  check('有抓到帶字數上限的欄位', limited.length > 0, limited.map((f) => f.key + ':' + f.maxLength).join(', '));
  check('每個欄位的字數剛好等於上限',
    limited.every((f) => String(a11col.data[f.key] || '').length === f.maxLength),
    limited.map((f) => f.key + '=' + String(a11col.data[f.key]).length + '/' + f.maxLength).join(', '));
  check('填的是可以用眼睛數的一二三四…', /^一二三/.test(String(a11col.data[limited[0].key])));

  console.log('\n=== 5. 維修頁的拖放 ===');
  const boxes = [...a11.querySelectorAll('[data-img-field]')];
  check('維修頁的圖片框也帶欄位標記', boxes.length > 0, boxes.map((b) => b.getAttribute('data-img-field')).join(', '));
  const key = boxes[0].getAttribute('data-img-field');
  const PNG = 'data:image/png;base64,MAINT';
  let ev = new window.Event('drop', { bubbles: true, cancelable: true });
  ev.dataTransfer = makeDataTransfer({ files: [fakeFile('m.png', PNG)] });
  boxes[0].dispatchEvent(ev);
  await sleep(120);
  check('拖進去的圖寫進維修頁自己的資料', window.maintColumns[a11idx].data[key] === PNG,
    key + ' = ' + String(window.maintColumns[a11idx].data[key]).slice(0, 22));
  const reBox = doc.querySelectorAll('#maint-list .mt-item')[a11idx].querySelector('[data-img-field="' + key + '"]');
  check('畫布上真的出現圖片', !!(reBox && reBox.querySelector('img')));

  console.log('\n=== 6. 不會污染匯入工單（最重要）===');
  check('匯入工單的暫存完全沒被動到',
    window.localStorage.getItem('wo_import_state_v1') === importSnapshot);
  check('匯入工單的資料還在', window.currentImportColumns[0].data.name === '匯入頁原本的品名',
    String(window.currentImportColumns[0].data.name));
  /* 在維修頁改文字也不該寫進工單暫存 */
  const textEl = doc.querySelectorAll('#maint-list .mt-item')[a11idx].querySelector('[contenteditable="true"]');
  if (textEl) {
    textEl.textContent = '維修頁改的字';
    textEl.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(50);
  }
  check('在維修頁改文字也不會寫進工單暫存',
    window.localStorage.getItem('wo_import_state_v1') === importSnapshot);

  console.log('\n=== 7. 工具列 ===');
  doc.getElementById('maint-filter').value = 'msbn';
  doc.getElementById('maint-filter').dispatchEvent(new window.Event('change'));
  await sleep(400);
  const msbnOnly = [...doc.querySelectorAll('#maint-list .mt-item')];
  check('「只看 MSBN」只列 MSBN', msbnOnly.length > 0 && msbnOnly.every((i) => /^msbn/.test(i.getAttribute('data-block'))),
    msbnOnly.length + ' 個');
  doc.getElementById('maint-filter').value = 'unreg';
  doc.getElementById('maint-filter').dispatchEvent(new window.Event('change'));
  await sleep(400);
  const unregOnly = [...doc.querySelectorAll('#maint-list .mt-item')];
  check('「只看未註冊」列出 21 個', unregOnly.length === 21, unregOnly.length + ' 個');
  doc.getElementById('maint-filter').value = 'all';
  doc.getElementById('maint-filter').dispatchEvent(new window.Event('change'));
  await sleep(500);

  const boxChk = doc.getElementById('maint-show-box');
  boxChk.checked = true;
  boxChk.dispatchEvent(new window.Event('change'));
  check('「顯示邊界」有生效', doc.getElementById('maint-list').classList.contains('show-box'));
  const unregChk = doc.getElementById('maint-hide-unreg');
  check('預設隱藏未註冊的版位', unregChk.checked && doc.getElementById('maint-list').classList.contains('hide-unreg'));

  doc.getElementById('maint-text').value = 'empty';
  doc.getElementById('maint-text').dispatchEvent(new window.Event('change'));
  await sleep(500);
  const items2 = [...doc.querySelectorAll('#maint-list .mt-item')];
  const a11b = items2.findIndex((i) => i.getAttribute('data-block') === 'msbn_A_1_1');
  check('切成「留空」後文字欄位是空的',
    a11b >= 0 && limited.every((f) => String(window.maintColumns[a11b].data[f.key] || '') === ''));

  doc.getElementById('maint-zoom').value = '0.4';
  doc.getElementById('maint-zoom').dispatchEvent(new window.Event('change'));
  await sleep(500);
  const stage = doc.querySelector('#maint-list .mt-stage');
  check('縮放有套到畫布上', /scale\(0.4\)/.test(stage.getAttribute('style')), stage.getAttribute('style').slice(-24));

  console.log('\n=== 8. 原本的頁面沒被弄壞 ===');
  ['home', 'generator', 'exposure', 'import'].forEach(function (v) {
    window.showView(v);
    check('切到 ' + v + ' 正常', doc.getElementById('view-' + v).classList.contains('active'));
  });
  window.showView('import');
  await sleep(100);
  check('匯入頁的畫布還在', !!doc.getElementById('imp-mount-0'));
  const sideActs = [...new Set([...doc.querySelectorAll('#import-fields-scroll .if-btn')]
    .map((b) => b.getAttribute('data-act')))].filter(Boolean);
  check('匯入頁的編輯／換圖／刪除按鈕都還在', ['edit', 'swap', 'del'].every((a) => sideActs.includes(a)), sideActs.join(', '));

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(52));
  console.log(`${results.length} 項檢查，通過 ${results.length - failed.length}，失敗 ${failed.length}`);
  if (failed.length) { failed.forEach((f) => console.log('  ✗ ' + f.name)); process.exitCode = 1; }
  dom.window.close();
})();
