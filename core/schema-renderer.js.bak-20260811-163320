/* ════════════════════════════════════════
   BN Schema Renderer — 純資料驅動的版位渲染引擎
   ────────────────────────────────────────
   版位不再自己寫 render() 邏輯，只需要提供一份 block.json 描述：
     - layers：不會重複的圖層（背景、漸層…）
     - repeats：會重複的一組圖層（例如「每品」×3），
       只需要給一份「樣板座標」+ 每個重複實例的位移基準點，
       這支引擎會自動算出每個實例的實際座標。

   這樣子以後新增版位、修改座標，都只是改數字（JSON），
   不會再因為手寫 render() 忘記加 position:absolute、
   z-index 排錯、transform-origin 亂加這類人為疏失而跑版。

   ── JSON 結構 ──
   {
     "id": "msbn3p", "name": "三品比對 MSBN_3P", "width": 1200, "height": 400,
     "layers": [                       // 不重複的圖層
       { "type":"image", "left":0,"top":0,"width":1200,"height":400,"zIndex":1,
         "backgroundColor":"#4f96c6", "field":"bgImage", "fieldLabel":"整體底圖" }
     ],
     "repeats": [
       {
         "templateBaseLeft": 804,      // 這份樣板座標是照哪一個實例量的
         "instances": [
           { "key":"p1", "baseLeft":30,  "label":"左" },
           { "key":"p2", "baseLeft":418, "label":"中" },
           { "key":"p3", "baseLeft":804, "label":"右" }
         ],
         "layers": [
           { "type":"text", "left":892.222,"top":306.2,"zIndex":360,
             "fontSize":29,"color":"rgb(255,255,255)","textAlign":"center",
             "field":"Name","fieldLabel":"品名","default":"品名一排7字內" }
         ]
       }
     ]
   }

   圖層 type：
     "image"  → 有 field(圖片網址) 時顯示圖片鋪滿；沒有時顯示 backgroundColor+opacity 佔位色
     "rect"   → 純色矩形（可加 clipPath 做三角形等形狀）
     "circle" → 圓形（border-radius:50%），可用 field 做顏色覆寫（globalField:true 代表三個實例共用一個欄位）
     "text"   → 文字，field 對應到可編輯內容
════════════════════════════════════════ */
(function (global) {

  /* ════════════════════════════════════════
     可調參數設定檔（render-config.json）
     ────────────────────────────────────────
     這些是「針對PS CSS額外做的調整」的可調數字，跟每個版位自己的座標資料(block.json)
     分開放。使用者可以直接編輯 render-config.json 微調這些值，不用碰程式碼。
     這裡先給一組預設值，setConfig() 載入實際檔案內容後會覆蓋掉。
  ════════════════════════════════════════ */
  var CONFIG = {
    textVerticalCorrection: { promo: 0, name: 0, warn: 0, badgeText: 0, ctaText: 0, logoText: 0 },
    letterSpacing: { promo: 0, name: 0, warn: 0, badgeText: 0, ctaText: 0, logoText: 0 },
    badge: { maxWidth: 80, lineHeight: 53 },
    image: { logoInsetScalePercent: 70, productImageInsetScalePercent: 100 },
    cardStyle: { cardCornerRadius: 15, promoBarTopCornerRadius: 15 }
  };

  function setConfig(cfg) {
    if (!cfg) return;
    Object.keys(cfg).forEach(function (k) {
      if (CONFIG[k] && typeof CONFIG[k] === 'object' && !Array.isArray(CONFIG[k])) {
        Object.assign(CONFIG[k], cfg[k]);
      } else {
        CONFIG[k] = cfg[k];
      }
    });
  }

  /* 讀取 render-config.js（用 <script> 標籤同步載入，寫在 window.BN_RENDER_CONFIG 上）。
     這個檔案要在 core-engine.js / schema-renderer.js 之前用 <script src="render-config.js">
     載入，才能保證這裡讀到的時候資料已經在了；如果沒放這個檔案，或忘記在 index.html
     加載入標籤，就繼續用上面寫死的預設值，不影響其他功能。 */
  if (window.BN_RENDER_CONFIG) setConfig(window.BN_RENDER_CONFIG);

  /* 一次性注入字型宣告：所有版位統一用 ShopeeNotoSans (content)，
     字型檔放在跟 index.html 同層的 fonts/ 資料夾底下，檔名如下三個：
       fonts/ShopeeNotoSans(content)-Regular.ttf （400 Regular，CTA文字用）
       fonts/ShopeeNotoSans(content)-Medium.ttf  （500 Medium，警語/圓標用）
       fonts/ShopeeNotoSans(content)-Bold.ttf    （700 Bold，促標/品名用）
     檔名要完全一致才抓得到；如果你實際拿到的字型檔名不同，把下面三個 url() 路徑改成實際檔名即可。 */
  if (!document.getElementById('bn-fontface')) {
    var fontStyle = document.createElement('style');
    fontStyle.id = 'bn-fontface';
    fontStyle.textContent =
      '@font-face{font-family:"ShopeeNotoSans (content)";font-weight:400;font-style:normal;' +
      'src:url("fonts/ShopeeNotoSans(content)-Regular.ttf") format("truetype");}' +
      '@font-face{font-family:"ShopeeNotoSans (content)";font-weight:500;font-style:normal;' +
      'src:url("fonts/ShopeeNotoSans(content)-Medium.ttf") format("truetype");}' +
      '@font-face{font-family:"ShopeeNotoSans (content)";font-weight:700;font-style:normal;' +
      'src:url("fonts/ShopeeNotoSans(content)-Bold.ttf") format("truetype");}';
    document.head.appendChild(fontStyle);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* 把「逗號分隔的多張圖」欄位值拆成陣列。
     dataURL（data:image/png;base64,xxxx）本身固定含有一個逗號，
     不能直接用逗號切，切開後遇到 data: 開頭的片段，
     要把緊接著的下一段（base64 內容）接回來，才是完整的一張圖。 */
  function splitImageList(v) {
    var raw = String(v == null ? '' : v).split(',');
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i].trim();
      if (!t) continue;
      if (/^data:/i.test(t) && i + 1 < raw.length) { out.push(t + ',' + raw[i + 1].trim()); i++; }
      else out.push(t);
    }
    return out;
  }
  function px(n) { return n + 'px'; }

  /* 算出這個圖層在資料物件裡對應的 key
     - 不在 repeat 裡（fieldPrefix為null）→ 直接用 layer.field
     - 在 repeat 裡、globalField:true（三品共用，如CTA顏色）→ 直接用 layer.field
     - 在 repeat 裡、一般欄位 → instance.key + layer.field（例如 p1Name） */
  function resolveFieldKey(layer, fieldPrefix) {
    if (!layer.field) return null;
    if (!fieldPrefix || layer.globalField) return layer.field;
    return fieldPrefix + layer.field;
  }

  function renderLayer(layer, left, top, data, fieldPrefix, opts) {
    /* hideIfField：例如 LOGO 佔位文字，一旦 logoImg 欄位有值，這層文字就不畫出來 */
    if (layer.hideIfField) {
      var hideKey = fieldPrefix ? fieldPrefix + layer.hideIfField : layer.hideIfField;
      if (data[hideKey]) return '';
    }

    /* PS 文字圖層座標修正：
       PS 匯出「只給 left/top、沒有 transform 縮放」的文字圖層時，量測基準點跟瀏覽器
       實際渲染文字的位置差了幾乎正好一個字體大小（用參考圖實測比對出來的規律，
       促標/品名/警語三個元素都準確符合 top差距≈fontSize）。
       這裡只對「沒有縮放，或縮放接近1（可視為沒縮放）」的文字套用這個修正；
       像 msbn3p 那種有明顯縮放 transform 的文字，是另一套已經驗證過的座標系統，不能套用這個修正。 */
    if (layer.type === 'text' && layer.fontSize && !layer.verticalCenter) {
      var noScale = !layer.transform ||
        (Math.abs(layer.transform[0] - 1) < 0.05 && Math.abs(layer.transform[3] - 1) < 0.05);
      if (noScale) {
        var extra = CONFIG.textVerticalCorrection[layer.id] || 0;
        top = top - layer.fontSize + extra;
      }
    }

    /* 圓標文字：寬度/行距改用設定檔的值即時計算（不是寫死在資料裡），
       這樣使用者改 render-config.json 的 badge.maxWidth / badge.lineHeight 就能直接生效，
       置中位置(left)也會跟著重新算，不會因為改了寬度就跑位 */
    var badgeWidthOverride = null;
    if (layer.verticalCenter && layer._boxLeft != null && layer._boxWidth != null) {
      badgeWidthOverride = CONFIG.badge.maxWidth;
      left = layer._boxLeft + (layer._boxWidth - badgeWidthOverride) / 2;
    }

    var style = ['position:absolute', 'left:' + px(left), 'top:' + px(top)];
    if (layer.zIndex != null) style.push('z-index:' + layer.zIndex);
    if (badgeWidthOverride != null) style.push('width:' + px(badgeWidthOverride));
    else if (layer.width != null) style.push('width:' + px(layer.width));
    if (layer.height != null) style.push('height:' + px(layer.height));
    if (layer.boxShadow) style.push('box-shadow:' + layer.boxShadow);
    if (layer.clipPath) style.push('clip-path:' + layer.clipPath);
    if (layer.id === 'bg') {
      style.push('border-radius:' + CONFIG.cardStyle.cardCornerRadius + 'px');
    } else if (layer.id === 'promoBg') {
      var r = CONFIG.cardStyle.promoBarTopCornerRadius;
      style.push('border-radius:' + r + 'px ' + r + 'px 0 0');
    } else if (layer.borderRadius && layer.type !== 'circle') {
      style.push('border-radius:' + (typeof layer.borderRadius === 'number' ? layer.borderRadius + 'px' : layer.borderRadius));
    }

    var content = '';
    var fieldKey = resolveFieldKey(layer, fieldPrefix);

    if (layer.type === 'image') {
      var url = fieldKey ? data[fieldKey] : null;
      /* LOGO 圖是內縮70%，周圍留白要看得到白色底色，所以底色要一直鋪著（keepBgWithImage:true）；
         商品圖是滿版contain顯示，一旦有圖片，原本的灰色佔位底色就該完全消失，不能透出來 */
      if (layer.backgroundColor && (!url || layer.keepBgWithImage)) style.push('background-color:' + layer.backgroundColor);
      if (!url && layer.opacity != null) style.push('opacity:' + layer.opacity); /* 半透明佔位色只在「還沒放圖片」時套用 */
      if (url) {
        /* 改用真正的 <img> + object-fit:contain：
           - 商品圖類：imageScale 預設100，等於整張圖完整顯示、依寬或高哪個先頂到邊自動縮小、置中，不裁切
           - LOGO圖：imageScale設70，讓圖片內縮在框內只佔70%大小，四周留白置中
           支援同一欄位用逗號分隔多張圖片網址（例如 "a.jpg,b.jpg"），
           每張圖高度=範圍高、等間距5px、整組置中、超寬整組等比縮小、
           滑鼠滾輪縮放──這些排版/互動邏輯都交給獨立的 image-layout.js 處理，
           這裡只需要把每張圖片的<img>標籤跟一個「群組容器」準備好。 */
        style.push('display:flex');
        style.push('align-items:center');
        style.push('justify-content:center');
        style.push('overflow:hidden');
        var scalePct;
        if (layer.id === 'logoBg') scalePct = CONFIG.image.logoInsetScalePercent;
        else if (layer.id === 'productArea' || layer.id === 'productArea1' || layer.id === 'productArea2' || layer.id === 'bg') scalePct = CONFIG.image.productImageInsetScalePercent;
        else scalePct = layer.imageScale != null ? layer.imageScale : 100;

        var urls = splitImageList(url);
        var imgsHtml = urls.map(function (u) {
          return '<img src="' + esc(u) + '" class="bn-imggroup-img" style="height:100%;width:auto;object-fit:contain;display:block;flex-shrink:0;">';
        }).join('');
        content = '<div class="bn-imggroup" data-field-key="' + esc(fieldKey || '') + '" ' +
          'style="width:' + scalePct + '%;height:' + scalePct + '%;display:flex;align-items:center;justify-content:center;overflow:hidden;">' +
          imgsHtml + '</div>';
      }
    } else if (layer.type === 'rect') {
      var rectColor = (fieldKey && data[fieldKey]) ? data[fieldKey] : layer.backgroundColor;
      if (rectColor) style.push('background-color:' + rectColor);
      if (layer.backgroundImage) style.push('background-image:' + layer.backgroundImage); /* 漸層等裝飾底 */
      if (layer.border) style.push('border:' + layer.border);
      if (layer.opacity != null) style.push('opacity:' + layer.opacity);
    } else if (layer.type === 'circle') {
      style.push('border-radius:50%');
      var color = (fieldKey && data[fieldKey]) ? data[fieldKey] : layer.backgroundColor;
      if (color) style.push('background-color:' + color);
      if (layer.border) style.push('border:' + layer.border);
    } else if (layer.type === 'text') {
      if (layer.fontSize != null) style.push('font-size:' + layer.fontSize + 'px');
      if (layer.fontFamily) style.push('font-family:' + JSON.stringify(layer.fontFamily));
      if (layer.color) style.push('color:' + layer.color);
      if (layer.fontWeight) style.push('font-weight:' + layer.fontWeight);
      var ls = CONFIG.letterSpacing[layer.id];
      if (ls) style.push('letter-spacing:' + ls + 'px');
      var lh = layer.verticalCenter ? CONFIG.badge.lineHeight : layer.lineHeight;
      if (lh != null) style.push('line-height:' + (typeof lh === 'number' ? lh + 'px' : lh));
      if (layer.textAlign) style.push('text-align:' + layer.textAlign);
      if (layer.textDecoration) style.push('text-decoration:' + layer.textDecoration);
      style.push('white-space:' + (layer.whiteSpace || 'nowrap'));
      if (layer.transform) style.push('transform:matrix(' + layer.transform.join(',') + ')');
      /* 所有文字都不能超出自己的範圍：裁掉多餘的部分，不會擠壓/蓋到旁邊的圖層 */
      style.push('overflow:hidden');
      if (layer.verticalCenter) {
        /* 圓標這種可能斷成兩行的文字，用 flex 置中：不管一行還是兩行，
           整塊文字永遠垂直+水平置中在圓標色塊範圍內，而且height已經限制成
           跟圓標一樣大，兩行加起來太高也會被裁掉，不會超出圓標範圍 */
        style.push('display:flex');
        style.push('flex-direction:column');
        style.push('align-items:center');
        style.push('justify-content:center');
      }
      var text = fieldKey ? (data[fieldKey] != null ? data[fieldKey] : layer.default) : layer.default;
      content = esc(text || '');
    }

    var attrs = '';
    if (opts && opts.editable && layer.type === 'text' && fieldKey) {
      /* 可以直接在畫布上點擊編輯：contenteditable + 記住對應的欄位key，
         外部（例如匯入工單頁面）監聽 input/blur 事件時可以用 data-field 取值寫回資料 */
      style.push('outline:none');
      style.push('cursor:text');
      attrs = ' contenteditable="true" spellcheck="false" data-field="' + esc(fieldKey) + '"';
    }

    return "<div" + attrs + " style='" + style.join(';') + ";'>" + content + '</div>';
  }

  function buildRender(schema) {
    return function (data, opts) {
      /* 外層容器本身是「整個版位的畫布邊界」，不是卡片，不需要圓角，維持直角矩形；
         真正看起來像卡片的圓角，是靠版位自己的「背景」「促標底」這些圖層各自的border-radius做出來的 */
      var overflow = schema.cornerRadius ? 'hidden' : 'visible';
      var html = '<div class="blk-' + schema.id + '" style="position:relative;width:' +
        schema.width + 'px;height:' + schema.height + 'px;overflow:' + overflow + ';background:#eee2cf;' +
        'font-family:sans-serif;">';

      (schema.layers || []).forEach(function (layer) {
        html += renderLayer(layer, layer.left, layer.top, data, null, opts);
      });

      (schema.repeats || []).forEach(function (repeat) {
        repeat.instances.forEach(function (inst) {
          (repeat.layers || []).forEach(function (layer) {
            var relLeft = layer.left - repeat.templateBaseLeft;
            var left = inst.baseLeft + relLeft;
            html += renderLayer(layer, left, layer.top, data, inst.key, opts);
          });
        });
      });

      html += '</div>';
      return html;
    };
  }

  function fieldType(layer) {
    if (layer.type === 'image') return 'image';
    if ((layer.type === 'circle' || layer.type === 'rect') && layer.field) return 'color';
    return 'text';
  }

  function buildFields(schema) {
    var seen = {};
    var fields = [];
    function addField(key, label, type, def, maxLength) {
      if (seen[key]) return;
      seen[key] = true;
      var f = { key: key, label: label, type: type, default: def != null ? def : '' };
      if (maxLength != null) f.maxLength = maxLength;
      fields.push(f);
    }

    (schema.layers || []).forEach(function (layer) {
      if (layer.field) addField(layer.field, layer.fieldLabel || layer.field, fieldType(layer), layer.default, layer.maxLength);
    });

    (schema.repeats || []).forEach(function (repeat) {
      repeat.instances.forEach(function (inst) {
        (repeat.layers || []).forEach(function (layer) {
          if (!layer.field) return;
          if (layer.globalField) {
            addField(layer.field, layer.fieldLabel || layer.field, fieldType(layer), layer.default, layer.maxLength);
          } else {
            addField(inst.key + layer.field, (inst.label || inst.key) + '・' + (layer.fieldLabel || layer.field),
              fieldType(layer), layer.default, layer.maxLength);
          }
        });
      });
    });

    return fields;
  }

  function registerFromSchema(schema) {
    if (!schema || !schema.id) { console.error('[BNSchemaRenderer] schema 缺少 id'); return; }
    global.BNCore.registerBlock({
      id: schema.id,
      name: schema.name || schema.id,
      width: schema.width,
      height: schema.height,
      fields: buildFields(schema),
      style: '', /* 全部用 inline style，不需要額外注入 <style> */
      render: buildRender(schema)
    });
  }

  global.BNSchemaRenderer = { registerFromSchema: registerFromSchema, setConfig: setConfig };
})(window);
