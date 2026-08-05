
/*!
 * HBN Product Editor Plugin
 * External plugin replacement for HBN product image editor.
 * Requires img/bg.png in the html/img/ folder.
 */
(function(){
  if (window.__HBN_PRODUCT_EDITOR_PLUGIN__) return;
  window.__HBN_PRODUCT_EDITOR_PLUGIN__ = true;

  const oldOpenEraseEditor = window.openEraseEditor;

  const css = `
  .hbn-plugin-modal{position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:100050;display:none;align-items:center;justify-content:center;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
  .hbn-plugin-modal.open{display:flex;}
  .hbn-plugin-panel{width:min(96vw,1120px);height:min(94vh,860px);background:#111827;color:#e5e7eb;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.45);display:grid;grid-template-rows:auto 1fr auto;overflow:hidden;border:1px solid rgba(255,255,255,.12);}
  .hbn-plugin-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px;border-bottom:1px solid rgba(255,255,255,.12);background:#0f172a;}
  .hbn-plugin-toolbar button{appearance:none;border:1px solid rgba(255,255,255,.16);background:#1f2937;color:#e5e7eb;padding:8px 11px;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;}
  .hbn-plugin-toolbar button.active{border-color:#38bdf8;background:rgba(56,189,248,.18);}
  .hbn-plugin-toolbar button.danger{border-color:rgba(251,113,133,.6);color:#fecdd3;}
  .hbn-plugin-toolbar label{display:inline-flex;align-items:center;gap:6px;color:#94a3b8;font-size:13px;}
  .hbn-plugin-toolbar input[type=range]{width:110px;}
  .hbn-plugin-control-group{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;}
  .hbn-plugin-tool-separator{width:1px;height:28px;background:rgba(255,255,255,.16);margin:0 2px;}
  .hbn-plugin-history{margin-left:auto;display:inline-flex;align-items:center;gap:6px;padding-left:12px;border-left:1px solid rgba(255,255,255,.18);}
  .hbn-plugin-history button{background:#fff !important;color:#111827 !important;border-color:#fff !important;box-shadow:0 1px 4px rgba(0,0,0,.18);}
  .hbn-plugin-history button.active{background:#fff !important;color:#111827 !important;border-color:#fff !important;}
  .hbn-plugin-history button:disabled{background:#fff !important;color:#fff !important;border-color:rgba(255,255,255,.5) !important;opacity:.35;}
  .hbn-plugin-chip{width:18px;height:18px;border-radius:99px;border:1px solid rgba(255,255,255,.2);background:transparent;}
  .hbn-plugin-workspace{position:relative;min-height:0;margin:12px;border-radius:16px;border:1px solid #d1d5db;overflow:hidden;display:flex;align-items:center;justify-content:center;background-color:#fff;background-image:linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0;}
  .hbn-plugin-workspace canvas{position:relative;z-index:2;display:block;max-width:100%;max-height:100%;width:auto;height:auto;touch-action:none;border-radius:10px;}
  .hbn-plugin-status{display:flex;justify-content:space-between;gap:10px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.12);color:#94a3b8;font-size:13px;}
  .hbn-plugin-crop{position:absolute;border:2px solid #2563eb;background:rgba(37,99,235,.08);display:none;z-index:6;}
  .hbn-plugin-edge{position:absolute;background:rgba(37,99,235,.95);pointer-events:auto;}
  .hbn-plugin-edge.top,.hbn-plugin-edge.bottom{left:-8px;right:-8px;height:12px;cursor:ns-resize;}
  .hbn-plugin-edge.left,.hbn-plugin-edge.right{top:-8px;bottom:-8px;width:12px;cursor:ew-resize;}
  .hbn-plugin-edge.top{top:-7px}.hbn-plugin-edge.bottom{bottom:-7px}.hbn-plugin-edge.left{left:-7px}.hbn-plugin-edge.right{right:-7px}
  .hbn-plugin-edge:after{content:"";position:absolute;background:#fff;border-radius:99px;box-shadow:0 1px 4px rgba(0,0,0,.25);}
  .hbn-plugin-edge.top:after,.hbn-plugin-edge.bottom:after{width:42px;height:4px;left:50%;top:50%;transform:translate(-50%,-50%);}
  .hbn-plugin-edge.left:after,.hbn-plugin-edge.right:after{width:4px;height:42px;left:50%;top:50%;transform:translate(-50%,-50%);}
  .hbn-plugin-brush{position:absolute;border:2px solid rgba(255,255,255,.95);border-radius:99px;pointer-events:none;display:none;transform:translate(-50%,-50%);box-shadow:0 0 0 1px rgba(15,23,42,.8),0 0 14px rgba(56,189,248,.45);background:rgba(56,189,248,.08);z-index:8;}
  .hbn-plugin-shadow{position:absolute;display:none;pointer-events:none;z-index:1;touch-action:none;}
  .hbn-plugin-shadow.active{display:block;pointer-events:auto;outline:2px solid rgba(37,99,235,.95);outline-offset:2px;z-index:9;}
  .hbn-plugin-shadow img{width:100%;height:100%;display:block;user-select:none;pointer-events:none;}
  .hbn-plugin-handle{position:absolute;width:14px;height:14px;border:2px solid #2563eb;background:#fff;border-radius:99px;box-shadow:0 1px 4px rgba(0,0,0,.28);display:none;pointer-events:auto;z-index:10;}
  .hbn-plugin-shadow.active .hbn-plugin-handle{display:block;}
  .hbn-plugin-handle.nw{left:-9px;top:-9px;cursor:nwse-resize}.hbn-plugin-handle.ne{right:-9px;top:-9px;cursor:nesw-resize}.hbn-plugin-handle.sw{left:-9px;bottom:-9px;cursor:nesw-resize}.hbn-plugin-handle.se{right:-9px;bottom:-9px;cursor:nwse-resize}.hbn-plugin-handle.n{left:50%;top:-9px;transform:translateX(-50%);cursor:ns-resize}.hbn-plugin-handle.s{left:50%;bottom:-9px;transform:translateX(-50%);cursor:ns-resize}.hbn-plugin-handle.w{left:-9px;top:50%;transform:translateY(-50%);cursor:ew-resize}.hbn-plugin-handle.e{right:-9px;top:50%;transform:translateY(-50%);cursor:ew-resize}
  .hbn-plugin-shadow.active:after{content:"拖曳移動，拉控制點縮放/變形";position:absolute;left:50%;top:calc(100% + 10px);transform:translateX(-50%);white-space:nowrap;color:#111827;background:rgba(255,255,255,.94);border:1px solid #d1d5db;border-radius:999px;padding:4px 10px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,.12);}
  .hbn-plugin-modal.shadow-editing canvas{pointer-events:none;}
  .hbn-plugin-toolbar button:disabled,.hbn-plugin-status button:disabled,.hbn-plugin-toolbar input:disabled{opacity:.38;cursor:not-allowed;filter:grayscale(.8);transform:none !important;}
  .hbn-plugin-toolbar label.is-disabled{opacity:.38;cursor:not-allowed;}
  .hbn-plugin-modal.crop-locked .hbn-plugin-panel{box-shadow:0 0 0 3px rgba(249,115,22,.35),0 24px 70px rgba(0,0,0,.45);}
  .hbn-plugin-modal.crop-locked [data-act="applyCrop"]{border-color:#fb923c !important;background:rgba(249,115,22,.18) !important;color:#fed7aa !important;box-shadow:0 0 0 2px rgba(249,115,22,.45),0 0 18px rgba(249,115,22,.35);}
  .hbn-plugin-crop-help{display:none;margin-left:4px;color:#fed7aa;background:rgba(249,115,22,.14);border:1px solid rgba(249,115,22,.45);border-radius:999px;padding:5px 9px;font-size:12px;font-weight:700;}
  .hbn-plugin-modal.crop-locked .hbn-plugin-crop-help{display:inline-flex;}
  .hbn-plugin-link-btn{border:0;background:#fff;color:#111827;padding:6px 10px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;margin-right:auto;}
  .hbn-plugin-nudge{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:100080;background:rgba(0,0,0,.55);}
  .hbn-plugin-nudge.show{display:flex;}
  .hbn-plugin-nudge-box{position:relative;width:300px;height:200px;background:#0000;border-radius:10px;overflow:hidden;box-shadow:none;}
  .hbn-plugin-nudge-box img{width:100%;height:100%;object-fit:cover;cursor:pointer;display:block;}
  .hbn-plugin-nudge-close{position:absolute;right:6px;top:6px;width:28px;height:28px;border-radius:999px;background:#111;color:#fff;border:0;cursor:pointer;font-size:16px;line-height:28px;text-align:center;}
  `;

  const html = `
    <div class="hbn-plugin-panel">
      <div class="hbn-plugin-toolbar">
        <span class="hbn-plugin-control-group hbn-plugin-eraser-group">
          <button data-act="eraser">橡皮擦</button>
          <label>橡皮擦 <strong data-role="brushVal">32px</strong><input data-role="brush" type="range" min="5" max="90" value="32"></label>
        </span>
        <button data-act="crop">裁切模式</button>
        <button data-act="applyCrop">套用裁切</button>
        <span class="hbn-plugin-crop-help">請按「套用裁切」完成裁切後，其他工具才會恢復</span>
        <span class="hbn-plugin-tool-separator"></span>
        <button data-act="autoBg">自動去背</button>
        <span class="hbn-plugin-control-group hbn-plugin-pickbg-group">
          <button data-act="pickBg">點選顏色去背</button>
          <label>選取色 <span data-role="chip" class="hbn-plugin-chip"></span></label>
          <label>去背容差 <input data-role="tol" type="range" min="10" max="120" value="48"></label>
        </span>
        <button data-act="shadow">加 / 編輯影子</button>
        <button data-act="reset" class="danger">重作</button>
        <span class="hbn-plugin-history">
          <button data-act="undo">回上一步</button>
          <button data-act="redo">下一步</button>
        </span>
      </div>
      <div class="hbn-plugin-workspace" data-role="wrap">
        <div class="hbn-plugin-shadow" data-role="shadowLayer">
          <img data-role="shadowImg" alt="shadow">
          <span class="hbn-plugin-handle nw" data-handle="nw"></span>
          <span class="hbn-plugin-handle n" data-handle="n"></span>
          <span class="hbn-plugin-handle ne" data-handle="ne"></span>
          <span class="hbn-plugin-handle e" data-handle="e"></span>
          <span class="hbn-plugin-handle se" data-handle="se"></span>
          <span class="hbn-plugin-handle s" data-handle="s"></span>
          <span class="hbn-plugin-handle sw" data-handle="sw"></span>
          <span class="hbn-plugin-handle w" data-handle="w"></span>
        </div>
        <canvas data-role="canvas"></canvas>
        <div class="hbn-plugin-crop" data-role="cropBox">
          <div class="hbn-plugin-edge top" data-edge="top"></div>
          <div class="hbn-plugin-edge right" data-edge="right"></div>
          <div class="hbn-plugin-edge bottom" data-edge="bottom"></div>
          <div class="hbn-plugin-edge left" data-edge="left"></div>
        </div>
        <div class="hbn-plugin-brush" data-role="brushPreview"></div>
      </div>
      <div class="hbn-plugin-status">
        <button data-act="photoroom" class="hbn-plugin-link-btn">最強去背工具連結</button>
        <span data-role="status">Ready</span>
        <span>
          <button data-act="cancel" class="danger">取消</button>
          <button data-act="apply">完成套用</button>
        </span>
      </div>
    </div>
    <div class="hbn-plugin-nudge" data-role="pluginNudge" aria-hidden="true">
      <div class="hbn-plugin-nudge-box">
        <button class="hbn-plugin-nudge-close" data-act="pluginNudgeClose" aria-label="關閉">✖</button>
        <img data-act="pluginNudgeImage" src="程式檔案/跳出.png" alt="跳出提示">
      </div>
    </div>`;

  function ensureModal(){
    let modal = document.getElementById('hbnProductEditorPlugin');
    if(modal) return modal;
    const style = document.createElement('style');
    style.id = 'hbn-product-editor-plugin-style';
    style.textContent = css;
    document.head.appendChild(style);
    modal = document.createElement('div');
    modal.id = 'hbnProductEditorPlugin';
    modal.className = 'hbn-plugin-modal';
    modal.innerHTML = html;
    document.body.appendChild(modal);
    return modal;
  }

  function makeEditor(){
    const modal = ensureModal();
    const $ = (sel) => modal.querySelector(sel);
    const canvas = $('[data-role="canvas"]');
    const ctx = canvas.getContext('2d', {willReadFrequently:true});
    const wrap = $('[data-role="wrap"]');
    const cropBox = $('[data-role="cropBox"]');
    const brushPreview = $('[data-role="brushPreview"]');
    const shadowLayer = $('[data-role="shadowLayer"]');
    const shadowImg = $('[data-role="shadowImg"]');
    const brush = $('[data-role="brush"]');
    const brushVal = $('[data-role="brushVal"]');
    const tol = $('[data-role="tol"]');
    const chip = $('[data-role="chip"]');
    const status = $('[data-role="status"]');

    let targetImg = null, targetBox = null, originalSrc = '';
    let mode = 'none', isDrawing=false, cropStart=null, cropEnd=null, activeCropEdge=null;
    let lastPointerPoint=null, pickedBgColor=null;
    let undoStack=[], redoStack=[];
    let shadowState=null, shadowLoaded=false, activeShadowHandle=null, isDraggingShadow=false, shadowPointerStart=null, shadowStartState=null;
    const minCropSize = 20;

    function setStatus(t){ status.textContent = t; }
    function hasImage(){ return canvas.width > 0 && canvas.height > 0; }
    function setActive(){
      modal.querySelectorAll('[data-act]').forEach(b=>b.classList.remove('active'));
      const map = {eraser:'eraser', crop:'crop', removeBgPick:'pickBg', shadowEdit:'shadow'};
      const act = map[mode];
      if(act) modal.querySelector(`[data-act="${act}"]`)?.classList.add('active');
      shadowLayer.classList.toggle('active', mode === 'shadowEdit' && !!shadowState);
      modal.classList.toggle('shadow-editing', mode === 'shadowEdit' && !!shadowState);
      updateCropFocusState();
    }

    function updateCropFocusState(){
      const locked = mode === 'crop';
      modal.classList.toggle('crop-locked', locked);
      modal.querySelectorAll('button[data-act]').forEach(btn => {
        const act = btn.dataset.act;
        if(locked){
          // 裁切模式：只允許「套用裁切」，避免使用者在未套用前誤按其他工具。
          btn.disabled = act !== 'applyCrop';
        }else{
          // 非裁切模式：「套用裁切」沒有意義，平常維持反灰不可按。
          btn.disabled = act === 'applyCrop';
        }
      });
      modal.querySelectorAll('.hbn-plugin-toolbar input').forEach(input => {
        input.disabled = locked;
        const label = input.closest('label');
        if(label) label.classList.toggle('is-disabled', locked);
      });
    }

    function setMode(next){
      mode = mode === next ? 'none' : next;
      if(mode === 'crop' && hasImage()){
        if(!cropStart || !cropEnd) resetCropToImageBounds();
        updateCropBox();
      }else{
        cropBox.style.display = 'none';
        activeCropEdge = null;
      }
      setActive();
      updateBrushPreview(lastPointerPoint);
      if(mode === 'eraser') setStatus('橡皮擦模式：拖曳圖片即可擦除，白色圓圈為目前橡皮擦範圍');
      else if(mode === 'crop') setStatus('裁切模式：其他工具已暫停。調整範圍後，請按橘框「套用裁切」才會完成裁切。');
      else if(mode === 'removeBgPick') setStatus('點選顏色去背：請在圖片上點選想去除的背景顏色');
      else if(mode === 'shadowEdit') setStatus('影子模式：bg.png 寬度等於商品寬度，商品底部吸附點與 bg.png 高度中心點相接');
      else setStatus('Ready');
    }

    function updateCanvasCssSize(){
      if(!hasImage()) return;
      const pad = 28;
      const maxW = Math.max(100, wrap.clientWidth - pad);
      const maxH = Math.max(100, wrap.clientHeight - pad);
      const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1);
      canvas.style.width = Math.round(canvas.width * scale) + 'px';
      canvas.style.height = Math.round(canvas.height * scale) + 'px';
      updateCropBox();
      updateBrushPreview(lastPointerPoint);
      updateShadowLayer();
    }

    new ResizeObserver(updateCanvasCssSize).observe(wrap);

    function pushHistory(){
      if(!hasImage()) return;
      undoStack.push(canvas.toDataURL('image/png'));
      if(undoStack.length > 30) undoStack.shift();
      redoStack.length = 0;
    }

    function restoreFrom(url){
      const img = new Image();
      img.onload = ()=>{
        canvas.width = img.width; canvas.height = img.height;
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0);
        autoAttachShadowAfterImageChange();
        updateCanvasCssSize();
      };
      img.src = url;
    }

    function getCanvasPoint(evt){
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(canvas.width, (evt.clientX - rect.left) * canvas.width / rect.width)),
        y: Math.max(0, Math.min(canvas.height, (evt.clientY - rect.top) * canvas.height / rect.height))
      };
    }

    function updateBrushPreview(p){
      if(!hasImage() || mode !== 'eraser' || !p){ brushPreview.style.display='none'; return; }
      const rect = canvas.getBoundingClientRect();
      const wrect = wrap.getBoundingClientRect();
      const scaleX = rect.width / canvas.width;
      const scaleY = rect.height / canvas.height;
      const size = Number(brush.value);
      const d = Math.max(2, size * ((scaleX + scaleY) / 2));
      brushPreview.style.width = d + 'px';
      brushPreview.style.height = d + 'px';
      brushPreview.style.left = (rect.left - wrect.left + p.x * scaleX) + 'px';
      brushPreview.style.top = (rect.top - wrect.top + p.y * scaleY) + 'px';
      brushPreview.style.display = 'block';
    }

    brush.addEventListener('input', ()=>{ brushVal.textContent = brush.value + 'px'; updateBrushPreview(lastPointerPoint); });

    function eraseAt(p){
      const size = Number(brush.value);
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(p.x, p.y, size/2, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }

    function resetCropToImageBounds(){
      cropStart = {x:0,y:0};
      cropEnd = {x:canvas.width,y:canvas.height};
    }

    function updateCropBox(){
      if(!cropStart || !cropEnd || mode !== 'crop') return;
      const rect = canvas.getBoundingClientRect();
      const wrect = wrap.getBoundingClientRect();
      const x1 = Math.min(cropStart.x,cropEnd.x), y1 = Math.min(cropStart.y,cropEnd.y);
      const x2 = Math.max(cropStart.x,cropEnd.x), y2 = Math.max(cropStart.y,cropEnd.y);
      const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
      cropBox.style.left = (rect.left - wrect.left + x1 * sx) + 'px';
      cropBox.style.top = (rect.top - wrect.top + y1 * sy) + 'px';
      cropBox.style.width = Math.max(2, (x2 - x1) * sx) + 'px';
      cropBox.style.height = Math.max(2, (y2 - y1) * sy) + 'px';
      cropBox.style.display = 'block';
    }

    function resizeCropByEdge(edge, p){
      const left = Math.min(cropStart.x,cropEnd.x), right = Math.max(cropStart.x,cropEnd.x);
      const top = Math.min(cropStart.y,cropEnd.y), bottom = Math.max(cropStart.y,cropEnd.y);
      let l=left,r=right,t=top,b=bottom;
      if(edge === 'left') l = Math.min(Math.max(0,p.x), right-minCropSize);
      if(edge === 'right') r = Math.max(Math.min(canvas.width,p.x), left+minCropSize);
      if(edge === 'top') t = Math.min(Math.max(0,p.y), bottom-minCropSize);
      if(edge === 'bottom') b = Math.max(Math.min(canvas.height,p.y), top+minCropSize);
      cropStart = {x:l,y:t}; cropEnd = {x:r,y:b};
    }

    function colorDistance(a,b){ return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2); }
    function setPickedColor(c){
      pickedBgColor = [c[0],c[1],c[2]];
      chip.style.background = `rgb(${pickedBgColor[0]},${pickedBgColor[1]},${pickedBgColor[2]})`;
    }

    function removeBgByColor(bg){
      if(!hasImage()) return;
      pushHistory();
      const tolerance = Number(tol.value);
      const imageData = ctx.getImageData(0,0,canvas.width,canvas.height);
      const d = imageData.data;
      for(let i=0;i<d.length;i+=4){
        const dist = colorDistance([d[i],d[i+1],d[i+2]], bg);
        if(dist < tolerance) d[i+3] = 0;
        else if(dist < tolerance + 22) d[i+3] = Math.max(0, d[i+3] * ((dist - tolerance) / 22));
      }
      ctx.putImageData(imageData,0,0);
      autoAttachShadowAfterImageChange();
    }

    function getVisibleImageBounds(){
      const imageData = ctx.getImageData(0,0,canvas.width,canvas.height);
      const d = imageData.data;
      let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
      for(let y=0;y<canvas.height;y++){
        for(let x=0;x<canvas.width;x++){
          const a = d[(y*canvas.width+x)*4+3];
          if(a > 8){
            if(x<minX) minX=x; if(y<minY) minY=y; if(x>maxX) maxX=x; if(y>maxY) maxY=y;
          }
        }
      }
      if(maxX<0 || maxY<0) return {x:0,y:0,w:canvas.width,h:canvas.height,bottom:canvas.height};
      return {x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1,bottom:maxY+1};
    }

    function makeDefaultShadow(){
      const b = getVisibleImageBounds();
      const w = b.w;
      const h = Math.max(14, b.h * 0.10);
      return {x:b.x, y:b.bottom - h/2, w, h};
    }

    function attachShadowBelowProduct(){
      if(!shadowState) return;
      const b = getVisibleImageBounds();
      shadowState.w = b.w;
      shadowState.x = b.x;
      shadowState.y = b.bottom - shadowState.h / 2;
      shadowState = clampShadowState(shadowState);
      updateShadowLayer();
    }
    function autoAttachShadowAfterImageChange(){ if(shadowState) attachShadowBelowProduct(); }

    function getCanvasRectMetrics(){
      const rect = canvas.getBoundingClientRect();
      const wrect = wrap.getBoundingClientRect();
      return {left:rect.left-wrect.left, top:rect.top-wrect.top, scaleX:rect.width/canvas.width, scaleY:rect.height/canvas.height};
    }
    function updateShadowLayer(){
      if(!hasImage() || !shadowState){ shadowLayer.style.display='none'; shadowLayer.classList.remove('active'); return; }
      const m = getCanvasRectMetrics();
      shadowLayer.style.left = (m.left + shadowState.x*m.scaleX)+'px';
      shadowLayer.style.top = (m.top + shadowState.y*m.scaleY)+'px';
      shadowLayer.style.width = Math.max(2, shadowState.w*m.scaleX)+'px';
      shadowLayer.style.height = Math.max(2, shadowState.h*m.scaleY)+'px';
      shadowLayer.style.display = 'block';
      shadowLayer.classList.toggle('active', mode === 'shadowEdit');
    }
    function clampShadowState(s){
      s.w = Math.max(20, s.w);
      s.h = Math.max(8, s.h);
      s.x = Math.min(canvas.width-20, Math.max(-canvas.width, s.x));
      s.y = Math.min(canvas.height, Math.max(-canvas.height, s.y));
      return s;
    }
    function loadShadowImage(cb){
      if(shadowLoaded){ cb && cb(); return; }
      shadowImg.onload = ()=>{ shadowLoaded=true; cb && cb(); };
      shadowImg.onerror = ()=> setStatus('找不到 html/img/bg.png：請確認 bg.png 放在 html/img/ 資料夾裡');
      shadowImg.src = 'html/img/bg.png';
    }
    function setShadowMode(){
      if(!hasImage()) return;
      // 再按一次「加/編輯影子」→ 清除影子並回到 none 模式
      if(mode === 'shadowEdit'){
        shadowState = null;
        updateShadowLayer();
        setMode('none');
        setStatus('已關閉影子');
        return;
      }
      loadShadowImage(()=>{
        if(!shadowState) shadowState = makeDefaultShadow();
        updateShadowLayer();
        setMode('shadowEdit');
      });
    }

    function getVisibleBoundsFromCanvas(srcCanvas, alphaThreshold){
      const w = srcCanvas.width || 0, h = srcCanvas.height || 0;
      if(!w || !h) return {x:0,y:0,w:0,h:0,right:0,bottom:0,empty:true};
      const c = srcCanvas.getContext('2d', {willReadFrequently:true});
      const d = c.getImageData(0,0,w,h).data;
      const threshold = alphaThreshold == null ? 8 : alphaThreshold;
      let minX=w, minY=h, maxX=-1, maxY=-1;
      for(let y=0;y<h;y++){
        for(let x=0;x<w;x++){
          const a = d[(y*w+x)*4+3];
          if(a > threshold){
            if(x<minX) minX=x; if(y<minY) minY=y;
            if(x>maxX) maxX=x; if(y>maxY) maxY=y;
          }
        }
      }
      if(maxX < 0 || maxY < 0) return {x:0,y:0,w:w,h:h,right:w,bottom:h,empty:true};
      return {x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1,right:maxX+1,bottom:maxY+1,empty:false};
    }

    function trimCanvasToVisibleBounds(srcCanvas, pad){
      const b = getVisibleBoundsFromCanvas(srcCanvas, 8);
      if(b.empty) return srcCanvas;
      const p = Math.max(0, pad == null ? 0 : pad);
      const x = Math.max(0, b.x - p);
      const y = Math.max(0, b.y - p);
      const right = Math.min(srcCanvas.width, b.right + p);
      const bottom = Math.min(srcCanvas.height, b.bottom + p);
      const out = document.createElement('canvas');
      out.width = Math.max(1, right - x);
      out.height = Math.max(1, bottom - y);
      out.getContext('2d').drawImage(srcCanvas, x, y, out.width, out.height, 0, 0, out.width, out.height);
      out._trimX = x;
      out._trimY = y;
      out._visibleBounds = {x:x,y:y,w:out.width,h:out.height};
      return out;
    }

    function renderProductOnlyCanvas(){
      const out = document.createElement('canvas');
      out.width = canvas.width; out.height = canvas.height;
      out.getContext('2d').drawImage(canvas,0,0);
      const trimmed = trimCanvasToVisibleBounds(out, 0);
      trimmed._productOffsetX = 0;
      trimmed._productOffsetY = 0;
      trimmed._productW = trimmed.width;
      trimmed._productH = trimmed.height;
      trimmed._outputRatio = trimmed.width / Math.max(1, trimmed.height);
      return trimmed;
    }

    function renderWithShadowCanvas(){
      const productBounds = getVisibleImageBounds();
      const hasShadow = !!(shadowState && shadowLoaded);
      const minX = hasShadow ? Math.min(productBounds.x, shadowState.x) : productBounds.x;
      const minY = hasShadow ? Math.min(productBounds.y, shadowState.y) : productBounds.y;
      const maxX = hasShadow ? Math.max(productBounds.x + productBounds.w, shadowState.x + shadowState.w) : (productBounds.x + productBounds.w);
      const maxY = hasShadow ? Math.max(productBounds.y + productBounds.h, shadowState.y + shadowState.h) : (productBounds.y + productBounds.h);

      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.ceil(maxX - minX));
      out.height = Math.max(1, Math.ceil(maxY - minY));
      const o = out.getContext('2d');

      if(hasShadow){
        o.drawImage(shadowImg, shadowState.x - minX, shadowState.y - minY, shadowState.w, shadowState.h);
      }
      o.drawImage(canvas, -minX, -minY);

      const trimmed = trimCanvasToVisibleBounds(out, 0);
      const trimX = trimmed._trimX || 0;
      const trimY = trimmed._trimY || 0;
      /* Metadata for applyToTarget(): visible product remains at this offset inside the expanded shadow result. */
      trimmed._productOffsetX = (productBounds.x - minX) - trimX;
      trimmed._productOffsetY = (productBounds.y - minY) - trimY;
      trimmed._productW = productBounds.w;
      trimmed._productH = productBounds.h;
      trimmed._outputRatio = trimmed.width / Math.max(1, trimmed.height);
      return trimmed;
    }

    function applyCrop(){
      if(!hasImage() || !cropStart || !cropEnd) return;
      const x = Math.round(Math.min(cropStart.x,cropEnd.x));
      const y = Math.round(Math.min(cropStart.y,cropEnd.y));
      const w = Math.round(Math.abs(cropEnd.x-cropStart.x));
      const h = Math.round(Math.abs(cropEnd.y-cropStart.y));
      if(w<5 || h<5) return setStatus('裁切範圍太小');
      pushHistory();
      const imageData = ctx.getImageData(x,y,w,h);
      canvas.width=w; canvas.height=h;
      ctx.putImageData(imageData,0,0);
      cropStart=cropEnd=null; cropBox.style.display='none';
      autoAttachShadowAfterImageChange();
      setMode('none');
      updateCanvasCssSize();
      setStatus('裁切完成，影子已依商品重新吸附');
    }

    function resetToOriginal(){
      if(!originalSrc) return;
      const img = new Image();
      img.onload = ()=>{
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0);
        undoStack = []; redoStack = [];
        pushHistory();
        shadowState = null;
        cropStart = cropEnd = null;
        chip.style.background = 'transparent';
        updateCanvasCssSize();
        setMode('none');
      };
      img.src = originalSrc;
    }

    function applyToTarget(){
      if(!targetImg || !hasImage()) return;
      const productOnly = renderProductOnlyCanvas();
      const final = renderWithShadowCanvas();
      const productUrl = productOnly.toDataURL('image/png');
      const finalUrl = final.toDataURL('image/png');

      // Keep stable references before close() clears the editor state.
      // Otherwise the onload callback cannot restore the original product box size.
      const boxRef = targetBox;
      const imgRef = targetImg;

      if(boxRef && boxRef.dataset){
        boxRef.dataset.baseSrc = productUrl;
        boxRef.dataset.outputRatio = String(final.width / Math.max(1, final.height));
        boxRef.dataset.productOnlyRatio = String(productOnly.width / Math.max(1, productOnly.height));
        boxRef.dataset.shadowEnabled = shadowState ? '1' : '0';
        if(shadowState){
          boxRef.dataset.pluginShadowX = String(shadowState.x);
          boxRef.dataset.pluginShadowY = String(shadowState.y);
          boxRef.dataset.pluginShadowW = String(shadowState.w);
          boxRef.dataset.pluginShadowH = String(shadowState.h);
        } else {
          delete boxRef.dataset.pluginShadowX;
          delete boxRef.dataset.pluginShadowY;
          delete boxRef.dataset.pluginShadowW;
          delete boxRef.dataset.pluginShadowH;
        }
      }

      const prevW = boxRef ? (parseFloat(boxRef.style.width) || boxRef.offsetWidth || 0) : 0;
      const prevH = boxRef ? (parseFloat(boxRef.style.height) || boxRef.offsetHeight || 0) : 0;
      const prevL = boxRef ? (parseFloat(boxRef.style.left) || boxRef.offsetLeft || 0) : 0;
      const prevT = boxRef ? (parseFloat(boxRef.style.top) || boxRef.offsetTop || 0) : 0;

      function containRect(boxW, boxH, imgW, imgH){
        if(!boxW || !boxH || !imgW || !imgH) return {x:0,y:0,w:boxW,h:boxH,scale:1};
        const scale = Math.min(boxW / imgW, boxH / imgH);
        const w = imgW * scale;
        const h = imgH * scale;
        return { x:(boxW - w) / 2, y:(boxH - h) / 2, w, h, scale };
      }

      imgRef.onload = ()=>{
        if(boxRef){
          let targetW = prevW;
          let targetH = prevH;
          let targetL = prevL;
          let targetT = prevT;

          if(shadowState && (final.width !== productOnly.width || final.height !== productOnly.height)){
            const prevDraw = containRect(prevW, prevH, productOnly.width, productOnly.height);
            const scale = prevDraw.scale || 1;
            targetW = Math.max(20, Math.round(final.width * scale));
            targetH = Math.max(20, Math.round(final.height * scale));
            targetL = Math.round(prevL + prevDraw.x - (final._productOffsetX || 0) * scale);
            targetT = Math.round(prevT + prevDraw.y - (final._productOffsetY || 0) * scale);
          }

          boxRef.style.width = targetW + 'px';
          boxRef.style.height = targetH + 'px';
          boxRef.style.left = targetL + 'px';
          boxRef.style.top = targetT + 'px';
          boxRef.dataset.fixedW = String(Math.round(targetW || boxRef.offsetWidth || 0));
          boxRef.dataset.fixedH = String(Math.round(targetH || boxRef.offsetHeight || 0));
        }
        imgRef.style.objectFit = 'contain';
        imgRef.style.width = '100%';
        imgRef.style.height = '100%';
        imgRef.style.maxWidth = '100%';
        imgRef.style.maxHeight = '100%';
        imgRef.style.display = 'block';
        if(typeof window.syncDdLinkedCanvases === 'function'){
          setTimeout(()=>window.syncDdLinkedCanvases(), 80);
        }
      };
      imgRef.src = finalUrl;

      close();
      if(typeof window.showToast === 'function') window.showToast('商品圖已套用外掛編輯器結果', 'ok', 1600);
    }

    function close(){
      modal.classList.remove('open');
      setMode('none');
      targetImg = null; targetBox = null; originalSrc = '';
    }

    function openPhotoRoomLink(){
      window.open('https://www.photoroom.com/tools/background-remover','_blank');
    }

    function showCancelNudge(){
      const nudge = $('[data-role="pluginNudge"]');
      if(nudge) nudge.classList.add('show');
    }

    function hideCancelNudgeAndClose(){
      const nudge = $('[data-role="pluginNudge"]');
      if(nudge) nudge.classList.remove('show');
      close();
    }

    canvas.addEventListener('pointerdown', e=>{
      if(!hasImage()) return;
      const p = getCanvasPoint(e);
      lastPointerPoint = p;
      if(mode === 'eraser'){
        pushHistory(); isDrawing = true; eraseAt(p);
      }else if(mode === 'crop'){
        if(!cropStart || !cropEnd) resetCropToImageBounds();
        updateCropBox();
      }else if(mode === 'removeBgPick'){
        const px = ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
        setPickedColor(px); removeBgByColor(pickedBgColor); setStatus('點選顏色去背完成，影子已重新吸附');
      }
    });
    canvas.addEventListener('pointermove', e=>{
      if(!hasImage()) return;
      const p = getCanvasPoint(e);
      lastPointerPoint = p;
      updateBrushPreview(p);
      if(mode === 'eraser' && isDrawing) eraseAt(p);
    });
    window.addEventListener('pointerup', ()=>{
      if(isDrawing){ isDrawing=false; autoAttachShadowAfterImageChange(); setStatus('已擦除，影子已自動重新吸附'); }
      activeCropEdge = null;
    });
    canvas.addEventListener('pointerleave', ()=>{ lastPointerPoint=null; brushPreview.style.display='none'; });

    cropBox.addEventListener('pointerdown', e=>{
      const edge = e.target.dataset.edge;
      if(!edge || mode !== 'crop' || !hasImage()) return;
      e.preventDefault(); e.stopPropagation();
      activeCropEdge = edge;
      cropBox.setPointerCapture(e.pointerId);
    });
    cropBox.addEventListener('pointermove', e=>{
      if(!activeCropEdge || mode !== 'crop' || !hasImage()) return;
      e.preventDefault();
      const p = getCanvasPoint(e);
      resizeCropByEdge(activeCropEdge, p);
      updateCropBox();
    });
    cropBox.addEventListener('pointerup', e=>{
      activeCropEdge = null;
      try{ cropBox.releasePointerCapture(e.pointerId); }catch(_){}
    });

    function getWrapPoint(e){
      const r = wrap.getBoundingClientRect();
      return {x:e.clientX-r.left, y:e.clientY-r.top};
    }
    function resizeShadow(handle, dx, dy){
      const s = {...shadowStartState};
      if(handle.includes('e')) s.w = shadowStartState.w + dx;
      if(handle.includes('s')) s.h = shadowStartState.h + dy;
      if(handle.includes('w')){ s.x = shadowStartState.x + dx; s.w = shadowStartState.w - dx; }
      if(handle.includes('n')){ s.y = shadowStartState.y + dy; s.h = shadowStartState.h - dy; }
      shadowState = clampShadowState(s);
      updateShadowLayer();
    }
    shadowLayer.addEventListener('pointerdown', e=>{
      if(mode !== 'shadowEdit' || !shadowState) return;
      e.preventDefault(); e.stopPropagation();
      activeShadowHandle = e.target.dataset.handle || null;
      isDraggingShadow = !activeShadowHandle;
      const p = getWrapPoint(e), m = getCanvasRectMetrics();
      shadowPointerStart = {x:(p.x-m.left)/m.scaleX, y:(p.y-m.top)/m.scaleY};
      shadowStartState = {...shadowState};
      shadowLayer.setPointerCapture(e.pointerId);
    });
    shadowLayer.addEventListener('pointermove', e=>{
      if(mode !== 'shadowEdit' || !shadowState || !shadowPointerStart) return;
      e.preventDefault();
      const p = getWrapPoint(e), m = getCanvasRectMetrics();
      const cur = {x:(p.x-m.left)/m.scaleX, y:(p.y-m.top)/m.scaleY};
      const dx = cur.x - shadowPointerStart.x, dy = cur.y - shadowPointerStart.y;
      if(isDraggingShadow){
        shadowState = clampShadowState({...shadowStartState, x:shadowStartState.x+dx, y:shadowStartState.y+dy});
        updateShadowLayer();
      }else if(activeShadowHandle) resizeShadow(activeShadowHandle, dx, dy);
    });
    shadowLayer.addEventListener('pointerup', e=>{
      activeShadowHandle=null; isDraggingShadow=false; shadowPointerStart=null; shadowStartState=null;
      try{ shadowLayer.releasePointerCapture(e.pointerId); }catch(_){}
    });

    modal.addEventListener('click', e=>{
      const act = e.target.dataset.act;
      if(!act) return;
      if(act === 'eraser') setMode('eraser');
      if(act === 'crop') setMode('crop');
      if(act === 'applyCrop') applyCrop();
      if(act === 'autoBg'){
        if(!hasImage()) return;
        const imageData = ctx.getImageData(0,0,canvas.width,canvas.height);
        const d = imageData.data;
        const pts = [0,(canvas.width-1)*4,((canvas.height-1)*canvas.width)*4,((canvas.height*canvas.width)-1)*4];
        const bg = [0,0,0];
        pts.forEach(i=>{bg[0]+=d[i];bg[1]+=d[i+1];bg[2]+=d[i+2];});
        bg[0]=Math.round(bg[0]/4); bg[1]=Math.round(bg[1]/4); bg[2]=Math.round(bg[2]/4);
        setPickedColor(bg); removeBgByColor(bg); setStatus('自動去背完成，影子已重新吸附');
      }
      if(act === 'pickBg') setMode('removeBgPick');
      if(act === 'shadow') setShadowMode();
      if(act === 'undo'){
        if(undoStack.length <= 1) return setStatus('沒有可回復的步驟');
        redoStack.push(undoStack.pop()); restoreFrom(undoStack[undoStack.length-1]); setStatus('已回上一步');
      }
      if(act === 'redo'){
        if(!redoStack.length) return setStatus('沒有下一步');
        const next = redoStack.pop(); undoStack.push(next); restoreFrom(next); setStatus('已到下一步');
      }
      if(act === 'reset') resetToOriginal();
      if(act === 'photoroom') openPhotoRoomLink();
      if(act === 'pluginNudgeImage') openPhotoRoomLink();
      if(act === 'pluginNudgeClose') hideCancelNudgeAndClose();
      if(act === 'cancel') showCancelNudge();
      if(act === 'apply') applyToTarget();
    });

    function open(imgEl){
      targetImg = imgEl;
      targetBox = imgEl.closest('.editor-item');
      originalSrc = (targetBox && targetBox.dataset && targetBox.dataset.baseSrc) ? targetBox.dataset.baseSrc : imgEl.src;
      modal.classList.add('open');
      const img = new Image();
      img.onload = ()=>{
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0);
        undoStack = []; redoStack = [];
        pushHistory();
        mode = 'none';
        cropStart = cropEnd = null;
        pickedBgColor = null;
        chip.style.background = 'transparent';

        // 還原上次儲存的影子狀態
        const hasSavedShadow = targetBox && targetBox.dataset && targetBox.dataset.shadowEnabled === '1';
        if(hasSavedShadow){
          const sx = parseFloat(targetBox.dataset.pluginShadowX);
          const sy = parseFloat(targetBox.dataset.pluginShadowY);
          const sw = parseFloat(targetBox.dataset.pluginShadowW);
          const sh = parseFloat(targetBox.dataset.pluginShadowH);
          if(isFinite(sx) && isFinite(sy) && isFinite(sw) && isFinite(sh) && sw > 0 && sh > 0){
            shadowState = {x:sx, y:sy, w:sw, h:sh};
          } else {
            shadowState = makeDefaultShadow();
          }
          loadShadowImage(()=>{ updateShadowLayer(); });
        } else {
          shadowState = null;
        }

        setActive();
        updateCanvasCssSize();
        setStatus('外掛商品編輯器已開啟');
      };
      img.src = originalSrc;
    }

    return {open};
  }

  let editorInstance = null;
  function openPluginProductEditor(imgEl){
    if(!editorInstance) editorInstance = makeEditor();
    editorInstance.open(imgEl);
  }

  window.openEraseEditor = function(imgEl, options){
    if(options && options.isLogoEdit && typeof oldOpenEraseEditor === 'function'){
      return oldOpenEraseEditor.apply(this, arguments);
    }
    return openPluginProductEditor(imgEl);
  };

  window.HBNProductEditorPlugin = { open: openPluginProductEditor, version: '1.1.1-crop-button-and-upload-perf' };
})();
