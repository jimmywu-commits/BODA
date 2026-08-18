/*
 * 工單（.xlsx / .csv）匯入器。
 *
 * ── 為什麼不能寫死座標 ──
 * 工單範例裡吸底圖那一區，五格的起始欄是 2, 6, 10, 15, 19——寬度是 4, 4, 5, 4, 5，
 * 不固定（合併儲存格造成的）。任何「固定欄距」的寫法從第 3 格就會錯位。
 * 列號同理，工單一改版就位移。所以位置全部是「算出來」的，不是查表來的。
 *
 * ── 定位策略：多重訊號 ──
 * 主結構錨點是「同一列出現 2 個以上的 Icon：」——這是結構特徵，工單內容再怎麼換都在。
 * 找到之後再用其他訊號互相佐證並提高信心分數：
 *   A 欄含「吸底」、同列含 Nav.bar（純 ASCII，不受編碼/繁簡影響）、
 *   下方有 LOGO： 列、有磁碟路徑列。
 * 任一訊號單獨失效都不會致命。
 *
 * ── 欄位怎麼切 ──
 * 每一格的欄位範圍由 Icon： 的實際欄號推導：
 *   第 k 格 = [iconCols[k] - 1, iconCols[k+1] - 2]
 * （Icon： 左邊那一欄是 TRUE/FALSE 勾選欄，也是文案欄）。
 * 用範例工單驗證：iconCols = [3,7,11,16,20] → 格子範圍 [2-5][6-9][10-14][15-18][19-]，完全吻合。
 *
 * ── 文案列為什麼不能靠內容比對 ──
 * 範例工單裡是「文案05字內」，但真實工單裡那格是實際文案。
 * 所以文案列的定位方式是「區塊內排除掉 Icon 列、LOGO 列、路徑列之後剩下的那一列」。
 */
(function () {
  var SHEETJS_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

  var MIN_GROUPS = 2;
  var MAX_GROUPS = 5;
  var BLOCK_SCAN_ROWS = 8; // 從 Icon 列往下最多看幾列

  var RE_ICON = /^icon\s*[：:]/i;
  var RE_LOGO = /^logo\s*[：:]/i;
  var RE_PATH = /^(?:[a-z]:[\\/]|\\\\)/i;
  var RE_NAVBAR = /nav\.?\s*bar/i;
  var RE_STICKY = /吸底/;
  var RE_NUMERIC = /^-?\d+(\.\d+)?$/;

  var loadingPromise = null;

  function loadSheetJs() {
    if (window.XLSX) return Promise.resolve();
    if (loadingPromise) return loadingPromise;

    loadingPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = SHEETJS_URL;
      script.onload = function () { resolve(); };
      script.onerror = function () {
        loadingPromise = null;
        reject(new Error("無法載入試算表元件 SheetJS，請確認網路連線"));
      };
      document.head.appendChild(script);
    });
    return loadingPromise;
  }

  /* ---------------- 小工具 ---------------- */

  function str(v) {
    if (v === null || v === undefined) return "";
    var s = String(v).trim();
    // 上游工具偶爾會把 undefined/null 寫成字面字串進儲存格，那不是內容
    if (s === "undefined" || s === "null") return "";
    return s;
  }

  function cell(rows, r, c) {
    return rows[r] ? str(rows[r][c]) : "";
  }

  function colsMatching(row, re) {
    var out = [];
    if (!row) return out;
    for (var c = 0; c < row.length; c++) {
      if (re.test(str(row[c]))) out.push(c);
    }
    return out;
  }

  function rowHasAny(row, re) {
    if (!row) return false;
    for (var c = 0; c < row.length; c++) {
      if (re.test(str(row[c]))) return true;
    }
    return false;
  }

  function toBool(v) {
    var s = str(v).toLowerCase();
    if (s === "true" || s === "yes" || s === "1" || s === "v" || s === "✓" || s === "是") return true;
    if (s === "false" || s === "no" || s === "0" || s === "否" || s === "") return false;
    return null; // 不是布林值
  }

  function stripLabel(v, re) {
    return str(v).replace(re, "").replace(/^\s*[：:]\s*/, "").trim();
  }

  /* ---------------- 區塊分析 ---------------- */

  /*
   * 把 Icon： 的欄號換算成每一格的欄位範圍。
   * 最後一格刻意不吃到列尾——工單右側常有「視覺參考 / 指定」之類的無關欄位，
   * 全吃進來會把那些內容誤判成文案。改成用前面幾格的最大寬度當上限。
   */
  function buildSpans(iconCols, rowLength) {
    var starts = iconCols.map(function (c) {
      return Math.max(0, c - 1);
    });

    var spans = [];
    var maxWidth = 0;
    for (var i = 0; i < starts.length - 1; i++) {
      var w = starts[i + 1] - starts[i];
      if (w > maxWidth) maxWidth = w;
    }
    if (!maxWidth) maxWidth = 4;

    for (var k = 0; k < starts.length; k++) {
      var end =
        k < starts.length - 1
          ? starts[k + 1] - 1
          : Math.min(rowLength - 1, starts[k] + maxWidth - 1);
      spans.push({ start: starts[k], end: Math.max(starts[k], end) });
    }
    return spans;
  }

  function findInSpan(rows, r, span, predicate) {
    var row = rows[r];
    if (!row) return null;
    for (var c = span.start; c <= span.end; c++) {
      var v = str(row[c]);
      if (predicate(v, c)) return { col: c, value: v };
    }
    return null;
  }

  /*
   * 從 Icon 列往下找同一區塊的其他列。
   * 邊界：碰到「A 欄有值」就停——那是下一個素材區段的開頭。
   */
  function scanBlockRows(rows, iconRow) {
    var out = [];
    for (var r = iconRow + 1; r < rows.length && r <= iconRow + BLOCK_SCAN_ROWS; r++) {
      if (cell(rows, r, 0)) break;
      out.push(r);
    }
    return out;
  }

  function analyseBlock(rows, iconRow, iconCols, sheetName) {
    var row = rows[iconRow] || [];
    var spans = buildSpans(iconCols, row.length);
    var below = scanBlockRows(rows, iconRow);

    var signals = [];
    var score = 3; // 有 2 個以上 Icon： 就先給基礎分
    signals.push(iconCols.length + " 個 Icon：");

    if (RE_STICKY.test(cell(rows, iconRow, 0)) || RE_STICKY.test(cell(rows, iconRow, 1))) {
      score += 5;
      signals.push("A/B 欄有「吸底」");
    }
    if (rowHasAny(row, RE_NAVBAR)) {
      score += 4;
      signals.push("Nav.bar");
    }

    var logoRow = null;
    var pathRow = null;
    below.forEach(function (r) {
      if (logoRow === null && colsMatching(rows[r], RE_LOGO).length >= MIN_GROUPS) logoRow = r;
      if (pathRow === null && colsMatching(rows[r], RE_PATH).length >= MIN_GROUPS) pathRow = r;
    });
    if (logoRow !== null) { score += 3; signals.push("LOGO： 列"); }
    if (pathRow !== null) { score += 2; signals.push("素材路徑列"); }

    /*
     * 文案列：區塊內排除掉 LOGO 列、路徑列之後，第一列「在 2 格以上有非數字內容」的。
     * 不能用內容比對——真實工單那格是實際文案，不是固定字樣。
     */
    var textRow = null;
    for (var i = 0; i < below.length; i++) {
      var r = below[i];
      if (r === logoRow || r === pathRow) continue;
      var filled = 0;
      spans.forEach(function (span) {
        var hit = findInSpan(rows, r, span, function (v) {
          return v && !RE_NUMERIC.test(v) && !RE_PATH.test(v) && toBool(v) === null;
        });
        if (hit) filled++;
      });
      if (filled >= MIN_GROUPS) { textRow = r; break; }
    }

    /*
     * 找不到文案列就直接放棄這個區塊。
     * 硬吃下去只會匯入一整排空文案——那比「沒匯到」更糟，因為看起來像成功了。
     */
    if (textRow === null) return null;
    score += 3;
    signals.push("文案列");

    /*
     * 門檻 8 的意思是：光有「Icon： + 文案列」（3+3=6）不夠，
     * 一定要再有至少一個獨立佐證（吸底 +5 / Nav.bar +4 / LOGO 列 +3 / 路徑列 +2）。
     * 兩個以上互相獨立的結構訊號才算數，單一巧合不會通過。
     */
    if (score < 8) return null;

    var groups = spans.map(function (span, k) {
      var iconCol = iconCols[k];
      var iconName = stripLabel(cell(rows, iconRow, iconCol), RE_ICON);

      var logoHit = logoRow === null ? null : findInSpan(rows, logoRow, span, function (v) {
        return RE_LOGO.test(v);
      });
      var logoName = logoHit ? stripLabel(logoHit.value, RE_LOGO) : "";

      var iconFlag = findInSpan(rows, iconRow, span, function (v, c) {
        return c !== iconCol && toBool(v) !== null && v !== "";
      });
      var logoFlag = logoRow === null ? null : findInSpan(rows, logoRow, span, function (v, c) {
        return (!logoHit || c !== logoHit.col) && toBool(v) !== null && v !== "";
      });

      // 勾了 LOGO 就是廠商 LOGO（配色規則不同：不套橘/紅，只返灰）
      var isLogo = logoFlag ? toBool(logoFlag.value) === true : false;

      var textHit = textRow === null ? null : findInSpan(rows, textRow, span, function (v) {
        return v && !RE_NUMERIC.test(v) && !RE_PATH.test(v) && toBool(v) === null;
      });
      var pathHit = pathRow === null ? null : findInSpan(rows, pathRow, span, function (v) {
        return RE_PATH.test(v);
      });

      return {
        index: k,
        columns: [span.start, span.end],
        type: isLogo ? "logo" : "icon",
        iconName: iconName,
        logoName: logoName,
        name: isLogo ? logoName || iconName : iconName || logoName,
        iconChecked: iconFlag ? toBool(iconFlag.value) : null,
        logoChecked: logoFlag ? toBool(logoFlag.value) : null,
        text: textHit ? textHit.value : "",
        assetPath: pathHit ? pathHit.value : "",
      };
    });

    // 尾端整格空白（沒文案、沒 icon 名、沒 LOGO 名）就砍掉——工單常留著沒用到的格子
    while (groups.length > MIN_GROUPS) {
      var last = groups[groups.length - 1];
      if (last.text || last.iconName || last.logoName) break;
      groups.pop();
    }

    return {
      sheetName: sheetName,
      iconRow: iconRow,
      logoRow: logoRow,
      pathRow: pathRow,
      textRow: textRow,
      score: score,
      signals: signals,
      groups: groups,
    };
  }

  function detectBlocks(rows, sheetName) {
    var blocks = [];
    for (var r = 0; r < rows.length; r++) {
      var iconCols = colsMatching(rows[r], RE_ICON);
      if (iconCols.length < MIN_GROUPS) continue;
      var block = analyseBlock(rows, r, iconCols, sheetName);
      if (block) blocks.push(block);
    }
    return blocks;
  }

  function sheetToRows(workbook, name) {
    return window.XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      defval: "",
      blankrows: true,
      raw: false, // 布林轉成 "TRUE"/"FALSE" 字串，數字轉成顯示值
    });
  }

  function analyseWorkbook(workbook) {
    var blocks = [];
    workbook.SheetNames.forEach(function (name) {
      detectBlocks(sheetToRows(workbook, name), name).forEach(function (b) {
        blocks.push(b);
      });
    });
    return blocks;
  }

  /* ---------------- 對回素材庫 ---------------- */

  function norm(s) {
    return str(s).toLowerCase().replace(/\s+/g, "");
  }

  /*
   * 名稱比對，由嚴到寬：同型別完全相同 → 完全相同 → 同型別包含 → 包含。
   * 對不上就回 null，讓 UI 明講「這格要人工選」，不硬塞一個看起來像的。
   */
  function matchLibraryIcon(library, name, type) {
    var n = norm(name);
    if (!n) return null;

    var passes = [
      function (i) { return i.type === type && norm(i.displayName) === n; },
      function (i) { return norm(i.displayName) === n; },
      function (i) { return i.type === type && (norm(i.displayName).indexOf(n) >= 0 || n.indexOf(norm(i.displayName)) >= 0); },
      function (i) { return norm(i.displayName).indexOf(n) >= 0 || n.indexOf(norm(i.displayName)) >= 0; },
    ];

    for (var p = 0; p < passes.length; p++) {
      for (var i = 0; i < library.length; i++) {
        if (passes[p](library[i])) return library[i];
      }
    }
    return null;
  }

  /*
   * 把偵測結果變成 banner 陣列，同時產生一份「發生了什麼」的報告。
   * 報告要夠具體（第幾條第幾格、原文是什麼），使用者才有辦法核對。
   */
  function toBanners(blocks, library) {
    var notes = [];
    var banners = blocks.map(function (block, bi) {
      var groups = block.groups.slice(0, MAX_GROUPS);
      if (block.groups.length > MAX_GROUPS) {
        notes.push(
          "第 " + (bi + 1) + " 條偵測到 " + block.groups.length + " 格，超過上限 " +
            MAX_GROUPS + "，只取前 " + MAX_GROUPS + " 格"
        );
      }

      var banner = window.BannerFactory.create(Math.max(MIN_GROUPS, groups.length));

      banner.slots = banner.slots.map(function (slot, i) {
        var g = groups[i];
        if (!g) return slot;

        // 工單的文案原樣帶進來，不截斷；超過 5 字只提醒，欄位會轉成紅框
        if (window.TextLimit.isOver(g.text)) {
          notes.push(
            "第 " + (bi + 1) + " 條第 " + (i + 1) + " 格文案「" + g.text + "」是 " +
              window.TextLimit.format(window.TextLimit.countUnits(g.text)) + " 字，超過建議的 " +
              window.TextLimit.MAX_UNITS + " 字"
          );
        }

        var matched = matchLibraryIcon(library, g.name, g.type);
        if (g.name && !matched) {
          notes.push(
            "第 " + (bi + 1) + " 條第 " + (i + 1) + " 格的" +
              (g.type === "logo" ? "LOGO" : "Icon") + "「" + g.name + "」素材庫裡沒有，需人工選或上傳"
          );
        }

        return Object.assign({}, slot, {
          text: g.text,
          iconId: matched ? matched.id : null,
          type: matched ? matched.type : g.type,
        });
      });

      return banner;
    });

    return { banners: banners, notes: notes };
  }

  function summarise(blocks) {
    return blocks.map(function (b, i) {
      return (
        "第 " + (i + 1) + " 條：" + (b.sheetName ? b.sheetName + " " : "") +
        "第 " + (b.iconRow + 1) + " 列，" + b.groups.length + " 格（" +
        b.groups.map(function (g) { return g.text || "（無文案）"; }).join(" / ") + "）"
      );
    });
  }

  /* ---------------- 進入點 ---------------- */

  function parseFile(file, onDone, onError) {
    var isCsv = /\.csv$/i.test(file.name);

    loadSheetJs()
      .then(function () {
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var wb = isCsv
              ? window.XLSX.read(ev.target.result, { type: "string" })
              : window.XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
            var blocks = analyseWorkbook(wb);
            if (!blocks.length) {
              throw new Error(
                "在這份工單裡找不到吸底圖區塊。偵測方式是找「同一列有 2 個以上的 Icon：」，" +
                  "請確認工單包含該區塊，或工單格式是否有大幅變動。"
              );
            }
            onDone(blocks);
          } catch (e) {
            onError(e);
          }
        };
        reader.onerror = function () {
          onError(new Error("讀取檔案失敗。"));
        };
        // CSV 明確指定 UTF-8，避免中文變亂碼；xlsx 是二進位，沒有編碼問題
        if (isCsv) reader.readAsText(file, "UTF-8");
        else reader.readAsArrayBuffer(file);
      })
      .catch(onError);
  }

  window.WorkOrderImporter = {
    parseFile: parseFile,
    detectBlocks: detectBlocks,
    analyseWorkbook: analyseWorkbook,
    toBanners: toBanners,
    summarise: summarise,
    matchLibraryIcon: matchLibraryIcon,
  };
})();
