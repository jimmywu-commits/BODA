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

   renderInstance 的 opts（都可以不給）：
     opts.editable  文字圖層加上 contenteditable，可以直接在畫布上點著改
     opts.theme     全站統一的顏色覆寫，改一次所有版位一起變（匯入工單頁面在用）：
                    { bg, promoBg, promoText, badgeBg, badgeText, ctaBg, ctaText }
                    空字串／不給＝不覆寫，維持每個版位自己原本的顏色。
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
    textVerticalCorrection: { promo: 0, name: 0, warn: 0, badgeText: 0, ctaText: -3, logoText: 0 },
    letterSpacing: { promo: 0, name: 0, warn: 0, badgeText: 0, ctaText: 0, logoText: 0 },
    badge: { maxWidth: 80, lineHeight: 53 },
    /* 特定文字的行距覆寫（數字＝倍數，1 就是貼在一起）。
       代言人／簽名小字本來是 1.667，兩行之間太開，這裡壓緊一點。 */
    textLineHeight: { signNote: 1.15, endorserNote: 1.15 },
    image: { logoInsetScalePercent: 70, productImageInsetScalePercent: 100 },
    /* ctaBgCornerRadius：CTA 底色塊統一的圓角（不管原本是方角、圓角還是整顆圓形，
       一律用這個值；框比圓角小的時候瀏覽器會自己等比例收斂，看起來就是圓形） */
    cardStyle: { cardCornerRadius: 15, promoBarTopCornerRadius: 15, ctaBgCornerRadius: 35 }
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

  /* 只有「真的可以載入的圖片網址」才會畫成 <img>。
     試算表的圖片欄位平常填的是檔名（例如 apple.png），還沒上傳對應的圖片素材時，
     那串檔名當然抓不到檔案，瀏覽器就會畫出「破圖」的圖示（還會帶出滾輪縮放的
     提示文字），看起來像壞掉。所以這裡只認 data: / http(s): / blob: 這三種
     真的可以載入的來源，其他（純檔名、空白、還沒填）一律走下面的「尚未上傳圖片」佔位卡。 */
  function isRenderableImageUrl(u) {
    return /^(data:|https?:|blob:)/i.test(String(u == null ? '' : u).trim());
  }

  /* 尚未上傳圖片時的佔位卡：柔和的底色＋淡淡的虛線框＋小圖示，
     空間夠大才連檔名一起顯示，小範圍只放圖示，不會擠成一團。 */
  function imagePlaceholderHtml(layer, rawValue) {
    var w = layer.width || 0, h = layer.height || 0;
    var pending = String(rawValue == null ? '' : rawValue).trim();
    var label = String(layer.fieldLabel || '').replace(/圖片網址|網址/g, '').trim();
    var showText = w >= 96 && h >= 56;
    var showName = pending && w >= 130 && h >= 78;
    var iconSize = Math.max(12, Math.min(26, Math.round(Math.min(w, h) * 0.28)));
    var html = '<div style="width:100%;height:100%;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:3px;box-sizing:border-box;padding:4px;' +
      'border:1px dashed rgba(31,43,41,.18);border-radius:8px;background:rgba(255,255,255,.34);' +
      'color:rgba(31,43,41,.42);font-family:\'PingFang TC\',\'Microsoft JhengHei\',\'Segoe UI\',Arial,sans-serif;' +
      'line-height:1.35;text-align:center;overflow:hidden;">' +
      '<div style="font-size:' + iconSize + 'px;line-height:1;opacity:.5;">🖼</div>';
    if (showText) {
      html += '<div style="font-size:11px;font-weight:600;white-space:nowrap;">' +
        esc(label ? label : '圖片') + '</div>';
    }
    if (showName) {
      html += '<div style="font-size:9.5px;opacity:.72;max-width:100%;overflow:hidden;' +
        'text-overflow:ellipsis;white-space:nowrap;">' + esc(pending) + '</div>';
    }
    return html + '</div>';
  }

  /* ── 全站統一的顏色覆寫（opts.theme）──────────────────────────
     匯入工單頁面左邊有一組「背景顏色／促標底色・字色／圓標底色・字色／CTA底色・字色」，
     改一次就要讓畫布上「所有」版位一起變。與其去每個版位的資料裡一格一格改，
     這裡在渲染階段直接依圖層的角色覆寫顏色──圖層有沒有對應的可編輯欄位都吃得到
     （例如很多版位的 CTA 底色本來就沒有欄位，只寫死在圖層上）。
     角色判斷同時看 layer.id 與 layer.field，並且忽略結尾的編號（bgColor2、badgeBg1…）。 */
  function normColor(c) { return String(c == null ? '' : c).replace(/\s+/g, '').toLowerCase(); }

  /* CTA 旁邊那個小三角形：PS 匯出時是一個用 clip-path 切成三角形的矩形。
     有些版位有 id=ctaTri，有些沒有 id，但 clip-path 的形狀都一樣，用形狀認最準。 */
  var CTA_TRIANGLE_CLIP = normColor('polygon(0 0,100% 50%,0 100%)');
  function isCtaTriangle(layer) {
    if (layer.id === 'ctaTri') return true;
    return layer.type === 'rect' && normColor(layer.clipPath) === CTA_TRIANGLE_CLIP;
  }

  /* 以前這裡有一段「用藍綠色認出促標色帶」的特例：當時以為 MSBN B-4-1、B-4-2
     沒有促標底的 rect，那條色帶是「LOGO 圖片範圍自己的底色」。
     那是看錯了 —— 對照參考圖，那條色帶就是一般的促標底色，上面放的是促標文字，
     跟 LOGO 無關。它被存成 image + field=logoImg，才會在色帶上冒出 LOGO 佔位卡、
     工單也多出一欄「LOGO圖」。已經在 block.json 改成正常的
     rect(id=promoBg*, field=promoColor*)，所以這個以顏色判斷的特例不需要了。
     （留著反而危險：真的有一張 LOGO 圖底色剛好是這個藍綠色時會被誤判成促標底。） */

  function themeRoleOf(layer) {
    /* 少數圖層的欄位 key 是沿用舊命名，但視覺語意不同。
       例如 MSBN B-1-4 的「文案」仍使用 field=promo，若只看欄位名，
       會誤套全域的「促標字色」（常見預設為白色）。
       block.json 可用 themeRole 明確指定它應歸類到哪一種顏色角色。 */
    if (layer && layer.themeRole) return String(layer.themeRole);
    var id = String(layer.id || '').replace(/[0-9]+$/, '');
    var fld = String(layer.field || '').replace(/[0-9]+$/, '').toLowerCase();
    /* 三角形跟著 CTA 的「字色」走，不是底色（不然改底色時三角形會跟底色融成一塊看不見） */
    if (isCtaTriangle(layer)) return 'ctaText';
    if (layer.type === 'text') {
      if (id === 'promo' || fld === 'promo') return 'promoText';
      if (id === 'badgeText' || fld === 'badge') return 'badgeText';
      if (id === 'ctaText' || fld === 'cta') return 'ctaText';
      if (id === 'warn' || fld === 'warn') return 'warnText';
      /* 其他所有文字（品名、內文、文案、簽名小字、LOGO 佔位字…）算一般文字 */
      return 'bodyText';
    }
    if (layer.type === 'image') {
      return null;   /* 圖片沒有顏色角色（促標色帶已經改成 rect，走下面那條） */
    }
    if (layer.type === 'rect' || layer.type === 'circle') {
      if (id === 'promoBg' || id === 'promoBar' || fld === 'promocolor') return 'promoBg';
      if (id === 'badgeBg' || fld === 'badgecolor') return 'badgeBg';
      if (id === 'ctaBg' || fld === 'ctacolor') return 'ctaBg';
    }
    return null;
  }

  /* 這個圖層是不是「CTA 底色塊」（要套統一圓角的那個；三角形不算） */
  function isCtaBgLayer(layer) {
    if (layer.type !== 'rect' && layer.type !== 'circle') return false;
    if (isCtaTriangle(layer)) return false;
    return themeRoleOf(layer) === 'ctaBg';
  }

  /* ── 有字 CTA 的垂直置中 ────────────────────────────────────
     「逛逛去／領券去」這種有文字的 CTA 是三個獨立圖層：
       1. CTA 底色塊
       2. CTA 文字
       3. 右側白色三角形

     PS 匯出的三層座標各自量測，文字還會再經過字型 topExact、行距、padding
     修正，因此換電腦、換字型載入時機或調整版位後，三者可能差 1～3px。
     這裡把「CTA 底色塊」當成唯一基準：文字使用同高的 flex 容器置中，
     三角形則直接以幾何中心對齊。只要版位裡同時存在 CTA 文字與底色塊，
     就自動套用；純圓鈕／只有三角形、沒有文字的 CTA 完全不受影響。 */
  function ctaTextSuffix(layer) {
    var m = /^cta(\d*)$/i.exec(String(layer.field || ''));
    if (m) return m[1] || '';
    m = /^ctaText(\d*)$/i.exec(String(layer.id || ''));
    return m ? (m[1] || '') : null;
  }

  function ctaBgSuffix(layer) {
    var m = /^ctaColor(\d*)$/i.exec(String(layer.field || ''));
    if (m) return m[1] || '';
    m = /^cta(?:Bg|Color)(\d*)$/i.exec(String(layer.id || ''));
    return m ? (m[1] || '') : null;
  }

  function ctaTriangleSuffix(layer) {
    var m = /^ctaTri(\d*)$/i.exec(String(layer.id || ''));
    return m ? (m[1] || '') : null;
  }

  function layerCenterDistance(a, b) {
    var ax = (Number(a.left) || 0) + (Number(a.width) || 0) / 2;
    var ay = (Number(a.top) || 0) + (Number(a.height) || 0) / 2;
    var bx = (Number(b.left) || 0) + (Number(b.width) || 0) / 2;
    var by = (Number(b.top) || 0) + (Number(b.height) || 0) / 2;
    return Math.abs(ax - bx) + Math.abs(ay - by) * 2;
  }

  function nearestUnusedLayer(target, candidates, used) {
    var best = null, bestDistance = Infinity;
    candidates.forEach(function (candidate) {
      if (used.indexOf(candidate) !== -1) return;
      var d = layerCenterDistance(target, candidate);
      if (d < bestDistance) { best = candidate; bestDistance = d; }
    });
    return best;
  }

  function normalizeTextCtaVerticalAlignment(layers) {
    if (!layers || !layers.length) return;

    var texts = layers.filter(function (layer) {
      return layer.type === 'text' && ctaTextSuffix(layer) != null;
    });
    var backgrounds = layers.filter(isCtaBgLayer);
    var triangles = layers.filter(isCtaTriangle);
    if (!texts.length || !backgrounds.length) return;

    var usedBackgrounds = [], usedTriangles = [];
    texts.forEach(function (text) {
      var suffix = ctaTextSuffix(text);
      var bg = null;

      /* 先用欄位編號精準配對：cta2 ↔ ctaColor2。
         舊版資料若沒有編號／id，再退回找距離最近的底色塊。 */
      backgrounds.some(function (candidate) {
        if (usedBackgrounds.indexOf(candidate) !== -1) return false;
        if (ctaBgSuffix(candidate) !== suffix) return false;
        bg = candidate;
        return true;
      });
      if (!bg) bg = nearestUnusedLayer(text, backgrounds, usedBackgrounds);
      if (!bg || bg.top == null || bg.height == null) return;
      usedBackgrounds.push(bg);

      /* renderLayer 看到這組資料後，不再使用 PS 的文字 top/topExact，
         而是把文字放進跟底色塊同高的容器中做真正的垂直置中。 */
      text.ctaVerticalCenter = true;
      text._ctaBoxTop = Number(bg.top);
      text._ctaBoxHeight = Number(bg.height);

      var tri = null;
      /* 有明確編號的 ctaTri2 優先；多組但沒有 id 的舊資料，依位置就近配對。 */
      triangles.some(function (candidate) {
        if (usedTriangles.indexOf(candidate) !== -1) return false;
        var triSuffix = ctaTriangleSuffix(candidate);
        if (triSuffix == null || triSuffix !== suffix) return false;
        /* 多組 CTA 若都沿用同一個未編號 id=ctaTri，不能只靠 id 配對，
           否則第一個文字可能抓到遠處的三角形；改由下面的距離配對。 */
        if (triangles.length > 1 && suffix === '') return false;
        tri = candidate;
        return true;
      });
      if (!tri) tri = nearestUnusedLayer(bg, triangles, usedTriangles);
      if (tri && tri.height != null) {
        tri.top = Number(bg.top) + (Number(bg.height) - Number(tri.height)) / 2;
        usedTriangles.push(tri);
      }
    });
  }
  function themeColorOf(layer, opts) {
    var theme = opts && opts.theme;
    if (!theme) return null;
    var role = themeRoleOf(layer);
    if (!role) return null;
    var v = theme[role];
    return (v && String(v).trim()) ? String(v).trim() : null;
  }

  /* 算出這個圖層在資料物件裡對應的 key
     - 不在 repeat 裡（fieldPrefix為null）→ 直接用 layer.field
     - 在 repeat 裡、globalField:true（三品共用，如CTA顏色）→ 直接用 layer.field
     - 在 repeat 裡、一般欄位 → instance.key + layer.field（例如 p1Name） */
  function resolveFieldKey(layer, fieldPrefix) {
    if (!layer.field) return null;
    if (!fieldPrefix || layer.globalField) return layer.field;
    return fieldPrefix + layer.field;
  }


  /* 圖片依來源曝品的寬高比切換範圍時，把 box 轉成精簡的 data-* 字串。
     實際寬高要等 <img> 載入後才知道，所以 renderer 只輸出規則，
     JS/image-layout.js 再依 naturalWidth / naturalHeight 套用 wide 或 tall。 */
  function aspectBoxAttrValue(box) {
    if (!box) return null;
    var values = [box.left, box.top, box.width, box.height].map(Number);
    for (var i = 0; i < values.length; i++) {
      if (!isFinite(values[i])) return null;
    }
    return values.join(',');
  }

  /* ── 文字行距：解析成「實際會套用到 CSS 的那個值」 ────────────────
     行距的數字有兩種寫法：小數（1.15）＝倍數，大數（40）＝px。
     4 以下當倍數，4 以上當 px──行距不可能只有 4px，倍數也幾乎不會超過 4。
     另外 CONFIG.textLineHeight 會覆寫特定文字（簽名小字等），
     圓標則固定用 CONFIG.badge.lineHeight。
     垂直位置修正跟實際輸出的 line-height 必須用同一份計算，
     不然兩邊會不一致，所以統一走這兩支函式。 */
  function effectiveLineHeight(layer) {
    if (layer.verticalCenter) return CONFIG.badge.lineHeight;
    var lhKey = String(layer.field || layer.id || '').replace(/[0-9]+$/, '');
    var lhOverride = CONFIG.textLineHeight ? CONFIG.textLineHeight[lhKey] : null;
    return lhOverride != null ? lhOverride : layer.lineHeight;
  }
  function lineHeightCss(lh) {
    if (lh == null) return null;
    return (typeof lh === 'number' ? (lh <= 4 ? String(lh) : lh + 'px') : lh);
  }
  /* ShopeeNotoSans 一個字實際佔的高度（含上下伸部的預留空間）：
     hhea ascent 1160 + descent 320 = 1480 / upem 1000 = 1.48 em。
     三個字重（Regular/Medium/Bold）都一樣。
     只要 line-height 小於這個數字，字就會超出行框；用來算要留多少
     上下 padding 才不會被 overflow:hidden 裁掉。 */
  var FONT_CONTENT_EM = 1.48;

  /* 這個圓角是不是「只圓上面兩角」（例如 "15px 15px 0 0"）。
     這種形狀代表它是貼齊卡片頂端的色帶，圓角要跟著卡片一起由設定檔控制；
     四個角都圓的（例如 "10px"）是浮在卡片裡的獨立色塊，要照原本的值。 */
  function isTopOnlyRadius(v) {
    if (typeof v !== 'string') return false;
    var p = v.trim().split(/\s+/);
    if (p.length !== 4) return false;
    var isZero = function (s) { return parseFloat(s) === 0; };
    return !isZero(p[0]) && parseFloat(p[0]) === parseFloat(p[1]) && isZero(p[2]) && isZero(p[3]);
  }

  /* 把圓角的「形狀」保留、只換掉「大小」。
       scaleRadiusPattern("15px 0px 0px 15px", 20) → "20px 0px 0px 20px"
       scaleRadiusPattern("15px", 20)              → "20px"
       scaleRadiusPattern(null, 20)                → "20px"（沒寫就四個角都圓）
     PS 稿上哪幾個角要圓，是設計決定、不能改；圓幾 px 才是 render-config 統一控制的。
     以前這裡直接寫成一個數字，把「只圓左邊兩角」的曝品範圍畫成四角全圓，右邊就會凸出卡片。 */
  function scaleRadiusPattern(v, size) {
    if (v == null || v === '') return size + 'px';
    var parts = String(v).trim().split(/\s+/);
    if (parts.length === 1) return size + 'px';
    return parts.map(function (p) {
      return parseFloat(p) === 0 ? '0px' : size + 'px';
    }).join(' ');
  }

  /* 行距換算成「倍數」，用來算半行距（half-leading）。算不出來就回 1（等於沒有半行距）。 */
  function lineHeightMultiplier(layer) {
    var lh = effectiveLineHeight(layer);
    if (lh == null || !layer.fontSize) return 1;
    var n = parseFloat(lh);
    if (isNaN(n) || n <= 0) return 1;
    return n <= 4 ? n : (n / layer.fontSize);
  }

  function renderLayer(layer, left, top, data, fieldPrefix, opts) {
    /* hidden:true ＝這一層完全不畫（也不會出現在欄位面板）。
       用來關掉 PS 稿上的示意圖層，例如 LOGO 框裡那個「LOGO」佔位字：
       那個框現在是可以直接拖圖片進來的圖片欄位，字疊在上面反而礙眼。
       保留資料不刪，之後想恢復把這個旗標拿掉就好。 */
    if (layer.hidden) return '';

    /* hideIfField：例如 LOGO 佔位文字，一旦 logoImg 欄位有值，這層文字就不畫出來 */
    if (layer.hideIfField) {
      var hideKey = fieldPrefix ? fieldPrefix + layer.hideIfField : layer.hideIfField;
      if (data[hideKey]) return '';
    }

    /* 有字 CTA 已在 schema 註冊時跟底色塊綁成同一個垂直範圍。
       這種文字不再走 PS top/topExact 的字型補償，而是交給 flex 先把「行框」置中。

       但行框置中不等於肉眼看到的字形置中：ShopeeNotoSans 的字型 ascent / descent
       並非上下對稱，中文字的實際筆畫中心會比行框中心低約 2～3px（42px CTA 字級）。
       所以再套用 textVerticalCorrection.ctaText 做光學修正；目前設定為 -3px，
       只把 CTA 文字往上提，底色塊與三角形仍維持幾何中心不動。 */
    var isCenteredCtaText = layer.type === 'text' && layer.ctaVerticalCenter &&
      layer._ctaBoxTop != null && layer._ctaBoxHeight != null;
    if (isCenteredCtaText) {
      var ctaOpticalY = Number(CONFIG.textVerticalCorrection.ctaText);
      if (!isFinite(ctaOpticalY)) ctaOpticalY = 0;
      top = Number(layer._ctaBoxTop) + ctaOpticalY;
    }

    /* PS 文字圖層座標修正（垂直）：
       PS 匯出「只給 left/top、沒有 transform 縮放」的文字圖層時，量測基準點跟瀏覽器
       實際渲染文字的位置差了幾乎正好一個字體大小（用參考圖實測比對出來的規律）。

       但光減一個字體大小還不夠：瀏覽器畫單行文字時，字會被放在「行框」的正中間，
       行框高度＝line-height，所以字實際上又被推移了「半行距」
         halfLeading = (行距倍數 − 1) × 字體大小 ÷ 2
       行距大於 1 就往下推，小於 1 就往上拉。PS 的 top 是文字框頂端、跟行距無關，
       所以這一份位移必須扣掉，否則行距不是 1 的文字就會跑版。

       這件事很重要，因為 block.json 裡同一種元素的行距並不統一，例如：
         促標 line-height 在各版位之間換算出來的半行距從 −5.99 到 +4.00（差 10px）
         品名 0～+4、警語 −5～0、LOGO佔位字 +2～+7、圓標 +6.76～+9
       以前是用 render-config 的一個固定數字硬補，只能補對其中一部分版位，
       其他版位就會歪掉。改成逐圖層計算之後，這個誤差就整批消失了。

       這裡只對「沒有縮放，或縮放接近1（可視為沒縮放）」的文字套用；
       像 msbn3p 那種有明顯縮放 transform 的文字，是另一套已經驗證過的座標系統，不能套用。 */
    if (layer.type === 'text' && layer.fontSize && !layer.verticalCenter && !isCenteredCtaText) {
      if (layer.topExact != null) {
        /* topExact ＝已經算好的「文字內容區上緣」，直接用，不再做任何推算。
           （實際套用在下面「扣掉上下 padding」之後，因為那一段對 topExact 不適用，
             topExact 本身就已經是最終位置了。）
           這個值是由 tools/apply_css_ink_top.py 從新版 PS CSS 產生的：
           新版 CSS 的文字 top 就是「筆畫上緣」（用 200 個圖層對過參考圖，
           誤差中位數 1px、標準差 0.78px），再用字型檔算出該字串最高的筆畫
           離內容區上緣幾個 em，兩者相減就得到精確的內容區上緣。
           所以有 topExact 的圖層不需要下面那串「減一個字級、減半行距、
           再加一個手調補償值」的估算 —— 那串估算會隨字級放大誤差
           （實測 40px 差 0～2.4px、45px 差 2.5px、55px 差 7.1px）。 */
        top = layer.topExact;
      } else {
        var noScale = !layer.transform ||
          (Math.abs(layer.transform[0] - 1) < 0.05 && Math.abs(layer.transform[3] - 1) < 0.05);
        if (noScale) {
          var extra = CONFIG.textVerticalCorrection[layer.id] || 0;
          var halfLeading = (lineHeightMultiplier(layer) - 1) * layer.fontSize / 2;
          top = top - layer.fontSize - halfLeading + extra;
        }
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

    /* ── 文字不要被上下裁掉 ────────────────────────────────────────
       所有文字圖層都有 overflow:hidden（避免字太多時橫向壓到隔壁圖層），
       但這個裁切是四個方向都裁的，而「行框」常常比字本身還矮：
         行框高度 = 行距 × 字級
         字的內容高度 = 1.48 × 字級（ShopeeNotoSans 的 ascent 1160 + descent 320）
       只要行距小於 1.48，字的上下就會超出行框、被裁掉一截。實際上幾乎每一種
       文字都中：警語 40px 字配 0.75 行距（行框只有 30px，上下各被切掉 14.6px）、
       簽名/代言人小字 24px 字被設定檔壓到 1.15 行距（上下各切掉 4px，就是
       「小字下面有一點被裁切」的原因）。

       解法：用上下 padding 把「裁切邊界」往外推到字的外面，同時把 top 往上
       補回同樣的量。字的位置完全不變（padding 只影響裁切範圍，不影響行框中心），
       左右也還是照原本的框裁，所以橫向不會壓到隔壁。 */
    var textPadV = 0;
    if (layer.type === 'text' && layer.fontSize && !isCenteredCtaText) {
      var lineBox = lineHeightMultiplier(layer) * layer.fontSize;
      textPadV = Math.max(0, (FONT_CONTENT_EM * layer.fontSize - lineBox) / 2);
      /* 上面那串估算算出來的是「行框上緣」，要再往上退半個 padding 才是內容區上緣；
         topExact 給的本來就已經是內容區上緣，不用再退。
         （padding 本身兩種情況都要留著，那是為了不讓字被上下裁掉。） */
      if (layer.topExact == null) top -= textPadV;
    }

    var style = ['position:absolute', 'left:' + px(left), 'top:' + px(top)];
    if (textPadV > 0) {
      style.push('padding-top:' + px(textPadV));
      style.push('padding-bottom:' + px(textPadV));
      /* width/height 都是照原本的框給的，加了 padding 不能讓框被撐大，
         所以維持 content-box 的量測方式改成連 padding 一起算在內。 */
      style.push('box-sizing:content-box');
    }
    /* 圖片圖層可依狀態使用不同層級：
       - 尚未上傳時，預覽範圍與 icon 留在內容物件下方
       - 上傳後，實際圖片可移到圓標上方、CTA 下方
       圖片的 z-index 要等下面判斷出是否有可渲染圖片後再決定；
       其他圖層仍直接使用原本的 zIndex。 */
    if (layer.type !== 'image' && layer.zIndex != null) style.push('z-index:' + layer.zIndex);
    if (badgeWidthOverride != null) style.push('width:' + px(badgeWidthOverride));
    else if (layer.width != null) style.push('width:' + px(layer.width));
    if (isCenteredCtaText) style.push('height:' + px(layer._ctaBoxHeight));
    else if (layer.height != null) style.push('height:' + px(layer.height));
    if (layer.boxShadow) style.push('box-shadow:' + layer.boxShadow);
    if (layer.clipPath) style.push('clip-path:' + layer.clipPath);
    else if (layer.clipBottom) {
      /* 人物圖只限制原範圍的下緣：上方與左右仍可拖曳／放大超出框外，
         但超過 bottom 的部分會被裁掉。負 inset 是刻意放寬另外三邊。 */
      style.push('clip-path:inset(-10000px -10000px 0 -10000px)');
    }
    /* ── 圓角 ────────────────────────────────────────────────
       原則：「圓哪幾個角」照 block.json 走（那是 PS 稿的設計，不能改），
             只有「圓幾 px」交給 render-config 統一控制。

       所以這裡不是用 id 判斷，而是看資料裡的圓角形狀：
         只圓上面兩角（例如 "15px 15px 0 0"）＝貼齊卡片頂端的色帶
             → 用 promoBarTopCornerRadius，跟卡片圓角保持一致、接縫看不出來
         四個角都圓（例如 MSBN 促標底的 "10px"）＝浮在卡片裡的獨立色塊
             → 照它自己的值，四個角都要圓
       一開始這裡是寫 id === 'promoBg' / 'promoBar'，結果把 MSBN 那種
       四角都圓的促標底也一律改成「只圓上面兩角」，圓邊就不見了。 */
    var baseId = String(layer.id || '').replace(/[0-9]+$/, '');
    if (isCtaBgLayer(layer)) {
      /* CTA 底色塊：不管原本是方角、圓角還是整顆圓形，一律統一成同一個圓角
         （框比圓角小時瀏覽器會自己等比例收斂，原本是圓形的看起來還是圓形） */
      style.push('border-radius:' + CONFIG.cardStyle.ctaBgCornerRadius + 'px');
    } else if (layer.psRadius && layer.borderRadius) {
      /* psRadius:true ＝「這個圓角就照 PS 稿的數字畫，不要被 render-config 統一覆寫」。
         用在跟卡片圓角刻意不同的地方，例如 MSBN A-2-4 的背景是 R20（卡片統一值是 R15）。 */
      style.push('border-radius:' + (typeof layer.borderRadius === 'number' ? layer.borderRadius + 'px' : layer.borderRadius));
    } else if (baseId === 'bg') {
      /* 卡片背景：圓角大小交給 render-config 統一控制，但「圓哪幾個角」要照 block.json 的形狀走
         （例如 "15px 15px 0 0" 這種只圓上面兩角的背景，不能被畫成四角全圓）。 */
      style.push('border-radius:' + scaleRadiusPattern(layer.borderRadius, CONFIG.cardStyle.cardCornerRadius));
    } else if (isTopOnlyRadius(layer.borderRadius)) {
      var r = CONFIG.cardStyle.promoBarTopCornerRadius;
      style.push('border-radius:' + r + 'px ' + r + 'px 0 0');
    } else if (layer.borderRadius && layer.type !== 'circle') {
      style.push('border-radius:' + (typeof layer.borderRadius === 'number' ? layer.borderRadius + 'px' : layer.borderRadius));
    }

    var content = '';
    /* fixedImage：版型內建且不允許替換的圖（例如 C 系列蝦皮購物 LOGO、
       C-1-4 中間的 3C 家電圖）。這種圖不建立欄位、不接受拖放，也不提供
       滾輪縮放或滑鼠拖曳；永遠只畫 block.json 的 defaultSrc。 */
    var fieldKey = layer.fixedImage ? null : resolveFieldKey(layer, fieldPrefix);

    if (layer.type === 'image') {
      var rawUrl = layer.fixedImage ? null : (fieldKey ? data[fieldKey] : null);
      /* 只留真的載得到的圖片來源；純檔名（還沒上傳對應素材）不算，走下面的佔位卡 */
      var urls = splitImageList(rawUrl).filter(isRenderableImageUrl);
      /* defaultSrc：這個框有一張「內建的圖」，例如 C 系列券上的蝦皮 LOGO。
         沒有人上傳東西時就顯示它（不是顯示空白佔位卡），
         上傳／拖曳圖片進來則會蓋過去，所以既保留原本的設計，又能換成別的品牌 LOGO。 */
      if (!urls.length && layer.defaultSrc) urls = [layer.defaultSrc];
      var url = urls.length ? urls.join(',') : null;

      /* 圖片框的空白預覽與實際圖片可以分開指定 z-index。
         未設定新欄位的舊版位會完整沿用 layer.zIndex，不改變既有結果。 */
      var stateZIndex = url ? layer.imageZIndex : layer.placeholderZIndex;
      if (stateZIndex == null) stateZIndex = layer.zIndex;
      if (stateZIndex != null) style.push('z-index:' + stateZIndex);
      /* LOGO 圖是內縮70%，周圍留白要看得到白色底色，所以底色要一直鋪著（keepBgWithImage:true）；
         商品圖是滿版contain顯示，一旦有圖片，原本的灰色佔位底色就該完全消失，不能透出來。

         bgField：這個圖片框「同時也是一塊可以換色的底色」。
         曝品範圍就是這種：它本來在 block.json 裡是一個有顏色欄位的 rect，
         現在改成圖片框讓人可以把圖拖進去，但那個顏色欄位要留著
         （不然使用者在匯入頁改卡片顏色時，這一塊會變成改不到的死白）。 */
      var bgFieldKey = layer.bgField ? resolveFieldKey({ field: layer.bgField }, fieldPrefix) : null;
      var imgBgColor = themeColorOf(layer, opts)
        || (bgFieldKey && data[bgFieldKey])
        || layer.backgroundColor;
      /* 有 bgField 的圖片框，本身就是設計稿上一塊看得到的色塊（曝品範圍就是這種），
         圖片是疊在它上面，所以放了圖之後底色還是要留著；
         一般商品圖框的底色只是佔位用的灰底，一放圖就該完全消失。 */
      var keepBg = layer.keepBgWithImage || !!layer.bgField;
      if (imgBgColor && (!url || keepBg)) style.push('background-color:' + imgBgColor);
      if (!url && layer.opacity != null) style.push('opacity:' + layer.opacity); /* 半透明佔位色只在「還沒放圖片」時套用 */
      if (!url) {
        /* 尚未上傳圖片：不畫 <img>（不會出現破圖跟滾輪提示文字），改放柔和的佔位卡 */
        style.push('display:flex');
        style.push('align-items:center');
        style.push('justify-content:center');
        style.push('overflow:hidden');
        content = imagePlaceholderHtml(layer, rawUrl);
      }
      /* 有圖片時預設「不裁切」：滾輪放大、拖曳移動都可以超出這個範圍，
         不會被自己的框切掉（框只是預設的擺放位置，不是牢籠）。
         真的超出整個版位邊界時才會被版位／卡片圓角裁掉。

         例外是標了 clipImage:true 的框（LOGO 框、曝品範圍、做圖範圍這類
         「範圍即色塊」的區域）：那些框本身就是設計稿上畫出來的一塊底色，
         圖片溢出去會直接蓋到卡片其他內容，所以一律裁切在框內，
         而且連框的圓角一起吃（上面已經算好 border-radius）。 */
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
        style.push('overflow:' + (layer.clipImage ? 'hidden' : 'visible'));
        var scalePct;
        if (layer.id === 'logoBg') scalePct = CONFIG.image.logoInsetScalePercent;
        else if (layer.id === 'productArea' || layer.id === 'productArea1' || layer.id === 'productArea2' || layer.id === 'bg') scalePct = CONFIG.image.productImageInsetScalePercent;
        else scalePct = layer.imageScale != null ? layer.imageScale : 100;

        if (layer.fixedImage) {
          /* 固定圖直接畫成一般 img，不建立 .bn-imggroup，因此 image-layout.js
             不會替它綁定縮放、拖曳、雙擊復原等互動。 */
          style.push('pointer-events:none');
          content = '<img src="' + esc(urls[0]) + '" onerror="this.style.display=\'none\'" ' +
            'style="width:' + scalePct + '%;height:' + scalePct + '%;object-fit:contain;display:block;pointer-events:none;">';
        } else {
          var imgsHtml = urls.map(function (u) {
            /* onerror：萬一是外部網址載不到，就把這張藏起來，不要留一個破圖圖示在版面上 */
            return '<img src="' + esc(u) + '" class="bn-imggroup-img" onerror="this.style.display=\'none\'" ' +
              'style="height:100%;width:auto;object-fit:contain;display:block;flex-shrink:0;">';
          }).join('');
          content = '<div class="bn-imggroup" data-field-key="' + esc(fieldKey || '') + '" ' +
            'style="width:' + scalePct + '%;height:' + scalePct + '%;display:flex;align-items:center;justify-content:center;overflow:visible;">' +
            imgsHtml + '</div>';
        }
      }
    } else if (layer.type === 'rect') {
      var rectColor = (fieldKey && data[fieldKey]) ? data[fieldKey] : layer.backgroundColor;
      rectColor = themeColorOf(layer, opts) || rectColor; /* 全站統一顏色（促標底／CTA底…）優先 */
      if (rectColor) style.push('background-color:' + rectColor);
      if (layer.backgroundImage) style.push('background-image:' + layer.backgroundImage); /* 漸層等裝飾底 */
      if (layer.border) style.push('border:' + layer.border);
      if (layer.opacity != null) style.push('opacity:' + layer.opacity);
      /* 色塊沒有任何互動，不該擋住滑鼠——底下如果是圖片框，還要能把圖片拖進去 */
      style.push('pointer-events:none');
    } else if (layer.type === 'circle') {
      style.push('pointer-events:none');
      if (!isCtaBgLayer(layer)) style.push('border-radius:50%'); /* CTA 底色塊上面已經套過統一圓角了 */
      var color = (fieldKey && data[fieldKey]) ? data[fieldKey] : layer.backgroundColor;
      color = themeColorOf(layer, opts) || color; /* 全站統一顏色（圓標底／CTA底…）優先 */
      if (color) style.push('background-color:' + color);
      if (layer.border) style.push('border:' + layer.border);
    } else if (layer.type === 'text') {
      if (layer.fontSize != null) style.push('font-size:' + layer.fontSize + 'px');
      if (layer.fontFamily) style.push('font-family:' + JSON.stringify(layer.fontFamily));
      var textColor = themeColorOf(layer, opts) || layer.color; /* 全站統一顏色（促標字色／圓標字色／CTA字色）優先 */
      if (textColor) style.push('color:' + textColor);
      if (layer.fontWeight) style.push('font-weight:' + layer.fontWeight);
      /* PS 有些文字層有自己的 tracking（例如有字 CTA 是 -0.025em，
         42px 時等於 -1.05px）。圖層自己的值優先，沒有才使用全站設定。 */
      var ls = layer.letterSpacing != null ? Number(layer.letterSpacing) : CONFIG.letterSpacing[layer.id];
      if (ls != null && isFinite(Number(ls)) && Number(ls) !== 0) style.push('letter-spacing:' + Number(ls) + 'px');
      /* 代言人／簽名小字這類多行小字，行距用設定檔壓緊（兩行之間靠近一點）。
         用跟上面垂直修正同一支函式解析，兩邊保證一致。 */
      var lhOut = lineHeightCss(effectiveLineHeight(layer));
      if (lhOut != null) style.push('line-height:' + lhOut);
      if (layer.textAlign) style.push('text-align:' + layer.textAlign);
      if (layer.textDecoration) style.push('text-decoration:' + layer.textDecoration);
      /* 有字 CTA 永遠是單行；中文字瀏覽器預設可在任意字之間斷行，
         因此即使只差 1px 也會把第三個字折到下一行。 */
      style.push('white-space:' + (isCenteredCtaText ? 'nowrap' : (layer.whiteSpace || 'nowrap')));
      if (layer.transform) style.push('transform:matrix(' + layer.transform.join(',') + ')');
      /* 一般文字仍裁在自己的框內；CTA 的框是定位參考，文字必須保持單行，
         所以允許極小的字型量測差異溢出，不會因此換行。 */
      style.push('overflow:' + (isCenteredCtaText ? 'visible' : 'hidden'));
      if (isCenteredCtaText) {
        /* 高度與 CTA 底色塊完全相同；align-items:center 讓文字行框中心
           永遠落在底色塊中心，不再依賴不同電腦的字型 top/baseline。 */
        style.push('display:flex');
        style.push('align-items:center');
        style.push('box-sizing:border-box');
      }
      if (layer.verticalCenter) {
        /* 圓標這種可能斷成兩行的文字，用 flex 置中：不管一行還是兩行，
           整塊文字永遠垂直+水平置中在圓標色塊範圍內，而且height已經限制成
           跟圓標一樣大，兩行加起來太高也會被裁掉，不會超出圓標範圍 */
        style.push('display:flex');
        style.push('flex-direction:column');
        style.push('align-items:center');
        style.push('justify-content:center');
      }
      /* 沒有綁欄位的文字＝純裝飾/示意字，不能編輯，也就不該擋住滑鼠。
         這件事很重要：這種字常常整片蓋在圖片框上面（例如 LOGO 框裡的「LOGO」佔位字），
         沒關掉的話，圖片拖到那個位置會落在文字圖層上，圖片框的 drop 事件根本收不到，
         看起來就是「這個框拖不進去」。 */
      if (!fieldKey) style.push('pointer-events:none');
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

    /* 圖片範圍一律標上自己的欄位 key，不管裡面現在有沒有圖。
       裡面那層 .bn-imggroup 只有「已經有圖」時才存在，所以外面沒有標記的話，
       空的圖片框從 DOM 上認不出自己是哪個欄位 —— 匯入頁要做「拖曳圖片進畫布」
       就需要空框也認得出來（拖進去的通常正是還沒有圖的框）。
       同時附上中文欄位名，拖放時的提示文字可以直接用。 */
    if (layer.type === 'image' && fieldKey && !layer.fixedImage) {
      attrs += ' data-img-field="' + esc(fieldKey) + '"' +
        ' data-img-label="' + esc(layer.fieldLabel || '圖片') + '"';

      /* aspectSource + aspectBoxes：同一組曝品／贈品範圍會依曝品原圖方向一起切換。
         預設 block.json 的 left/top/width/height 就是 wide 版；圖片載入後，
         image-layout.js 讀這三個 data-* 屬性，若 naturalWidth < naturalHeight
         就改套 tall 版。source key 也支援 repeat 的欄位前綴。 */
      if (layer.aspectSource && layer.aspectBoxes) {
        var aspectSourceKey = resolveFieldKey({ field: layer.aspectSource }, fieldPrefix);
        var wideBox = aspectBoxAttrValue(layer.aspectBoxes.wide);
        var tallBox = aspectBoxAttrValue(layer.aspectBoxes.tall);
        if (aspectSourceKey && wideBox && tallBox) {
          attrs += ' data-aspect-source-field="' + esc(aspectSourceKey) + '"' +
            ' data-aspect-wide-box="' + wideBox + '"' +
            ' data-aspect-tall-box="' + tallBox + '"';
        }
      }
    }

    return "<div" + attrs + " style='" + style.join(';') + ";'>" + content + '</div>';
  }

  /* ── 沒填的欄位，空間讓給商品圖 ──────────────────────────────
     工單上「簽名小字＋代言人圖」整組都沒填，就代表這張 MSBN 不放代言人那一塊，
     那商品圖就可以把代言人的位置一起用掉（範圍變大、圖能放大一點）；
     「贈品圖」沒填也一樣，商品圖的範圍可以含進贈品圖原本的位置。
     判斷「沒填」＝欄位是空的，或還是原本的預設內容（例如簽名小字還是「簽名小字」）。
     被讓出來的圖層不會畫出來（不然會留下佔位卡或預設文字在那邊）。
     有編號的欄位各自成一組：productImg 配 endorserImg/signImg/signNote/giftImg，
     productImg2 配 endorserImg2/signImg2/signNote2/giftImg2，以此類推。 */
  var ABSORB_GROUPS = [
    { target: 'productImg', donors: ['endorserImg', 'signImg', 'signNote', 'endorserNote'] },
    { target: 'productImg', donors: ['giftImg'] }
  ];

  function isFieldUnfilled(layer, data, key) {
    var v = data ? data[key] : null;
    if (v == null) return true;
    v = String(v).trim();
    if (v === '') return true;
    var def = layer.default != null ? String(layer.default).trim() : '';
    return def !== '' && v === def; /* 還是原本的預設內容＝沒填 */
  }

  function computeAbsorb(schema, data) {
    var res = { skip: [], targets: [], boxes: [] };
    /* 有些特殊版型（MSBN A-2-2）要求曝品與贈品兩個範圍永遠同時存在，
       贈品沒填也不能把空間併給商品圖；由 schema 明確關閉吸收規則。 */
    if (schema.disableImageAbsorb) return res;
    var layers = schema.layers || [];
    ABSORB_GROUPS.forEach(function (group) {
      layers.forEach(function (target) {
        if (target.type !== 'image' || !target.field) return;
        if (target.width == null || target.height == null) return;
        var m = new RegExp('^' + group.target + '(\\d*)$').exec(target.field);
        if (!m) return;
        var suffix = m[1] || '';

        var donors = [];
        var allEmpty = true;
        group.donors.forEach(function (donorName) {
          var key = donorName + suffix;
          layers.forEach(function (l) {
            if (l.field !== key) return;
            donors.push(l);
            if (!isFieldUnfilled(l, data, key)) allEmpty = false;
          });
        });
        if (!donors.length || !allEmpty) return;

        var left = target.left, top = target.top;
        var right = target.left + target.width, bottom = target.top + target.height;
        donors.forEach(function (l) {
          if (res.skip.indexOf(l) === -1) res.skip.push(l);
          if (l.width == null || l.height == null) return; /* 文字類沒有尺寸，只參與判斷、不參與範圍 */
          left = Math.min(left, l.left); top = Math.min(top, l.top);
          right = Math.max(right, l.left + l.width); bottom = Math.max(bottom, l.top + l.height);
        });

        var box = { left: left, top: top, width: right - left, height: bottom - top };
        var i = res.targets.indexOf(target);
        if (i === -1) { res.targets.push(target); res.boxes.push(box); return; }
        /* 兩組都讓出來（代言人＋贈品）→ 再取一次聯集 */
        var b = res.boxes[i];
        var l2 = Math.min(b.left, box.left), t2 = Math.min(b.top, box.top);
        res.boxes[i] = {
          left: l2, top: t2,
          width: Math.max(b.left + b.width, box.left + box.width) - l2,
          height: Math.max(b.top + b.height, box.top + box.height) - t2
        };
      });
    });
    return res;
  }

  /* 淺複製圖層並換掉範圍（不動到原始 schema，schema 是全部實例共用的） */
  function layerWithBox(layer, box) {
    var copy = {};
    Object.keys(layer).forEach(function (k) { copy[k] = layer[k]; });
    copy.left = box.left; copy.top = box.top;
    copy.width = box.width; copy.height = box.height;
    return copy;
  }

  function buildRender(schema) {
    return function (data, opts) {
      /* 外層容器本身是「整個版位的畫布邊界」，不是卡片，不需要圓角，維持直角矩形；
         真正看起來像卡片的圓角，是靠版位自己的「背景」「促標底」這些圖層各自的border-radius做出來的 */
      var overflow = schema.cornerRadius ? 'hidden' : 'visible';
      /* 整個版位的底色（卡片與卡片之間、四周留白露出來的那個顏色）。
         匯入工單頁面可以用 opts.theme.bg 統一換掉（預設會去吃「曝光資源」目前的背景色），
         沒有給就沿用原本的暖色佔位底 #eee2cf。 */
      var canvasBg = (opts && opts.theme && opts.theme.bg && String(opts.theme.bg).trim()) || '#eee2cf';
      var html = '<div class="blk-' + schema.id + '" data-bn-schema-id="' + esc(schema.id) +
        '" style="position:relative;width:' + schema.width + 'px;height:' + schema.height +
        'px;overflow:' + overflow + ';background:' + canvasBg + ';font-family:sans-serif;">';

      /* 沒填的代言人／贈品空間讓給商品圖（範圍變大，被讓出來的圖層不畫） */
      var absorb = computeAbsorb(schema, data);
      (schema.layers || []).forEach(function (layer) {
        if (absorb.skip.indexOf(layer) !== -1) return;
        var ti = absorb.targets.indexOf(layer);
        if (ti !== -1) {
          var grown = layerWithBox(layer, absorb.boxes[ti]);
          html += renderLayer(grown, grown.left, grown.top, data, null, opts);
          return;
        }
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
    function addField(key, label, type, def, maxLength, designText) {
      if (seen[key]) return;
      seen[key] = true;
      var f = { key: key, label: label, type: type, default: def != null ? def : '' };
      if (maxLength != null) f.maxLength = maxLength;
      /* designText＝PS 設計稿上原本寫的示意字（「品名一排最多8字」「逛逛去」…）。
         維修頁拿它當預覽文字，一眼就看得出這一欄是什麼、限幾個字。
         跟 default 分開放，所以匯入工單頁「沒填欄位時顯示什麼」完全不受影響。 */
      if (designText != null) f.designText = designText;
      fields.push(f);
    }

    (schema.layers || []).forEach(function (layer) {
      if (layer.hidden) return; /* 不畫出來的圖層，欄位面板也不要列 */
      if (layer.fixedImage) return; /* 版型內建固定圖不提供替換／縮放欄位 */
      if (layer.field) addField(layer.field, layer.fieldLabel || layer.field, fieldType(layer), layer.default, layer.maxLength, layer.designText);
      /* 圖片框如果同時兼任一塊底色（曝品範圍），那個顏色欄位也要列出來可以改 */
      if (layer.bgField) addField(layer.bgField, layer.bgFieldLabel || '底色', 'color', layer.backgroundColor);
    });

    (schema.repeats || []).forEach(function (repeat) {
      repeat.instances.forEach(function (inst) {
        (repeat.layers || []).forEach(function (layer) {
          if (!layer.field) return;
          if (layer.globalField) {
            addField(layer.field, layer.fieldLabel || layer.field, fieldType(layer), layer.default, layer.maxLength, layer.designText);
          } else {
            addField(inst.key + layer.field, (inst.label || inst.key) + '・' + (layer.fieldLabel || layer.field),
              fieldType(layer), layer.default, layer.maxLength, layer.designText);
          }
        });
      });
    });

    return fields;
  }

  /* ── 圖層前後順序（z-index）的統一規則 ─────────────────────────
     PS 匯出的順序有些不是我們要的，這裡在「積木註冊時」統一調整一次
     （只做一次，不用每次渲染都算）：
       1. CTA 那一組（底色塊、三角形、文字）永遠壓在所有物件的最上面
       2. 簽名檔圖片要蓋在代言人圖片上面
     調整時保留各自原本的相對順序，只是整組往上搬。 */
  var CTA_Z_BASE = 100000;
  function normalizeSchemaZOrder(schema) {
    /* 先把所有「有字 CTA」的文字與三角形鎖到同一條水平中心線。
       一般 layers 與 repeats 的樣板都處理，之後新增版位也會自動套用。 */
    normalizeTextCtaVerticalAlignment(schema.layers || []);
    (schema.repeats || []).forEach(function (repeat) {
      normalizeTextCtaVerticalAlignment(repeat.layers || []);
    });

    var layers = schema.layers || [];
    layers.forEach(function (l) {
      var role = themeRoleOf(l);
      var isCta = isCtaTriangle(l) || isCtaBgLayer(l) ||
        (l.type === 'text' && role === 'ctaText');
      if (isCta) l.zIndex = CTA_Z_BASE + (l.zIndex || 0);
    });
    /* 簽名檔壓在代言人上面（有編號的各自成對：signImg2 對 endorserImg2） */
    layers.forEach(function (sign) {
      if (sign.type !== 'image' || !/^signImg\d*$/.test(String(sign.field || ''))) return;
      var suffix = String(sign.field).replace('signImg', '');
      layers.forEach(function (endorser) {
        if (endorser.field !== ('endorserImg' + suffix)) return;
        if ((sign.zIndex || 0) <= (endorser.zIndex || 0)) sign.zIndex = (endorser.zIndex || 0) + 1;
      });
    });
  }

  /* 抓出這個版位目前「實際用的顏色」，給左側『統一顏色』區把色號吸進來用。
     回傳例如 { promoBg:'rgb(79, 159, 162)', ctaText:'rgb(254, 254, 254)' , … } */
  function roleColorsOf(schema, data) {
    var out = {}, pri = {};
    var layers = (schema.layers || []).concat(
      (schema.repeats || []).reduce(function (a, r) { return a.concat(r.layers || []); }, [])
    );
    /* 「一般文字」可能有好幾種（品名、內文、簽名小字、LOGO 佔位字…），
       吸色號時優先拿品名，最不要拿 LOGO 佔位字（那是半透明的灰，不代表文字顏色） */
    function priorityOf(layer, role) {
      if (role !== 'bodyText') return 1;
      var k = String(layer.field || layer.id || '').replace(/[0-9]+$/, '');
      if (k === 'name') return 3;
      if (k === 'logoText') return 0;
      return 2;
    }
    layers.forEach(function (l) {
      var role = themeRoleOf(l);
      if (!role) return;
      var p = priorityOf(l, role);
      if (out[role] && pri[role] >= p) return;
      var color = null;
      if (l.type === 'text') color = l.color;
      else if (l.field && data && data[l.field]) color = data[l.field];
      else color = l.backgroundColor;
      if (color) { out[role] = color; pri[role] = p; }
    });
    return out;
  }

  function registerFromSchema(schema) {
    if (!schema || !schema.id) { console.error('[BNSchemaRenderer] schema 缺少 id'); return; }
    normalizeSchemaZOrder(schema);
    global.BNCore.registerBlock({
      id: schema.id,
      name: schema.name || schema.id,
      width: schema.width,
      height: schema.height,
      fields: buildFields(schema),
      schema: schema, /* 留著原始圖層資料，外面要吸色號、判斷欄位角色時用得到 */
      style: '', /* 全部用 inline style，不需要額外注入 <style> */
      render: buildRender(schema)
    });
  }

  global.BNSchemaRenderer = {
    registerFromSchema: registerFromSchema,
    setConfig: setConfig,
    themeRoleOf: themeRoleOf,
    roleColorsOf: roleColorsOf
  };
})(window);
