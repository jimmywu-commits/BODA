/**
 * 商品建議售價更新器
 * D 欄：商品狀況（全新／二手）
 * E 欄：品名
 * F 欄：建議售價
 *
 * 價格來源：SerpApi Google Shopping API。
 */
const CONFIG = {
  SHEET_NAME: '', // 留白＝目前開啟的分頁；也可填入固定分頁名稱
  START_ROW: 2,
  CONDITION_COL: 4, // D
  PRODUCT_COL: 5,   // E
  PRICE_COL: 6,     // F
  API_KEY_PROPERTY: 'SERPAPI_KEY',
  API_URL: 'https://serpapi.com/search.json',
  MAX_RESULTS: 8,
  ROUND_TO: 100,
  USED_FALLBACK_RATE: 0.65,
};

const USED_RE = /二手|中古|良品|福利品|整新|展示機|展示品|used|pre-owned|second\s*hand|refurbished|refurb/i;
const NEW_RE = /全新|新品|未拆|未使用|公司貨|原廠盒|new/i;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('商品價格工具')
    .addItem('更新資訊', 'updateSuggestedPrices')
    .addItem('設定 SerpApi Key', 'setSerpApiKey')
    .addItem('測試 API 設定', 'testSerpApiConnection')
    .addToUi();
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

function updateSuggestedPrices() {
  const ui = SpreadsheetApp.getUi();
  const key = getApiKey_();
  if (!key) {
    ui.alert('請先從「商品價格工具 → 設定 SerpApi Key」設定 API Key。');
    return;
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) return ui.alert('已有更新程序正在執行，請稍後再試。');

  try {
    const sheet = getTargetSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < CONFIG.START_ROW) return ui.alert('目前沒有可更新的資料列。');

    const rowCount = lastRow - CONFIG.START_ROW + 1;
    const inputs = sheet
      .getRange(CONFIG.START_ROW, CONFIG.CONDITION_COL, rowCount, 2)
      .getDisplayValues();
    const outputRange = sheet.getRange(CONFIG.START_ROW, CONFIG.PRICE_COL, rowCount, 1);
    const prices = outputRange.getValues();
    const notes = outputRange.getNotes();
    const memo = {};
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    inputs.forEach(function (row, index) {
      const conditionText = String(row[0] || '').trim();
      const productName = String(row[1] || '').trim();
      if (!conditionText && !productName) return;

      if (!productName) {
        skipped++;
        notes[index][0] = '未更新：E 欄沒有品名。';
        return;
      }

      const type = normalizeCondition_(conditionText);
      if (!type) {
        skipped++;
        notes[index][0] = '未更新：D 欄請填「全新」或「二手」。目前內容：' + conditionText;
        return;
      }

      const cacheKey = type + '|' + productName.toLowerCase();
      try {
        if (!memo[cacheKey]) memo[cacheKey] = findQuote_(productName, type, key);
        prices[index][0] = memo[cacheKey].price;
        notes[index][0] = makeNote_(memo[cacheKey], conditionText, productName);
        updated++;
      } catch (error) {
        failed++;
        notes[index][0] = makeErrorNote_(conditionText, productName, error);
      }
    });

    outputRange.setValues(prices);
    outputRange.setNotes(notes);
    ui.alert([
      '更新完成（' + sheet.getName() + '）',
      '成功更新：' + updated + ' 筆',
      '略過：' + skipped + ' 筆',
      '查詢失敗：' + failed + ' 筆',
      '',
      '每個價格的查詢來源已放在 F 欄儲存格備註。',
    ].join('\n'));
  } finally {
    lock.releaseLock();
  }
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

  // 找不到二手結果時，另外查全新價格，再依設定比例推估二手價。
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
    throw new Error('SerpApi 查詢失敗（HTTP ' + status + '）： ' + (json.error || '請確認 Key 與額度。'));
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
