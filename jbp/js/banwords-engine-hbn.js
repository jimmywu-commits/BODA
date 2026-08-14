(function(global){
  'use strict';

  let currentRules = [];

  function normalizeRuleRecord(rule){
    return {
      row: rule && rule.row != null ? rule.row : null,
      scope: rule && rule.scope != null ? rule.scope : '出現',
      keyword: rule && rule.keyword != null ? String(rule.keyword).trim() : '',
      rule: rule && rule.rule != null ? String(rule.rule).trim() : '',
      message: rule && rule.message != null ? String(rule.message).trim() : '',
      exclude: rule && rule.exclude != null ? String(rule.exclude).trim() : ''
    };
  }

  function setRules(nextRules){
    currentRules = Array.isArray(nextRules)
      ? nextRules.map(normalizeRuleRecord).filter(function(r){ return !!r.keyword; })
      : [];
    return currentRules;
  }

  function getRules(){
    return currentRules;
  }

  function splitList(value){
    if (!value) return [];
    return String(value)
      .split(/[\n,，、、\/]+/)
      .map(function(s){ return s.trim(); })
      .filter(Boolean);
  }

  function escapeRegExp(str){
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isRegexKeyword(keyword){
    if (!keyword) return false;
    if (keyword === '-' || keyword === '~') return false;

    const raw = String(keyword);
    if (raw.length === 1) return false;
    if (/\\[dDsSwWbB]/.test(raw)) return true;
    if (/^\^.*\$/.test(raw)) return true;
    if (/[+*?]{1,}/.test(raw)) return true;
    if (/\[[^\]]+\]/.test(raw)) return true;
    if (/\([^\)]*\)/.test(raw)) return true;
    if (/\|/.test(raw)) return true;
    if (/\\./.test(raw)) return true;

    return false;
  }

  function buildKeywordPattern(keyword){
    const raw = String(keyword || '');
    const flags = /[A-Za-z]/.test(raw) ? 'gi' : 'g';

    if (raw === '-') return /\-/g;
    if (raw === '~') return /\~/g;

    if (isRegexKeyword(raw)) {
      try {
        return new RegExp(raw, flags);
      } catch (err) {
        return new RegExp(escapeRegExp(raw), flags);
      }
    }

    return new RegExp(escapeRegExp(raw), flags);
  }

  function parseReplacement(ruleText){
    const m = String(ruleText || '').match(/^自動改成["「]?([\s\S]+?)["」]?$/);
    return m ? m[1] : '';
  }

  function replaceKeyword(text, keyword, replacement){
    const pattern = buildKeywordPattern(keyword);
    return String(text || '').replace(pattern, replacement);
  }

  function testKeyword(text, keyword){
    const pattern = buildKeywordPattern(keyword);
    pattern.lastIndex = 0;
    return pattern.test(String(text || ''));
  }

  function removeKeyword(text, keyword){
    const pattern = buildKeywordPattern(keyword);
    return String(text || '').replace(pattern, '');
  }

  function getCellByAliases(row, aliases){
    if (!row || typeof row !== 'object') return undefined;
    for (let i = 0; i < aliases.length; i++) {
      const key = aliases[i];
      if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== '') {
        return row[key];
      }
    }
    return undefined;
  }

  function formatExcelValue(value){
    if (value == null) return '';
    if (typeof value === 'number') return String(value);
    return String(value).trim();
  }

  function convertExcelRowsToRules(rows){
    if (!Array.isArray(rows) || !rows.length) return [];

    const firstRow = rows[0] || {};
    const hasObjectHeader = typeof firstRow === 'object' && !Array.isArray(firstRow);

    if (hasObjectHeader) {
      return rows.map(function(row, idx){
        if (!row || typeof row !== 'object') return null;

        const keyword = formatExcelValue(
          getCellByAliases(row, ['禁用語列表', '禁用語', '關鍵字', 'keyword', 'A欄'])
        );
        const replacement = formatExcelValue(
          getCellByAliases(row, ['改字', '替換字', '替換內容', 'replace', 'replacement', 'B欄'])
        );
        const exclude = formatExcelValue(
          getCellByAliases(row, ['排除', '排除禁用語', '排除詞', 'exclude', 'C欄'])
        );
        const message = formatExcelValue(
          getCellByAliases(row, [
            '若符合左B欄的禁字語，在報告中呈現：禁用語列表的內容加上以下內容 (紅字)',
            '若符合左B欄的禁字語，在報告中呈現：\n禁用語列表的內容加上以下內容 (紅字)',
            '提示文案',
            '訊息',
            '說明',
            'message',
            'D欄'
          ])
        );
        const rowNo = formatExcelValue(
          getCellByAliases(row, ['row', '列', '編號'])
        );

        if (!keyword || keyword === '禁用語列表') return null;

        return normalizeRuleRecord({
          row: rowNo || (idx + 1),
          scope: '出現',
          keyword: keyword,
          rule: replacement ? ('自動改成"' + replacement + '"') : '直接無法輸入',
          message: message || '',
          exclude: exclude || ''
        });
      }).filter(Boolean);
    }

    return rows.map(function(row, idx){
      if (!Array.isArray(row)) return null;

      const keyword = formatExcelValue(row[0]);
      const replacement = formatExcelValue(row[1]);
      const exclude = formatExcelValue(row[2]);
      const message = formatExcelValue(row[3]);

      if (!keyword || keyword === '禁用語列表') return null;

      return normalizeRuleRecord({
        row: idx + 1,
        scope: '出現',
        keyword: keyword,
        rule: replacement ? ('自動改成"' + replacement + '"') : '直接無法輸入',
        message: message || '',
        exclude: exclude || ''
      });
    }).filter(Boolean);
  }

  function loadRulesFromExcelArrayBuffer(arrayBuffer){
    if (!global.XLSX) {
      throw new Error('XLSX parser not found');
    }

    const workbook = global.XLSX.read(arrayBuffer, { type: 'array' });
    const targetSheetName = workbook.SheetNames.indexOf('禁用語') !== -1
      ? '禁用語'
      : workbook.SheetNames[0];

    const sheet = workbook.Sheets[targetSheetName];
    const rows = global.XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const rules = convertExcelRowsToRules(rows);

    setRules(rules);
    return rules;
  }

  function getTextFromElement(el){
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.counter,.audit-tip').forEach(function(node){
      node.remove();
    });
    return (clone.textContent || '').replace(/ /g, ' ').trim();
  }

  function addThousandsSeparator(digits){
    return String(digits || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatNumericToken(token, keepDollar){
    let digits = String(token || '').replace(/,/g, '').replace(/^0+(?=\d)/, '');
    if (!digits) digits = '0';

    const withComma = digits.length >= 4
      ? addThousandsSeparator(digits)
      : digits;

    return keepDollar ? ('$' + withComma) : withComma;
  }

  function makeAlphaToken(prefix, index){
    let n = index;
    let label = '';
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return '\x00' + prefix + '_' + label + '\x00';
  }

  function sanitizeAllowedCharacters(text, role){
    let out = String(text || '');

    if (role === 'date') {
      out = out.replace(/[^\p{Script=Han}\p{L}\p{N}\s,$%\/\-:]/gu, '');
    } else {
      /* 主標／副標仍禁止一般逗號，但必須保留數字千分位中的半形逗號。
         先把合法的 1,200／12,345,678 暫存，再做字元過濾，最後還原。 */
      const commaMap = [];
      out = out.replace(/\d{1,3}(?:,\d{3})+/g, function(match){
        const token = makeAlphaToken('NUMCOMMA', commaMap.length);
        commaMap.push({ token: token, value: match });
        return token;
      });
      out = out.replace(/[^\p{Script=Han}\p{L}\p{N}\s$%\x00_]/gu, '');
      commaMap.forEach(function(item){ out = out.split(item.token).join(item.value); });
    }

    out = out.replace(/ /g, ' ');

    return out;
  }

  function applyStandardNumericRules(text, options){
    let out = String(text || '');

    // 斜線日期保護：MM/DD 及 MM/DD - MM/DD
    const slashDateMap = [];
    out = out.replace(/\b0*\d{1,2}\/0*\d{1,2}(?:\s*-\s*0*\d{1,2}\/0*\d{1,2})?\b/g, function(match){
      const normalized = match.replace(/[ \t]*-[ \t]*/g, ' - ');
      const key = makeAlphaToken('SLASHDATE', slashDateMap.length);
      slashDateMap.push({ token: key, value: normalized });
      return key;
    });

    // 冒號時間保護：HH:MM 前後最多2位數不加 $
    out = out.replace(/(\d{1,2}):(\d{1,2})/g, function(match){
      const key = makeAlphaToken('SLASHDATE', slashDateMap.length);
      slashDateMap.push({ token: key, value: match });
      return key;
    });

    // 百分比保護
    const percentMap = [];
    out = out.replace(/\b(\d{1,2})%/g, function(match){
      const key = makeAlphaToken('PERCENT', percentMap.length);
      percentMap.push({ token: key, value: match });
      return key;
    });

    const protectedMap = [];

    /* 蝦幣規則一定要早於一般 $ 金額，否則「蝦幣$120」中的 $120
       會先被鎖成一般金額，後續就無法移除 $。支援前後寫法與既有千分位。 */
    out = out.replace(/(蝦幣回饋|蝦幣)\s*\$?\s*([\d,]+)/g, function(match, keyword, digits){
      const clean = String(digits || '').replace(/,/g, '');
      if (!/^\d+$/.test(clean)) return match;
      const key = makeAlphaToken('SPECIALNUM', protectedMap.length);
      protectedMap.push({ token: key, value: keyword + formatNumericToken(clean, false) });
      return key;
    });
    out = out.replace(/(^|[^\d,\x00])\$?\s*([\d,]+)\s*(蝦幣回饋|蝦幣)/g, function(match, prefix, digits, keyword){
      const clean = String(digits || '').replace(/,/g, '');
      if (!/^\d+$/.test(clean)) return match;
      const key = makeAlphaToken('SPECIALNUM', protectedMap.length);
      protectedMap.push({ token: key, value: prefix + formatNumericToken(clean, false) + keyword });
      return key;
    });

    // 優先保護「已有 $ 前綴的數字」，同時補千分位
    out = out.replace(/\$([\d,]+)/g, function(match, digits){
      const clean = digits.replace(/,/g, '');
      if (!/^\d+$/.test(clean)) return match;
      const formatted = '$' + (clean.length >= 4 ? addThousandsSeparator(clean) : clean);
      const key = makeAlphaToken('SPECIALNUM', protectedMap.length);
      protectedMap.push({ token: key, value: formatted });
      return key;
    });

    // 保護 dollarExempt 清單中的數字
    const exemptList = (options && options.dollarExempt) || [];
    if (exemptList.length > 0) {
      const exemptPattern = new RegExp(
        '(?<![\\d$])(' + exemptList.map(function(n){ return n.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'); }).join('|') + ')(?!\\d)',
        'g'
      );
      out = out.replace(exemptPattern, function(match){
        const key = makeAlphaToken('SPECIALNUM', protectedMap.length);
        protectedMap.push({ token: key, value: match });
        return key;
      });
    }

    // 保護「數字+折/件/組/個...」
    out = out.replace(/(^|[^\d$,\x00])(\d{1,2})(?=[折件組個入盒包罐台支雙])/g, function(match, prefix, digits){
      const key = makeAlphaToken('SPECIALNUM', protectedMap.length);
      protectedMap.push({ token: key, value: prefix + digits });
      return key;
    });

    // 保護「數字+加+數字」
    out = out.replace(/(^|[^\d$,\x00])(\d+)(加)(\d+)/g, function(match, prefix, left, mid, right){
      const key = makeAlphaToken('SPECIALNUM', protectedMap.length);
      protectedMap.push({ token: key, value: prefix + left + mid + right });
      return key;
    });

    // 保護「買數字送數字」
    out = out.replace(/(買)(\d+)(送)(\d+)/g, function(match, buy, left, give, right){
      const key = makeAlphaToken('SPECIALNUM', protectedMap.length);
      protectedMap.push({ token: key, value: buy + left + give + right });
      return key;
    });

    // 加 $ 和千分位到所有裸數字
    out = out.replace(/(^|[^\d$,\x00])(\d[\d,]*)(?=$|[^\d,])/g, function(match, prefix, digits){
      const clean = String(digits || '').replace(/,/g, '');
      if (!/^\d+$/.test(clean)) return match;
      return prefix + formatNumericToken(clean, true);
    });

    // 還原所有保護的 token
    protectedMap.forEach(function(item){ out = out.split(item.token).join(item.value); });
    percentMap.forEach(function(item){   out = out.split(item.token).join(item.value); });
    slashDateMap.forEach(function(item){ out = out.split(item.token).join(item.value); });

    return out;
  }


  function normalizeSlashDateString(text){
    return String(text || '').replace(
      /\b0*(\d{1,2})\/0*(\d{1,2})(?:\s*-\s*0*(\d{1,2})\/0*(\d{1,2}))?\b/g,
      function(_, m1, d1, m2, d2){
        const left = Number(m1) + '/' + Number(d1);
        if (m2 && d2) {
          return left + ' - ' + Number(m2) + '/' + Number(d2);
        }
        return left;
      }
    );
  }

  function compactDigitsToDate(token){
    const raw = String(token || '').replace(/\D/g, '');
    if (!/^\d{3,4}$/.test(raw)) return null;

    let month, day;

    if (raw.length === 3) {
      month = Number(raw.slice(0, 1));
      day = Number(raw.slice(1));
    } else {
      const mm1 = Number(raw.slice(0, 1));
      const dd1 = Number(raw.slice(1));
      const mm2 = Number(raw.slice(0, 2));
      const dd2 = Number(raw.slice(2));

      const valid1 = mm1 >= 1 && mm1 <= 9 && dd1 >= 1 && dd1 <= 31;
      const valid2 = mm2 >= 1 && mm2 <= 12 && dd2 >= 1 && dd2 <= 31;

      if (valid2) {
        month = mm2;
        day = dd2;
      } else if (valid1) {
        month = mm1;
        day = dd1;
      } else {
        return null;
      }
    }

    if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
    return month + '/' + day;
  }

  function normalizeCompactDateInput(text){
    let out = String(text || '').trim();

    out = out.replace(
      /^\s*(\d{3,4})\s*-\s*(\d{3,4})\s*$/,
      function(_, a, b){
        const da = compactDigitsToDate(a);
        const db = compactDigitsToDate(b);
        if (da && db) return da + ' - ' + db;
        return _;
      }
    );

    out = out.replace(
      /^\s*(\d{3,4})\s*$/,
      function(_, a){
        const da = compactDigitsToDate(a);
        return da || _;
      }
    );

    return out;
  }

  function normalizeLeadingDateForDateRole(text){
    let out = String(text || '').trim();

    out = normalizeCompactDateInput(out);
    out = normalizeSlashDateString(out);

    const leadingDatePattern = /^(0*\d{1,2}\/0*\d{1,2}(?:\s*-\s*0*\d{1,2}\/0*\d{1,2})?)(\s*)([\s\S]*)$/;
    const match = out.match(leadingDatePattern);

    if (!match) return out;

    const datePart = normalizeSlashDateString(match[1]).replace(/\s*-\s*/g, ' - ');
    const rest = match[3] || '';

    if (rest) return datePart + ' ' + rest.replace(/^\s+/, '');
    return datePart;
  }

  function applyNumericRules(text, role, options){
    let out = String(text || '');

    if (role === 'date') {
      out = normalizeLeadingDateForDateRole(out);

      const match = out.match(/^(0*\d{1,2}\/0*\d{1,2}(?:\s*-\s*0*\d{1,2}\/0*\d{1,2})?)(\s*)([\s\S]*)$/);

      if (!match) {
        return applyStandardNumericRules(out, options);
      }

      const datePart = match[1];
      const spacer = match[2] || '';
      const rest = match[3] || '';

      if (!rest) return datePart;

      return datePart + spacer + applyStandardNumericRules(rest, options);
    }

    return applyStandardNumericRules(out, options);
  }

  function makeToken(prefix, index){
    return '__' + prefix + '_' + index + '__';
  }

  function protectExcludedSegments(text, excludeText){
    let out = String(text || '');
    const protectedMap = [];

    const excludes = splitList(excludeText);
    excludes.forEach(function(ex){
      if (!ex) return;

      const pattern = new RegExp(escapeRegExp(ex), 'g');
      out = out.replace(pattern, function(match){
        const token = makeToken('EXCLUDE', protectedMap.length);
        protectedMap.push({
          token: token,
          value: match
        });
        return token;
      });
    });

    return {
      text: out,
      protectedMap: protectedMap
    };
  }

  function restoreExcludedSegments(text, protectedMap){
    let out = String(text || '');
    (protectedMap || []).forEach(function(item){
      out = out.replace(item.token, item.value);
    });
    return out;
  }

  function calcUnits(str){
    let units = 0;
    const chars = String(str || '');
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === ',') units += 1;
      else if (/\p{Script=Han}/u.test(ch)) units += 1;
      else units += 0.5;
    }
    return units;
  }

  function trimTextToLimit(str, limit){
    if (!limit || !isFinite(limit)) return String(str || '');

    let out = '';
    let units = 0;
    const chars = String(str || '');

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const next = (ch === ',') ? 1 : (/\p{Script=Han}/u.test(ch) ? 1 : 0.5);
      if (units + next > limit) break;
      out += ch;
      units += next;
    }

    return out;
  }

  /*
   * 蝦幣金額必須先於 banwords.xlsx 規則保護。
   * Excel 內有「\$\d+\s*蝦幣 -> 蝦幣」等規則；若直接執行，
   * `$2000蝦幣` 會整段被替換成「蝦幣」，連 2000 都消失。
   * 這裡只針對「蝦幣＋數字」或「數字＋蝦幣」完整片段建立暫存 token，
   * 正規化為不含 $ 的千分位格式，再讓其他禁用語繼續處理。
   */
  function protectShopeeCoinAmounts(text){
    let out = String(text || '');
    const protectedMap = [];

    function keep(value){
      const token = makeAlphaToken('COINAMOUNT', protectedMap.length);
      protectedMap.push({ token: token, value: value });
      return token;
    }

    /* 蝦幣$2000／蝦幣 2,000／蝦幣回饋$2000 */
    out = out.replace(/(蝦幣回饋|蝦幣)\s*\$?\s*([\d,]+)/g, function(match, keyword, digits){
      const clean = String(digits || '').replace(/,/g, '');
      if (!/^\d+$/.test(clean)) return match;
      return keep(keyword + formatNumericToken(clean, false));
    });

    /* $2000蝦幣／2,000 蝦幣／$2000蝦幣回饋 */
    out = out.replace(/\$?\s*([\d,]+)\s*(蝦幣回饋|蝦幣)/g, function(match, digits, keyword){
      const clean = String(digits || '').replace(/,/g, '');
      if (!/^\d+$/.test(clean)) return match;
      return keep(formatNumericToken(clean, false) + keyword);
    });

    return { text: out, protectedMap: protectedMap };
  }

  function restoreProtectedMap(text, protectedMap){
    let out = String(text || '');
    (protectedMap || []).forEach(function(item){
      out = out.split(item.token).join(item.value);
    });
    return out;
  }

  /*
   * 全域「永遠保留」清單：不論 Excel 規則的排除欄怎麼設定，
   * 這裡列出的詞一律會在所有禁用語規則套用前被保護起來，
   * 處理完畢後再還原，確保像「百搭」這種詞不會被「百」這類
   * 單字禁用語誤傷。可用 banwordEngine.setAlwaysAllowedTerms()
   * 動態調整清單。
   */
  let alwaysAllowedTerms = ['百搭'];

  function getAlwaysAllowedTerms(){
    return alwaysAllowedTerms.slice();
  }

  function setAlwaysAllowedTerms(terms){
    alwaysAllowedTerms = Array.isArray(terms)
      ? terms.map(function(t){ return String(t || '').trim(); }).filter(Boolean)
      : [];
    return alwaysAllowedTerms.slice();
  }

  function protectAlwaysAllowedTerms(text){
    let out = String(text || '');
    const protectedMap = [];

    alwaysAllowedTerms.forEach(function(term){
      if (!term) return;
      const pattern = new RegExp(escapeRegExp(term), 'g');
      out = out.replace(pattern, function(match){
        const token = makeAlphaToken('ALWAYSOK', protectedMap.length);
        protectedMap.push({ token: token, value: match });
        return token;
      });
    });

    return { text: out, protectedMap: protectedMap };
  }

  function transformText(text, role, options){
    const original = String(text || '');
    let out = original;
    const messages = [];
    let changed = false;
    let blocked = false;

    const sanitizedBeforeRules = sanitizeAllowedCharacters(out, role);
    if (sanitizedBeforeRules !== out) {
      out = sanitizedBeforeRules;
      changed = true;
    }

    /* 先保護蝦幣金額，避免 Excel 的正規式替換把數字整段吃掉。 */
    const shopeeCoinProtected = protectShopeeCoinAmounts(out);
    out = shopeeCoinProtected.text;

    /* 再保護全域永遠允許的詞（例如「百搭」），避免被單字禁用語誤傷。 */
    const alwaysAllowedProtected = protectAlwaysAllowedTerms(out);
    out = alwaysAllowedProtected.text;

    getRules().forEach(function(rule){
      if (!rule.keyword) return;

      const protectedResult = protectExcludedSegments(out, rule.exclude);
      let workingText = protectedResult.text;
      const protectedMap = protectedResult.protectedMap;

      if (!testKeyword(workingText, rule.keyword)) {
        out = restoreExcludedSegments(workingText, protectedMap);
        return;
      }

      const replacement = parseReplacement(rule.rule);

      if (String(rule.rule || '').indexOf('自動改成') === 0 && replacement) {
        const next = replaceKeyword(workingText, rule.keyword, replacement);
        if (next !== workingText) {
          workingText = next;
          changed = true;
          if (rule.message) messages.push(rule.message);
        }
      } else if (rule.rule === '直接無法輸入') {
        const next = removeKeyword(workingText, rule.keyword);
        if (next !== workingText) {
          workingText = next;
          changed = true;
          blocked = true;
          if (rule.message) messages.push(rule.message);
        }
      }

      out = restoreExcludedSegments(workingText, protectedMap);
    });

    /* 還原全域永遠允許的詞。 */
    out = restoreProtectedMap(out, alwaysAllowedProtected.protectedMap);

    /* 還原已正規化的蝦幣金額，再執行其他一般數字規則。 */
    out = restoreProtectedMap(out, shopeeCoinProtected.protectedMap);

    const adjusted = applyNumericRules(out, role, options);
    if (adjusted !== out) {
      out = adjusted;
      changed = true;
    }

    const sanitizedAfterRules = sanitizeAllowedCharacters(out, role);
    if (sanitizedAfterRules !== out) {
      out = sanitizedAfterRules;
      changed = true;
    }

    // - 左右補空格：清掉 - 周圍任意空白後補成 ' - '（不含字串開頭的負號）
    out = out.replace(/(?<=.)[ \t]*-[ \t]*(?=\S)/g, ' - ');

    out = out.replace(/\s{2,}/g, ' ').trim();

    const uniqueMessages = Array.from(new Set(messages));
    return {
      text: out,
      changed: changed || out !== original,
      blocked: blocked,
      message: uniqueMessages.join('；'),
      messages: uniqueMessages,
      duration: 4000
    };
  }

  function applyToElement(el, options){
    options = options || {};

    // Blur-only safety guard:
    // Do not format while the user is actively typing.
    // Blur callers must pass { force: true }.
    if (
      el &&
      el.isContentEditable &&
      global.document &&
      document.activeElement === el &&
      !options.force
    ) {
      const currentText = (options.getText || getTextFromElement)(el);
      return {
        text: currentText,
        changed: false,
        blocked: false,
        message: '',
        messages: [],
        duration: 0,
        skipped: 'active-editing'
      };
    }

    const role = options.role || (el && el.dataset ? el.dataset.role : '');
    const getText = options.getText || getTextFromElement;
    const before = getText(el);
    let dollarExempt = [];
    if (el && el.dataset && el.dataset.dollarExempt) {
      try { dollarExempt = JSON.parse(el.dataset.dollarExempt); } catch(_) {}
    }
    const result = transformText(before, role, { dollarExempt: dollarExempt });

    if (el && result.text !== before) {
      const counter = el.querySelector('.counter');
      el.textContent = result.text;
      if (counter) el.appendChild(counter);
    }

    if (el) {
      if (result.blocked) el.classList.add('audit-error');
      else el.classList.remove('audit-error');
    }

    return result;
  }

  function getEditablePlainText(el){
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.counter,.audit-tip').forEach(function(node){
      node.remove();
    });
    return (clone.textContent || '').replace(/ /g, ' ');
  }

  function setEditableText(el, text){
    if (!el) return;
    const counter = el.querySelector('.counter');
    el.textContent = text;
    if (counter) el.appendChild(counter);
  }

  function installLiveInputGuards(){
    if (!global.document || !document.querySelectorAll) return;

    document.querySelectorAll('[contenteditable="true"]').forEach(function(el){
      if (el.dataset.banwordLiveGuardBound === '1') return;
      el.dataset.banwordLiveGuardBound = '1';

      const role = el.dataset.role || '';
      const limit = parseFloat(el.dataset.limit || '');

      el.addEventListener('beforeinput', function(e){
        if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
          e.preventDefault();
          return;
        }

        if (typeof e.data === 'string' && e.data) {
          const sanitizedIncoming = sanitizeAllowedCharacters(e.data, role);
          if (!sanitizedIncoming) {
            e.preventDefault();
            return;
          }
        }
      });

      function normalizeLiveEditable(){
        if (global.document && document.activeElement === el) return;

        const raw = getEditablePlainText(el);
        let dollarExempt = [];
        if (el.dataset && el.dataset.dollarExempt) {
          try { dollarExempt = JSON.parse(el.dataset.dollarExempt); } catch(_) {}
        }
        const result = transformText(raw, role, { dollarExempt: dollarExempt });

        if (result.text !== raw) {
          setEditableText(el, result.text);
        }

        if (result.blocked) el.classList.add('audit-error');
        else el.classList.remove('audit-error');
      }

      // Only normalize after the user leaves the editing area.
      // This prevents JS from rewriting text while the user is typing.
      el.addEventListener('blur', function(){
        // Use setTimeout to ensure activeElement has updated before we check.
        setTimeout(normalizeLiveEditable, 0);
      });

      el.addEventListener('paste', function(e){
        const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
        const sanitized = sanitizeAllowedCharacters(text, role);
        if (text !== sanitized) {
          e.preventDefault();
          try {
            document.execCommand('insertText', false, sanitized);
          } catch (err) {
            setEditableText(el, sanitizeAllowedCharacters(getEditablePlainText(el) + sanitized, role));
          }
        }
      });
    });
  }

  if (global.document) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', installLiveInputGuards);
    } else {
      installLiveInputGuards();
    }
  }

  global.__BANWORD_ENGINE_READY = true;
  console.log('[banword] engine ready: blur-only combined');

  global.banwordEngine = {
    rules: currentRules,
    getRules: getRules,
    setRules: function(rules){
      this.rules = setRules(rules);
      return this.rules;
    },
    convertExcelRowsToRules: convertExcelRowsToRules,
    loadRulesFromExcelArrayBuffer: function(arrayBuffer){
      this.rules = loadRulesFromExcelArrayBuffer(arrayBuffer);
      return this.rules;
    },
    getTextFromElement: getTextFromElement,
    transformText: transformText,
    applyToElement: applyToElement,
    sanitizeAllowedCharacters: sanitizeAllowedCharacters,
    calcUnits: calcUnits,
    trimTextToLimit: trimTextToLimit,
    getAlwaysAllowedTerms: getAlwaysAllowedTerms,
    setAlwaysAllowedTerms: setAlwaysAllowedTerms
  };
})(window);
