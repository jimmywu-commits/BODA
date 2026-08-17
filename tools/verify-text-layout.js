/* 驗證腳本：用「真正的渲染引擎」算出每個文字圖層實際會落在哪裡，
   比對修改前(.bak)與修改後的差異，並檢查圓標字是否確實落在圓標圈內。

   用法：node tools/verify-text-layout.js [舊版 schema-renderer 路徑] [舊版 render-config 路徑]
   （舊版檔案用來算「改版前」的結果；沒給就只跑改版後的檢查）

   做法：把 schema-renderer.js 當成瀏覽器腳本載入到一個假的 window 上，
   攔截 BNCore.registerBlock 拿到 render()，餵資料進去產生 HTML，
   再從 inline style 把 left/top 讀回來。不是重寫一份公式，是直接跑產品程式碼。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadEngine(rendererPath, configPath) {
  const registered = {};
  const stubEl = { appendChild() {}, setAttribute() {}, style: {}, textContent: '', id: '' };
  const sandbox = {
    console: { error: () => {}, warn: () => {}, log: () => {} },
    BNCore: { registerBlock: (b) => { registered[b.id] = b; } },
    /* 引擎啟動時會注入 @font-face 的 <style>；驗證只算座標，用最小假 DOM 讓它跑過去 */
    document: {
      getElementById: () => null,
      createElement: () => Object.assign({}, stubEl),
      head: Object.assign({}, stubEl),
      body: Object.assign({}, stubEl),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  if (configPath) {
    vm.runInContext(fs.readFileSync(configPath, 'utf8'), sandbox, { filename: configPath });
  }
  vm.runInContext(fs.readFileSync(rendererPath, 'utf8'), sandbox, { filename: rendererPath });
  return { sandbox, registered };
}

/* 從產生出來的 HTML 依序抓出每個 div 的 left/top/width/height 與文字內容 */
function parseBoxes(html) {
  const out = [];
  const re = /<div([^>]*)style='([^']*)'([^>]*)>([\s\S]*?)(?=<div|$)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const style = m[2];
    const get = (prop) => {
      const mm = new RegExp('(?:^|;)\\s*' + prop + ':\\s*([^;]+)').exec(style);
      return mm ? mm[1].trim() : null;
    };
    const num = (prop) => {
      const v = get(prop);
      if (v == null) return null;
      const f = parseFloat(v);
      return isNaN(f) ? null : f;
    };
    const fieldM = /data-field="([^"]*)"/.exec(m[1] + m[3]);
    out.push({
      field: fieldM ? fieldM[1] : null,
      left: num('left'), top: num('top'),
      width: num('width'), height: num('height'),
      fontSize: num('font-size'), lineHeight: get('line-height'),
      isText: num('font-size') != null,
      display: get('display'),
      textAlign: get('text-align'),
    });
  }
  return out;
}

function renderBlock(engine, schema, data) {
  engine.sandbox.BNSchemaRenderer.registerFromSchema(JSON.parse(JSON.stringify(schema)));
  const block = engine.registered[schema.id];
  if (!block) return null;
  return block.render(data, { editable: true });
}

function blockFiles() {
  return fs.readdirSync(path.join(ROOT, 'blocks'))
    .map((d) => path.join(ROOT, 'blocks', d, 'block.json'))
    .filter((p) => fs.existsSync(p));
}

const oldRenderer = process.argv[2];
const oldConfig = process.argv[3];

const nowEngine = loadEngine(path.join(ROOT, 'core/schema-renderer.js'), path.join(ROOT, 'JS/render-config.js'));
const oldEngine = oldRenderer ? loadEngine(oldRenderer, oldConfig) : null;

let badgeOk = 0, badgeBad = 0, badgeSkipped = 0;
const badgeProblems = [];
const shifts = [];

for (const f of blockFiles()) {
  const schema = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!schema.id) continue;

  // 每個欄位都給一段字，讓文字圖層都畫得出來
  const data = {};
  const collect = (ls) => (ls || []).forEach((l) => { if (l.field) data[l.field] = l.type === 'text' ? '測試文字' : ''; });
  collect(schema.layers);
  (schema.repeats || []).forEach((r) => (r.instances || []).forEach((inst) => {
    (r.layers || []).forEach((l) => { if (l.field) data[(l.globalField ? '' : inst.key) + l.field] = l.type === 'text' ? '測試文字' : ''; });
  }));

  const htmlNew = renderBlock(nowEngine, schema, data);
  if (!htmlNew) continue;
  const boxesNew = parseBoxes(htmlNew);

  /* ── 檢查一：圓標字是否落在圓標圈範圍內 ── */
  const circles = {};
  (schema.layers || []).forEach((l) => {
    const m = /^badgeBg(\d*)$/.exec(String(l.id || ''));
    if (m) circles[m.group || m[1]] = l;
  });
  (schema.layers || []).forEach((l) => {
    const m = /^badgeText(\d*)$/.exec(String(l.id || ''));
    if (!m) return;
    const c = circles[m[1]];
    if (!c) { badgeSkipped++; return; }
    const box = boxesNew.find((b) => b.field === l.field && b.isText);
    if (!box) { badgeSkipped++; return; }
    const inside = box.left >= c.left - 0.5 && (box.left + (box.width || 0)) <= c.left + c.width + 0.5
      && box.top >= c.top - 0.5 && (box.top + (box.height || 0)) <= c.top + c.height + 0.5;
    if (inside) badgeOk++;
    else {
      badgeBad++;
      badgeProblems.push(`${schema.id} ${l.id}: 字框 ${box.left}..${box.left + (box.width || 0)} / ${box.top}..${box.top + (box.height || 0)}  圈 ${c.left}..${c.left + c.width} / ${c.top}..${c.top + c.height}`);
    }
  });

  /* ── 檢查二：跟改版前比，每個文字圖層垂直移動了多少 ── */
  if (oldEngine) {
    const schemaOldSrc = process.env.OLD_BLOCKS
      ? path.join(process.env.OLD_BLOCKS, path.basename(path.dirname(f)), 'block.json')
      : null;
    const schemaOld = schemaOldSrc && fs.existsSync(schemaOldSrc)
      ? JSON.parse(fs.readFileSync(schemaOldSrc, 'utf8')) : schema;
    const htmlOld = renderBlock(oldEngine, schemaOld, data);
    if (htmlOld) {
      const boxesOld = parseBoxes(htmlOld);
      boxesNew.filter((b) => b.isText && b.field).forEach((bn) => {
        const bo = boxesOld.find((b) => b.field === bn.field && b.isText);
        if (!bo) return;
        /* 置中文字要比「框的中心」，不是比 left —— 改了框寬之後 left 變動的量
           跟字實際移動的量不一樣，只看 left 會誤判。 */
        const centerOf = (b) => (b.textAlign === 'center' && b.width != null)
          ? b.left + b.width / 2 : b.left;
        shifts.push({
          block: schema.id, field: bn.field,
          dx: +(centerOf(bn) - centerOf(bo)).toFixed(2),
          dy: +(bn.top - bo.top).toFixed(2),
        });
      });
    }
  }
}

console.log('=== 檢查一：圓標字是否落在圓標圈內 ===');
console.log(`  落在圈內 ${badgeOk} 個 / 超出範圍 ${badgeBad} 個 / 無圓標圈可比對 ${badgeSkipped} 個`);
badgeProblems.slice(0, 20).forEach((p) => console.log('  ! ' + p));

if (oldEngine) {
  console.log('\n=== 檢查二：跟改版前的位移 ===');
  const moved = shifts.filter((s) => Math.abs(s.dx) > 0.01 || Math.abs(s.dy) > 0.01);
  console.log(`  文字圖層共 ${shifts.length} 個，位置有變的 ${moved.length} 個`);

  const byField = {};
  moved.forEach((s) => {
    const k = s.field.replace(/[0-9]+$/, '');
    (byField[k] = byField[k] || []).push(s);
  });
  Object.keys(byField).sort((a, b) => byField[b].length - byField[a].length).forEach((k) => {
    const g = byField[k];
    const dys = g.map((s) => s.dy), dxs = g.map((s) => s.dx);
    console.log(`  ${k.padEnd(14)} n=${String(g.length).padEnd(4)} 垂直 ${Math.min(...dys).toFixed(2)}~${Math.max(...dys).toFixed(2)}px  水平 ${Math.min(...dxs).toFixed(2)}~${Math.max(...dxs).toFixed(2)}px`);
  });

  const a11 = shifts.filter((s) => s.block === 'msbn_A_1_1');
  console.log('\n  ── MSBN A-1-1（目視確認過的基準版位）應該完全沒動 ──');
  a11.forEach((s) => console.log(`    ${s.field.padEnd(12)} 水平 ${s.dx >= 0 ? '+' : ''}${s.dx}  垂直 ${s.dy >= 0 ? '+' : ''}${s.dy}`));
}
