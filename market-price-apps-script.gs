/**
 * 商品建議售價更新器（Google Sheets / Apps Script）
 *
 * 欄位約定：
 *   D 欄 = 商品狀況（全新／二手）
 *   E 欄 = 品名
 *   F 欄 = 建議售價
 *
 * 價格來源：SerpApi Google Shopping API（需自行申請 API Key）
 */

const CONFIG = Object.freeze({
  // 留白時使用目前開啟的分頁；若要固定分頁，可填入分頁名稱，例如「庫存」。
  SHEET_NAME: '',

  HEADER_ROW: 1,
  DATA_START_ROW: 2,
  CONDITION_COLUMN: 4, // D
  PRODUCT_COLUMN: 5,   // E
  OUTPUT_COLUMN: 6,    // F

  API_KEY_PROPERTY: 'SERPAPI_KEY',
  API_ENDPOINT: 'https://serpapi.com/search.json',
  API_LOCATION: 'Taiwan',
  API_LANGUAGE: 'zh-TW',
  API_COUNTRY: 'tw',

  // 同一輪更新中，同品名＋同狀況只查一次，避免浪費 API 次數。
  MAX_PRICE_RESULTS: 8,
  PRICE_ROUND_TO: 100,
  USED_FALLBACK_RATE: 0.65,
  REQUEST_DELAY_MS: 150,
});

const USED_SIGNAL = /二手|中古|良品|福利品|整新|展示機|展示品|used|pre-owned|second\s*hand|refurbished|refurb/i;
const NEW_SIGNAL = /全新|新品|未拆|未使用|公司貨|原廠盒|new/i;

/**
 * 開啟試算表時，在上方選單加入「商品價格工具」。
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('商品價格工具')
    .addItem('更新資訊', 'updateSuggestedPrices')
    .addItem('設定 SerpApi Key', 'setSerpApiKey')
    .addItem('測試 API 設定', 'testSerpApiConnection')
    .addToUi();
}

/**
 * 主程式：讀取 D/E 欄，查詢市價，回填 F 欄。
 */
function updateSuggestedPrices() {
  const ui = SpreadsheetApp.getUi();
  const apiKey = getSerpApiKey_();

  if (!apiKey) {
    ui.alert(
      '尚未設定 SerpApi Key',
      '請先從「商品價格工具 → 設定 SerpApi Key」貼上 API Key，再重新更新。',
      ui.ButtonSet.OK
    );
    return;
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) {
    ui.alert('已有更新程序正在執行，請稍後再試。');
    return;
  }

  try {
    const sheet = getTargetSheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow < CONFIG.DATA_START_ROW) {
      ui.alert('目前沒有可更新的資料列。');
      return;
    }

    const rowCount = lastRow - CONFIG.DATA_START_ROW + 1;
    const inputValues = sheet
      .getRange(CONFIG.DATA_START_ROW, CONFIG.CONDITION_COLUMN, rowCount, 2)
      .getDisplayValues();
    const outputRange = sheet.getRange(
      CONFIG.DATA_START_ROW,
      CONFIG.OUTPUT_COLUMN,
      rowCount,
      1
    );
    const outputValues = outputRange.getValues();
    const outputNotes = outputRange.getNotes();
    const cache = {};

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    inputValues.forEach((row, index) => {
      const conditionText = String(row[0] || '').trim();
      const productName = String(row[1] || '').trim();

      // 空白列不動，保留原本 F 欄內容與備註。
      if (!conditionText && !productName) return;

      if (!productName) {
        skipped++;
        outputNotes[index][0] = '未更新：E 欄沒有品名。';
        return;
      }

      const conditionType = normalizeCondition_(conditionText);
      if (!conditionType) {
        skipped++;
        outputNotes[index][0] =
          '未更新：D 欄請填「全新」或「二手」。目前內容：' + conditionText;
        return;
      }

      const cacheKey = conditionType + '|' + productName.toLowerCase();

      try {
        if (!cache[cacheKey]) {
          cache[cacheKey] = findMarketPrice_(productName, conditionType, apiKey);
          Utilities.sleep(CONFIG.REQUEST_DELAY_MS);
        }

        const quote = cache[cacheKey];
        outputValues[index][0] = quote.price;
        outputNotes[index][0] = buildPriceNote_(quote, conditionText, productName);
        updated++;
      } catch (error) {
        // 查詢失敗時保留 F 欄原值，只在備註記錄錯誤，避免誤清資料。
        failed++;
        outputNotes[index][0] = buildErrorNote_(conditionText, productName, error);
      }
    });

    outputRange.setValues(outputValues);
    outputRange.setNotes(outputNotes);

    ui.alert(
      '更新完成',
      [
        '分頁：' + sheet.getName(),
        '成功更新：' + updated + ' 筆',
        '略過：' + skipped + ' 筆',
        '查詢失敗：' + failed + ' 筆',
        '',
        '每個 F 欄價格的參考結果已寫入該儲存格備註。',
      ].join('\n'),
      ui.ButtonSet.OK
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * 從上方選單設定 SerpApi Key，Key 會存放在 Apps Script 的 Script Properties，
 * 不會寫在試算表儲存格裡。
 */
function setSerpApiKey() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    '設定 SerpApi Key',
    '請貼上 SerpApi API Key。Key 只會儲存在此 Apps Script 專案的設定中。',
    ui.ButtonSet.OK_CANCEL
  );

  if (result.getSelectedButton() !== ui.Button.OK) return;

  const apiKey = result.getResponseText().trim();
  if (!apiKey) {
    ui.alert('API Key 不可為空白。');
    return;
  }

  PropertiesService.getScriptProperties().setProperty(
    CONFIG.API_KEY_PROPERTY,
    apiKey
  );
  ui.alert('SerpApi Key 已儲存。現在可以執行「更新資訊」。');
}

/**
 * 測試 API Key 與購物搜尋是否可用。
 */
function testSerpApiConnection() {
  const ui = SpreadsheetApp.getUi();
  const apiKey = getSerpApiKey_();

  if (!apiKey) {
    ui.alert('尚未設定 SerpApi Key。請先設定後再測試。');
    return;
  }

  try {
    const result = searchShopping_('iPhone 15', 'new', apiKey);
    const count = Array.isArray(result.shopping_results)
      ? result.shopping_results.length
      : 0;
    ui.alert('API 測試成功', '已取得 ' + count + ' 筆購物搜尋結果。', ui.ButtonSet.OK);
  } catch (error) {
    ui.alert('API 測試失敗', error.message || String(error), ui.ButtonSet.OK);
  }
}

function getTargetSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (CONFIG.SHEET_NAME) {
    const fixedSheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
    if (!fixedSheet) {
      throw new Error('找不到指定分頁：「' + CONFIG.SHEET_NAME + '」。');
    }
    return fixedSheet;
  }
  return spreadsheet.getActiveSheet();
}

function getSerpApiKey_() {
  return PropertiesService.getScriptProperties().getProperty(
    CONFIG.API_KEY_PROPERTY
  );
}

function normalizeCondition_(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';

  // 先判斷二手，避免「二手、非全新」被誤判成全新。
  if (/(二手|中古|used|pre-owned|refurbished|福利品|整新|展示機)/i.test(text)) {
    return 'used';
  }
  if (/(全新|新品|new|未使用)/i.test(text)) {
    return 'new';
  }
  return '';
}

function findMarketPrice_(productName, conditionType, apiKey) {
  const response = searchShopping_(productName, conditionType, apiKey);
  if (response.error) throw new Error(response.error);

  const items = Array.isArray(response.shopping_results)
    ? response.shopping_results
    : [];

  if (!items.length) {
    throw new Error('沒有取得購物搜尋結果。');
  }

  const candidates = selectCandidates_(items, productName, conditionType);
  if (candidates.length) {
    return makeQuote_(
      productName,
      conditionType,
      candidates,
      false,
      response.search_metadata && response.search_metadata.status
    );
  }

  // 二手商品若沒有足夠的二手刊登價格，改用同品名的全新市價乘折舊比例，
  // 並在 F 欄備註清楚標示「推估」，避免把全新價誤當成二手實際行情。
  if (conditionType === 'used') {
    const newCandidates = selectCandidates_(items, productName, 'new');
    if (newCandidates.length) {
      const newQuote = makeQuote_(
        productName,
        'new',
        newCandidates,
        false,
        response.search_metadata && response.search_metadata.status
      );
      return {
        productName: productName,
        conditionType: 'used',
        price: roundPrice_(newQuote.price * CONFIG.USED_FALLBACK_RATE),
        estimated: true,
        fallbackNewPrice: newQuote.price,
        query: newQuote.query,
        samples: newQuote.samples,
        searchStatus: newQuote.searchStatus,
      };
    }
  }

  throw new Error('找不到符合「' + (conditionType === 'used' ? '二手' : '全新') + '」且含價格的結果。');
}

function searchShopping_(productName, conditionType, apiKey) {
  const conditionWords = conditionType === 'used' ? '二手 中古' : '全新 新品';
  const query = productName + ' ' + conditionWords;
  const params = {
    engine: 'google_shopping',
    q: query,
    location: CONFIG.API_LOCATION,
    google_domain: 'google.com.tw',
    hl: CONFIG.API_LANGUAGE,
    gl: CONFIG.API_COUNTRY,
    api_key: apiKey,
  };
  const url = CONFIG.API_ENDPOINT + '?' + toQueryString_(params);
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: { Accept: 'application/json' },
  });
  const statusCode = response.getResponseCode();
  const body = response.getContentText();

  let json;
  try {
    json = JSON.parse(body);
  } catch (error) {
    throw new Error('SerpApi 回傳不是有效 JSON（HTTP ' + statusCode + '）。');
  }

  if (statusCode < 200 || statusCode >= 300 || json.error) {
    throw new Error(
      'SerpApi 查詢失敗（HTTP ' +
        statusCode + '）：' +
        (json.error || '請確認 API Key、額度與查詢參數。')
    );
  }

  json.__query = query;
  return json;
}

function selectCandidates_(items, productName, conditionType) {
  const tokens = tokenizeProductName_(productName);

  return items
    .map(function (item) {
      const title = String(item.title || '').trim();
      const source = String(item.source || '').trim();
      const snippet = String(item.snippet || '').trim();
      const secondHandCondition = String(item.second_hand_condition || '').trim();
      const condition = String(item.condition || '').trim();
      const extensions = Array.isArray(item.extensions)
        ? item.extensions.join(' ')
        : String(item.extensions || '');
      const haystack = [
        title,
        source,
        snippet,
        secondHandCondition,
        condition,
        extensions,
      ].join(' ');
      const isUsed = USED_SIGNAL.test(haystack);
      const isNew = NEW_SIGNAL.test(haystack);
      const price = extractPrice_(item);
      const relevance = tokens.reduce(function (score, token) {
        return score + (title.toLowerCase().indexOf(token.toLowerCase()) >= 0 ? 1 : 0);
      }, 0);
      const link = item.link || item.product_link || item.serpapi_product_api || '';

      return {
        title: title || productName,
        source: source || '未知來源',
        price: price,
        priceText: String(item.price || price),
        link: String(link),
        isUsed: isUsed,
        isNew: isNew,
        relevance: relevance,
        score: relevance * 10 + (isUsed ? 20 : 0) + (isNew ? 5 : 0),
      };
    })
    .filter(function (candidate) {
      if (!isFinite(candidate.price) || candidate.price <= 0) return false;

      if (conditionType === 'used') {
        // 二手查詢只採用有二手訊號的結果，避免將全新商品當成二手行情。
        return candidate.isUsed && !candidate.isNew;
      }

      // 全新查詢排除二手、福利品、展示機與整新機。
      return !candidate.isUsed;
    })
    .sort(function (a, b) {
      return b.score - a.score || a.price - b.price;
    })
    .slice(0, CONFIG.MAX_PRICE_RESULTS);
}

function makeQuote_(productName, conditionType, candidates, estimated, searchStatus) {
  const prices = candidates.map(function (candidate) {
    return candidate.price;
  });
  const median = median_(prices);

  return {
    productName: productName,
    conditionType: conditionType,
    price: roundPrice_(median),
    estimated: estimated,
    query: productName + ' ' + (conditionType === 'used' ? '二手 中古' : '全新 新品'),
    samples: candidates,
    searchStatus: searchStatus || '',
  };
}

function extractPrice_(item) {
  const extracted = Number(item.extracted_price);
  if (isFinite(extracted) && extracted > 0) return extracted;

  const text = String(item.price || '').replace(/[,，]/g, '');
  const match = text.match(/[0-9]+(?:\.[0-9]+)?/);
  return match ? Number(match[0]) : NaN;
}

function tokenizeProductName_(productName) {
  const tokens = String(productName)
    .split(/[\s,，/|()（）[\]【】\-]+/)
    .map(function (token) {
      return token.trim();
    })
    .filter(function (token) {
      return token.length >= 2;
    });

  return tokens.length ? tokens : [String(productName).trim()];
}

function median_(numbers) {
  const sorted = numbers.slice().sort(function (a, b) {
    return a - b;
  });
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function roundPrice_(price) {
  const roundTo = CONFIG.PRICE_ROUND_TO;
  return Math.max(0, Math.round(Number(price) / roundTo) * roundTo);
}

function toQueryString_(params) {
  return Object.keys(params)
    .map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    })
    .join('&');
}

function buildPriceNote_(quote, conditionText, productName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const timezone = spreadsheet.getSpreadsheetTimeZone() || 'Asia/Taipei';
  const updatedAt = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd HH:mm:ss');
  const lines = [
    '更新時間：' + updatedAt,
    '品名：' + productName,
    '狀況：' + conditionText,
    '查詢：' + quote.query,
  ];

  if (quote.estimated) {
    lines.push(
      '注意：未找到足夠二手結果，依全新中位數 NT$' +
        formatNumber_(quote.fallbackNewPrice) +
        ' × ' +
        Math.round(CONFIG.USED_FALLBACK_RATE * 100) +
        '% 推估。'
    );
  } else {
    lines.push('建議價：取 ' + quote.samples.length + ' 筆結果的價格中位數並四捨五入至百元。');
  }

  lines.push('參考結果：');
  quote.samples.slice(0, 5).forEach(function (sample, index) {
    lines.push(
      (index + 1) +
        '. ' +
        sample.title.slice(0, 100) +
        '｜' +
        sample.priceText +
        '｜' +
        sample.source +
        (sample.link ? '｜' + sample.link : '')
    );
  });

  return lines.join('\n');
}

function buildErrorNote_(conditionText, productName, error) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const timezone = spreadsheet.getSpreadsheetTimeZone() || 'Asia/Taipei';
  const updatedAt = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd HH:mm:ss');
  return [
    '本次更新失敗：' + updatedAt,
    '品名：' + productName,
    '狀況：' + conditionText,
    '原因：' + (error && error.message ? error.message : String(error)),
    'F 欄已保留原本內容。',
  ].join('\n');
}

function formatNumber_(value) {
  return Math.round(Number(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

