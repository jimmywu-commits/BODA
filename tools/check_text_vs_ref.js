/* 用 PS 參考圖當標準答案，檢查渲染引擎把文字放在哪裡。

   原理
   ----
   引擎算出來的 top 是文字「內容區(content area)」的上緣，不是筆畫的上緣。
   同一種字體、同一串字，「筆畫上緣離內容區上緣多少個 em」是固定的比例。
   所以只要量出參考圖上筆畫的實際位置，就能反推每個圖層差了幾 px：

       偏移量(em) = (參考圖筆畫上緣 − 引擎算出的 top) ÷ 字級

   把所有版位的同一種文字（例如「促標」）排在一起看，
   絕大多數會落在同一個數字附近＝那是字體本身的比例；
   明顯偏離的那幾個，就是真的跑版了，差多少 px 也一併算出來。

   用法：node tools/check_text_vs_ref.js > 報告.txt
   （需要 msbn-img/ 底下的參考圖，以及 tools/ref_ink.json：
     筆畫位置是用 tools/measure_ref_ink.py 先量好存起來的）
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadEngine() {
  const registered = {};
  const stub = () => ({ appendChild() {}, setAttribute() {}, style: {}, textContent: '', id: '' });
  const sandbox = {
    console: { error() {}, warn() {}, log() {} },
    BNCore: { registerBlock: (b) => { registered[b.id] = b; } },
    document: { getElementById: () => null, createElement: stub, head: stub(), body: stub() },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'JS/render-config.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'core/schema-renderer.js'), 'utf8'), sandbox);
  return { sandbox, registered };
}

const { sandbox, registered } = loadEngine();
const ink = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ref_ink.json'), 'utf8'));

const rows = [];
Object.keys(ink).forEach((key) => {
  const [blockId, field] = key.split('::');
  const file = path.join(ROOT, 'blocks', blockId, 'block.json');
  if (!fs.existsSync(file)) return;
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
  sandbox.BNSchemaRenderer.registerFromSchema(schema);
  const def = registered[blockId];
  const data = {};
  (def.fields || []).forEach((f) => { data[f.key] = f.type === 'image' ? '' : (f.default || ''); });
  const html = def.render(data, { editable: true });

  const re = new RegExp('<div[^>]*data-field="' + field + '"[^>]*style=\'([^\']*)\'');
  const m = re.exec(html);
  if (!m) return;
  const style = m[1];
  const num = (p) => {
    const mm = new RegExp('(?:^|;)\\s*' + p + ':\\s*([-\\d.]+)px').exec(style);
    return mm ? parseFloat(mm[1]) : null;
  };
  const top = num('top');
  const fontSize = num('font-size');
  if (top == null || !fontSize) return;

  const r = ink[key];
  rows.push({
    block: blockId, field: field, fontSize: fontSize,
    top: top, inkTop: r.top,
    em: (r.top - top) / fontSize,
  });
});

/* 同一種文字（field 去掉結尾數字）分成一組看 */
const groups = {};
rows.forEach((r) => {
  const g = r.field.replace(/\d+$/, '');
  (groups[g] = groups[g] || []).push(r);
});

Object.keys(groups).sort().forEach((g) => {
  const list = groups[g].slice().sort((a, b) => a.em - b.em);
  const ems = list.map((r) => r.em).sort((a, b) => a - b);
  const median = ems[Math.floor(ems.length / 2)];
  console.log('\n═══ %s（%d 個，中位數偏移 %s em）', g, list.length, median.toFixed(3));
  list.forEach((r) => {
    const offPx = (r.em - median) * r.fontSize;
    const flag = Math.abs(offPx) >= 2 ? (offPx > 0 ? '  ← 畫得太高 ' + offPx.toFixed(1) + 'px' : '  ← 畫得太低 ' + (-offPx).toFixed(1) + 'px') : '';
    console.log('   %s %s  字級%s  引擎top=%s 參考圖筆畫top=%s  偏移%s em%s',
      r.block.padEnd(14), r.field.padEnd(10), String(r.fontSize).padEnd(5),
      r.top.toFixed(2).padEnd(9), String(r.inkTop).padEnd(5), r.em.toFixed(3), flag);
  });
});
