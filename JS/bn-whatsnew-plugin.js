/* ============================================================
 * BN What's New Plugin — 版本更新說明
 * ------------------------------------------------------------
 * 資料來源：js/changelog.json（最新一筆放最前面，填法見該檔 _說明）。
 * 顯示規則：
 *   - localStorage 'jbp_whatsnew_seen' 記住「使用者已看過的最新 version」。
 *   - 頁面載入：最新 version > seen → 自動跳一次，列出所有沒看過的版本；
 *     關閉（×／知道了／Esc／點外面）就寫入 seen，同版本不再跳。
 *   - 第一次使用（沒有 seen）不跳，直接把目前版本記為已看過。
 *   - 工具列標題旁的版本號可隨時點開完整紀錄（手動開不影響 seen 以外的邏輯）。
 * ============================================================ */
(function(){
  'use strict';
  if(window._bnWhatsNew) return;

  var SRC = 'js/changelog.json';
  var SEEN_KEY = 'jbp_whatsnew_seen';
  var TYPE_LABEL = { 'new':'新功能', 'fix':'修正', 'tip':'提示' };

  var css = [
    '#bn-wn-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100070;align-items:center;justify-content:center;backdrop-filter:blur(3px)}',
    '#bn-wn-modal.show{display:flex}',
    '.bn-wn-box{background:#13161f;border:1px solid #252b3d;border-radius:14px;width:min(520px,92vw);max-height:80vh;display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.6);overflow:hidden;color:#e6e8ef;font-size:12px}',
    '.bn-wn-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #252b3d}',
    '.bn-wn-head h3{margin:0;font-size:14px;font-weight:700}',
    '.bn-wn-close{background:transparent;border:0;color:#8b949e;font-size:20px;cursor:pointer;line-height:1}',
    '.bn-wn-body{padding:6px 16px 12px;overflow:auto;min-height:0}',
    '.bn-wn-rel{padding:10px 0;border-bottom:1px solid #1c2333}',
    '.bn-wn-rel:last-child{border-bottom:0}',
    '.bn-wn-rel-head{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}',
    '.bn-wn-ver{font-size:11px;color:#58a6ff;font-weight:700;font-variant-numeric:tabular-nums}',
    '.bn-wn-title{font-size:13px;font-weight:700}',
    '.bn-wn-rel ul{margin:0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:5px}',
    '.bn-wn-rel li{display:flex;gap:8px;align-items:flex-start;line-height:1.55;color:#c9d1d9}',
    '.bn-wn-tag{flex-shrink:0;font-size:10px;padding:1px 6px;border-radius:4px;background:#1c2333;color:#8b949e;border:1px solid #30363d;margin-top:2px}',
    '.bn-wn-tag.new{color:#3fb950;border-color:rgba(63,185,80,.4)}',
    '.bn-wn-tag.fix{color:#f0883e;border-color:rgba(240,136,62,.4)}',
    '.bn-wn-tag.tip{color:#58a6ff;border-color:rgba(88,166,255,.4)}',
    '.bn-wn-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:1px solid #252b3d}',
    '.bn-wn-btn{padding:7px 16px;border-radius:7px;border:1px solid #1f6feb;background:#1f6feb;color:#fff;cursor:pointer;font-size:12px;font-weight:600}',
    '#bn-wn-open{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}',
    '#bn-wn-open:hover{color:#58a6ff}',
    '#bn-wn-open.unread::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:#f0883e;margin-right:5px;vertical-align:middle}'
  ].join('\n');
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var releases = [];
  var modal = null;

  function getSeen(){ try{ return localStorage.getItem(SEEN_KEY) || ''; }catch(_){ return ''; } }
  function setSeen(v){ try{ localStorage.setItem(SEEN_KEY, v); }catch(_){} }
  function latest(){ return releases.length ? String(releases[0].version) : ''; }
  function unseen(){ var s = getSeen(); return releases.filter(function(r){ return String(r.version) > s; }); }

  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  function renderRelease(r){
    var items = (r.items || []).map(function(it){
      var text = typeof it === 'string' ? it : (it && it.text) || '';
      var type = typeof it === 'object' && it && it.type ? String(it.type) : '';
      var tag = type && TYPE_LABEL[type] ? '<span class="bn-wn-tag '+esc(type)+'">'+esc(TYPE_LABEL[type])+'</span>' : '';
      return '<li>'+tag+'<span>'+esc(text)+'</span></li>';
    }).join('');
    return '<div class="bn-wn-rel"><div class="bn-wn-rel-head"><span class="bn-wn-ver">'+esc(r.version)+'</span><span class="bn-wn-title">'+esc(r.title || '')+'</span></div><ul>'+items+'</ul></div>';
  }

  function buildModal(){
    if(modal) return modal;
    modal = document.createElement('div');
    modal.id = 'bn-wn-modal';
    modal.innerHTML = '<div class="bn-wn-box"><div class="bn-wn-head"><h3 data-role="title">更新說明</h3><button class="bn-wn-close" data-act="close" title="關閉">×</button></div><div class="bn-wn-body" data-role="body"></div><div class="bn-wn-foot"><button class="bn-wn-btn" data-act="close">知道了</button></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function(e){
      if(e.target === modal || (e.target.getAttribute && e.target.getAttribute('data-act') === 'close')) close();
    });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && modal.classList.contains('show')) close(); });
    return modal;
  }

  /* list：要顯示的版本；title：視窗標題 */
  function open(list, title){
    buildModal();
    var body = modal.querySelector('[data-role="body"]');
    body.innerHTML = list.length ? list.map(renderRelease).join('') : '<div class="bn-wn-rel" style="color:#8b949e">目前沒有更新紀錄</div>';
    modal.querySelector('[data-role="title"]').textContent = title || '更新說明';
    modal.classList.add('show');
    body.scrollTop = 0;
  }
  function close(){
    if(!modal) return;
    modal.classList.remove('show');
    /* 不論自動跳或手動開，關掉就視為看過最新版 */
    if(latest()) setSeen(latest());
    updateBadge();
  }

  /* 右上角「版本更新說明」小字（jbpbn.html #tab-title 內的 #bn-wn-open）：
     點了開完整紀錄；有沒看過的版本時前面亮一顆橘點。 */
  function updateBadge(){
    var b = document.getElementById('bn-wn-open');
    if(!b) return;
    b.title = latest() ? '查看版本更新紀錄（目前 v' + latest() + '）' : '查看版本更新紀錄';
    b.classList.toggle('unread', unseen().length > 0);
  }
  function insertBadge(){
    var b = document.getElementById('bn-wn-open');
    if(!b || b.dataset.wnBound) return;
    b.dataset.wnBound = '1';
    b.addEventListener('click', function(){ open(releases, '更新紀錄'); });
    updateBadge();
  }

  function load(){
    return fetch(SRC + '?t=' + Date.now(), {cache:'no-store'}).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(data){
      var list = Array.isArray(data) ? data : (data && data.releases) || [];
      releases = list.filter(function(r){ return r && r.version; })
        .sort(function(a,b){ return String(b.version).localeCompare(String(a.version)); });
    });
  }

  function init(){
    load().then(function(){
      insertBadge();
      if(!releases.length) return;
      var seen = getSeen();
      if(!seen){ setSeen(latest()); updateBadge(); return; } /* 第一次使用：不跳 */
      var list = unseen();
      if(list.length) open(list, list.length > 1 ? '更新說明（有 '+list.length+' 個新版本）' : '更新說明');
    }).catch(function(err){
      console.warn('[bn-whatsnew] changelog 載入失敗', err);
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window._bnWhatsNew = {
    open: function(){ open(releases, '更新紀錄'); },
    reload: function(){ return load().then(updateBadge); },
    reset: function(){ try{ localStorage.removeItem(SEEN_KEY); }catch(_){} updateBadge(); }
  };
})();
