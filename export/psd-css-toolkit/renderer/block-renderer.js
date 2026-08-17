/* ════════════════════════════════════════════════════════════
   block-renderer.js — 最小可用的版位渲染引擎（無相依套件）

   吃 psdcss.build_blocks 產生的 block.json，吐出絕對定位的 HTML。
   把「PS 設計稿 → 瀏覽器」之間所有校正都實作在這裡，
   所以只要 block.json 是那支程式產的，畫出來就會跟設計稿對齊。

   用法：
     BlockRenderer.render(schema, data, opts) → HTML 字串
       schema  block.json 的內容
       data    { 欄位key: 內容 }，文字給字串、圖片給網址或 dataURL
       opts    { editable:true 讓文字可以直接在畫布上點著改 }

   schema 支援的圖層屬性（重要的都有註解）：
     共同      type / left / top / width / height / zIndex / hidden
     形狀      backgroundColor / backgroundImage / opacity / borderRadius
               psRadius / boxShadow / clipPath / border
     文字      fontSize / fontFamily / fontWeight / color / lineHeight
               textAlign / letterSpacing / whiteSpace / topExact
               field / fieldLabel / default / designText / maxLength
     圖片      field / defaultSrc / clipImage / bgField / keepBgWithImage
   ════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* 字型的內容區高度（em）＝ (hhea.ascent + |descent|) ÷ unitsPerEm。
     ShopeeNotoSans 是 (1160+320)/1000 = 1.48。
     換字型時要跟著改，不然「文字不被裁掉」的 padding 會算錯。 */
  var FONT_CONTENT_EM = 1.48;

  function setFontContentEm(v) { FONT_CONTENT_EM = v; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function px(v) { return (Math.round(v * 1000) / 1000) + 'px'; }

  /* 圖片欄位可以用逗號放多張。dataURL 本身含逗號，遇到 data: 開頭要接回來。 */
  function splitImages(v) {
    var raw = String(v == null ? '' : v).split(',');
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var s = raw[i].trim();
      if (/^data:/i.test(s) && i + 1 < raw.length) { out.push(s + ',' + raw[++i].trim()); }
      else if (s) { out.push(s); }
    }
    return out.filter(function (u) { return /^(data:|https?:|blob:|\.{0,2}\/|[\w.-]+\/)/i.test(u); });
  }

  /* 行距解析：小數當倍數（1.116），大數當 px（48）。 */
  function lineHeightMultiplier(layer) {
    var lh = layer.lineHeight;
    if (lh == null || !layer.fontSize) return 1;
    var n = parseFloat(lh);
    if (isNaN(n) || n <= 0) return 1;
    return n <= 4 ? n : (n / layer.fontSize);
  }

  function placeholder(layer) {
    var w = layer.width || 0, h = layer.height || 0;
    var label = String(layer.fieldLabel || '圖片').replace(/圖片網址|網址/g, '').trim();
    var icon = Math.max(12, Math.min(26, Math.round(Math.min(w, h) * 0.28)));
    var html = '<div style="width:100%;height:100%;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:3px;box-sizing:border-box;padding:4px;' +
      'border:1px dashed rgba(31,43,41,.18);border-radius:8px;background:rgba(255,255,255,.34);' +
      'color:rgba(31,43,41,.42);font-family:system-ui,sans-serif;line-height:1.35;' +
      'text-align:center;overflow:hidden;">' +
      '<div style="font-size:' + icon + 'px;line-height:1;opacity:.5;">&#128247;</div>';
    if (w >= 96 && h >= 56) {
      html += '<div style="font-size:11px;font-weight:600;white-space:nowrap;">' +
        esc(label) + '</div>';
    }
    return html + '</div>';
  }

  function renderLayer(layer, data, opts) {
    if (layer.hidden) return '';          /* 設計稿上的示意／標註圖層，不輸出 */

    var style = ['position:absolute'];
    var top = layer.top;
    var textPadV = 0;

    /* ── 文字：把 topExact（內容區上緣）直接當最終位置 ──────────
       topExact 是產生 block.json 時就用「筆畫上緣 − 字型字高」算好的，
       這裡不需要、也不可以再做任何推算。 */
    if (layer.type === 'text' && layer.fontSize) {
      if (layer.topExact != null) top = layer.topExact;

      /* 裁切補償：行框常常比字本身矮（行距 0.956 < 字高 1.48），
         overflow:hidden 會把字的上下切掉。用上下 padding 把裁切邊界推到字外面，
         同時因為 padding 不影響行框位置，字的位置完全不變。 */
      var lineBox = lineHeightMultiplier(layer) * layer.fontSize;
      textPadV = Math.max(0, (FONT_CONTENT_EM * layer.fontSize - lineBox) / 2);
    }

    style.push('left:' + px(layer.left));
    style.push('top:' + px(top));
    if (textPadV > 0) {
      style.push('padding-top:' + px(textPadV));
      style.push('padding-bottom:' + px(textPadV));
      style.push('box-sizing:content-box');   /* 加了 padding 不能把框撐大 */
    }
    if (layer.zIndex != null) style.push('z-index:' + layer.zIndex);
    if (layer.width != null) style.push('width:' + px(layer.width));
    if (layer.height != null) style.push('height:' + px(layer.height));
    if (layer.boxShadow) style.push('box-shadow:' + layer.boxShadow);
    if (layer.clipPath) style.push('clip-path:' + layer.clipPath);
    if (layer.border) style.push('border:' + layer.border);

    /* ── 圓角：psRadius 代表「就照 PS 的數字畫」 ──────────────
       沒有 psRadius 的話，可以在這裡接自己專案的統一圓角規則。 */
    if (layer.borderRadius) {
      style.push('border-radius:' + (typeof layer.borderRadius === 'number'
        ? layer.borderRadius + 'px' : layer.borderRadius));
    } else if (layer.type === 'circle') {
      style.push('border-radius:50%');
    }

    var content = '';
    var key = layer.field;
    var attrs = '';

    if (layer.type === 'image') {
      var urls = splitImages(key ? data[key] : null);
      if (!urls.length && layer.defaultSrc) urls = [layer.defaultSrc];
      var hasImg = urls.length > 0;

      /* bgField：這個圖片框同時是一塊看得到的色塊（例如「曝品範圍」），
         放了圖之後底色還是要留著；一般商品圖框的佔位底色則要消失。 */
      var keepBg = layer.keepBgWithImage || !!layer.bgField;
      var bg = (layer.bgField && data[layer.bgField]) || layer.backgroundColor;
      if (bg && (!hasImg || keepBg)) style.push('background-color:' + bg);
      if (!hasImg && layer.opacity != null) style.push('opacity:' + layer.opacity);

      style.push('display:flex', 'align-items:center', 'justify-content:center');
      /* clipImage：放大時裁切在框內（連圓角一起吃）。沒標就允許超出框。 */
      style.push('overflow:' + (layer.clipImage ? 'hidden' : 'visible'));

      if (hasImg) {
        content = '<div class="blk-imggroup" data-field="' + esc(key || '') + '" ' +
          'style="width:100%;height:100%;display:flex;align-items:center;' +
          'justify-content:center;gap:5px;overflow:visible;">' +
          urls.map(function (u) {
            return '<img src="' + esc(u) + '" style="height:100%;width:auto;' +
              'object-fit:contain;display:block;flex-shrink:0;">';
          }).join('') + '</div>';
      } else {
        style.push('overflow:hidden');
        content = placeholder(layer);
      }
      if (key) {
        attrs += ' data-img-field="' + esc(key) + '"' +
          ' data-img-label="' + esc(layer.fieldLabel || '圖片') + '"';
      }

    } else if (layer.type === 'text') {
      style.push('font-size:' + layer.fontSize + 'px');
      if (layer.fontFamily) style.push('font-family:' + JSON.stringify(layer.fontFamily));
      if (layer.color) style.push('color:' + layer.color);
      if (layer.fontWeight) style.push('font-weight:' + layer.fontWeight);
      if (layer.letterSpacing) style.push('letter-spacing:' + layer.letterSpacing + 'px');
      if (layer.lineHeight != null) style.push('line-height:' + lineHeightMultiplier(layer));
      if (layer.textAlign) style.push('text-align:' + layer.textAlign);
      style.push('white-space:' + (layer.whiteSpace || 'nowrap'));
      style.push('overflow:hidden');
      /* 沒綁欄位的文字＝純裝飾，不能擋住滑鼠，
         否則蓋在圖片框上面時，圖片就拖不進那個框了。 */
      if (!key) style.push('pointer-events:none');

      var text = key ? (data[key] != null ? data[key] : layer.default) : layer.default;
      content = esc(text || '');
      if (opts && opts.editable && key) {
        style.push('outline:none', 'cursor:text');
        attrs += ' contenteditable="true" spellcheck="false" data-field="' + esc(key) + '"';
      }

    } else {
      /* rect / circle：純色塊，直接照 PS 的座標畫 */
      var color = (key && data[key]) || layer.backgroundColor;
      if (color) style.push('background-color:' + color);
      if (layer.backgroundImage) style.push('background-image:' + layer.backgroundImage);
      if (layer.opacity != null) style.push('opacity:' + layer.opacity);
      style.push('pointer-events:none');
    }

    return '<div' + attrs + " style='" + style.join(';') + ";'>" + content + '</div>';
  }

  function render(schema, data, opts) {
    data = data || {};
    var layers = (schema.layers || []).slice()
      .sort(function (a, b) { return (a.zIndex || 0) - (b.zIndex || 0); });
    var html = '<div class="blk-' + esc(schema.id) + '" style="position:relative;width:' +
      schema.width + 'px;height:' + schema.height + 'px;overflow:hidden;">';
    for (var i = 0; i < layers.length; i++) html += renderLayer(layers[i], data, opts);
    return html + '</div>';
  }

  /* 欄位清單：拿來產生編輯面板。 */
  function fields(schema) {
    var seen = {}, out = [];
    (schema.layers || []).forEach(function (l) {
      if (l.hidden) return;
      function add(key, label, type, def, extra) {
        if (!key || seen[key]) return;
        seen[key] = true;
        var f = { key: key, label: label, type: type, default: def == null ? '' : def };
        if (extra) Object.keys(extra).forEach(function (k) { f[k] = extra[k]; });
        out.push(f);
      }
      var type = l.type === 'image' ? 'image'
        : (l.type === 'text' ? 'text' : 'color');
      if (l.field) {
        add(l.field, l.fieldLabel || l.field, type, l.default,
          { maxLength: l.maxLength, designText: l.designText });
      }
      if (l.bgField) add(l.bgField, l.bgFieldLabel || '底色', 'color', l.backgroundColor);
    });
    return out;
  }

  /* 預覽用的資料：mode = 'design'（設計稿文字）/ 'default' / 'empty' */
  function sampleData(schema, mode) {
    var data = {};
    fields(schema).forEach(function (f) {
      if (f.type === 'image') { data[f.key] = ''; return; }
      if (f.type !== 'text') { data[f.key] = ''; return; }
      if (mode === 'empty') data[f.key] = '';
      else if (mode === 'default') data[f.key] = f.default || '';
      else data[f.key] = f.designText || f.default || '';
    });
    return data;
  }

  var api = { render: render, fields: fields, sampleData: sampleData,
              setFontContentEm: setFontContentEm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.BlockRenderer = api;
})(typeof window !== 'undefined' ? window : this);
