/* ============================================================
 * BN Shadow Plugin — 商品貼地陰影（引擎：js/shadow-plugin.js，來自 shadow-module）
 * ------------------------------------------------------------
 * 做法：陰影不是在版位 iframe 裡即時畫，而是「烘進商品圖」——
 *   p.baseSrc = 去背/裁切後的商品原圖（沒有陰影）
 *   p.src     = 原圖 + 陰影 合成後的 PNG（版位、下載、存檔全部直接用這張）
 *   p.meta.groundShadow = {enabled, angle, offsetX, offsetY, scaleX, scaleY, color}
 *   p.meta.rotate       = 旋轉角度（度，-180～180）；管線固定是 baseSrc → 旋轉 → 影子 → p.src
 * 這樣 layout-runtime / 下載 / 狀態存檔完全不用改，陰影自然跟著商品走。
 *
 * 對外：
 *   window._bnGroundShadow.DEFAULT                 預設參數
 *   window._bnGroundShadow.compose(baseSrc, cfg)   → Promise<{src, ratio, w, h}>
 *   window._bnGroundShadow.applyToProduct(p, cfg)  → Promise（更新 p.src/p.ratio/p.meta）
 *   window._bnGroundShadow.openEditor(p, onApplied) 開啟「編輯影子」視窗
 * ============================================================ */
(function(){
  'use strict';
  if(window._bnGroundShadow) return;

  var ENGINE_SRC = 'js/shadow-plugin.js';
  var DEFAULT = { enabled:true, angle:'left', offsetX:0, offsetY:0, scaleX:1, scaleY:1, color:'#5a5a5a' };
  var ANGLES = [{v:'left',label:'左'},{v:'top',label:'中'},{v:'right',label:'右'}];

  var css = [
    '#bn-shadow-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:100060;align-items:center;justify-content:center;backdrop-filter:blur(4px)}',
    '#bn-shadow-modal.show{display:flex}',
    '.bn-shadow-box{background:#13161f;border:1px solid #252b3d;border-radius:14px;width:min(860px,94vw);max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.6);overflow:hidden;color:#e6e8ef;font-size:12px}',
    '.bn-shadow-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #252b3d}',
    '.bn-shadow-head h3{margin:0;font-size:14px;font-weight:700}',
    '.bn-shadow-close{background:transparent;border:0;color:#8b949e;font-size:20px;cursor:pointer;line-height:1}',
    '.bn-shadow-body{display:flex;gap:16px;padding:14px 16px;overflow:auto;min-height:0}',
    '.bn-shadow-preview{flex:1;min-width:0;display:flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid #252b3d;background:#e8e4df;background-image:linear-gradient(45deg,rgba(0,0,0,.04) 25%,transparent 25%,transparent 75%,rgba(0,0,0,.04) 75%),linear-gradient(45deg,rgba(0,0,0,.04) 25%,transparent 25%,transparent 75%,rgba(0,0,0,.04) 75%);background-size:20px 20px;background-position:0 0,10px 10px;min-height:320px;position:relative}',
    '.bn-shadow-preview canvas{max-width:100%;max-height:60vh;display:block}',
    '.bn-shadow-preview .bn-shadow-busy{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.25);color:#fff;font-size:12px}',
    '.bn-shadow-preview.busy .bn-shadow-busy{display:flex}',
    '.bn-shadow-ctrl{width:250px;flex-shrink:0;display:flex;flex-direction:column;gap:10px}',
    '.bn-shadow-ctrl label{display:flex;justify-content:space-between;align-items:center;color:#8b949e;font-size:11px;margin-bottom:3px}',
    '.bn-shadow-ctrl label b{color:#e6e8ef;font-weight:600}',
    '.bn-shadow-ctrl input[type=range]{width:100%}',
    '.bn-shadow-seg{display:flex;gap:4px}',
    '.bn-shadow-seg button{flex:1;padding:6px 0;background:#1c2333;border:1px solid #30363d;border-radius:6px;color:#8b949e;cursor:pointer;font-size:12px}',
    '.bn-shadow-seg button.active{background:#1f6feb;border-color:#1f6feb;color:#fff}',
    '.bn-shadow-toggle{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#e6e8ef;cursor:pointer}',
    '.bn-shadow-row{display:flex;align-items:center;gap:8px}',
    '.bn-shadow-row input[type=color]{width:36px;height:26px;padding:0;border:1px solid #30363d;border-radius:5px;background:transparent;cursor:pointer}',
    '.bn-shadow-hint{font-size:10px;color:#6e7681;line-height:1.5}',
    '.bn-shadow-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid #252b3d}',
    '.bn-shadow-foot .r{display:flex;gap:8px}',
    '.bn-shadow-btn{padding:7px 14px;border-radius:7px;border:1px solid #30363d;background:#1c2333;color:#e6e8ef;cursor:pointer;font-size:12px}',
    '.bn-shadow-btn.primary{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:600}',
    '.bn-shadow-btn.ghost{background:transparent;color:#8b949e}',
    '.bn-shadow-btn:disabled{opacity:.5;cursor:default}'
  ].join('\n');
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ── 引擎載入 ── */
  var _enginePromise = null;
  function ensureEngine(){
    if(window.ShadowPlugin) return Promise.resolve();
    if(_enginePromise) return _enginePromise;
    _enginePromise = new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = ENGINE_SRC + '?t=' + Date.now();
      s.onload = function(){ window.ShadowPlugin ? resolve() : reject(new Error('ShadowPlugin missing')); };
      s.onerror = function(){ _enginePromise = null; reject(new Error('load failed: ' + ENGINE_SRC)); };
      document.head.appendChild(s);
    });
    return _enginePromise;
  }

  function loadImg(src){
    return new Promise(function(res, rej){
      var i = new Image();
      i.onload = function(){ res(i); };
      i.onerror = function(){ rej(new Error('image load failed')); };
      i.src = src;
    });
  }
  function hexToRgbStr(hex){
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex||'').trim());
    if(!m) return '90,90,90';
    var n = parseInt(m[1], 16);
    return ((n>>16)&255) + ',' + ((n>>8)&255) + ',' + (n&255);
  }
  function normCfg(cfg){
    var c = {};
    Object.keys(DEFAULT).forEach(function(k){ c[k] = (cfg && cfg[k] !== undefined && cfg[k] !== null) ? cfg[k] : DEFAULT[k]; });
    c.enabled = !!c.enabled;
    if(['left','top','right'].indexOf(c.angle) === -1) c.angle = DEFAULT.angle;
    c.offsetX = clamp(Number(c.offsetX)||0, -0.5, 0.5);
    c.offsetY = clamp(Number(c.offsetY)||0, -0.5, 0.5);
    c.scaleX = clamp(Number(c.scaleX)||1, 0.3, 2.5);
    c.scaleY = clamp(Number(c.scaleY)||1, 0.3, 2.5);
    return c;
  }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  /* 把合成後透明邊裁掉（alpha>2 才算有內容），回傳裁切後 canvas */
  function trimCanvas(c, keepRect){
    var w = c.width, h = c.height;
    var d;
    try{ d = c.getContext('2d').getImageData(0,0,w,h).data; }catch(_){ return c; }
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for(var y=0;y<h;y++){
      for(var x=0;x<w;x++){
        if(d[(y*w+x)*4+3] > 2){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
      }
    }
    if(x1 < 0) return c;
    if(keepRect){
      x0 = Math.min(x0, keepRect.x); y0 = Math.min(y0, keepRect.y);
      x1 = Math.max(x1, keepRect.x + keepRect.w - 1); y1 = Math.max(y1, keepRect.y + keepRect.h - 1);
    }
    var tw = x1-x0+1, th = y1-y0+1;
    var o = document.createElement('canvas'); o.width = tw; o.height = th;
    o.getContext('2d').drawImage(c, x0, y0, tw, th, 0, 0, tw, th);
    o._offX = x0; o._offY = y0;
    return o;
  }

  var _seq = 0;
  /* 合成：商品原圖 + 貼地陰影 → canvas（enabled=false 時直接回原圖） */
  function composeCanvas(img, cfg){
    cfg = normCfg(cfg);
    var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    var out = document.createElement('canvas');
    if(!cfg.enabled || !W || !H){
      out.width = W; out.height = H;
      out.getContext('2d').drawImage(img, 0, 0);
      out._productRect = {x:0,y:0,w:W,h:H};
      return Promise.resolve(out);
    }
    return ensureEngine().then(function(){
      var SP = window.ShadowPlugin;
      var id = 'bnshadow_' + (++_seq);
      return SP.registerProduct(id, img, 'product').then(function(p){
        var trim = (p && p.trim) || {top:0,bottom:0,left:0,right:0};
        var angleDeg = SP.ANGLE_PRESETS[cfg.angle] || 0;
        var shear = Math.abs(Math.tan(angleDeg*Math.PI/180*0.55));
        var padX = Math.ceil(shear*H*cfg.scaleY + 0.08*H + Math.abs(cfg.offsetX)*W + 40);
        var padTop = Math.ceil(0.5*H*cfg.scaleY + Math.abs(cfg.offsetY)*H + 20);
        var padBottom = Math.ceil(0.08*H + Math.abs(cfg.offsetY)*H + 24);
        out.width = W + padX*2; out.height = padTop + H + padBottom;
        var ctx = out.getContext('2d');

        var groundX = padX + W/2;
        var groundY = padTop + H - trim.bottom*H; /* 去背內容真正碰地的那條線 */
        SP.setShadowColorRGB(hexToRgbStr(cfg.color));
        SP.setAngle(cfg.angle);
        SP.renderScene(ctx, [{
          id:id,
          x: groundX + cfg.offsetX*W,
          y: groundY + cfg.offsetY*H,
          w: W, h: H,
          groundAnchorX: groundX, groundAnchorY: groundY,
          shadowScaleX: cfg.scaleX, shadowScaleY: cfg.scaleY
        }], true);
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(img, padX, padTop, W, H);
        SP.removeProduct(id);

        var trimmed = trimCanvas(out, {x:padX, y:padTop, w:W, h:H});
        trimmed._productRect = {x: padX - (trimmed._offX||0), y: padTop - (trimmed._offY||0), w:W, h:H};
        return trimmed;
      });
    });
  }

  /* 先裁掉商品原圖的透明邊，讓商品範圍（productRect）在任何角度都貼住商品本身 */
  function trimDataUrl(src){
    return loadImg(src).then(function(img){
      var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
      if(!W || !H) return src;
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').drawImage(img, 0, 0);
      return trimCanvas(c).toDataURL('image/png');
    });
  }

  function compose(baseSrc, cfg){
    return trimDataUrl(baseSrc).then(loadImg).then(function(img){
      return composeCanvas(img, cfg).then(function(c){
        return { src: c.toDataURL('image/png'), ratio: c.width/Math.max(1,c.height), w:c.width, h:c.height, productRect:c._productRect };
      });
    });
  }

  /* 旋轉：把「沒有影子的原圖」轉成指定角度，輸出外接矩形大小的透明 PNG。
     角度永遠從 baseSrc 重算（不是在已經轉過的圖上再轉），所以反覆調整不會累積模糊。
     影子一定要在旋轉之後才合成，貼地陰影才會貼在旋轉後的新底邊，空間感才正確。 */
  function normRotate(deg){
    deg = Number(deg) || 0;
    if(!isFinite(deg)) return 0;
    deg = ((deg % 360) + 360) % 360;
    if(deg > 180) deg -= 360;
    return Math.round(deg * 10) / 10;
  }
  function rotateImage(src, deg){
    deg = normRotate(deg);
    if(!deg) return Promise.resolve(src);
    return loadImg(src).then(function(img){
      var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
      if(!W || !H) return src;
      var rad = deg * Math.PI / 180;
      var cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
      var bw = Math.max(1, Math.ceil(W * cos + H * sin));
      var bh = Math.max(1, Math.ceil(W * sin + H * cos));
      var c = document.createElement('canvas');
      c.width = bw; c.height = bh;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(bw / 2, bh / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -W / 2, -H / 2, W, H);
      /* 外接矩形四角是透明的，裁到實際商品內容，商品範圍（productRect）才會貼住商品本身 */
      var tc = trimCanvas(c);
      return tc.toDataURL('image/png');
    });
  }

  /* 套到 _bnProducts 的一筆商品：以 p.baseSrc（沒有陰影的原圖）為基底，
     先依 p.meta.rotate 旋轉，再重新合成影子。 */
  function applyToProduct(p, cfg){
    if(!p) return Promise.resolve(p);
    cfg = normCfg(cfg);
    var base = p.baseSrc || (p.meta && p.meta.baseSrc) || p.src;
    var rot = normRotate(p.meta && p.meta.rotate);
    return rotateImage(base, rot).then(function(rotated){
      return compose(rotated, cfg);
    }).then(function(r){
      p.baseSrc = base;
      p.meta = p.meta || {};
      p.meta.baseSrc = base;
      p.meta.groundShadow = cfg;
      p.meta.rotate = rot;
      p.meta.productRect = r.productRect; /* 商品本身的範圍（不含影子）*/
      p.src = r.src;
      p.ratio = r.ratio; /* 包含影子的比例 */
      return p;
    });
  }

  /* ── 編輯視窗 ── */
  var modal = null, ui = {};
  function buildModal(){
    if(modal) return modal;
    modal = document.createElement('div');
    modal.id = 'bn-shadow-modal';
    modal.innerHTML = [
      '<div class="bn-shadow-box">',
      '  <div class="bn-shadow-head"><h3>編輯影子</h3><button class="bn-shadow-close" data-act="cancel" title="取消">×</button></div>',
      '  <div class="bn-shadow-body">',
      '    <div class="bn-shadow-preview" data-role="preview"><canvas data-role="canvas"></canvas><div class="bn-shadow-busy">計算陰影中…</div></div>',
      '    <div class="bn-shadow-ctrl">',
      '      <label class="bn-shadow-toggle"><input type="checkbox" data-role="enabled"> 開啟商品影子</label>',
      '      <div><label>光源角度</label><div class="bn-shadow-seg" data-role="angle"></div></div>',
      '      <div><label>陰影左右位移 <b data-role="offsetXVal"></b></label><input type="range" data-role="offsetX" min="-30" max="30" step="1"></div>',
      '      <div><label>陰影上下位移 <b data-role="offsetYVal"></b></label><input type="range" data-role="offsetY" min="-30" max="30" step="1"></div>',
      '      <div><label>陰影寬度 <b data-role="scaleXVal"></b></label><input type="range" data-role="scaleX" min="50" max="200" step="5"></div>',
      '      <div><label>陰影長度 <b data-role="scaleYVal"></b></label><input type="range" data-role="scaleY" min="50" max="200" step="5"></div>',
      '      <div><label>陰影顏色</label><div class="bn-shadow-row"><input type="color" data-role="color"><span data-role="colorVal"></span></div></div>',
      '      <div><label>預覽背景色（僅預覽用）</label><div class="bn-shadow-row"><input type="color" data-role="bg" value="#e8e4df"></div></div>',
      '      <div class="bn-shadow-hint">「中」角度只保留貼地的接地陰影，左右/上下位移與寬度長度對「中」無效。陰影會合成進商品圖，版位上與下載結果一致。</div>',
      '    </div>',
      '  </div>',
      '  <div class="bn-shadow-foot">',
      '    <button class="bn-shadow-btn ghost" data-act="reset">重設為預設</button>',
      '    <div class="r"><button class="bn-shadow-btn" data-act="cancel">取消</button><button class="bn-shadow-btn primary" data-act="apply">套用</button></div>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(modal);
    ['preview','canvas','enabled','angle','offsetX','offsetY','scaleX','scaleY','color','bg','offsetXVal','offsetYVal','scaleXVal','scaleYVal','colorVal'].forEach(function(k){
      ui[k] = modal.querySelector('[data-role="'+k+'"]');
    });
    ANGLES.forEach(function(a){
      var b = document.createElement('button'); b.type = 'button'; b.textContent = a.label; b.dataset.angle = a.v;
      b.addEventListener('click', function(){ state.cfg.angle = a.v; syncUI(); schedulePreview(); });
      ui.angle.appendChild(b);
    });
    ui.enabled.addEventListener('change', function(){ state.cfg.enabled = ui.enabled.checked; syncUI(); schedulePreview(); });
    ['offsetX','offsetY'].forEach(function(k){ ui[k].addEventListener('input', function(){ state.cfg[k] = Number(ui[k].value)/100; syncUI(); schedulePreview(); }); });
    ['scaleX','scaleY'].forEach(function(k){ ui[k].addEventListener('input', function(){ state.cfg[k] = Number(ui[k].value)/100; syncUI(); schedulePreview(); }); });
    ui.color.addEventListener('input', function(){ state.cfg.color = ui.color.value; syncUI(); schedulePreview(); });
    ui.bg.addEventListener('input', function(){ ui.preview.style.backgroundColor = ui.bg.value; });
    modal.addEventListener('click', function(e){
      var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if(e.target === modal){ close(); return; }
      if(act === 'cancel') close();
      else if(act === 'reset'){ state.cfg = normCfg(DEFAULT); syncUI(); schedulePreview(); }
      else if(act === 'apply') apply();
    });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && modal.classList.contains('show')) close(); });
    return modal;
  }

  var state = { cfg: normCfg(DEFAULT), img:null, product:null, onApplied:null, previewTimer:null, previewSeq:0 };

  function syncUI(){
    var c = state.cfg;
    ui.enabled.checked = c.enabled;
    Array.prototype.forEach.call(ui.angle.children, function(b){ b.classList.toggle('active', b.dataset.angle === c.angle); });
    ui.offsetX.value = Math.round(c.offsetX*100); ui.offsetXVal.textContent = Math.round(c.offsetX*100) + '%';
    ui.offsetY.value = Math.round(c.offsetY*100); ui.offsetYVal.textContent = Math.round(c.offsetY*100) + '%';
    ui.scaleX.value = Math.round(c.scaleX*100); ui.scaleXVal.textContent = Math.round(c.scaleX*100) + '%';
    ui.scaleY.value = Math.round(c.scaleY*100); ui.scaleYVal.textContent = Math.round(c.scaleY*100) + '%';
    ui.color.value = c.color; ui.colorVal.textContent = c.color;
    var dis = !c.enabled;
    [ui.offsetX, ui.offsetY, ui.scaleX, ui.scaleY, ui.color].forEach(function(el){ el.disabled = dis; });
    Array.prototype.forEach.call(ui.angle.children, function(b){ b.disabled = dis; });
  }

  function schedulePreview(){
    clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(renderPreview, 60);
  }
  function renderPreview(){
    if(!state.img) return;
    var seq = ++state.previewSeq;
    ui.preview.classList.add('busy');
    /* 預覽用縮小版（最長邊 520px）算，拖滑桿才不會卡；套用時才用原尺寸合成 */
    var img = state.previewImg || state.img;
    composeCanvas(img, state.cfg).then(function(c){
      if(seq !== state.previewSeq) return;
      ui.canvas.width = c.width; ui.canvas.height = c.height;
      var cx = ui.canvas.getContext('2d');
      cx.clearRect(0,0,c.width,c.height);
      cx.drawImage(c, 0, 0);
      ui.preview.classList.remove('busy');
    }).catch(function(err){
      ui.preview.classList.remove('busy');
      console.warn('[bn-shadow] preview failed', err);
    });
  }
  function makePreviewImg(img){
    var max = 520, W = img.naturalWidth, H = img.naturalHeight;
    var s = Math.min(1, max/Math.max(W,H));
    if(s >= 1) return Promise.resolve(img);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W*s)); c.height = Math.max(1, Math.round(H*s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return loadImg(c.toDataURL('image/png'));
  }

  function openEditor(p, onApplied){
    if(!p) return;
    buildModal();
    state.product = p;
    state.onApplied = onApplied || null;
    state.cfg = normCfg((p.meta && p.meta.groundShadow) || {});
    state.img = null; state.previewImg = null;
    ui.preview.style.backgroundColor = ui.bg.value;
    ui.canvas.width = 1; ui.canvas.height = 1;
    syncUI();
    modal.classList.add('show');
    var base = p.baseSrc || (p.meta && p.meta.baseSrc) || p.src;
    ensureEngine().then(function(){ return loadImg(base); }).then(function(img){
      if(state.product !== p) return;
      state.img = img;
      return makePreviewImg(img).then(function(pi){ state.previewImg = pi; renderPreview(); });
    }).catch(function(err){
      console.warn('[bn-shadow] open failed', err);
      alert('影子編輯器載入失敗：' + (err && err.message || err));
      close();
    });
  }
  function close(){
    if(!modal) return;
    modal.classList.remove('show');
    state.product = null; state.img = null; state.previewImg = null; state.onApplied = null;
    clearTimeout(state.previewTimer);
  }
  function apply(){
    var p = state.product, cb = state.onApplied, cfg = normCfg(state.cfg);
    if(!p) { close(); return; }
    var btn = modal.querySelector('[data-act="apply"]');
    btn.disabled = true; btn.textContent = '合成中…';
    applyToProduct(p, cfg).then(function(){
      btn.disabled = false; btn.textContent = '套用';
      close();
      if(typeof cb === 'function') cb(p);
    }).catch(function(err){
      btn.disabled = false; btn.textContent = '套用';
      console.warn('[bn-shadow] apply failed', err);
      alert('影子套用失敗：' + (err && err.message || err));
    });
  }

  window._bnGroundShadow = {
    DEFAULT: DEFAULT,
    normalize: normCfg,
    ensureEngine: ensureEngine,
    compose: compose,
    rotateImage: rotateImage,
    normalizeRotate: normRotate,
    applyToProduct: applyToProduct,
    openEditor: openEditor,
    close: close
  };
})();
