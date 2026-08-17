/*!
 * Logo Menu Plugin v14
 * 從 hbn.html jimmy-new-logo-menu-only-script 抽取
 * 提供：logo 縮圖右上角 ✎ 觸發器 + 下拉選單（編輯/往右移/刪除/加圓角）
 *       + CropperJS Logo 裁切 Modal
 *
 * 使用：
 *   window.BNLogoMenu.attach(imgEl, options)
 *     options.onEdit(imgEl)    → 點「編輯」
 *     options.onSwap(imgEl)    → 點「往右移」（可選）
 *     options.onDelete(imgEl)  → 點「刪除」
 *     options.showSwap         → 是否顯示「往右移」
 *
 *   window.BNLogoMenu.openCropEditor(src, onDone)
 *     → 開啟 CropperJS 裁切視窗，完成後呼叫 onDone(newSrc)
 */
(function(global){
  if(global.__BN_LOGO_MENU_PLUGIN__) return;
  global.__BN_LOGO_MENU_PLUGIN__ = true;

  /* ── 載入 CropperJS ── */
  function loadCropper(cb){
    if(global.Cropper){ cb(); return; }
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.css';
    document.head.appendChild(link);
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  /* ── 注入 CSS ── */
  function injectCSS(){
    if(document.getElementById('_bn_lm_css')) return;
    var s = document.createElement('style');
    s.id = '_bn_lm_css';
    s.textContent = `
.logo-edit-btn,
.logo-swap-btn,
.logo-delete-btn,
.logo-white-btn,
.logo-main-pen-btn,
.logo-action-menu{
  display:none !important;
}

.logo-v14-trigger{
  position:absolute !important;
  top:-24px !important;
  right:-2px !important;
  width:20px !important;
  height:20px !important;
  border-radius:50% !important;
  background:#000 !important;
  color:#fff !important;
  display:flex !important;
  align-items:center !important;
  justify-content:center !important;
  cursor:pointer !important;
  z-index:2147483645 !important;
  font-size:12px !important;
  line-height:1 !important;
  user-select:none !important;
  box-shadow:0 2px 6px rgba(0,0,0,.25);
}
.logo-item,
#square .brand{ overflow:visible !important; }

#logoMenuV14{
  position:fixed !important;
  min-width:118px !important;
  background:#111 !important;
  color:#fff !important;
  border-radius:10px !important;
  box-shadow:0 8px 24px rgba(0,0,0,.28) !important;
  padding:6px 0 !important;
  display:none !important;
  z-index:2147483647 !important;
}
#logoMenuV14.show{ display:block !important; }
#logoMenuV14 button{
  width:100% !important;
  border:0 !important;
  background:transparent !important;
  color:#fff !important;
  text-align:left !important;
  padding:7px 12px !important;
  font-size:12px !important;
  line-height:1.35 !important;
  cursor:pointer !important;
}
#logoMenuV14 button:hover{ background:#2b2b2b !important; }
#logoMenuV14 button[hidden]{ display:none !important; }

.is-exporting .logo-v14-trigger,
.is-exporting #logoMenuV14,
.is-exporting #logoCropModal{ display:none !important; }

#logoCropModal{
  position:fixed !important;
  inset:0 !important;
  background:rgba(0,0,0,.5) !important;
  display:none !important;
  align-items:center !important;
  justify-content:center !important;
  z-index:2147483646 !important;
  padding:24px !important;
  box-sizing:border-box !important;
}
#logoCropModal.open{ display:flex !important; }
#logoCropModal .cropper-panel{
  position:relative !important;
  width:min(92vw, 900px) !important;
  max-height:88vh !important;
  background:#fff !important;
  border-radius:14px !important;
  overflow:hidden !important;
  display:flex !important;
  flex-direction:column !important;
  box-shadow:0 18px 60px rgba(0,0,0,.35) !important;
}
#logoCropModal .cropper-panel header{
  display:flex !important;
  align-items:center !important;
  justify-content:space-between !important;
  padding:12px 16px !important;
  margin:0 !important;
  border-bottom:1px solid #eee !important;
  background:#fff !important;
}
#logoCropModal .cropper-panel header strong{
  font-size:14px !important;
  color:#111 !important;
}
#logoCropModal .cropper-panel .body{
  padding:12px !important;
  min-height:280px !important;
  overflow:auto !important;
}
#logoCropModal .cropper-panel .actions{
  display:flex !important;
  align-items:center !important;
  justify-content:space-between !important;
  gap:10px !important;
  padding:10px 12px !important;
  border-top:1px solid #eee !important;
  background:#fff !important;
}
#logoCropModal .cropper-help{
  font-size:12px !important;
  color:#777 !important;
  line-height:1.5 !important;
}
#logoCropModal .cropper-buttons{
  display:flex !important;
  gap:8px !important;
  justify-content:flex-end !important;
}
#logoCropImg{
  max-width:100%;
  max-height:64vh;
  display:block;
  margin:0 auto;
}
`;
    document.head.appendChild(s);
  }

  /* ── 注入 Modal HTML ── */
  function injectHTML(){
    if(document.getElementById('logoCropModal')) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = `
<div id="logoCropModal" class="cropper-modal-wrap" aria-hidden="true">
  <div class="cropper-panel" role="dialog" aria-modal="true" aria-label="Logo 裁切">
    <header>
      <strong>Logo 裁切</strong>
      <button id="logoCropClose" class="btn secondary" type="button">關閉</button>
    </header>
    <div class="body"><img id="logoCropImg" alt="Logo 裁切" /></div>
    <div class="actions">
      <div class="cropper-help">同等比裁切：按住 shift 鍵再用滑鼠拉框線</div>
      <div class="cropper-buttons">
        <button id="logoCropCancel" class="btn secondary" type="button">取消</button>
        <button id="logoCropApply" class="btn" type="button">套用</button>
      </div>
    </div>
  </div>
</div>
`;
    while(tmp.firstChild) document.body.appendChild(tmp.firstChild);
  }

  /* ── 核心邏輯（從 hbn.html 抽取，移除 hbn 專屬 DOM 依賴） ── */

  var ctx = null;
  var activeCropper = null;
  var activeTarget = null;
  var _cropDone = null;

  function q(sel, root){ return (root||document).querySelector(sel); }

  function closeMenu(){
    var menu = document.getElementById('logoMenuV14');
    if(menu) menu.classList.remove('show');
  }

  function ensureMenu(){
    var menu = document.getElementById('logoMenuV14');
    if(menu) return menu;
    menu = document.createElement('div');
    menu.id = 'logoMenuV14';
    menu.innerHTML =
      '<button type="button" data-action="edit">編輯</button>' +
      '<button type="button" data-action="swap">往右移</button>' +
      '<button type="button" data-action="delete">刪除</button>' +
      '<button type="button" data-action="round">加圓角</button>';
    document.body.appendChild(menu);
    menu.addEventListener('mousedown', function(e){ e.stopPropagation(); }, true);
    menu.addEventListener('click', function(e){
      var btn = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
      if(!btn) return;
      e.preventDefault(); e.stopPropagation();
      runAction(btn.dataset.action);
      closeMenu();
    }, true);
    return menu;
  }

  function updateMenu(){
    var menu = ensureMenu();
    var swapBtn = menu.querySelector('[data-action="swap"]');
    if(swapBtn) swapBtn.hidden = !(ctx && ctx.showSwap);
    var roundBtn = menu.querySelector('[data-action="round"]');
    if(roundBtn){
      roundBtn.textContent = (ctx && ctx.img && ctx.img.dataset.bnLogoRound === '1') ? '取消圓角' : '加圓角';
    }
  }

  function openMenu(wrap, img, trigger, opts){
    ctx = { wrap:wrap, img:img, opts:opts||{}, showSwap:!!(opts&&opts.showSwap) };
    var menu = ensureMenu();
    updateMenu();
    var rect = trigger.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.round(rect.right - 118)) + 'px';
    menu.style.top  = Math.max(8, Math.round(rect.bottom + 6)) + 'px';
    menu.classList.add('show');
  }

  function runAction(action){
    if(!ctx || !ctx.img) return;
    var img = ctx.img, opts = ctx.opts||{};
    if(action === 'edit'){
      /* 開啟 CropperJS 裁切，完成後回呼 opts.onEdit */
      openCropEditor(img.src, function(newSrc){
        if(!newSrc) return;
        img.src = newSrc;
        if(typeof opts.onEdit === 'function') opts.onEdit(img, newSrc);
      });
    } else if(action === 'swap'){
      if(typeof opts.onSwap === 'function') opts.onSwap(img);
    } else if(action === 'delete'){
      if(typeof opts.onDelete === 'function') opts.onDelete(img);
    } else if(action === 'round'){
      var isRound = ctx.img.dataset.bnLogoRound === '1';
      ctx.img.dataset.bnLogoRound = isRound ? '' : '1';
      ctx.img.style.borderRadius = isRound ? '' : '50%';
      updateMenu();
      if(typeof opts.onRound === 'function') opts.onRound(img, !isRound);
    }
  }

  /* ── CropperJS 裁切 ── */
  function destroyCropper(){
    try{ activeCropper && activeCropper.destroy(); }catch(_){}
    activeCropper = null;
  }

  function closeCropEditor(){
    var modal = document.getElementById('logoCropModal');
    destroyCropper();
    if(modal){
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
    _cropDone = null;
  }

  function openCropEditor(src, onDone){
    injectCSS();
    injectHTML();
    _cropDone = onDone || null;
    loadCropper(function(){
      var modal   = document.getElementById('logoCropModal');
      var cropImg = document.getElementById('logoCropImg');
      var apply   = document.getElementById('logoCropApply');
      var close   = document.getElementById('logoCropClose');
      var cancel  = document.getElementById('logoCropCancel');
      if(!modal || !cropImg) return;

      activeTarget = null;
      destroyCropper();
      /* 重設 img 讓瀏覽器重新 load */
      cropImg.removeAttribute('src');
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');

      cropImg.onload = function(){
        cropImg.onload = null;
        destroyCropper();
        activeCropper = new Cropper(cropImg, {
          viewMode: 1,
          autoCropArea: 1,
          movable: true,
          zoomable: true,
          scalable: true,
          background: false
        });
      };
      cropImg.src = src;

      /* 「套用」按鈕 */
      if(apply && apply.dataset.bnBound !== '1'){
        apply.dataset.bnBound = '1';
        apply.addEventListener('click', function(){
          if(!activeCropper) return;
          var out = activeCropper.getCroppedCanvas();
          if(!out) return;
          var url = out.toDataURL('image/png');
          var done = _cropDone;
          closeCropEditor();
          if(typeof done === 'function'){ done(url); }
        });
      }
      /* 「關閉 / 取消」按鈕 */
      if(close && close.dataset.bnBound !== '1'){
        close.dataset.bnBound = '1';
        close.addEventListener('click', closeCropEditor);
      }
      if(cancel && cancel.dataset.bnBound !== '1'){
        cancel.dataset.bnBound = '1';
        cancel.addEventListener('click', closeCropEditor);
      }
      if(modal.dataset.bnBackdropBound !== '1'){
        modal.dataset.bnBackdropBound = '1';
        modal.addEventListener('mousedown', function(e){
          if(e.target === modal) closeCropEditor();
        });
      }
      if(document.documentElement.dataset.bnLogoEscBound !== '1'){
        document.documentElement.dataset.bnLogoEscBound = '1';
        document.addEventListener('keydown', function(e){
          var m = document.getElementById('logoCropModal');
          if(e.key === 'Escape' && m && m.classList.contains('open')) closeCropEditor();
        });
      }
    });
  }

  /* ── 附加觸發器到 logo 縮圖 ── */
  function attach(imgEl, opts){
    injectCSS();
    var wrap = imgEl.parentElement;
    if(!wrap) return;
    wrap.style.overflow = 'visible';
    wrap.style.position = 'relative';

    /* 移除舊觸發器 */
    var old = wrap.querySelector('.logo-v14-trigger');
    if(old) old.remove();

    var trigger = document.createElement('div');
    trigger.className = 'logo-v14-trigger';
    trigger.textContent = '✎';
    trigger.title = 'Logo 功能';
    wrap.appendChild(trigger);

    trigger.style.display = imgEl.getAttribute('src') ? 'flex' : 'none';

    trigger.addEventListener('click', function(e){
      e.preventDefault(); e.stopPropagation();
      document.addEventListener('click', closeMenu, { once:true });
      openMenu(wrap, imgEl, trigger, opts||{});
    }, true);

    /* src 變化時更新顯示 */
    var obs = new MutationObserver(function(){
      trigger.style.display = imgEl.getAttribute('src') ? 'flex' : 'none';
    });
    obs.observe(imgEl, { attributes:true, attributeFilter:['src'] });
  }

  /* ── 關閉 menu 點外部 ── */
  document.addEventListener('click', function(e){
    var menu = document.getElementById('logoMenuV14');
    if(menu && !menu.contains(e.target)) closeMenu();
  });

  /* ── 公開 API ── */
  global.BNLogoMenu = {
    attach: attach,
    openCropEditor: openCropEditor
  };

}(window));
