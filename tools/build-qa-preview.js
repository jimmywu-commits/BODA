/* 產生「排版驗證」頁：把渲染引擎實際畫出來的文字，疊在 PS 參考圖上面，
   一眼就能看出圓標字／品名／警語有沒有對準。

   用法：node tools/build-qa-preview.js
   產出：排版驗證.html（放在專案根目錄，這樣 fonts/ 跟 msbn-img/ 的相對路徑才抓得到）

   跟 verify-text-layout.js 一樣，是直接跑 core/schema-renderer.js 這支產品程式碼，
   不是另外重寫一份排版公式，所以看到的位置就是網頁上真正會出現的位置。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadEngine(rendererPath, configPath) {
  const registered = {};
  const stub = () => ({ appendChild() {}, setAttribute() {}, style: {}, textContent: '', id: '' });
  const sandbox = {
    console: { error() {}, warn() {}, log() {} },
    BNCore: { registerBlock: (b) => { registered[b.id] = b; } },
    document: { getElementById: () => null, createElement: stub, head: stub(), body: stub() },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(configPath, 'utf8'), sandbox, { filename: configPath });
  vm.runInContext(fs.readFileSync(rendererPath, 'utf8'), sandbox, { filename: rendererPath });
  return { sandbox, registered };
}

/* 參考圖上的字是設計稿的示意文字，長度會影響置中結果。
   這裡用每個圖層自己的 default（就是 PS 稿上的那串字），
   對齊結果才跟參考圖可比。 */
function buildData(schema) {
  const data = {};
  const put = (l, key) => {
    if (!l.field) return;
    data[key] = l.type === 'text' ? (l.default != null ? l.default : '文字') : '';
  };
  (schema.layers || []).forEach((l) => put(l, l.field));
  (schema.repeats || []).forEach((r) => (r.instances || []).forEach((inst) => {
    (r.layers || []).forEach((l) => put(l, (l.globalField ? '' : inst.key) + l.field));
  }));
  return data;
}

const engine = loadEngine(
  path.join(ROOT, 'core/schema-renderer.js'),
  path.join(ROOT, 'JS/render-config.js'));

const dirs = fs.readdirSync(path.join(ROOT, 'blocks'))
  .filter((d) => fs.existsSync(path.join(ROOT, 'blocks', d, 'block.json')))
  .sort();

const cards = [];
for (const d of dirs) {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'blocks', d, 'block.json'), 'utf8'));
  if (!schema.id || !schema.refImage) continue;
  const imgDir = fs.existsSync(path.join(ROOT, 'msbn-img', schema.refImage)) ? 'msbn-img' : 'img';

  engine.sandbox.BNSchemaRenderer.registerFromSchema(JSON.parse(JSON.stringify(schema)));
  const block = engine.registered[schema.id];
  if (!block) continue;
  const html = block.render(buildData(schema), {});

  /* 圓標圈的位置另外畫一圈黃色虛線，方便確認圓標字有沒有在圈裡面 */
  const guides = (schema.layers || [])
    .filter((l) => /^badgeBg\d*$/.test(String(l.id || '')))
    .map((l) => `<div class="guide" style="left:${l.left}px;top:${l.top}px;width:${l.width}px;height:${l.height}px;border-radius:50%;"></div>`)
    .join('');

  cards.push(`
  <section class="card">
    <h2>${schema.name || schema.id} <span class="id">${schema.id}</span></h2>
    <div class="stage" style="width:${schema.width}px;height:${schema.height}px;">
      <img class="ref" src="${imgDir}/${schema.refImage}" style="width:${schema.width}px;height:${schema.height}px;">
      <div class="render" style="width:${schema.width}px;height:${schema.height}px;">${html}</div>
      <div class="guides">${guides}</div>
    </div>
  </section>`);
}

const page = `<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<title>排版驗證 — 渲染結果 vs PS 參考圖</title>
<style>
  @font-face{font-family:"ShopeeNotoSans (content)";font-weight:400;src:url("fonts/ShopeeNotoSans(content)-Regular.ttf") format("truetype");}
  @font-face{font-family:"ShopeeNotoSans (content)";font-weight:500;src:url("fonts/ShopeeNotoSans(content)-Medium.ttf") format("truetype");}
  @font-face{font-family:"ShopeeNotoSans (content)";font-weight:700;src:url("fonts/ShopeeNotoSans(content)-Bold.ttf") format("truetype");}
  body{margin:0;padding:24px;background:#f5f6f8;font-family:system-ui,"Microsoft JhengHei",sans-serif;color:#121827;}
  h1{font-size:20px;margin:0 0 4px;}
  .hint{font-size:13px;color:#6b7280;margin:0 0 18px;line-height:1.7;}
  .bar{position:sticky;top:0;z-index:9999;background:#fff;border:1px solid #e5e7eb;border-radius:10px;
       padding:12px 16px;margin-bottom:20px;display:flex;gap:22px;align-items:center;flex-wrap:wrap;
       box-shadow:0 2px 8px rgba(0,0,0,.06);font-size:14px;}
  .bar label{display:flex;gap:7px;align-items:center;cursor:pointer;}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:20px;
        overflow:auto;box-shadow:0 1px 3px rgba(0,0,0,.05);}
  h2{font-size:15px;margin:0 0 10px;}
  .id{font-size:12px;color:#9ca3af;font-weight:400;margin-left:6px;}
  .stage{position:relative;transform-origin:top left;}
  .ref{position:absolute;left:0;top:0;}
  .render{position:absolute;left:0;top:0;}
  .guides{position:absolute;left:0;top:0;}
  .guide{position:absolute;border:2px dashed #f5b400;pointer-events:none;}
  /* 只看文字：把渲染層的圖片跟色塊藏起來，只留文字，疊在參考圖上最好比對 */
  body.textonly .render div:not([style*="font-size"]){background:transparent!important;
      box-shadow:none!important;border-color:transparent!important;}
  body.textonly .render img{display:none!important;}
  body.noref .ref{display:none;}
  body.noguide .guide{display:none;}
</style></head><body class="textonly">
<h1>排版驗證 — 渲染結果 vs PS 參考圖</h1>
<p class="hint">
  底圖是 PS 參考圖，上面疊的是渲染引擎實際畫出來的圖層（文字用各圖層自己的預設示意文字）。<br>
  文字要跟參考圖上的字重疊在一起才算對位；黃色虛線圈是圓標底圈的實際範圍，圓標字必須落在圈內。
</p>
<div class="bar">
  <label><input type="checkbox" id="t" checked> 只顯示文字（藏掉圖片色塊）</label>
  <label><input type="checkbox" id="r"> 隱藏參考圖</label>
  <label><input type="checkbox" id="g"> 隱藏圓標圈虛線</label>
  <label>縮放 <input type="range" id="z" min="30" max="100" value="60"> <span id="zv">60%</span></label>
</div>
${cards.join('\n')}
<script>
  var b = document.body;
  document.getElementById('t').onchange = function(){ b.classList.toggle('textonly', this.checked); };
  document.getElementById('r').onchange = function(){ b.classList.toggle('noref', this.checked); };
  document.getElementById('g').onchange = function(){ b.classList.toggle('noguide', this.checked); };
  var z = document.getElementById('z'), zv = document.getElementById('zv');
  function applyZoom(){
    var s = z.value / 100; zv.textContent = z.value + '%';
    document.querySelectorAll('.stage').forEach(function(st){
      st.style.transform = 'scale(' + s + ')';
      st.parentElement.style.height = (parseFloat(st.style.height) * s + 8) + 'px';
      st.parentElement.style.width  = (parseFloat(st.style.width) * s + 8) + 'px';
    });
  }
  z.oninput = applyZoom; applyZoom();
</script>
</body></html>`;

fs.writeFileSync(path.join(ROOT, '排版驗證.html'), page, 'utf8');
console.log('產出 排版驗證.html — 共 ' + cards.length + ' 個版位');
