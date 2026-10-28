/* BODA 互動導覽 v1.1 / 2026-10-28
 * 無第三方依賴、無追蹤、無網路請求。動畫是隔離的示意，不呼叫上傳／匯出／寫入 API。
 * 導覽暫時切換 DOM 的可見頁籤；不呼叫 showView，不改 URL、本機暫存或工單狀態。
 */
(function () {
  'use strict';
  if (window.BODATour) return;
  var VERSION = '20261028-2';
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.8 8.5a2.5 2.5 0 0 1 4.7 1.2c0 1.8-2.5 2-2.5 3.8M12 17h.01"/></svg>';
  var POINTER = '<svg viewBox="0 0 22 28" fill="currentColor" stroke="#234736" stroke-width="1" aria-hidden="true"><path d="m3 2 16 14-8 1-4 8z"/></svg>';
  var FILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h5M9 12h6M9 16h6"/></svg>';
  var STEPS = [
    {id:'workflow',group:'認識工具',view:'home',target:'#home-workflow',title:'先選對你的工作入口',
      text:'還沒開工單，從<b>工單生成器</b>開始。已經拿到填好的試算表，就直接進<b>匯入工單</b>，完成後再延伸製作曝光資源與吸底。',
      tip:'這次導覽只展示操作位置，結束後會回到原本的頁面。',demo:'exposure'},
    {id:'level',group:'工單生成',view:'generator',target:'#palette-level',title:'先確認活動等級',
      text:'在「等級」下拉選擇這次的包套。不同等級會影響可用版位，以及 MSBN 可放的數量。',
      tip:'導覽不會替你更換等級，也不會刪除已排好的版位。',demo:'level'},
    {id:'categories',group:'工單生成',view:'generator',target:'#palette-tabs',title:'副區、MSBN 分類挑選',
      text:'先切換<b>副區</b>或 <b>MSBN</b>，再從素材庫挑選系列與款式。同一排的副區需符合系列規則；不相容的項目會反灰。',
      tip:'需要吸底時，另有獨立的吸底工具可用。',demo:'layout'},
    {id:'layout',group:'工單生成',view:'generator',target:['#stage','#canvas-area'],title:'把版位拖到畫布',
      text:'從左側素材庫拖入需要的版位，依畫面預覽確認排列順序。這裡是在規劃版配，還不是上傳商品圖。',
      tip:'示意動畫不會在你的實際畫布新增任何版位。',demo:'layout'},
    {id:'workorder',group:'工單生成',view:'generator',target:'#generator-actions',title:'下載工單，交給需求端填寫',
      text:'排好後按<b>下載工單</b>取得試算表。也可保存排版暫存檔，或下載 Demo 圖，方便之後繼續編輯與溝通。',
      tip:'填好工單後，再到「匯入工單」製作成品。',demo:'download'},
    {id:'import',group:'匯入與編輯',view:'import',target:'#import-drop',title:'STEP 1：匯入填好的工單',
      text:'將 <b>.xlsx 工單</b>拖到這個區塊，或點擊選檔。工具會依 <code>Layout_Output</code> 的欄位與版位，建立預覽畫布。',
      tip:'依這包版本的介面，試算表與圖片分成 STEP 1、STEP 2 上傳。',demo:'upload',ghost:'工單.xlsx'},
    {id:'images',group:'匯入與編輯',view:'import',target:['#import-img-drop','#import-img-section'],title:'STEP 2：整包圖片資料夾放進來',
      text:'把商品圖與 LOGO 資料夾拖進來，或按<b>選擇圖片資料夾</b>。圖片放在資料夾內的第二、第三層，也會向下讀取。',
      tip:'這裡的動畫只是示意，不會開啟選檔視窗或上傳檔案。',demo:'folder',ghost:'商品與LOGO資料夾'},
    {id:'matching',group:'匯入與編輯',view:'import',target:'#import-img-drop',title:'先讀工單，再依檔名找圖片',
      text:'工具會先判讀工單的圖片欄位，再尋找相符檔名。<b>一格多圖要用逗號分開</b>，每張都會獨立配對；副檔名可不同。',
      tip:'找不到圖時，先檢查欄位名稱、空白與逗號的分隔方式。',demo:'matching'},
    {id:'from-generator',group:'匯入與編輯',view:'import',target:'#import-generator-load',title:'也能直接使用剛排好的版配',
      text:'若先在工單生成器排版，可以按<b>載入工單生成器版配</b>，再在這裡編輯。這是另一條入口，不必為了導覽重新下載與匯入。',
      tip:'此按鈕會載入版配；導覽只標示它的位置，不會代你按下。',demo:'layout'},
    {id:'preview',group:'匯入與編輯',view:'import',target:'#import-canvas-area',title:'在中央畫布確認整張成品',
      text:'這裡會顯示副區、MSBN 與匯入的內容。上下捲動畫布逐一確認；工具列的<b>顯示比例</b>是預覽縮放，不等於商品本身的大小。',
      tip:'尚未匯入時看到空白提示是正常的，導覽不會灌入測試工單。',demo:'exposure'},
    {id:'text',group:'匯入與編輯',view:'import',target:['#import-fields-scroll','#import-canvas-tools'],title:'在右側調整文案與欄位',
      text:'選擇版位後，右側顯示相對應的文字與欄位。修改品名、促標、警語等內容時，留意該欄位的字數與行數規則。',
      tip:'目前沒有工單時，右側可能尚未列出實際欄位。',demo:'text'},
    {id:'image-tools',group:'匯入與編輯',view:'import',target:['#import-block-tools','#import-canvas-tools'],title:'商品、LOGO 分別編輯',
      text:'右側的圖片操作列提供<b>編輯、換圖、刪除與前後順序</b>。先確認選到的是哪一張素材，再進入編輯。',
      tip:'換圖與刪除都會變更實際內容，導覽不會執行這些操作。',demo:'resize'},
    {id:'transform',group:'匯入與編輯',view:'import',target:['#import-canvas-main','#import-canvas-area'],title:'拖曳縮放與任意角度旋轉',
      text:'在畫布點選商品圖，用四角控制點縮放，或拖曳上方 <b>↻</b> 任意旋轉；不是每按一次只能轉 90°。',
      tip:'動畫使用獨立示意商品，不會移動、縮放或旋轉你現有的圖片。',demo:'rotate'},
    {id:'shadow',group:'匯入與編輯',view:'import',target:'#import-shadow-panel',title:'調整商品影子的方向與位移',
      text:'調整光源、左右及上下位移；陰影色依實際畫布背景計算。若預覽未更新，可按<b>套用修改</b>重新處理。',
      tip:'處理多張圖片可能需要等待 Loading；導覽不會重製任何圖片。',demo:'shadow'},
    {id:'colors',group:'匯入與編輯',view:'import',target:'#import-color-section',title:'統一顏色，讓整組一致',
      text:'在這裡調整共用色，讓相關版位一起更新。背景色與<b>曝光資源雙向連動</b>；特定版位專用的顏色則在該版位工具內調整。',
      tip:'動畫只展示配色切換，不會改動目前色票。',demo:'colors'},
    {id:'exposure',group:'曝光與交付',frame:'exposure-frame',frameTargets:['#lv-wrap','#sidebar'],target:'.nav-item[data-view="exposure"]',title:'再延伸製作曝光資源',
      text:'從左側切到<b>曝光資源</b>，依等級選擇 BN、DDCARD、Search 等版位，並確認 LOGO、文案與商品圖。',
      tip:'若工具尚未載入，導覽先標示入口，不會為了展示而載入或重置你的資料。',demo:'exposure'},
    {id:'backgrounds',group:'曝光與交付',frame:'exposure-frame',frameTargets:['#bn-bg-open-btn','#bg-upload-btn','#section-bg'],target:'.nav-item[data-view="exposure"]',title:'背景圖庫與活動等級連動',
      text:'曝光資源中可選擇背景。<b>A 與四個 B+ 等級</b>應可使用完整圖庫；一般 B 維持類別模式。請先確認下拉等級，再挑選背景。',
      tip:'這是使用說明；導覽不會代改等級，也不會變更現有背景篩選規則。',demo:'colors'},
    {id:'bottom',group:'曝光與交付',frame:'bottom-standalone-frame',frameTargets:['#app','main'],target:'.nav-item[data-view="bottom"]',title:'有吸底需求，再編輯吸底工具',
      text:'工單有吸底內容時，可到<b>吸底工具</b>確認各顆的 LOGO、ICON、文字與狀態。工單原本沒有吸底時，不必額外製作。',
      tip:'請先由匯入工單載入資料，再確認吸底的預覽結果。',demo:'bottom'},
    {id:'restore',group:'曝光與交付',view:'import',target:'#btn-upload-snapshot',title:'暫存檔，讓下次可以接著做',
      text:'同一台瀏覽器有本機暫存；若要跨電腦或保留一份可還原的版本，請另外保存下載包中的 <b>JSON 暫存檔</b>。',
      tip:'「上傳暫存檔還原編輯」可載回先前內容；本機暫存不等於永久備份。',demo:'restore'},
    {id:'download',group:'曝光與交付',view:'import',target:'#btn-download-import-package',title:'確認完成，再一次下載交付',
      text:'按<b>下載工單＋圖片＋暫存檔</b>，輸出目前工單、圖片與可還原的編輯狀態。下載前再確認每個版位的文字、圖片與配色。',
      tip:'你已完成導覽！按「完成教學」會回到剛才的頁面與捲動位置，不會觸發下載。',demo:'download'}
  ];
  var ROUTES = {
    full:{label:'完整導覽 · 20 步',ids:STEPS.map(function(s){return s.id;})},
    generator:{label:'只看工單生成 · 5 步',ids:['workflow','level','categories','layout','workorder']},
    import:{label:'只看匯入與編輯 · 12 步',ids:['import','images','matching','from-generator','preview','text','image-tools','transform','shadow','colors','restore','download']},
    delivery:{label:'只看曝光與交付 · 5 步',ids:['exposure','backgrounds','bottom','restore','download']}
  };
  var root,card,focus,dim,hud,ghost,snapshot,steps=[],route='full',index=-1,active=false,paused=false;
  var frameRaf=0,restoreRaf=0,targetObserver=null,currentTarget=null;
  var pendingRoute='',waitingElement=null,waitingFocus=null,waitingTimer=0,waitingIdleTimer=0,waitingObserver=null;
  function html(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function $$(selector,doc){return Array.prototype.slice.call((doc||document).querySelectorAll(selector));}
  function visible(el){if(!el||!el.isConnected)return false;var r=el.getBoundingClientRect(),style=el.ownerDocument.defaultView.getComputedStyle(el);return r.width>2&&r.height>2&&style.visibility!=='hidden'&&style.display!=='none';}
  function safeFocus(el){if(el&&el.focus){try{el.focus({preventScroll:true});}catch(_){el.focus();}}}
  function isBusy(){
    if(window.APP_LOADING&&window.APP_LOADING.active===true)return true;
    var busy=document.getElementById('app-loading');
    if(!busy||!busy.classList.contains('show')||busy.getAttribute('aria-hidden')==='true')return false;
    var style=window.getComputedStyle(busy);
    return style.display!=='none'&&style.visibility!=='hidden';
  }
  function markGuideControls(container){
    $$('button',container).forEach(function(button){button.setAttribute('data-skip-app-loading','');});
  }
  function clearPendingStart(){
    pendingRoute='';
    clearTimeout(waitingTimer);waitingTimer=0;
    clearTimeout(waitingIdleTimer);waitingIdleTimer=0;
    if(waitingObserver){waitingObserver.disconnect();waitingObserver=null;}
    if(waitingElement){waitingElement.remove();waitingElement=null;}
    ['boda-tour-launch','boda-tour-home'].forEach(function(id){
      var button=document.getElementById(id);if(button)button.removeAttribute('aria-busy');
    });
    window.removeEventListener('keydown',onWaitingKey,true);
    window.removeEventListener('hashchange',cancelPendingStart,true);
    window.removeEventListener('popstate',cancelPendingStart,true);
    window.removeEventListener('focus',checkPendingStart);
    document.removeEventListener('visibilitychange',checkPendingStart);
    waitingFocus=null;
  }
  function cancelPendingStart(){
    var returnFocus=waitingFocus;
    clearPendingStart();
    if(visible(returnFocus))safeFocus(returnFocus);
  }
  function onWaitingKey(event){
    if(pendingRoute&&event.key==='Escape'){
      event.preventDefault();event.stopImmediatePropagation();cancelPendingStart();
    }
  }
  function checkPendingStart(){
    if(!pendingRoute)return;
    var busy=isBusy(),hidden=document.visibilityState==='hidden';
    if(waitingElement){
      var label=document.getElementById('app-loading-label'),percent=document.getElementById('app-loading-percent');
      var detail=waitingElement.querySelector('.bdt-wait-detail');
      var text=busy?'目前：'+(label&&label.textContent||'正在處理資料')+' '+(percent&&percent.textContent||''):'資料處理完成，正在準備導覽…';
      if(detail&&detail.textContent!==text)detail.textContent=text;
    }
    if(busy||hidden){
      clearTimeout(waitingIdleTimer);waitingIdleTimer=0;
    }else if(!waitingIdleTimer){
      /* Loading 消失後再穩定等候 220ms，避免下一個工作緊接著開始。 */
      waitingIdleTimer=setTimeout(function(){
        waitingIdleTimer=0;
        if(!pendingRoute||isBusy()||document.visibilityState==='hidden')return;
        var key=pendingRoute;
        var returnFocus=waitingElement&&waitingElement.contains(document.activeElement)?waitingFocus:null;
        clearPendingStart();
        beginTour(key,returnFocus);
      },220);
    }
    /* MutationObserver 以外保留低頻輪詢，載入模組不發事件時仍能開啟。 */
    if(!waitingTimer)waitingTimer=setTimeout(function(){waitingTimer=0;checkPendingStart();},200);
  }
  function queueStart(key){
    pendingRoute=key;
    if(!waitingElement){
      waitingFocus=document.activeElement;
      waitingElement=document.createElement('div');waitingElement.id='boda-tour-waiting';waitingElement.setAttribute('role','status');
      waitingElement.innerHTML='<span class="bdt-wait-spinner" aria-hidden="true"></span><div class="bdt-wait-copy"><b>已預約開始導覽</b><span>資料處理完成後會自動開啟，不用再按一次。</span><small class="bdt-wait-detail"></small></div><button type="button" data-skip-app-loading>取消等候</button>';
      document.body.appendChild(waitingElement);
      waitingElement.querySelector('button').addEventListener('click',cancelPendingStart);
      ['boda-tour-launch','boda-tour-home'].forEach(function(id){
        var button=document.getElementById(id);if(button)button.setAttribute('aria-busy','true');
      });
      var busy=document.getElementById('app-loading');
      if(window.MutationObserver&&busy){
        waitingObserver=new MutationObserver(checkPendingStart);
        waitingObserver.observe(busy,{attributes:true,childList:true,subtree:true,characterData:true});
      }
      window.addEventListener('keydown',onWaitingKey,true);
      window.addEventListener('hashchange',cancelPendingStart,true);
      window.addEventListener('popstate',cancelPendingStart,true);
      window.addEventListener('focus',checkPendingStart);
      document.addEventListener('visibilitychange',checkPendingStart);
    }
    checkPendingStart();
    return true;
  }
  function takeSnapshot(){
    var nodes=$$('.view,.nav-item'),scrolls=$$('#views [id],#views .view,#nav-rail');
    return {focus:document.activeElement,x:window.scrollX,y:window.scrollY,
      nodes:nodes.map(function(el){return {el:el,active:el.classList.contains('active')};}),
      scrolls:scrolls.map(function(el){return {el:el,x:el.scrollLeft,y:el.scrollTop};}),background:[]};
  }
  function isolateBackground(){
    Array.prototype.slice.call(document.body.children).forEach(function(el){
      if(el===root||/^(SCRIPT|STYLE|LINK)$/.test(el.tagName))return;
      snapshot.background.push({el:el,inert:el.getAttribute('inert'),aria:el.getAttribute('aria-hidden')});
      el.setAttribute('inert','');el.setAttribute('aria-hidden','true');
    });
  }
  function setView(name){
    if(!document.getElementById('view-'+name))return;
    $$('.view').forEach(function(el){el.classList.toggle('active',el.id==='view-'+name);});
    $$('.nav-item[data-view]').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-view')===name);});
  }
  function restore(){
    if(!snapshot)return;
    var saved=snapshot;snapshot=null;
    saved.nodes.forEach(function(s){if(s.el.isConnected)s.el.classList.toggle('active',s.active);});
    saved.background.forEach(function(s){
      if(s.inert===null)s.el.removeAttribute('inert');else s.el.setAttribute('inert',s.inert);
      if(s.aria===null)s.el.removeAttribute('aria-hidden');else s.el.setAttribute('aria-hidden',s.aria);
    });
    function scrollBack(){
      saved.scrolls.forEach(function(s){if(s.el.isConnected){s.el.scrollLeft=s.x;s.el.scrollTop=s.y;}});
      if(window.scrollX!==saved.x||window.scrollY!==saved.y)window.scrollTo(saved.x,saved.y);
    }
    scrollBack();
    restoreRaf=requestAnimationFrame(function(){restoreRaf=0;if(!active){scrollBack();if(visible(saved.focus))safeFocus(saved.focus);}});
  }
  function selection(){return '<span class="bdt-selection"><i></i><i></i><i></i><i></i></span>';}
  function product(rotate){return '<div class="bdt-product">'+selection()+(rotate?'<i class="bdt-rotate-handle">↻</i>':'')+'</div>';}
  function demo(type){
    var caption='<span class="bdt-demo-caption">操作示意 · 不影響目前內容</span>',body='';
    if(type==='upload'||type==='folder'||type==='restore'){
      var label=type==='folder'?'素材資料夾':type==='restore'?'編輯暫存.json':'工單.xlsx';
      body='<div class="bdt-demo-zone">拖曳到對應區域<small>放開即可讀取</small></div><div class="bdt-demo-file">'+label+'</div><div class="bdt-demo-cursor bdt-cursor-drag">'+POINTER+'</div><span class="bdt-demo-badge">✓ 已讀取</span>';
    }else if(type==='layout'){
      body='<div class="bdt-demo-zone"><i></i><i></i></div><div class="bdt-demo-file">MSBN</div><div class="bdt-demo-cursor bdt-cursor-drag">'+POINTER+'</div>';
    }else if(type==='matching'){
      body='<span>工單：商品A,商品B</span><span>逐張比對</span><span class="bdt-ok">✓ 商品A.png</span><span class="bdt-error">✕ 商品B 尚未找到</span>';
    }else if(type==='resize'||type==='rotate'||type==='shadow'){
      body='<div class="bdt-demo-board"><span class="bdt-product-shadow"></span>'+product(type==='rotate')+'</div>';
    }else if(type==='colors'){
      body='<i class="bdt-swatch"></i><i class="bdt-swatch"></i><i class="bdt-swatch"></i><i class="bdt-swatch"></i><div class="bdt-demo-cursor">'+POINTER+'</div>';
    }else if(type==='level'){
      body='<span class="bdt-level-pill">A / B+</span><span>→</span><span class="bdt-level-pill">依等級顯示版位</span>';
    }else if(type==='text'){
      body='<div class="bdt-demo-board"><div class="bdt-text-line">限時優惠開跑</div><small>在右側欄位編輯文案</small></div>';
    }else if(type==='bottom'){
      body='<span class="bdt-bottom-slot">主會場</span><span class="bdt-bottom-slot">品牌優惠</span><span class="bdt-bottom-slot">限時精選</span>';
    }else if(type==='download'){
      body='<span class="bdt-download-file">XLSX<br>工單</span><span class="bdt-download-file">PNG<br>成品圖</span><span class="bdt-download-file">JSON<br>暫存檔</span>';
    }else{
      body='<span class="bdt-exposure-tile">LOGO</span><span class="bdt-exposure-tile">BN 預覽</span><span class="bdt-exposure-tile">DDCARD</span>';
      type='exposure';
    }
    return '<div class="bdt-demo bdt-demo-'+type+'" aria-hidden="true">'+caption+body+'</div>';
  }
  function buildRoot(){
    root=document.createElement('div');root.id='boda-tour-root';root.hidden=true;root.tabIndex=-1;
    root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','boda-tour-title');
    root.innerHTML='<div class="bdt-dimmer" aria-hidden="true"></div><div class="bdt-focus" aria-hidden="true"></div>'+
      '<div class="bdt-hud"><strong>BODA 導覽</strong><span class="bdt-hud-note">教學模式 · 不會變更你的內容</span>'+
      '<button type="button" class="bdt-pause" data-action="pause" aria-pressed="false">暫停動畫</button>'+
      '<button type="button" class="bdt-icon-button" data-action="close" aria-label="關閉導覽">×</button></div>'+
      '<div class="bdt-ghost" hidden aria-hidden="true"></div><div class="bdt-host"></div>';
    markGuideControls(root);
    document.body.appendChild(root);focus=root.querySelector('.bdt-focus');dim=root.querySelector('.bdt-dimmer');hud=root.querySelector('.bdt-hud');ghost=root.querySelector('.bdt-ghost');
    root.addEventListener('click',function(event){
      var button=event.target.closest('[data-action]');if(!button||button.disabled)return;
      var action=button.getAttribute('data-action');
      if(action==='close')stop();
      else if(action==='start'){route=root.querySelector('.bdt-route-select').value;chooseRoute(route);go(0);}
      else if(action==='next'){if(index===steps.length-1)stop();else go(index+1);}
      else if(action==='prev')go(index-1);
      else if(action==='pause'){paused=!paused;root.dataset.paused=String(paused);button.setAttribute('aria-pressed',String(paused));button.textContent=paused?'播放動畫':'暫停動畫';}
    });
    root.addEventListener('change',function(event){if(event.target.classList.contains('bdt-jump'))go(Number(event.target.value));});
    root.addEventListener('wheel',function(event){if(!event.target.closest('.bdt-card,.bdt-welcome'))event.preventDefault();},{passive:false});
    root.addEventListener('touchmove',function(event){if(!event.target.closest('.bdt-card,.bdt-welcome'))event.preventDefault();},{passive:false});
  }
  function chooseRoute(key){
    route=ROUTES[key]?key:'full';
    steps=ROUTES[route].ids.map(function(id){return STEPS.filter(function(s){return s.id===id;})[0];});
    root.dataset.route=route;root.dataset.total=String(steps.length);
  }
  function welcome(){
    index=-1;currentTarget=null;focus.hidden=true;ghost.hidden=true;dim.hidden=false;
    root.dataset.screen='welcome';root.dataset.step='welcome';
    root.querySelector('.bdt-host').innerHTML='<section class="bdt-welcome"><div class="bdt-eyebrow">BODA / 互動操作導覽</div>'+
      '<h2 id="boda-tour-title">把工單，變成成品。</h2><p class="bdt-welcome-lead">跟著重點框選與動畫，認識從版配規劃到交付的操作。<br>第一次使用，先看一遍就有方向。</p>'+
      '<div class="bdt-welcome-path" aria-hidden="true"><div><b>1</b>規劃版配</div><span>→</span><div><b>2</b>匯入工單</div><span>→</span><div><b>3</b>編輯成品</div><span>→</span><div><b>4</b>下載交付</div></div>'+
      '<label class="bdt-route-label" for="boda-tour-route">想先了解哪一段？</label><select class="bdt-route-select" id="boda-tour-route">'+
      Object.keys(ROUTES).map(function(k){return '<option value="'+k+'"'+(route===k?' selected':'')+'>'+ROUTES[k].label+'</option>';}).join('')+'</select>'+
      '<div class="bdt-welcome-foot"><button type="button" class="bdt-skip" data-action="close">先不用，繼續工作</button><button type="button" class="bdt-primary" data-action="start">開始導覽 →</button></div>'+
      '<p class="bdt-safe"><b>放心看，不會改到作品。</b>不會寫入暫存、上傳檔案、改動素材或觸發下載；結束後回到原本頁面。下次可從左下角「使用教學」重新播放。</p></section>';
    markGuideControls(root);
    safeFocus(root.querySelector('[data-action="start"]'));
  }
  function resolve(step){
    var fallback=false,el=null,frame=null;
    if(step.frame){
      frame=document.getElementById(step.frame);
      try{
        var doc=frame&&frame.contentDocument;
        if(doc&&frame.getAttribute('src')){
          (step.frameTargets||[]).some(function(selector){var candidate=doc.querySelector(selector);if(candidate){el=candidate;return true;}return false;});
          if(el){setView(step.frame==='exposure-frame'?'exposure':'bottom');if(!visible(el))el=null;}
        }
      }catch(_){el=null;}
      if(!el){fallback=true;frame=null;setView('import');}
    }else setView(step.view);
    if(!el){
      var selectors=Array.isArray(step.target)?step.target:[step.target];
      selectors.some(function(selector){var candidate=document.querySelector(selector);if(visible(candidate)){el=candidate;return true;}return false;});
    }
    return {el:el,frame:frame,fallback:fallback};
  }
  function go(position){
    if(!active||position<0||position>=steps.length)return;
    index=position;var step=steps[index];
    if(targetObserver){targetObserver.disconnect();targetObserver=null;}
    currentTarget=resolve(step);
    if(currentTarget.el){
      try{currentTarget.el.scrollIntoView({behavior:'instant',block:'center',inline:'nearest'});}catch(_){}
      if(currentTarget.frame){try{currentTarget.frame.scrollIntoView({block:'nearest'});}catch(_){}}
    }
    root.dataset.screen='step';root.dataset.step=step.id;root.dataset.index=String(index+1);
    var fallback=currentTarget.fallback?'<p class="bdt-fallback">此工具尚未載入或無法直接框選，先以入口與動畫說明；不會替你載入測試內容。</p>':'';
    if(!currentTarget.el)fallback='<p class="bdt-fallback">目前頁面未顯示此操作區，先看動畫示意；可繼續下一步。</p>';
    root.querySelector('.bdt-host').innerHTML='<section class="bdt-card"><div class="bdt-card-content">'+
      '<div class="bdt-step-meta"><span>'+String(index+1).padStart(2,'0')+' / '+steps.length+'</span><span class="bdt-group">'+html(step.group)+'</span></div>'+
      '<h2 id="boda-tour-title">'+html(step.title)+'</h2><p class="bdt-description">'+step.text+'</p>'+
      demo(step.demo)+'<p class="bdt-tip">'+step.tip+'</p>'+fallback+
      '<div class="bdt-progress" role="progressbar" aria-label="導覽進度" aria-valuemin="0" aria-valuemax="'+steps.length+'" aria-valuenow="'+(index+1)+'"><span style="width:'+((index+1)/steps.length*100)+'%"></span></div>'+
      '<div class="bdt-controls"><button type="button" class="bdt-skip" data-action="close">跳過導覽</button><div class="bdt-controls-right">'+
      '<button type="button" class="bdt-secondary" data-action="prev"'+(index===0?' disabled':'')+'>上一步</button>'+
      '<button type="button" class="bdt-primary" data-action="next">'+(index===steps.length-1?'完成教學 ✓':'下一步 →')+'</button></div></div>'+
      '<select class="bdt-jump" aria-label="跳至教學步驟">'+steps.map(function(s,i){return '<option value="'+i+'"'+(index===i?' selected':'')+'>'+(i+1)+'. '+html(s.title)+'</option>';}).join('')+'</select></div></section>';
    markGuideControls(root);
    card=root.querySelector('.bdt-card');
    ghost.hidden=!step.ghost;
    if(step.ghost)ghost.innerHTML=FILE_ICON+'<span>'+html(step.ghost)+'</span>';
    layout();
    if(window.ResizeObserver&&currentTarget.el){
      targetObserver=new ResizeObserver(scheduleLayout);targetObserver.observe(currentTarget.el);
    }
    safeFocus(card.querySelector('[data-action="next"]'));
    scheduleLayout();
  }
  function rect(){
    if(!currentTarget||!visible(currentTarget.el))return null;
    var r=currentTarget.el.getBoundingClientRect();
    if(currentTarget.frame){
      var f=currentTarget.frame.getBoundingClientRect(),sx=f.width/(currentTarget.frame.offsetWidth||f.width),sy=f.height/(currentTarget.frame.offsetHeight||f.height);
      r={left:f.left+r.left*sx,top:f.top+r.top*sy,right:f.left+r.right*sx,bottom:f.top+r.bottom*sy};
    }
    var left=Math.max(8,r.left-6),top=Math.max(62,r.top-6),right=Math.min(window.innerWidth-8,r.right+6),bottom=Math.min(window.innerHeight-8,r.bottom+6);
    return right-left>5&&bottom-top>5?{left:left,top:top,right:right,bottom:bottom,width:right-left,height:bottom-top}:null;
  }
  function clamp(v,lo,hi){return Math.max(lo,Math.min(v,hi));}
  function layout(){
    if(!active||index<0||!card)return;
    var r=rect(),w=window.innerWidth,h=window.innerHeight,m=14,g=18,cw=Math.min(364,w-2*m);
    card.style.width=cw+'px';
    var ch=card.offsetHeight||420;
    if(r){
      dim.hidden=true;focus.hidden=false;
      focus.style.left=r.left+'px';focus.style.top=r.top+'px';focus.style.width=r.width+'px';focus.style.height=r.height+'px';
    }else{focus.hidden=true;dim.hidden=false;}
    var candidates=r?[
      {x:r.right+g,y:r.top},
      {x:r.left-cw-g,y:r.top},
      {x:r.left+(r.width-cw)/2,y:r.bottom+g},
      {x:r.left+(r.width-cw)/2,y:r.top-ch-g}
    ]:[{x:(w-cw)/2,y:(h-ch)/2}];
    var best=null,bestScore=Infinity;
    candidates.forEach(function(p){
      var x=clamp(p.x,m,w-cw-m),y=clamp(p.y,66,h-ch-m);
      var overlap=r?Math.max(0,Math.min(x+cw,r.right)-Math.max(x,r.left))*Math.max(0,Math.min(y+ch,r.bottom)-Math.max(y,r.top)):0;
      var score=overlap*10+Math.abs(x-p.x)+Math.abs(y-p.y);
      if(score<bestScore){bestScore=score;best={x:x,y:y};}
    });
    card.style.left=best.x+'px';card.style.top=best.y+'px';
    if(!ghost.hidden&&r){
      ghost.style.left=clamp(r.left+r.width*.48,90,w-220)+'px';
      ghost.style.top=clamp(r.top+r.height*.45,90,h-70)+'px';
    }else if(!r)ghost.hidden=true;
  }
  function scheduleLayout(){if(!active||frameRaf)return;frameRaf=requestAnimationFrame(function(){frameRaf=0;layout();});}
  function onKey(event){
    if(!active)return;
    event.stopImmediatePropagation();
    if(event.key==='Escape'){event.preventDefault();stop();return;}
    var select=event.target.tagName==='SELECT';
    if(!select&&index>=0&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
      if(event.key==='ArrowRight'){event.preventDefault();if(index===steps.length-1)stop();else go(index+1);return;}
      if(event.key==='ArrowLeft'){event.preventDefault();if(index>0)go(index-1);return;}
    }
    if(event.key==='Tab'){
      var controls=$$('button:not(:disabled),select',root).filter(visible);
      var first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){event.preventDefault();safeFocus(last);}
      else if(!event.shiftKey&&(document.activeElement===last||!root.contains(document.activeElement))){event.preventDefault();safeFocus(first);}
    }
  }
  function onFocus(event){if(active&&!root.contains(event.target))safeFocus(root.querySelector('[data-action="next"],[data-action="start"]'));}
  function onLocation(){if(active)stop();}
  function start(key){
    if(active)return false;
    key=ROUTES[key]?key:'full';
    if(isBusy())return queueStart(key);
    clearPendingStart();
    return beginTour(key);
  }
  function beginTour(key,returnFocus){
    if(active)return false;
    if(restoreRaf){cancelAnimationFrame(restoreRaf);restoreRaf=0;}
    if(!root)buildRoot();
    snapshot=takeSnapshot();active=true;paused=false;root.dataset.paused='false';
    if(visible(returnFocus))snapshot.focus=returnFocus;
    root.querySelector('[data-action="pause"]').setAttribute('aria-pressed','false');
    root.querySelector('[data-action="pause"]').textContent='暫停動畫';
    chooseRoute(key);root.hidden=false;safeFocus(root);isolateBackground();welcome();
    window.addEventListener('keydown',onKey,true);
    window.addEventListener('focusin',onFocus,true);
    window.addEventListener('resize',scheduleLayout);
    window.addEventListener('scroll',scheduleLayout,true);
    window.addEventListener('hashchange',onLocation,true);
    window.addEventListener('popstate',onLocation,true);
    return true;
  }
  function stop(){
    if(pendingRoute)cancelPendingStart();
    if(!active)return;
    active=false;
    if(frameRaf){cancelAnimationFrame(frameRaf);frameRaf=0;}
    if(targetObserver){targetObserver.disconnect();targetObserver=null;}
    window.removeEventListener('keydown',onKey,true);
    window.removeEventListener('focusin',onFocus,true);
    window.removeEventListener('resize',scheduleLayout);
    window.removeEventListener('scroll',scheduleLayout,true);
    window.removeEventListener('hashchange',onLocation,true);
    window.removeEventListener('popstate',onLocation,true);
    root.hidden=true;currentTarget=null;card=null;index=-1;
    root.querySelector('.bdt-host').innerHTML='';
    restore();
  }
  function mount(){
    var rail=document.getElementById('nav-rail');
    if(rail&&!document.getElementById('boda-tour-launch')){
      var launch=document.createElement('button');launch.id='boda-tour-launch';launch.className='boda-tour-launch';launch.type='button';launch.title='開始 BODA 操作導覽';launch.setAttribute('aria-haspopup','dialog');
      launch.setAttribute('data-skip-app-loading','');
      launch.innerHTML=ICON+'<span>使用教學</span>';launch.addEventListener('click',function(){start('full');});rail.appendChild(launch);
    }
    var home=document.getElementById('home-head');
    if(home&&!document.getElementById('boda-tour-home')){
      var button=document.createElement('button');button.id='boda-tour-home';button.type='button';button.className='boda-tour-home';button.setAttribute('aria-haspopup','dialog');button.innerHTML=ICON+'<span>開始導覽</span>';
      button.setAttribute('data-skip-app-loading','');
      button.addEventListener('click',function(){start('full');});home.appendChild(button);
    }
  }
  window.BODATour={version:VERSION,start:start,stop:stop,isActive:function(){return active;},isPending:function(){return !!pendingRoute;}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
