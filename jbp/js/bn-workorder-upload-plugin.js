/*
 * bn-workorder-upload-plugin.js
 * 工單上傳外掛：讀取 xlsx 工單，自動勾選排版與匯入文字內容。
 * 需求規則：
 * 1) 找到「版位」欄，讀取下面出現的版位（例：DD Card BN (APP)、Mall HBN、SCBN(商城Collection)）
 * 2) 找到「規範字數」欄，將「廠商名稱 / 主標 / 副標 / 日期/警語」右側欄位文案倒入左側文字內容
 * 3) 倒入後同步畫布預覽
 */
(function(global){
  'use strict';

  var XLSX_URLS = [
    'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
  ];

  var STATUS_ID = 'bn-workorder-status';
  var INPUT_ID = 'bn-workorder-file';

  function $(id){ return document.getElementById(id); }

  function toast(msg, type, duration){
    if(global._bnStatePlugin && typeof global._bnStatePlugin.toast === 'function'){
      global._bnStatePlugin.toast(msg, type || 'ok', duration || 2600);
    } else {
      console.log('[工單上傳]', msg);
    }
  }

  function setStatus(msg, kind){
    var el = $(STATUS_ID);
    if(!el) return;
    el.textContent = msg || '';
    el.className = 'bn-workorder-status' + (kind ? ' ' + kind : '');
  }

  function loadScriptOnce(src){
    return new Promise(function(resolve, reject){
      var existed = document.querySelector('script[data-bn-workorder-xlsx="' + src + '"]');
      if(existed){
        existed.addEventListener('load', resolve, {once:true});
        existed.addEventListener('error', reject, {once:true});
        if(global.XLSX) resolve();
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.bnWorkorderXlsx = src;
      s.onload = resolve;
      s.onerror = function(){ reject(new Error('無法載入 XLSX parser')); };
      document.head.appendChild(s);
    });
  }

  function ensureXLSX(){
    if(global.XLSX && global.XLSX.read) return Promise.resolve(global.XLSX);
    var chain = Promise.reject();
    XLSX_URLS.forEach(function(url){
      chain = chain.catch(function(){ return loadScriptOnce(url); });
    });
    return chain.then(function(){
      if(!global.XLSX || !global.XLSX.read) throw new Error('XLSX parser not found');
      return global.XLSX;
    });
  }

  function cellText(v){
    if(v === null || v === undefined) return '';
    if(typeof v === 'number') return String(v);
    return String(v).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  }

  function norm(s){
    return cellText(s).toLowerCase()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[()（）\[\]【】_\-\/\\:：,，.。]/g, '');
  }


  var BLOCKED_WORKORDER_SHEET_NAMES = [
    '包套表',
    '對照表',
    '發單前請詳閱規範',
    'jbp做圖公版參考'
  ];

  function isBlockedWorkorderSheetName(sheetName){
    var name = norm(sheetName);
    if(!name) return false;
    return BLOCKED_WORKORDER_SHEET_NAMES.some(function(blocked){
      var key = norm(blocked);
      return key && (name.indexOf(key) !== -1 || key.indexOf(name) !== -1);
    });
  }

  function findHeader(rows, keyword){
    var key = norm(keyword);
    for(var r = 0; r < rows.length; r++){
      for(var c = 0; c < (rows[r] || []).length; c++){
        if(norm(rows[r][c]) === key || norm(rows[r][c]).indexOf(key) !== -1){
          return {row:r, col:c};
        }
      }
    }
    return null;
  }

  function rowHasAnyHeader(row, keywords){
    row = row || [];
    return keywords.some(function(keyword){
      var key = norm(keyword);
      return row.some(function(cell){
        var n = norm(cell);
        return n === key || n.indexOf(key) !== -1;
      });
    });
  }

  function findLayoutHeader(rows){
    var candidates = [];
    for(var r = 0; r < rows.length; r++){
      var row = rows[r] || [];
      for(var c = 0; c < row.length; c++){
        var n = norm(row[c]);
        if(n === '版位'){
          var score = 100;
          if(rowHasAnyHeader(row, ['張數','尺寸','檔案格式','規範字數','內容','CTA','Check'])) score += 40;
          if(rowHasAnyHeader(rows[r + 1] || [], ['主標','副標','LOGO','公版編號'])) score += 10;
          candidates.push({row:r, col:c, score:score});
        }
      }
    }
    if(candidates.length){
      candidates.sort(function(a,b){ return b.score - a.score; });
      return {row:candidates[0].row, col:candidates[0].col};
    }
    return null;
  }

  function detectLayoutType(text){
    var n = norm(text);
    if(!n) return null;
    if(n.indexOf('ddcardbnapp') !== -1 || n.indexOf('ddcard') !== -1 || n.indexOf('ddcardbn') !== -1) return 'ddcard';
    if(n.indexOf('mallhbn') !== -1 || n === 'hbn' || n.indexOf('hbn') !== -1) return 'hbn';
    if(n.indexOf('scbn') !== -1 || n.indexOf('商城collection') !== -1 || n.indexOf('collection') !== -1) return 'scbn';
    return null;
  }

  function scanAppearedLayoutTypes(rows){
    var header = findLayoutHeader(rows);
    var found = {ddcard:false, hbn:false, scbn:false};
    var raw = [];
    if(!header){
      for(var rr=0; rr<rows.length; rr++){
        var row = rows[rr] || [];
        for(var cc=0; cc<row.length; cc++){
          var value2 = cellText(row[cc]);
          if(!value2) continue;
          var type2 = detectLayoutType(value2);
          if(type2){
            found[type2] = true;
            raw.push(value2);
          }
        }
      }
      return {types:found, raw:raw, header:null};
    }

    for(var r = header.row + 1; r < rows.length; r++){
      var value = cellText((rows[r] || [])[header.col]);
      if(!value) continue;
      var type = detectLayoutType(value);
      if(type){
        found[type] = true;
        raw.push(value);
      }
    }
    return {types:found, raw:raw, header:header};
  }

  function getRightValue(row, col){
    row = row || [];
    for(var c = col + 1; c < Math.min(row.length, col + 6); c++){
      var v = cellText(row[c]);
      if(v) return v;
    }
    return '';
  }

  function scanCopy(rows){
    var spec = findHeader(rows, '規範字數');
    var start = spec ? spec.row + 1 : 0;
    var result = {brand:'', main:'', sub:'', date:''};

    for(var r = start; r < rows.length; r++){
      var row = rows[r] || [];
      for(var c = 0; c < row.length; c++){
        var raw = cellText(row[c]);
        var n = norm(raw);
        if(!raw) continue;
        if(!result.brand && (n.indexOf('廠商名稱') !== -1 || n.indexOf('廠商名') !== -1)){
          result.brand = getRightValue(row, c);
        } else if(!result.main && n.indexOf('主標') !== -1){
          result.main = getRightValue(row, c);
        } else if(!result.sub && n.indexOf('副標') !== -1){
          result.sub = getRightValue(row, c);
        } else if(!result.date && (n.indexOf('日期警語') !== -1 || n.indexOf('日期') !== -1 || n.indexOf('警語') !== -1)){
          result.date = getRightValue(row, c);
        }
      }
    }
    return result;
  }


  function parsePublicTemplateCode(text){
    var s = cellText(text)
      .replace(/[＿]/g, '_')
      .replace(/[－—–]/g, '-')
      .replace(/\u00a0/g, ' ');
    if(!s) return null;

    /* 支援：
       EL-9 / EL_09 / EL 09 / EL09
       FMCG-10
       Fashion-12 / Fashion-Mockup-28 / Fashion Mockup 28
       Lifestyle-3
    */
    var m = s.match(/\b(EL|FMCG|Fashion|Lifestyle)\s*[-_ ]?\s*(?:Mock\s*up|Mockup)?\s*[-_ ]?\s*0*(\d{1,3})\b/i);
    if(!m) return null;
    var rawCat = m[1].toLowerCase();
    var catMap = { el:'EL', fmcg:'FMCG', fashion:'Fashion', lifestyle:'Lifestyle' };
    var cat = catMap[rawCat] || m[1];
    var num = parseInt(m[2], 10);
    return { category: cat, number: num, code: cat + '-' + num, raw: m[0] };
  }

  function isPublicTemplateHeader(v){
    var n = norm(v);
    if(!n) return false;
    return n.indexOf('公版編號') !== -1 ||
           n.indexOf('指定公版編號') !== -1 ||
           n.indexOf('請選公版') !== -1 ||
           n === '公版' ||
           n.indexOf('mockup') !== -1;
  }

  function findPublicTemplateHeaders(rows){
    var headers = [];
    for(var r = 0; r < rows.length; r++){
      var row = rows[r] || [];
      for(var c = 0; c < row.length; c++){
        if(isPublicTemplateHeader(row[c])) headers.push({row:r, col:c});
      }
    }
    return headers;
  }

  function pushCandidate(candidates, value, score){
    var text = cellText(value);
    if(!text) return;
    candidates.push({text:text, score:score || 0});
  }

  function scanPublicTemplateCode(rows){
    var candidates = [];
    var headers = findPublicTemplateHeaders(rows);

    /* 優先抓關鍵字同格、右邊欄位、下方附近欄位。 */
    headers.forEach(function(header){
      for(var dr = -1; dr <= 6; dr++){
        var rr = header.row + dr;
        if(rr < 0 || rr >= rows.length) continue;
        var row = rows[rr] || [];
        for(var dc = 0; dc <= 8; dc++){
          var cc = header.col + dc;
          if(cc < 0 || cc >= row.length) continue;
          var score = 100 - Math.abs(dr) * 6 - dc;
          if(dr === 0 && dc === 0) score += 8;
          if(dr === 0 && dc > 0) score += 12;
          if(dr > 0 && dc === 0) score += 6;
          pushCandidate(candidates, row[cc], score);
        }
      }
    });

    /* fallback：整張工單找 EL/FMCG/Fashion/Lifestyle + 編號，避免欄位名稱變體漏抓。 */
    for(var r = 0; r < rows.length; r++){
      var row2 = rows[r] || [];
      for(var c = 0; c < row2.length; c++){
        pushCandidate(candidates, row2[c], 1);
      }
    }

    candidates.sort(function(a,b){ return b.score - a.score; });
    for(var i = 0; i < candidates.length; i++){
      var parsed = parsePublicTemplateCode(candidates[i].text);
      if(parsed) return parsed;
    }
    return null;
  }

  function applyPublicTemplateBackground(publicCode){
    if(!publicCode || !publicCode.code) return;
    function run(){
      if(global.BNBgLibrary && typeof global.BNBgLibrary.applyByCode === 'function'){
        global.BNBgLibrary.applyByCode(publicCode.code).then(function(ok){
          if(ok) toast('已依公版編號套用背景：' + publicCode.code, 'ok', 2600);
        });
      }else{
        toast('已偵測公版編號 ' + publicCode.code + '，但背景圖庫外掛尚未載入', 'err', 3200);
      }
    }
    /* renderPreviews 會重建 iframe，稍等 iframe ready 後再套背景。 */
    setTimeout(run, 900);
  }

  function countCopyFields(copy){
    var n = 0;
    if(copy && copy.brand) n++;
    if(copy && copy.main) n++;
    if(copy && copy.sub) n++;
    if(copy && copy.date) n++;
    return n;
  }

  function countLayoutTypes(types){
    var n = 0;
    Object.keys(types || {}).forEach(function(k){ if(types[k]) n++; });
    return n;
  }

  function scoreSheetCandidate(candidate, index){
    var rows = candidate.rows || [];
    var layoutResult = scanAppearedLayoutTypes(rows);
    var copy = scanCopy(rows);
    var publicCode = scanPublicTemplateCode(rows);
    var specHeader = findHeader(rows, '規範字數');
    var layoutCount = countLayoutTypes(layoutResult.types);
    var copyCount = countCopyFields(copy);
    var score = 0;

    if(specHeader) score += 35;
    if(layoutResult.header) score += 22;
    score += layoutCount * 12;
    score += copyCount * 18;
    if(copy && copy.brand) score += 10;
    if(copy && copy.main && copy.sub && copy.main !== copy.sub) score += 8;
    if(publicCode) score += 28;

    /* 如果只抓到相同 CTA 文案，通常是總覽或錯誤區塊，降低優先順序。 */
    if(copy && copy.main && copy.sub && copy.main === copy.sub) score -= 18;
    if(copyCount === 0 && layoutCount === 0 && !publicCode) score -= 40;

    /* 同分時仍保留原始分頁順序，符合最新資料通常在前面的習慣。 */
    score -= index * 0.01;

    candidate.layoutResult = layoutResult;
    candidate.copy = copy;
    candidate.publicCode = publicCode;
    candidate.score = score;
    return candidate;
  }

  function rowsFromWorkbook(wb){
    if(!wb.SheetNames || !wb.SheetNames.length) throw new Error('找不到工作表');
    var readableSheetNames = wb.SheetNames.filter(function(sheetName){
      return !isBlockedWorkorderSheetName(sheetName);
    });
    if(!readableSheetNames.length) throw new Error('找不到可讀取的工作表：所有頁籤都被排除');

    var candidates = readableSheetNames.map(function(sheetName, idx){
      var sheet = wb.Sheets[sheetName];
      var rows = global.XLSX.utils.sheet_to_json(sheet, {header:1, defval:'', raw:false});
      return scoreSheetCandidate({sheetName:sheetName, rows:rows}, idx);
    }).filter(function(c){ return c.rows && c.rows.length; });

    if(!candidates.length) throw new Error('找不到可讀取的工作表');
    candidates.sort(function(a,b){ return b.score - a.score; });
    var best = candidates[0];

    /* 若所有分頁都沒有明確欄位，才退回第一個分頁。 */
    if(best.score < 10){
      best = candidates.sort(function(a,b){ return readableSheetNames.indexOf(a.sheetName) - readableSheetNames.indexOf(b.sheetName); })[0];
    }
    return best;
  }

  function layoutMatchesType(layout, type){
    var n = norm((layout.name || '') + ' ' + (layout.file || ''));
    if(type === 'ddcard') return n.indexOf('ddcard') !== -1;
    if(type === 'hbn') return n.indexOf('hbn') !== -1;
    if(type === 'scbn') return n.indexOf('scbn') !== -1;
    return false;
  }

  function rerenderLayoutSelection(){
    if(typeof global.renderChecks === 'function') global.renderChecks();
    if(typeof global.renderPreviews === 'function') global.renderPreviews();
    /* renderChecks/renderPreviews 有時會在工單匯入與 iframe 重建的同一輪事件中被呼叫，
       多補兩次可以避免右側短暫停在「請在左側勾選排版」。 */
    setTimeout(function(){
      if(typeof global.renderChecks === 'function') global.renderChecks();
      if(typeof global.renderPreviews === 'function') global.renderPreviews();
    }, 60);
    setTimeout(function(){
      if(typeof global.renderPreviews === 'function') global.renderPreviews();
    }, 220);
  }

  function hasAnyRequestedLayoutType(types){
    return Object.keys(types || {}).some(function(k){ return !!types[k]; });
  }

  function keepExistingOrDefaultSelection(layouts){
    if(!global.checked) global.checked = {};
    layouts.forEach(function(l){
      /* checked 沒有記錄時，BN 原本規則就是預設勾選。 */
      if(!(l.id in global.checked)) global.checked[l.id] = true;
    });
    rerenderLayoutSelection();
  }

  function applyLayouts(types){
    if(typeof global.loadLayouts !== 'function') return {matched:0, selectedNames:[], preserved:true};
    var layouts = global.loadLayouts().filter(function(l){ return l.enabled; });
    if(!global.checked) global.checked = {};
    var selectedNames = [];
    var matched = 0;
    var hasRequestedTypes = hasAnyRequestedLayoutType(types);

    /* 沒有從工單抓到版位時，不要把所有排版都取消勾選。
       之前右側會顯示「請在左側勾選排版」，就是因為這裡把 checked 全部設成 false。 */
    if(!hasRequestedTypes){
      keepExistingOrDefaultSelection(layouts);
      return {matched:0, selectedNames:selectedNames, preserved:true};
    }

    layouts.forEach(function(l){
      var shouldCheck = false;
      Object.keys(types).forEach(function(type){
        if(types[type] && layoutMatchesType(l, type)) shouldCheck = true;
      });
      if(shouldCheck){ matched++; selectedNames.push(l.name || l.file || String(l.id)); }
    });

    /* 工單有版位字樣，但目前排版清單沒有對應項目時，也不要清空畫布。 */
    if(!matched){
      keepExistingOrDefaultSelection(layouts);
      return {matched:0, selectedNames:selectedNames, preserved:true};
    }

    layouts.forEach(function(l){
      var shouldCheck = false;
      Object.keys(types).forEach(function(type){
        if(types[type] && layoutMatchesType(l, type)) shouldCheck = true;
      });
      global.checked[l.id] = shouldCheck;
    });

    rerenderLayoutSelection();
    return {matched:matched, selectedNames:selectedNames, preserved:false};
  }

  function setInputValue(id, value){
    var el = $(id);
    if(el && value){
      el.value = value;
      el.dispatchEvent(new Event('input', {bubbles:true}));
    }
  }

  function applyCopy(copy){
    setInputValue('txt-brand', copy.brand);
    setInputValue('txt-main', copy.main);
    setInputValue('txt-sub', copy.sub);
    setInputValue('txt-date', copy.date);
    if(typeof global.broadcastText === 'function') global.broadcastText();
    try{ document.dispatchEvent(new CustomEvent('bn-state-dirty')); }catch(_){}
  }

  function handleFile(file){
    if(!file) return;
    setStatus('讀取中…', 'loading');
    ensureXLSX()
      .then(function(){ return file.arrayBuffer(); })
      .then(function(buf){
        var wb = global.XLSX.read(buf, {type:'array'});
        var parsed = rowsFromWorkbook(wb);
        var layoutResult = parsed.layoutResult || scanAppearedLayoutTypes(parsed.rows);
        var copy = parsed.copy || scanCopy(parsed.rows);
        var publicCode = parsed.publicCode || scanPublicTemplateCode(parsed.rows);
        var appliedLayouts = applyLayouts(layoutResult.types);
        applyCopy(copy);
        applyPublicTemplateBackground(publicCode);

        var importedText = [];
        if(copy.brand) importedText.push('品牌名');
        if(copy.main) importedText.push('主標');
        if(copy.sub) importedText.push('副標');
        if(copy.date) importedText.push('日期/警語');

        var appeared = Object.keys(layoutResult.types).filter(function(k){ return layoutResult.types[k]; }).length;
        var bgMsg = publicCode ? ('，公版背景 ' + publicCode.code + ' 套用中') : '';
        setStatus('完成：讀取「' + parsed.sheetName + '」，勾選 ' + appliedLayouts.matched + ' 個排版，匯入 ' + importedText.join('、') + bgMsg, 'ok');
        toast('工單已匯入：讀取「' + parsed.sheetName + '」，偵測到 ' + appeared + ' 個版位，已同步文字與畫布' + bgMsg, 'ok', 3000);
      })
      .catch(function(err){
        console.error('[工單上傳] 失敗', err);
        setStatus('匯入失敗：' + (err && err.message ? err.message : err), 'err');
        toast('工單匯入失敗，請確認是 .xlsx 檔', 'err', 3200);
      })
      .finally(function(){
        var inp = $(INPUT_ID);
        if(inp) inp.value = '';
      });
  }

  var ENABLE_WORKORDER_UPLOAD = false;

  function injectUI(){
    if(!ENABLE_WORKORDER_UPLOAD) return;
    var sidebar = $('sidebar-scroll');
    if(!sidebar || $('bn-workorder-box')) return;

    var style = document.createElement('style');
    style.id = 'bn-workorder-style';
    style.textContent = [
      '.bn-workorder-box{padding:10px 14px 12px;border-bottom:1px solid var(--border);background:rgba(31,111,235,.08);}',
      '.bn-workorder-btn{width:100%;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:6px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;}',
      '.bn-workorder-btn:hover{opacity:.88;}',
      '.bn-workorder-status{display:block;margin-top:6px;font-size:10px;line-height:1.4;color:var(--text3);word-break:break-word;}',
      '.bn-workorder-status.ok{color:#3fb950;}',
      '.bn-workorder-status.err{color:#ff7b72;}',
      '.bn-workorder-status.loading{color:#d29922;}'
    ].join('\n');
    document.head.appendChild(style);

    var box = document.createElement('div');
    box.id = 'bn-workorder-box';
    box.className = 'bn-workorder-box';
    box.innerHTML = [
      '<button type="button" class="bn-workorder-btn" id="bn-workorder-btn">📤 上傳工單</button>',
      '<input type="file" id="' + INPUT_ID + '" accept=".xlsx,.xls,.xlsm" style="display:none">',
      '<span id="' + STATUS_ID + '" class="bn-workorder-status">支援 .xlsx：自動勾版位與匯入品牌名/主標/副標/日期</span>'
    ].join('');
    sidebar.insertBefore(box, sidebar.firstChild);

    $('bn-workorder-btn').addEventListener('click', function(){ $(INPUT_ID).click(); });
    $(INPUT_ID).addEventListener('change', function(e){ handleFile(e.target.files && e.target.files[0]); });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', injectUI);
  } else {
    injectUI();
  }

  global.bnWorkorderUploadPlugin = {
    parseRows: function(rows){ return {layouts:scanAppearedLayoutTypes(rows), copy:scanCopy(rows), publicCode:scanPublicTemplateCode(rows)}; },
    rowsFromWorkbook: rowsFromWorkbook,
    scanPublicTemplateCode: scanPublicTemplateCode,
    applyPublicTemplateBackground: applyPublicTemplateBackground,
    applyCopy: applyCopy,
    applyLayouts: applyLayouts
  };
})(window);
