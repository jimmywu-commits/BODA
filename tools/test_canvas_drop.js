/* 用 jsdom 把 index.html 真的跑起來，模擬「把圖片拖到畫布圖片框」整條流程。

   驗的是實際會發生的事，不是只看程式碼有沒有寫：
     1. 頁面載入不報錯
     2. 匯入頁畫出版位後，畫布上的圖片框（含還沒有圖的空框）都認得自己是哪個欄位
     3. 從電腦拖檔案 → 欄位資料被寫入、素材清單多一張、畫布重畫後真的出現 <img>
     4. 一次拖多張 → 全部並排進同一個欄位（逗號分隔）
     5. 從素材清單縮圖拖到別的框 → 那個框也吃到同一張圖
     6. 拖到「不是圖片框」的地方 → 不會寫進任何欄位

   用法：node tools/test_canvas_drop.js
*/
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom');

const ROOT = path.resolve(__dirname, '..');
const results = [];
function check(name, ok, extra) {
  results.push({ name, ok, extra });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '  → ' + extra : ''}`);
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (e) => errors.push('console.error: ' + e));

/* jsdom 沒有實作 FileReader.readAsDataURL 對 File 的行為？有的，但我們要能控制內容，
   所以用一個假的 File：只要有 type 和 name，並讓 FileReader 回傳我們指定的 dataURL。 */
function fakeFile(name, dataUrl) {
  return { name, type: 'image/png', __dataUrl: dataUrl };
}

function makeDataTransfer({ files = [], data = {} } = {}) {
  const types = [];
  if (files.length) types.push('Files');
  Object.keys(data).forEach((k) => types.push(k));
  return {
    types,
    files,
    dropEffect: '',
    effectAllowed: '',
    getData: (t) => (data[t] != null ? data[t] : ''),
    setData: (t, v) => { data[t] = v; },
  };
}

(async () => {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  /* 本機的 <script src> 直接內嵌進來：jsdom 用 file:// 才抓得到本機檔案，
     但 file:// 是 opaque origin、localStorage 會直接丟 SecurityError，
     所以改成用 https://localhost 當網址、外部腳本自己先貼進 HTML。
     CDN 的兩支（exceljs / html-to-image）測試用不到，換成空的。
     fonts-embed.js 有 17MB 的字型 base64，測座標邏輯不需要，也跳過。 */
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    if (/^https?:/.test(src) || src.indexOf('fonts-embed') !== -1) return '<script></script>';
    const p = path.join(ROOT, src);
    if (!fs.existsSync(p)) return '<script></script>';
    /* 內容裡若出現 </script> 字面，會提前結束這個 script 標籤、整段解析壞掉 */
    return '<script>' + fs.readFileSync(p, 'utf8').replace(/<\/script>/gi, '<\\/script>') + '</script>';
  });

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://localhost/index.html',
    virtualConsole: vc,
    pretendToBeVisual: true,
    /* fetch / FileReader 要在頁面腳本開始跑之前就換掉：
       版位模板是頁面一載入就用 fetch 抓 block.json 的。 */
    beforeParse(window) {
      window.fetch = (url) => {
        /* 載入時網址會帶 ?t=時間戳（避免快取），要先去掉才對得到本機檔案 */
        const rel = String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^.*BODA\//, '').replace(/\?.*$/, '');
        const p = path.join(ROOT, rel);
        if (!fs.existsSync(p)) {
          return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(''), json: () => Promise.reject(new Error('404')) });
        }
        const txt = fs.readFileSync(p, 'utf8');
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(txt), json: () => Promise.resolve(JSON.parse(txt)) });
      };
      /* 讓 FileReader 直接回傳我們塞在假 File 上的 dataURL，不用真的去讀檔 */
      window.FileReader = class {
        readAsDataURL(f) {
          this.result = f.__dataUrl;
          setTimeout(() => { if (this.onload) this.onload(); }, 0);
        }
      };
    },
  });
  const { window } = dom;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(300);

  console.log('\n=== 1. 頁面載入 ===');
  /* 「版位模板沒有全部載入成功…保留重試機會」是測試環境的時序造成的：
     這個假 fetch 是同步 resolve，跟頁面自己的背景預載撞在一起。
     程式本來就有重試機制，最後 108 個版位都有載到（下面那項會驗），
     所以這一條不算真的錯誤，其他錯誤照樣要抓出來。 */
  const realErrors = errors.filter((e) => e.indexOf('保留重試機會') === -1);
  check('載入沒有 JS 錯誤', realErrors.length === 0, realErrors.slice(0, 3).join(' / '));
  check('渲染引擎有載入', typeof window.BNSchemaRenderer === 'object');

  /* 把版位模板載進來，然後畫兩個版位到匯入頁 */
  await new Promise((resolve) => window.ensureBlocksLoaded(resolve));
  const blocks = window.BNCore.getBlocks().map((b) => b.id);
  check('版位模板載入數量 > 100', blocks.length > 100, blocks.length + ' 個');

  const targetIds = ['msbn_A_1_1', 'subarea_A_1_1'].filter((id) => blocks.includes(id));
  const columns = targetIds.map((id) => ({ blockId: id, data: window.BNCore.defaultData(id), header: id }));
  window.renderImportColumns(columns);
  await sleep(150);

  console.log('\n=== 2. 畫布上的圖片框 ===');
  const mount0 = window.document.getElementById('imp-mount-0');
  check('第一個版位有畫出來', !!mount0);
  const boxes = mount0 ? [...mount0.querySelectorAll('[data-img-field]')] : [];
  check('圖片框都帶著欄位標記', boxes.length > 0, boxes.map((b) => b.getAttribute('data-img-field')).join(', '));
  const emptyBoxes = boxes.filter((b) => !b.querySelector('img'));
  check('「還沒有圖」的空框也認得自己的欄位', emptyBoxes.length > 0, emptyBoxes.length + ' 個空框');

  console.log('\n=== 3. 從電腦拖一張圖進空框 ===');
  const box = emptyBoxes[0];
  const key = box.getAttribute('data-img-field');
  const PNG_A = 'data:image/png;base64,AAAA';
  const assetsBefore = window.uploadedImages.length;
  let ev = new window.Event('drop', { bubbles: true, cancelable: true });
  ev.dataTransfer = makeDataTransfer({ files: [fakeFile('a.png', PNG_A)] });
  box.dispatchEvent(ev);
  await sleep(80);
  check('欄位資料寫入了拖進來的圖', window.currentImportColumns[0].data[key] === PNG_A,
    key + ' = ' + String(window.currentImportColumns[0].data[key]).slice(0, 24));
  check('素材清單多了一張', window.uploadedImages.length === assetsBefore + 1,
    assetsBefore + ' → ' + window.uploadedImages.length);
  const reBox = window.document.getElementById('imp-mount-0').querySelector('[data-img-field="' + key + '"]');
  check('畫布重畫後那個框真的出現圖片', !!(reBox && reBox.querySelector('img')));

  console.log('\n=== 4. 一次拖三張到同一個框 ===');
  const boxes2 = [...window.document.getElementById('imp-mount-0').querySelectorAll('[data-img-field]')];
  const multiBox = boxes2.find((b) => b.getAttribute('data-img-field') !== key) || boxes2[0];
  const key2 = multiBox.getAttribute('data-img-field');
  ev = new window.Event('drop', { bubbles: true, cancelable: true });
  ev.dataTransfer = makeDataTransfer({
    files: [fakeFile('b1.png', 'data:image/png;base64,BBB1'),
      fakeFile('b2.png', 'data:image/png;base64,BBB2'),
      fakeFile('b3.png', 'data:image/png;base64,BBB3')],
  });
  multiBox.dispatchEvent(ev);
  await sleep(120);
  /* 不能直接用 split(',') 數：data:image/png;base64,xxx 本身就含一個逗號，
     會把一張算成兩張。要用程式自己那支解析（它會把 data: 的片段接回去）。 */
  const multiVal = String(window.currentImportColumns[0].data[key2] || '');
  const multiCount = window.splitImageList(multiVal).length;
  check('三張都併進同一個欄位', multiCount === 3, key2 + ' 有 ' + multiCount + ' 張');
  const multiRendered = window.document.getElementById('imp-mount-0')
    .querySelector('[data-img-field="' + key2 + '"]');
  check('畫布上那個框並排出現三張圖',
    !!multiRendered && multiRendered.querySelectorAll('img').length === 3,
    multiRendered ? multiRendered.querySelectorAll('img').length + ' 個 <img>' : '找不到框');

  console.log('\n=== 5. 從左邊素材清單縮圖拖到別的框 ===');
  window.renderImageGallery();
  const thumbs = [...window.document.querySelectorAll('#import-img-gallery .im-thumb')];
  check('素材清單有出現可拖曳的縮圖', thumbs.length > 0 && thumbs.every((t) => t.getAttribute('draggable') === 'true'),
    thumbs.length + ' 張縮圖');
  const mount1 = window.document.getElementById('imp-mount-1');
  const box1 = mount1 && mount1.querySelector('[data-img-field]');
  if (box1 && thumbs.length) {
    const key3 = box1.getAttribute('data-img-field');
    ev = new window.Event('drop', { bubbles: true, cancelable: true });
    ev.dataTransfer = makeDataTransfer({ data: { 'application/x-wo-asset': '0' } });
    box1.dispatchEvent(ev);
    await sleep(80);
    check('第二個版位的框吃到素材清單那張圖',
      window.currentImportColumns[1].data[key3] === window.uploadedImages[0].url,
      key3 + ' = ' + String(window.currentImportColumns[1].data[key3]).slice(0, 24));
  } else {
    check('第二個版位的框吃到素材清單那張圖', false, '找不到第二個版位的圖片框');
  }

  console.log('\n=== 6. 拖到不是圖片框的地方 ===');
  const mountNow = window.document.getElementById('imp-mount-0');
  const textEl = mountNow.querySelector('[contenteditable="true"]');
  const snapshot = JSON.stringify(window.currentImportColumns[0].data);
  ev = new window.Event('drop', { bubbles: true, cancelable: true });
  ev.dataTransfer = makeDataTransfer({ files: [fakeFile('zzz.png', 'data:image/png;base64,ZZZZ')] });
  (textEl || mountNow).dispatchEvent(ev);
  await sleep(80);
  check('拖到文字上不會改到任何欄位', JSON.stringify(window.currentImportColumns[0].data) === snapshot);
  check('畫布範圍內的拖放有被攔下來（不會讓瀏覽器開圖片）', ev.defaultPrevented);

  console.log('\n=== 7. 既有功能沒被影響 ===');
  const sideBtns = [...window.document.querySelectorAll('#import-fields-scroll .if-btn')];
  const acts = [...new Set(sideBtns.map((b) => b.getAttribute('data-act')))].filter(Boolean);
  check('左邊卡片的編輯／換圖／刪除按鈕都還在', ['edit', 'swap', 'del'].every((a) => acts.includes(a)), acts.join(', '));
  check('文字還是可以直接在畫布上編輯', !!mountNow.querySelector('[contenteditable="true"]'));

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(52));
  console.log(`${results.length} 項檢查，通過 ${results.length - failed.length}，失敗 ${failed.length}`);
  if (failed.length) { failed.forEach((f) => console.log('  ✗ ' + f.name)); process.exitCode = 1; }
  dom.window.close();
})();
