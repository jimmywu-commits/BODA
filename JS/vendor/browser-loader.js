/* Pinned browser-only dependencies. Local first; exact-version CDN on failure only. */
(function (root) {
  'use strict';
  if (root.BodaVendor) return;
  var current = document.currentScript;
  var base = new URL('.', current && current.src || new URL('../JS/vendor/browser-loader.js', document.baseURI).href).href;
  var pending = Object.create(null), styles = Object.create(null);
  var definitions = {
    konva: { file:'konva-9.3.22.min.js', remote:'https://unpkg.com/konva@9.3.22/konva.min.js', read:function(){ return root.Konva && typeof root.Konva.Stage === 'function' ? root.Konva : null; } },
    sheet: { file:'xlsx-0.18.5.full.min.js', remote:'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', read:function(){ return root.XLSX && typeof root.XLSX.read === 'function' ? root.XLSX : null; } },
    cropper: { file:'cropper-1.6.2.min.js', remote:'https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.js', css:'cropper-1.6.2.min.css', cssRemote:'https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.css', read:function(){ return typeof root.Cropper === 'function' ? root.Cropper : null; } }
  };
  function loadAsset(local, remote, css, validate) {
    function attempt(url) {
      return new Promise(function(resolve,reject) {
        var node=document.createElement(css ? 'link' : 'script'), settled=false;
        var timer=root.setTimeout(function(){ finish(new Error('載入逾時')); },15000);
        function finish(error) {
          if(settled)return;settled=true;root.clearTimeout(timer);
          node.onload=node.onerror=null;
          if(error){node.remove();reject(error);}else resolve();
        }
        if(css){node.rel='stylesheet';node.href=url;}else{node.async=true;node.src=url;}
        node.onload=function(){finish(validate && !validate() ? new Error('元件未正確初始化') : null);};
        node.onerror=function(){finish(new Error('檔案載入失敗'));};
        document.head.appendChild(node);
      });
    }
    return attempt(new URL(local,base).href).catch(function(){return attempt(remote);});
  }
  function ensure(name) {
    var definition=definitions[name];
    if(!definition)return Promise.reject(new Error('未知的瀏覽器元件：'+name));
    if(pending[name])return pending[name];
    var tasks=[];
    if(!definition.read())tasks.push(loadAsset(definition.file,definition.remote,false,definition.read));
    if(definition.css && !styles[definition.css]){
      tasks.push(loadAsset(definition.css,definition.cssRemote,true).then(function(){styles[definition.css]=true;}));
    }
    pending[name]=Promise.all(tasks).then(function(){return definition.read();}).catch(function(error){
      delete pending[name];throw new Error('無法載入 '+name+' 元件，請確認專案檔案或網路後重試。'+error.message);
    });
    return pending[name];
  }
  root.BodaVendor={ensure:ensure};
})(window);
