/* 全站支援按鈕設定：config.json 是 GitHub 部署後所有設備共用的唯一來源。
   後台可先預覽；真正發布時下載／更新根目錄 config.json，再 commit + push。 */
(function(){
  'use strict';
  var DEFAULTS={feedbackUrl:'',manualUrl:''};
  var shared=Object.assign({},DEFAULTS);
  var preview=null;
  var script=document.currentScript;
  var configUrl='config.json';
  try{
    if(script&&script.src) configUrl=new URL('../../config.json',script.src).href;
  }catch(_){ }

  function clean(source){
    source=source&&typeof source==='object'?source:{};
    return {
      feedbackUrl:typeof source.feedbackUrl==='string'?source.feedbackUrl.trim():'',
      manualUrl:typeof source.manualUrl==='string'?source.manualUrl.trim():''
    };
  }
  function get(){return Object.assign({},preview||shared);}
  function notify(){
    try{window.dispatchEvent(new CustomEvent('boda-help-settings-changed',{detail:get()}));}catch(_){ }
  }
  function set(partial){
    preview=Object.assign({},get(),clean(partial));
    notify();
    return get();
  }
  function resetPreview(){preview=null;notify();return get();}
  function open(url){if(url) window.open(url,'_blank','noopener');}
  function bindFloatingButtons(){
    var feedback=document.getElementById('feedback-btn');
    var manual=document.getElementById('manual-btn');
    if(feedback&&!feedback.dataset.bodaHelpBound){
      feedback.dataset.bodaHelpBound='1';
      feedback.addEventListener('click',function(event){
        var url=get().feedbackUrl;
        if(!url) return;
        event.preventDefault();event.stopImmediatePropagation();open(url);
      },true);
    }
    if(manual&&!manual.dataset.bodaHelpBound){
      manual.dataset.bodaHelpBound='1';
      manual.addEventListener('click',function(event){
        var url=get().manualUrl;
        if(!url) return;
        event.preventDefault();event.stopImmediatePropagation();open(url);
      },true);
    }
  }
  function loadConfig(){
    if(typeof fetch!=='function') return Promise.resolve(get());
    return fetch(configUrl,{cache:'no-store'}).then(function(response){
      if(!response.ok) throw new Error('config.json 讀取失敗');
      return response.json();
    }).then(function(config){
      shared=Object.assign({},DEFAULTS,clean(config&&config.helpLinks));
      notify();bindFloatingButtons();
      return get();
    }).catch(function(){return get();});
  }
  function buildConfig(partial){
    var next=Object.assign({},get(),clean(partial));
    return fetch(configUrl,{cache:'no-store'}).then(function(response){
      if(!response.ok) throw new Error('config.json 讀取失敗');
      return response.json();
    }).catch(function(){return {};}).then(function(config){
      config=config&&typeof config==='object'?config:{};
      config.helpLinks=next;
      return config;
    });
  }
  function downloadConfig(partial){
    return buildConfig(partial).then(function(config){
      var blob=new Blob([JSON.stringify(config,null,2)+'\n'],{type:'application/json'});
      var url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='config.json';document.body.appendChild(a);a.click();a.remove();
      setTimeout(function(){URL.revokeObjectURL(url);},1500);
      return config;
    });
  }

  var ready=loadConfig();
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bindFloatingButtons,{once:true});
  else bindFloatingButtons();
  window.BODAHelpSettings={get:get,set:set,resetPreview:resetPreview,ready:ready,configUrl:configUrl,buildConfig:buildConfig,downloadConfig:downloadConfig};
})();
