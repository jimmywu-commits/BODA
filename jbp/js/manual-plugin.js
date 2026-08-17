/* manual-plugin.js
 * Floating Manual Plugin
 * Usage: include <script src="manual-plugin.js"></script> before </body>.
 * Optional config before loading:
 * window.FloatingManualConfig = {
 *   imageUrl: 'manual.jpg',
 *   label: '說明書',
 *   buttonAriaLabel: '說明書',
 *   autoInit: true
 * };
 */
(function(){
  'use strict';

  var DEFAULTS = {
    imageUrl: 'https://github.com/jimmywu-commits/rd/blob/main/%E7%A8%8B%E5%BC%8F%E6%AA%94%E6%A1%88/floating_manual.jpg?raw=true',
    label: '說明書',
    buttonAriaLabel: '說明書',
    autoInit: true,
    ids: {
      button: 'manual-btn',
      overlay: 'manual-overlay',
      wrap: 'manual-wrap',
      close: 'manual-close',
      image: 'manual-img',
      style: 'manual-plugin-style'
    }
  };

  var state = { inited: false, config: null };

  function mergeConfig(userConfig){
    userConfig = userConfig || {};
    var ids = Object.assign({}, DEFAULTS.ids, userConfig.ids || {});
    return Object.assign({}, DEFAULTS, userConfig, { ids: ids });
  }

  function injectStyle(cfg){
    if(document.getElementById(cfg.ids.style)) return;
    var style = document.createElement('style');
    style.id = cfg.ids.style;
    style.textContent = `
#${cfg.ids.button}{
  position:fixed;
  right:18px;
  bottom:18px;
  z-index:999;
  width:74px;
  padding:10px 8px;
  border:none;
  border-radius:14px;
  background:rgba(13,16,24,.92);
  backdrop-filter:blur(10px);
  border:1px solid rgba(255,255,255,.22);
  color:rgba(255,255,255,.82);
  cursor:pointer;
  box-shadow:0 10px 28px rgba(0,0,0,.35);
  transition:.18s;
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:6px;
  font-family:inherit;
}
#${cfg.ids.button}:hover{
  transform:translateY(-2px) scale(1.03);
  border-color:#4a90e2;
  color:#fff;
}
#${cfg.ids.button} .manual-icon{
  width:34px;
  height:34px;
  stroke:currentColor;
  stroke-width:1.8;
  stroke-linecap:round;
  stroke-linejoin:round;
}
#${cfg.ids.button} .manual-label{
  font-size:10px;
  line-height:1.2;
  letter-spacing:.5px;
}
#${cfg.ids.overlay}{
  position:fixed;
  inset:0;
  z-index:9999;
  background:rgba(0,0,0,.82);
  display:none;
  align-items:flex-start;
  justify-content:center;
  overflow:auto;
  padding:28px;
  backdrop-filter:blur(4px);
}
#${cfg.ids.overlay}.manual-open{display:flex;}
#${cfg.ids.wrap}{
  position:relative;
  width:min(1400px,95vw);
}
#${cfg.ids.image}{
  width:100%;
  display:block;
  border-radius:18px;
  box-shadow:0 25px 80px rgba(0,0,0,.5);
}
#${cfg.ids.close}{
  position:fixed;
  top:18px;
  right:18px;
  width:54px;
  height:54px;
  border:none;
  border-radius:50%;
  background:#ff4d4f;
  color:#fff;
  font-size:30px;
  cursor:pointer;
  z-index:10000;
  box-shadow:0 8px 24px rgba(0,0,0,.35);
  font-family:inherit;
  line-height:54px;
}
`;
    document.head.appendChild(style);
  }

  function createManualDom(cfg){
    if(document.getElementById(cfg.ids.button) || document.getElementById(cfg.ids.overlay)) return;

    var button = document.createElement('button');
    button.id = cfg.ids.button;
    button.type = 'button';
    button.setAttribute('aria-label', cfg.buttonAriaLabel);
    button.innerHTML = `
  <svg class="manual-icon" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M7 6.5h11.5c3.6 0 6.5 2.9 6.5 6.5v12.5H12.5C9.5 25.5 7 23 7 20V6.5Z" />
    <path d="M7 6.5v18.8" />
    <path d="M12 11h8" />
    <path d="M12 15.5h7" />
    <path d="M12 20h5" />
  </svg>
  <div class="manual-label"></div>`;
    button.querySelector('.manual-label').textContent = cfg.label;

    var overlay = document.createElement('div');
    overlay.id = cfg.ids.overlay;
    overlay.innerHTML = `
  <div id="${cfg.ids.wrap}">
    <button id="${cfg.ids.close}" type="button" aria-label="關閉說明書">×</button>
    <img id="${cfg.ids.image}" alt="使用說明書">
  </div>`;
    overlay.querySelector('#' + cfg.ids.image).src = cfg.imageUrl;

    document.body.appendChild(button);
    document.body.appendChild(overlay);
  }

  function bindEvents(cfg){
    var button = document.getElementById(cfg.ids.button);
    var overlay = document.getElementById(cfg.ids.overlay);
    var wrap = document.getElementById(cfg.ids.wrap);
    var close = document.getElementById(cfg.ids.close);
    if(!button || !overlay || !wrap || !close) return;

    button.addEventListener('click', openManual);
    close.addEventListener('click', closeManual);
    overlay.addEventListener('click', closeManual);
    wrap.addEventListener('click', function(e){ e.stopPropagation(); });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape') closeManual();
    });
  }

  function openManual(){
    var cfg = state.config || mergeConfig(window.FloatingManualConfig);
    var overlay = document.getElementById(cfg.ids.overlay);
    if(overlay) overlay.classList.add('manual-open');
  }

  function closeManual(){
    var cfg = state.config || mergeConfig(window.FloatingManualConfig);
    var overlay = document.getElementById(cfg.ids.overlay);
    if(overlay) overlay.classList.remove('manual-open');
  }

  function init(userConfig){
    if(state.inited) return;
    var cfg = mergeConfig(userConfig || window.FloatingManualConfig);
    state.config = cfg;
    injectStyle(cfg);
    createManualDom(cfg);
    bindEvents(cfg);
    state.inited = true;
  }

  window.FloatingManualPlugin = {
    init: init,
    open: openManual,
    close: closeManual
  };

  // Keep backward compatibility with old inline onclick names.
  window.openManual = openManual;
  window.closeManual = closeManual;

  var cfg = mergeConfig(window.FloatingManualConfig);
  if(cfg.autoInit !== false){
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ init(cfg); });
    else init(cfg);
  }
})();
