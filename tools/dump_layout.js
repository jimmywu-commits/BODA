/* 把「渲染引擎實際算出來的座標」印出來，用來跟 PS 參考圖比對。

   跟 verify-text-layout.js 一樣，是直接跑 core/schema-renderer.js 這支產品程式碼
   （不是另外重寫一份排版公式），所以印出來的就是網頁上真正會出現的位置。

   用法：
     node tools/dump_layout.js msbn_C_1_1 msbn_C_1_2
     node tools/dump_layout.js msbn_C_1_1 --field promo
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

const args = process.argv.slice(2);
const fieldFilter = args.includes('--field') ? args[args.indexOf('--field') + 1] : null;
const ids = args.filter((a) => !a.startsWith('--') && a !== fieldFilter);

ids.forEach((id) => {
  const file = path.join(ROOT, 'blocks', id, 'block.json');
  if (!fs.existsSync(file)) { console.log('找不到', id); return; }
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
  sandbox.BNSchemaRenderer.registerFromSchema(schema);
  const def = registered[id];
  const data = {};
  (def.fields || []).forEach((f) => { data[f.key] = f.type === 'image' ? '' : (f.default || ''); });
  const html = def.render(data, { editable: true });

  console.log('\n═══', id, schema.width + '×' + schema.height);
  const re = /<div([^>]*?)style='([^']*)'/g;
  let m;
  let i = 0;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const style = m[2];
    const get = (p) => {
      const mm = new RegExp('(?:^|;)\\s*' + p + ':\\s*([^;]+)').exec(style);
      return mm ? mm[1].trim() : '';
    };
    const f = (/data-field="([^"]*)"/.exec(attrs) || [])[1]
      || (/data-img-field="([^"]*)"/.exec(attrs) || [])[1] || '';
    if (fieldFilter && f !== fieldFilter) { i++; continue; }
    console.log('  %s left=%s top=%s w=%s h=%s radius=%s overflow=%s pe=%s',
      (f || '·').padEnd(12), get('left').padEnd(10), get('top').padEnd(10),
      get('width').padEnd(9), get('height').padEnd(8),
      (get('border-radius') || '-').padEnd(22),
      (get('overflow') || '-').padEnd(8), get('pointer-events') || '-');
    i++;
  }
});
