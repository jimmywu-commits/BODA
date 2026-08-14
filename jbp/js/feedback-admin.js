(function(){
'use strict';
var api, rows=[], unsubscribe=null;
function fmt(ts){
  if(!ts)return '-';
  var d=ts.toDate?ts.toDate():new Date(ts.seconds?ts.seconds*1000:ts);
  return d.toLocaleString('zh-TW',{hour12:false});
}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function render(){
  var q=(document.getElementById('search').value||'').trim().toLowerCase();
  var filter=document.getElementById('filter').value;
  var list=rows.filter(function(r){
    if(filter==='open'&&r.fixed)return false;
    if(filter==='fixed'&&!r.fixed)return false;
    if(!q)return true;
    return [r.name,r.company,r.email,r.summary].join(' ').toLowerCase().indexOf(q)>=0;
  });
  document.getElementById('count').textContent='共 '+list.length+' 筆';
  var body=document.getElementById('tbody');
  body.innerHTML=list.map(function(r){return '<tr class="'+(r.fixed?'is-fixed':'')+'">'
    +'<td><input class="fixed-box" type="checkbox" data-id="'+esc(r.id)+'" '+(r.fixed?'checked':'')+'></td>'
    +'<td>'+esc(fmt(r.createdAt))+'</td>'
    +'<td><strong>'+esc(r.name)+'</strong><div class="muted">'+esc(r.company||'')+'</div></td>'
    +'<td><a href="mailto:'+esc(r.email)+'">'+esc(r.email)+'</a></td>'
    +'<td class="summary">'+esc(r.summary).replace(/\n/g,'<br>')+'</td>'
    +'<td><button class="delete-btn" data-id="'+esc(r.id)+'">刪除</button></td>'
    +'</tr>';}).join('')||'<tr><td colspan="6" class="empty">目前沒有反饋資料</td></tr>';
}
function startRealtime(){
  if(unsubscribe)unsubscribe();
  var db=firebase.firestore();
  unsubscribe=db.collection(api.config.collectionName||'bn_feedback').orderBy('createdAt','desc').onSnapshot(function(snap){
    rows=snap.docs.map(function(d){var x=d.data();x.id=d.id;return x;});render();
    document.getElementById('mode').textContent='Firebase 雲端模式｜即時同步';
  },function(err){document.getElementById('mode').textContent='讀取失敗：'+err.message;});
}
function updateFixed(id,fixed){
  return firebase.firestore().collection(api.config.collectionName||'bn_feedback').doc(id).update({
    fixed:fixed,
    fixedAt:fixed?firebase.firestore.FieldValue.serverTimestamp():null,
    updatedAt:firebase.firestore.FieldValue.serverTimestamp()
  }).catch(function(err){alert('更新失敗：'+err.message);});
}
function removeRow(id){
  if(!confirm('確定刪除這筆反饋？'))return;
  firebase.firestore().collection(api.config.collectionName||'bn_feedback').doc(id).delete()
    .catch(function(err){alert('刪除失敗：'+err.message);});
}
function showLogin(message){
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('admin-app').classList.add('hidden');
  document.getElementById('login-error').textContent=message||'';
}
function showAdmin(user){
  if(!api.isAdminUid(user.uid)){showLogin('這個帳號沒有管理權限');return;}
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('admin-app').classList.remove('hidden');
  document.getElementById('mode').textContent='登入帳號：'+(user.email||user.uid);
  startRealtime();
}
function boot(){
  api=window.BNFeedback;
  if(!api.hasCloud()){showLogin('請先完成 js/feedback-config.js 的 Firebase 設定');return;}
  document.getElementById('search').addEventListener('input',render);
  document.getElementById('filter').addEventListener('change',render);
  document.getElementById('tbody').addEventListener('change',function(e){if(e.target.classList.contains('fixed-box'))updateFixed(e.target.dataset.id,e.target.checked);});
  document.getElementById('tbody').addEventListener('click',function(e){if(e.target.classList.contains('delete-btn'))removeRow(e.target.dataset.id);});
  document.getElementById('logout').addEventListener('click',function(){api.adminLogout().then(function(){showLogin('已登出');});});
  document.getElementById('login-form').addEventListener('submit',function(e){
    e.preventDefault();
    var submit=document.getElementById('login-submit'),error=document.getElementById('login-error');
    submit.disabled=true;error.textContent='登入中…';
    api.adminLogin(document.getElementById('admin-email').value.trim(),document.getElementById('admin-password').value)
      .then(showAdmin)
      .catch(function(err){showLogin('登入失敗：'+err.message);})
      .finally(function(){submit.disabled=false;});
  });
  api.initCloud().then(function(){
    firebase.auth().onAuthStateChanged(function(user){
      if(user&&api.isAdminUid(user.uid))showAdmin(user);else showLogin();
    });
  }).catch(function(err){showLogin('Firebase 初始化失敗：'+err.message);});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
