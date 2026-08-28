/**
 * 商品建議售價更新器（含右側進度視窗）
 *
 * D 欄：商品狀況（全新／二手）
 * E 欄：品名
 * F 欄：建議售價
 *
 * 請將本檔案的內容取代目前 Apps Script 專案中的程式。
 * 價格來源：SerpApi Google Shopping API。
 */

const CONFIG = {
  SHEET_NAME: '', // 留白＝目前開啟的分頁；也可填入固定分頁名稱
  START_ROW: 2,
  CONDITION_COL: 4, // D
  PRODUCT_COL: 5,   // E
  PRICE_COL: 6,     // F
  API_KEY_PROPERTY: 'SERPAPI_KEY',
  STATUS_PROPERTY: 'PRICE_UPDATE_STATUS',
  API_URL: 'https://serpapi.com/search.json',
  MAX_RESULTS: 8,
  ROUND_TO: 100,
  USED_FALLBACK_RATE: 0.65,
};

const USED_RE = /二手|中古|良品|福利品|整新|展示機|展示品|used|pre-owned|second\s*hand|refurbished|refurb/i;
const NEW_RE = /全新|新品|未拆|未使用|公司貨|原廠盒|new/i;

/** 開啟試算表時建立上方選單。 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('商品價格工具')
    .addItem('更新資訊', 'updateSuggestedPrices')
    .addItem('設定 SerpApi Key', 'setSerpApiKey')
    .addItem('測試 API 設定', 'testSerpApiConnection')
    .addToUi();
}

/** 從上方選單或工作表按鈕執行，改為開啟右側進度視窗。 */
function updateSuggestedPrices() {
  openUpdateSidebar();
}

function openUpdateSidebar() {
  const html = HtmlService.createHtmlOutput(getSidebarHtml_())
    .setTitle('商品價格工具');
  SpreadsheetApp.getUi().showSidebar(html);
}

/** 由進度視窗非同步呼叫；不要在此函式中使用 alert。 */
function startPriceUpdateFromSidebar() {
  return runPriceUpdate_();
}

/** 由進度視窗每秒呼叫一次，取得目前執行狀態。 */
function getPriceUpdateStatus() {
  const raw = PropertiesService.getDocumentProperties()
    .getProperty(CONFIG.STATUS_PROPERTY);
  if (!raw) return { state: 'idle', message: '尚未開始。' };

  try {
    return JSON.parse(raw);
  } catch (error) {
    return { state: 'error', message: '無法讀取執行狀態。' };
  }
}

function setSerpApiKey() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    '設定 SerpApi Key',
    '請貼上 SerpApi API Key。Key 會儲存在 Apps Script 設定中，不會寫入試算表。',
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;

  const key = result.getResponseText().trim();
  if (!key) return ui.alert('API Key 不可為空白。');
  PropertiesService.getScriptProperties().setProperty(CONFIG.API_KEY_PROPERTY, key);
  ui.alert('API Key 已儲存，現在可以執行「更新資訊」。');
}

function testSerpApiConnection() {
  const key = getApiKey_();
  if (!key) return SpreadsheetApp.getUi().alert('請先設定 SerpApi Key。');
  try {
    const json = searchShopping_('iPhone 15', 'new', key);
    const count = Array.isArray(json.shopping_results) ? json.shopping_results.length : 0;
    SpreadsheetApp.getUi().alert('API 測試成功，取得 ' + count + ' 筆結果。');
  } catch (error) {
    SpreadsheetApp.getUi().alert('API 測試失敗：' + error.message);
  }
}

function runPriceUpdate_() {
  const key = getApiKey_();
  if (!key) {
    const message = '請先從「商品價格工具 → 設定 SerpApi Key」設定 API Key。';
    writeStatus_({ state: 'error', message: message, updatedAt: new Date().toISOString() });
    throw new Error(message);
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) {
    const message = '已有更新程序正在執行，請稍後再試。';
    writeStatus_({ state: 'error', message: message, updatedAt: new Date().toISOString() });
    throw new Error(message);
  }

  let progress = {
    state: 'running',
    total: 0,
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    currentRow: '',
    currentProduct: '',
    message: '準備讀取資料…',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const sheet = getTargetSheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow < CONFIG.START_ROW) {
      progress.state = 'done';
      progress.message = '目前沒有可更新的資料列。';
      writeStatus_(progress);
      return progress;
    }

    const rowCount = lastRow - CONFIG.START_ROW + 1;
    progress.total = rowCount;
    writeStatus_(progress);

    const inputs = sheet
      .getRange(CONFIG.START_ROW, CONFIG.CONDITION_COL, rowCount, 2)
      .getDisplayValues();
    const outputRange = sheet.getRange(CONFIG.START_ROW, CONFIG.PRICE_COL, rowCount, 1);
    const prices = outputRange.getValues();
    const notes = outputRange.getNotes();
    const memo = {};

    inputs.forEach(function (row, index) {
      const sheetRow = CONFIG.START_ROW + index;
      const conditionText = String(row[0] || '').trim();
      const productName = String(row[1] || '').trim();

      if (!conditionText && !productName) {
        progress.processed = index + 1;
        writeStatus_(progress);
        return;
      }

      progress.currentRow = sheetRow;
      progress.currentProduct = productName || '(沒有品名)';
      progress.message = '正在處理第 ' + sheetRow + ' 列…';
      writeStatus_(progress);

      if (!productName) {
        progress.skipped++;
        progress.processed = index + 1;
        notes[index][0] = '未更新：E 欄沒有品名。';
        progress.message = '略過第 ' + sheetRow + ' 列：E 欄沒有品名。';
        writeStatus_(progress);
        return;
      }

      const type = normalizeCondition_(conditionText);
      if (!type) {
        progress.skipped++;
        progress.processed = index + 1;
        notes[index][0] = '未更新：D 欄請填「全新」或「二手」。目前內容：' + conditionText;
        progress.message = '略過第 ' + sheetRow + ' 列：D 欄狀況無法辨識。';
        writeStatus_(progress);
        return;
      }

      const cacheKey = type + '|' + productName.toLowerCase();
      progress.message = '正在查詢第 ' + sheetRow + ' 列：' + productName;
      writeStatus_(progress);

      try {
        if (!memo[cacheKey]) memo[cacheKey] = findQuote_(productName, type, key);
        prices[index][0] = memo[cacheKey].price;
        notes[index][0] = makeNote_(memo[cacheKey], conditionText, productName);
        progress.updated++;
        progress.message = '完成第 ' + sheetRow + ' 列：NT$' + formatNumber_(memo[cacheKey].price);
      } catch (error) {
        progress.failed++;
        notes[index][0] = makeErrorNote_(conditionText, productName, error);
        progress.message = '第 ' + sheetRow + ' 列查詢失敗：' + error.message;
      }

      progress.processed = index + 1;
      writeStatus_(progress);
    });

    outputRange.setValues(prices);
    outputRange.setNotes(notes);
    progress.state = 'done';
    progress.currentRow = '';
    progress.currentProduct = '';
    progress.message = '更新完成。成功 ' + progress.updated + ' 筆，失敗 ' + progress.failed + ' 筆。';
    writeStatus_(progress);
    return progress;
  } catch (error) {
    progress.state = 'error';
    progress.message = error.message || String(error);
    writeStatus_(progress);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function writeStatus_(status) {
  status.updatedAt = new Date().toISOString();
  PropertiesService.getDocumentProperties().setProperty(
    CONFIG.STATUS_PROPERTY,
    JSON.stringify(status)
  );
}

function getTargetSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!CONFIG.SHEET_NAME) return ss.getActiveSheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('找不到分頁：' + CONFIG.SHEET_NAME);
  return sheet;
}

function getApiKey_() {
  return PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
}

function normalizeCondition_(value) {
  const text = String(value || '').trim().toLowerCase();
  if (/(二手|中古|used|pre-owned|refurbished|福利品|整新|展示機)/i.test(text)) return 'used';
  if (/(全新|新品|new|未使用)/i.test(text)) return 'new';
  return '';
}

function findQuote_(productName, type, key) {
  const first = searchShopping_(productName, type, key);
  const firstItems = Array.isArray(first.shopping_results) ? first.shopping_results : [];
  const actual = chooseCandidates_(firstItems, productName, type);
  if (actual.length) return makeQuote_(productName, type, actual, false);

  // 找不到二手結果時，另外查全新價格，再依比例推估二手價。
  if (type === 'used') {
    const fresh = searchShopping_(productName, 'new', key);
    const freshItems = Array.isArray(fresh.shopping_results) ? fresh.shopping_results : [];
    const freshCandidates = chooseCandidates_(freshItems, productName, 'new');
    if (freshCandidates.length) {
      const freshQuote = makeQuote_(productName, 'new', freshCandidates, false);
      return {
        productName: productName,
        type: 'used',
        price: roundPrice_(freshQuote.price * CONFIG.USED_FALLBACK_RATE),
        estimated: true,
        freshPrice: freshQuote.price,
        query: freshQuote.query,
        samples: freshQuote.samples,
      };
    }
  }
  throw new Error('找不到符合條件且含價格的購物結果。');
}

function searchShopping_(productName, type, key) {
  const query = productName + ' ' + (type === 'used' ? '二手 中古' : '全新 新品');
  const params = {
    engine: 'google_shopping',
    q: query,
    location: 'Taiwan',
    google_domain: 'google.com.tw',
    hl: 'zh-TW',
    gl: 'tw',
    api_key: key,
  };
  const url = CONFIG.API_URL + '?' + Object.keys(params).map(function (name) {
    return encodeURIComponent(name) + '=' + encodeURIComponent(params[name]);
  }).join('&');

  const response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
  const status = response.getResponseCode();
  let json;
  try {
    json = JSON.parse(response.getContentText());
  } catch (error) {
    throw new Error('SerpApi 回傳格式錯誤（HTTP ' + status + '）。');
  }
  if (status < 200 || status >= 300 || json.error) {
    throw new Error('SerpApi 查詢失敗（HTTP ' + status + '）：' + (json.error || '請確認 Key 與額度。'));
  }
  return json;
}

function chooseCandidates_(items, productName, type) {
  const tokens = String(productName).split(/[\s,，/|()（）[\]【】\-]+/).filter(function (token) {
    return token.length >= 2;
  });

  return items.map(function (item) {
    const title = String(item.title || productName).trim();
    const text = [
      title,
      item.source,
      item.snippet,
      item.second_hand_condition,
      item.condition,
      Array.isArray(item.extensions) ? item.extensions.join(' ') : item.extensions,
    ].join(' ');
    const used = USED_RE.test(text);
    const fresh = NEW_RE.test(text);
    const price = Number(item.extracted_price) > 0
      ? Number(item.extracted_price)
      : parsePrice_(item.price);
    const relevance = tokens.reduce(function (score, token) {
      return score + (title.toLowerCase().indexOf(token.toLowerCase()) >= 0 ? 1 : 0);
    }, 0);
    return {
      title: title,
      source: String(item.source || '未知來源'),
      price: price,
      priceText: String(item.price || price),
      link: String(item.link || item.product_link || item.serpapi_product_api || ''),
      used: used,
      fresh: fresh,
      score: relevance * 10 + (used ? 20 : 0) + (fresh ? 5 : 0),
    };
  }).filter(function (candidate) {
    if (!isFinite(candidate.price) || candidate.price <= 0) return false;
    return type === 'used'
      ? candidate.used && !candidate.fresh
      : !candidate.used;
  }).sort(function (a, b) {
    return b.score - a.score || a.price - b.price;
  }).slice(0, CONFIG.MAX_RESULTS);
}

function makeQuote_(productName, type, samples, estimated) {
  const prices = samples.map(function (sample) { return sample.price; }).sort(function (a, b) { return a - b; });
  const middle = Math.floor(prices.length / 2);
  const median = prices.length % 2
    ? prices[middle]
    : (prices[middle - 1] + prices[middle]) / 2;
  return {
    productName: productName,
    type: type,
    price: roundPrice_(median),
    estimated: estimated,
    query: productName + ' ' + (type === 'used' ? '二手 中古' : '全新 新品'),
    samples: samples,
  };
}

function parsePrice_(value) {
  const match = String(value || '').replace(/[,，]/g, '').match(/[0-9]+(?:\.[0-9]+)?/);
  return match ? Number(match[0]) : NaN;
}

function roundPrice_(value) {
  return Math.max(0, Math.round(Number(value) / CONFIG.ROUND_TO) * CONFIG.ROUND_TO);
}

function makeNote_(quote, condition, productName) {
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'Asia/Taipei';
  const lines = [
    '更新時間：' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss'),
    '品名：' + productName,
    '狀況：' + condition,
    '查詢：' + quote.query,
  ];
  if (quote.estimated) {
    lines.push('注意：沒有找到二手價格，依全新中位數 NT$' + formatNumber_(quote.freshPrice) + ' × ' + Math.round(CONFIG.USED_FALLBACK_RATE * 100) + '% 推估。');
  } else {
    lines.push('建議價：採用 ' + quote.samples.length + ' 筆結果的價格中位數，並四捨五入至百元。');
  }
  lines.push('參考結果：');
  quote.samples.slice(0, 5).forEach(function (sample, index) {
    lines.push((index + 1) + '. ' + sample.title.slice(0, 100) + '｜' + sample.priceText + '｜' + sample.source + (sample.link ? '｜' + sample.link : ''));
  });
  return lines.join('\n');
}

function makeErrorNote_(condition, productName, error) {
  return [
    '本次更新失敗：' + new Date(),
    '品名：' + productName,
    '狀況：' + condition,
    '原因：' + (error.message || error),
    'F 欄已保留原本內容。',
  ].join('\n');
}

function formatNumber_(value) {
  return Math.round(Number(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 產生右側進度視窗，不需要另外建立 HTML 檔案。 */
function getSidebarHtml_() {
  return `
<!doctype html>
<html>
<head>
  <base target="_top">
  <style>
    body { font-family: Arial, sans-serif; color: #202124; padding: 16px; margin: 0; }
    h2 { margin: 0 0 14px; font-size: 20px; }
    .muted { color: #5f6368; font-size: 12px; line-height: 1.5; }
    .message { background: #f1f3f4; border-radius: 8px; padding: 12px; margin: 14px 0; line-height: 1.5; word-break: break-word; }
    .bar-wrap { background: #e8eaed; border-radius: 8px; height: 12px; overflow: hidden; }
    .bar { background: #1a73e8; height: 100%; width: 0%; transition: width .25s ease; }
    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
    .stat { border: 1px solid #dadce0; border-radius: 8px; padding: 10px; }
    .stat b { display: block; font-size: 18px; margin-top: 3px; }
    .done { color: #188038; }
    .error { color: #d93025; }
    button { width: 100%; margin-top: 18px; padding: 9px; border: 0; border-radius: 5px; background: #1a73e8; color: white; cursor: pointer; }
  </style>
</head>
<body>
  <h2>商品價格更新</h2>
  <div class="muted" id="status">正在啟動…</div>
  <div class="message" id="message">正在準備…</div>
  <div class="bar-wrap"><div class="bar" id="bar"></div></div>
  <div class="stats">
    <div class="stat">處理進度<b id="progress">0 / 0</b></div>
    <div class="stat">成功更新<b id="updated">0</b></div>
    <div class="stat">略過<b id="skipped">0</b></div>
    <div class="stat">查詢失敗<b id="failed">0</b></div>
  </div>
  <div class="muted" style="margin-top:14px;">關閉視窗不會停止背景更新。</div>
  <button onclick="google.script.host.close()">關閉視窗</button>

  <script>
    var polling = true;

    function render(status) {
      var total = Number(status.total || 0);
      var processed = Number(status.processed || 0);
      var percent = total ? Math.min(100, Math.round(processed * 100 / total)) : 0;
      document.getElementById('bar').style.width = percent + '%';
      document.getElementById('status').textContent = status.state === 'done' ? '已完成' : (status.state === 'error' ? '執行失敗' : '執行中');
      document.getElementById('message').textContent = status.message || '';
      document.getElementById('progress').textContent = processed + ' / ' + total;
      document.getElementById('updated').textContent = status.updated || 0;
      document.getElementById('skipped').textContent = status.skipped || 0;
      document.getElementById('failed').textContent = status.failed || 0;
      document.getElementById('status').className = status.state === 'done' ? 'done' : (status.state === 'error' ? 'error' : '');
      if (status.state === 'done' || status.state === 'error') polling = false;
    }

    function poll() {
      google.script.run
        .withSuccessHandler(function(status) {
          render(status);
          if (polling) window.setTimeout(poll, 1000);
        })
        .withFailureHandler(function(error) {
          document.getElementById('status').textContent = '無法讀取進度';
          document.getElementById('status').className = 'error';
          document.getElementById('message').textContent = error.message || error;
          if (polling) window.setTimeout(poll, 2000);
        })
        .getPriceUpdateStatus();
    }

    function start() {
      poll();
      google.script.run
        .withSuccessHandler(function(status) { render(status); })
        .withFailureHandler(function(error) {
          polling = false;
          document.getElementById('status').textContent = '執行失敗';
          document.getElementById('status').className = 'error';
          document.getElementById('message').textContent = error.message || error;
        })
        .startPriceUpdateFromSidebar();
    }

    window.addEventListener('load', start);
  </script>
</body>
</html>`;
}
