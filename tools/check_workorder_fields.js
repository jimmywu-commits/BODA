/* 檢查「工單上有的欄位」是不是都真的對得到 block.json 裡存在的欄位。

   為什麼要查：工單的欄位規格（index.html 裡的 wo-msbn-fields）跟版位資料
   （每個版位的 block.json）是兩份各自維護的東西。只要對不起來，匯入時那一列的
   內容會被安靜丟掉，畫面上什麼都不會說。
   MSBN B-4-1 就是這樣：工單寫「促標」，但 block.json 裡那行文字被命名成 name、
   完全沒有 promo 欄位，所以促標內容一直進不去；同時 block.json 多了一個
   工單上根本沒有的 LOGO圖 欄位，畫布上就冒出 LOGO 佔位卡。

   用法：node tools/check_workorder_fields.js
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function embeddedJson(id) {
  const re = new RegExp('<script id="' + id + '" type="application/json">([\\s\\S]*?)</script>');
  return JSON.parse(re.exec(html)[1]);
}
const MSBN_FIELDS = embeddedJson('wo-msbn-fields');

/* 從 index.html 直接把對照表挖出來，避免這支檢查跟產品程式碼各寫一份而走鐘 */
const LABEL_TO_FIELD_BASE = (() => {
  const src = /var LABEL_TO_FIELD_BASE = (\{[\s\S]*?\n\};)/.exec(html)[1].replace(/;$/, '');
  return vm.runInNewContext('(' + src + ')');
})();

function loadEngine() {
  const reg = {};
  const stub = () => ({ appendChild() {}, setAttribute() {}, style: {}, textContent: '', id: '' });
  const sb = {
    console: { error() {}, warn() {}, log() {} },
    BNCore: { registerBlock: (b) => { reg[b.id] = b; } },
    document: { getElementById: () => null, createElement: stub, head: stub(), body: stub() },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'JS/render-config.js'), 'utf8'), sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'core/schema-renderer.js'), 'utf8'), sb);
  return { sb, reg };
}
const E = loadEngine();

/* MSBN-A-1-1.jpg → blocks/msbn_A_1_1 */
function blockDirFor(file) {
  return 'msbn_' + file.replace(/^MSBN-/, '').replace(/\.jpg$/i, '').replace(/-/g, '_');
}

const problems = [];
let checked = 0;

Object.keys(MSBN_FIELDS).forEach((file) => {
  const spec = MSBN_FIELDS[file];
  const dir = blockDirFor(file);
  const p = path.join(ROOT, 'blocks', dir, 'block.json');
  if (!fs.existsSync(p)) { problems.push(`${file}：找不到對應的 blocks/${dir}/block.json`); return; }
  const schema = JSON.parse(fs.readFileSync(p, 'utf8'));
  E.sb.BNSchemaRenderer.registerFromSchema(JSON.parse(JSON.stringify(schema)));
  const block = E.reg[schema.id];
  if (!block) { problems.push(`${file}：版位註冊失敗`); return; }
  const keys = block.fields.map((f) => f.key);

  (spec.groups || []).forEach((group, gi) => {
    const suffix = gi === 0 ? '' : String(gi + 1);
    /* 同一個位置裡同名的欄位會被合併成多行文字（例如簽名小字兩行），所以只看種類 */
    const types = [...new Set(group.map((g) => (typeof g === 'string' ? g : g.type)))];
    types.forEach((type) => {
      checked++;
      const base = LABEL_TO_FIELD_BASE[type];
      if (!base) { problems.push(`${file} 位置${gi + 1}：工單欄位「${type}」不在 LABEL_TO_FIELD_BASE 對照表裡`); return; }
      const want = base + suffix;
      const alt = base + (gi + 1);           /* 另一種命名習慣：第1個位置也帶 1 */
      if (keys.indexOf(want) === -1 && keys.indexOf(alt) === -1) {
        problems.push(`${file} 位置${gi + 1}：工單有「${type}」，但 block.json 沒有 ${want}（也沒有 ${alt}）→ 匯入時這欄內容會被丟掉`);
      }
    });
  });

  /* 反向：block.json 有圖片欄位，但工單完全沒提到 → 畫布上會出現多餘的佔位卡 */
  const specTypes = new Set();
  (spec.groups || []).forEach((g) => g.forEach((x) => specTypes.add(typeof x === 'string' ? x : x.type)));
  const wantedImageKeys = new Set();
  specTypes.forEach((t) => {
    const b = LABEL_TO_FIELD_BASE[t];
    if (b) for (let i = 1; i <= (spec.n || 1); i++) { wantedImageKeys.add(b); wantedImageKeys.add(b + i); }
  });
  block.fields.filter((f) => f.type === 'image').forEach((f) => {
    if (!wantedImageKeys.has(f.key)) {
      problems.push(`${file}：block.json 有圖片欄位 ${f.key}（${f.label}），但工單規格沒有這一項 → 畫布會多出一個佔位卡`);
    }
  });
});

console.log(`檢查 ${Object.keys(MSBN_FIELDS).length} 個 MSBN 版位、${checked} 組欄位對應\n`);
if (!problems.length) {
  console.log('全部對得上，工單每一欄的內容都有地方可以放。');
  process.exit(0);
}

/* 逐條列 81 行看不出重點，改成依「原因」歸類，才知道要修幾件事 */
const groups = new Map();
problems.forEach((p) => {
  const key = p.replace(/^MSBN-[\w-]+\.jpg( 位置\d+)?：?/, '')
    .replace(/沒有 \w+（也沒有 \w+）/, '沒有對應欄位')
    .replace(/圖片欄位 \w+（([^）]*)）/, '圖片欄位「$1」');
  const file = /^(MSBN-[\w-]+\.jpg)/.exec(p)[1];
  if (!groups.has(key)) groups.set(key, new Set());
  groups.get(key).add(file);
});

console.log(`發現 ${problems.length} 處對不上，歸納成 ${groups.size} 種原因：\n`);
[...groups.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .forEach(([reason, files]) => {
    console.log(`  ${String(files.size).padStart(2)} 個版位  ${reason}`);
    console.log(`            ${[...files].join(', ')}`);
  });

console.log('\nMSBN B-4-1 / B-4-2 的狀態：');
['MSBN-B-4-1.jpg', 'MSBN-B-4-2.jpg'].forEach((f) => {
  const mine = problems.filter((p) => p.startsWith(f));
  console.log(`  ${f}：${mine.length ? mine.length + ' 處對不上' : '全部對得上 ✓'}`);
});
