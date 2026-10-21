(() => {
  'use strict';

  const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
  const SPREADSHEET_EXTENSION = /\.(?:xlsx|xls|xlsm|csv)$/i;
  const FIELD_KEYWORD = /(logo|圖片|圖檔|商品圖|商品圖片|商品影像|商品照|商品素材|商品照片|品圖|主圖|副圖|小圖|圖像|image|img|photo|產品圖|贈品圖|贈品圖片|代言人|簽名圖|素材圖)/i;
  const LOGO_KEYWORD = /(logo|品牌標誌|品牌圖示|商標)/i;
  const BACKGROUND_KEYWORD = /(背景|底圖|bg|banner|kv|裝飾)/i;
  const EMPTY_VALUE = /^(?:-|--|n\/?a|na|none|null|無|未設定|不適用)$/i;
  const DEFAULT_COLUMN_WIDTH = 88;
  const DEFAULT_ROW_HEIGHT = 20;
  const MAX_CANVAS_SIDE = 30000;

  const el = {
    dropZone: document.getElementById('dropZone'),
    folderInput: document.getElementById('folderInput'),
    filesInput: document.getElementById('filesInput'),
    chooseFolder: document.getElementById('chooseFolder'),
    chooseFiles: document.getElementById('chooseFiles'),
    resultCanvas: document.getElementById('resultCanvas'),
    emptyCopy: document.getElementById('emptyCopy'),
    downloadButton: document.getElementById('downloadButton'),
    totalCount: document.getElementById('totalCount'),
    foundCount: document.getElementById('foundCount'),
    missingCount: document.getElementById('missingCount'),
    status: document.getElementById('status')
  };
  const ctx = el.resultCanvas.getContext('2d');
  const state = {
    files: [],
    images: [],
    imageByExactName: new Map(),
    imageByStem: new Map(),
    layout: null,
    fields: []
  };

  function setStatus(message, kind = '') {
    el.status.textContent = message;
    el.status.className = `status ${kind}`.trim();
  }

  function setMetrics(fields = []) {
    const found = fields.filter((field) => field.isFound).length;
    el.totalCount.textContent = fields.length || '0';
    el.foundCount.textContent = found || '0';
    el.missingCount.textContent = fields.length - found || '0';
  }

  function fileRecord(file, path = '') {
    return { file, path: path || file.webkitRelativePath || file.name };
  }

  function normaliseName(value) {
    return String(value ?? '')
      .trim()
      .replace(/^['"`]+|['"`]+$/g, '')
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      .trim()
      .toLocaleLowerCase();
  }

  function fileStem(value) {
    return normaliseName(value).replace(IMAGE_EXTENSION, '');
  }

  function splitReferences(value) {
    return String(value ?? '')
      .split(/[，,\n\r]+/)
      .map((part) => part.trim().replace(/^['"`]+|['"`]+$/g, ''))
      .filter((part) => part && !EMPTY_VALUE.test(part));
  }

  function addIndex(map, key, value) {
    if (!key) return;
    const list = map.get(key) || [];
    list.push(value);
    map.set(key, list);
  }

  function buildImageIndex() {
    state.images = state.files.filter((entry) => IMAGE_EXTENSION.test(entry.file.name));
    state.imageByExactName = new Map();
    state.imageByStem = new Map();
    state.images.forEach((entry) => {
      addIndex(state.imageByExactName, normaliseName(entry.file.name), entry);
      addIndex(state.imageByStem, fileStem(entry.file.name), entry);
    });
  }

  function findMatchingImage(reference) {
    const exact = state.imageByExactName.get(normaliseName(reference));
    if (exact?.length) return exact[0];

    // 與匯入工單相同：副檔名可不同；若同檔名主體有多張，便不任意猜測。
    const sameStem = state.imageByStem.get(fileStem(reference));
    return sameStem?.length === 1 ? sameStem[0] : null;
  }

  function isImageField(header) {
    const text = String(header ?? '').trim();
    return FIELD_KEYWORD.test(text) && !BACKGROUND_KEYWORD.test(text);
  }

  function hasExplicitImageReference(value) {
    return splitReferences(value).some((part) => IMAGE_EXTENSION.test(normaliseName(part)));
  }

  function isUsableReference(value, forcedByHeader = false) {
    const text = String(value ?? '').trim();
    if (!text || EMPTY_VALUE.test(text)) return false;
    if (hasExplicitImageReference(text)) return true;
    // 商品圖／LOGO 欄位有時只填檔名主體，不會填副檔名。
    return forcedByHeader && text.length <= 260 && !/^\d+(?:\.\d+)?$/.test(text);
  }

  function cellText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function excelColumnName(index) {
    let value = index + 1;
    let name = '';
    while (value > 0) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name;
  }

  function findHeaderRow(rows) {
    let best = { row: 0, score: 0 };
    const limit = Math.min(rows.length, 30);
    for (let r = 0; r < limit; r += 1) {
      const score = (rows[r] || []).reduce((total, value) => total + (isImageField(value) ? 1 : 0), 0);
      if (score > best.score) best = { row: r, score };
    }
    return best;
  }

  function findLocalHeader(rows, rowIndex, columnIndex, fallback) {
    for (let r = rowIndex - 1; r >= Math.max(0, rowIndex - 8); r -= 1) {
      const value = cellText(rows[r]?.[columnIndex]);
      if (isImageField(value)) return value;
    }
    for (let c = columnIndex - 1; c >= Math.max(0, columnIndex - 4); c -= 1) {
      const value = cellText(rows[rowIndex]?.[c]);
      if (isImageField(value)) return value;
    }
    return fallback || '';
  }

  function nearestContext(rows, rowIndex, columnIndex, expected) {
    const row = rows[rowIndex] || [];
    for (let c = 0; c < row.length; c += 1) {
      if (c === columnIndex) continue;
      const value = cellText(row[c]);
      if (value && value !== expected && value.length <= 72 && !isImageField(value)) return value;
    }
    return '';
  }

  function classifyType(header) {
    return LOGO_KEYWORD.test(header) ? 'LOGO 圖' : '商品圖';
  }

  function isTargetImageLabel(value) {
    const text = cellText(value);
    if (!text || text.length > 20 || BACKGROUND_KEYWORD.test(text)) return false;
    const normalized = text.replace(/[\s:：()（）\[\]【】\d]+/g, '').toLocaleLowerCase();
    return [
      '商品圖', '商品圖片', '商品圖檔', '商品影像', '商品照', '商品素材',
      '產品圖', '主圖', '副圖', '品圖', '贈品圖', '贈品圖片',
      'logo', 'logo圖', '品牌logo', '品牌標誌', '商標'
    ].includes(normalized);
  }

  function reviewColumnStart(worksheet, range) {
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const cell = worksheet[window.XLSX.utils.encode_cell({ r: row, c: column })];
        const value = cellText(cell?.w ?? cell?.v);
        if (/校稿區|檢查區|review/i.test(value)) return column;
      }
    }
    return Number.POSITIVE_INFINITY;
  }

  function scanLayoutFields(layout) {
    const { worksheet, name } = layout;
    const range = logicalRange(worksheet);
    const reviewStart = reviewColumnStart(worksheet, range);
    const fields = [];

    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
      for (let labelColumn = range.s.c; labelColumn < range.e.c; labelColumn += 1) {
        if (labelColumn >= reviewStart) continue;
        const labelCell = worksheet[window.XLSX.utils.encode_cell({ r: rowIndex, c: labelColumn })];
        const label = cellText(labelCell?.w ?? labelCell?.v);
        if (!isTargetImageLabel(label)) continue;

        // Layout_Output 的規則是：標籤（商品圖／LOGO）右邊一格為檔名輸入格，
        // 且該輸入格可能向右合併。因此框選 valueCell，而不是左側標籤。
        const valueColumn = labelColumn + 1;
        const valueCell = worksheet[window.XLSX.utils.encode_cell({ r: rowIndex, c: valueColumn })];
        const rawValue = cellText(valueCell?.w ?? valueCell?.v);
        const references = splitReferences(rawValue);
        const results = references.map((reference) => ({ reference, match: findMatchingImage(reference) }));
        const missingReferences = references.length
          ? results.filter((item) => !item.match).map((item) => item.reference)
          : ['未填檔名'];

        fields.push({
          rowIndex,
          columnIndex: valueColumn,
          labelCell: `${excelColumnName(labelColumn)}${rowIndex + 1}`,
          cell: `${excelColumnName(valueColumn)}${rowIndex + 1}`,
          header: label,
          type: classifyType(label),
          references,
          matches: results,
          isFound: references.length > 0 && missingReferences.length === 0,
          missingReferences,
          worksheet,
          sheetName: name
        });
      }
    }
    return fields;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"' && quoted && next === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { row.push(field); field = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') i += 1;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += char;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function sheetRows(worksheet) {
    return window.XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false, blankrows: false });
  }

  async function readSpreadsheet(entry) {
    const { file } = entry;
    if (!window.XLSX) throw new Error('Excel 讀取模組尚未載入，請確認 js/xlsx.full.min.js 與 index.html 位於同一資料夾。');
    if (/\.csv$/i.test(file.name)) {
      const rows = parseCsv(await file.text());
      const worksheet = window.XLSX.utils.aoa_to_sheet(rows);
      return [{ name: file.name.replace(/\.csv$/i, ''), worksheet, rows }];
    }
    const workbook = window.XLSX.read(await file.arrayBuffer(), {
      type: 'array',
      cellText: true,
      cellDates: false,
      cellStyles: true,
      cellNF: true
    });
    return workbook.SheetNames.map((name) => ({ name, worksheet: workbook.Sheets[name], rows: sheetRows(workbook.Sheets[name]) }));
  }

  async function getLayoutOutput(spreadsheetEntries) {
    const sheets = (await Promise.all(spreadsheetEntries.map(readSpreadsheet))).flat();
    const exact = sheets.find((sheet) => sheet.name.trim().toLocaleLowerCase() === 'layout_output');
    const similar = sheets.find((sheet) => /layout.*output/i.test(sheet.name));
    if (exact || similar) return exact || similar;
    if (sheets.length === 1) return sheets[0];
    throw new Error('找不到 Layout_Output 頁簽。請確認工單試算表中有此頁簽。');
  }

  function colorFrom(value, fallback) {
    if (!value) return fallback;
    if (typeof value === 'string') return value.startsWith('#') ? value : `#${value.slice(-6)}`;
    if (value.rgb) return `#${String(value.rgb).slice(-6)}`;
    const indexed = { 0: '#000000', 1: '#ffffff', 8: '#000000', 9: '#ffffff', 10: '#ff0000', 11: '#00ff00', 12: '#0000ff', 13: '#ffff00', 14: '#ff00ff', 15: '#00ffff', 64: '#ffffff' };
    return indexed[value.indexed] || fallback;
  }

  function pixelColumnWidth(worksheet, columnIndex) {
    const column = worksheet['!cols']?.[columnIndex];
    if (column?.hidden) return 0;
    if (Number.isFinite(column?.wpx)) return Math.max(1, Math.round(column.wpx));
    if (Number.isFinite(column?.width)) return Math.max(1, Math.round(column.width * 7 + 5));
    return DEFAULT_COLUMN_WIDTH;
  }

  function pixelRowHeight(worksheet, rowIndex) {
    const row = worksheet['!rows']?.[rowIndex];
    if (row?.hidden) return 0;
    if (Number.isFinite(row?.hpx)) return Math.max(1, Math.round(row.hpx));
    if (Number.isFinite(row?.hpt)) return Math.max(1, Math.round(row.hpt * 96 / 72));
    return DEFAULT_ROW_HEIGHT;
  }

  function key(row, column) { return `${row}:${column}`; }

  function logicalRange(worksheet) {
    let minRow = Number.POSITIVE_INFINITY;
    let minColumn = Number.POSITIVE_INFINITY;
    let maxRow = -1;
    let maxColumn = -1;
    const include = (row, column) => {
      minRow = Math.min(minRow, row);
      minColumn = Math.min(minColumn, column);
      maxRow = Math.max(maxRow, row);
      maxColumn = Math.max(maxColumn, column);
    };

    Object.entries(worksheet).forEach(([address, cell]) => {
      if (address.startsWith('!') || (!cell?.f && cell?.v === undefined)) return;
      const position = window.XLSX.utils.decode_cell(address);
      include(position.r, position.c);
    });
    (worksheet['!merges'] || []).forEach((merge) => {
      include(merge.s.r, merge.s.c);
      include(merge.e.r, merge.e.c);
    });
    if (maxRow < 0) return window.XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    return { s: { r: minRow, c: minColumn }, e: { r: maxRow, c: maxColumn } };
  }

  function buildGeometry(layout, range = logicalRange(layout.worksheet)) {
    const { worksheet } = layout;
    const xs = [0];
    const ys = [0];
    for (let column = range.s.c; column <= range.e.c; column += 1) xs.push(xs.at(-1) + pixelColumnWidth(worksheet, column));
    for (let row = range.s.r; row <= range.e.r; row += 1) ys.push(ys.at(-1) + pixelRowHeight(worksheet, row));
    const mergeAnchors = new Map();
    const covered = new Set();
    (worksheet['!merges'] || []).forEach((merge) => {
      if (merge.e.r < range.s.r || merge.s.r > range.e.r || merge.e.c < range.s.c || merge.s.c > range.e.c) return;
      mergeAnchors.set(key(merge.s.r, merge.s.c), merge);
      for (let row = merge.s.r; row <= merge.e.r; row += 1) {
        for (let column = merge.s.c; column <= merge.e.c; column += 1) {
          if (row !== merge.s.r || column !== merge.s.c) covered.add(key(row, column));
        }
      }
    });
    return { range, xs, ys, width: xs.at(-1), height: ys.at(-1), mergeAnchors, covered };
  }

  function previewRange(layout, fields) {
    const range = logicalRange(layout.worksheet);
    if (!fields.length) return range;
    const lastFieldColumn = fields.reduce((rightmost, field) => {
      const merge = mergeForCell(layout.worksheet, field.rowIndex, field.columnIndex);
      return Math.max(rightmost, merge ? merge.e.c : field.columnIndex);
    }, range.s.c);
    return {
      s: { ...range.s },
      e: { r: range.e.r, c: Math.min(range.e.c, lastFieldColumn) }
    };
  }

  function mergeForCell(worksheet, rowIndex, columnIndex) {
    return (worksheet['!merges'] || []).find((merge) => (
      rowIndex >= merge.s.r && rowIndex <= merge.e.r && columnIndex >= merge.s.c && columnIndex <= merge.e.c
    ));
  }

  function styleFor(cell) { return cell && typeof cell.s === 'object' ? cell.s : {}; }

  function borderWidth(style) {
    const widths = { hair: 1, thin: 1, medium: 2, thick: 3, double: 3, dashed: 1, dotted: 1, mediumDashed: 2, mediumDashDot: 2, mediumDashDotDot: 2 };
    return widths[style] || 1;
  }

  function drawBorder(x, y, width, height, border) {
    const sides = [
      ['top', x, y, x + width, y], ['right', x + width, y, x + width, y + height],
      ['bottom', x, y + height, x + width, y + height], ['left', x, y, x, y + height]
    ];
    sides.forEach(([side, x1, y1, x2, y2]) => {
      const rule = border?.[side];
      if (!rule?.style) return;
      ctx.strokeStyle = colorFrom(rule.color, '#98a5b5');
      ctx.lineWidth = borderWidth(rule.style);
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });
  }

  function textLines(text, maxWidth, wrap) {
    const paragraphs = String(text ?? '').split(/\r?\n/);
    if (!wrap) return paragraphs.map((line) => line || '');
    const lines = [];
    paragraphs.forEach((paragraph) => {
      if (!paragraph) { lines.push(''); return; }
      let line = '';
      for (const character of paragraph) {
        const candidate = line + character;
        if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = character; }
        else line = candidate;
      }
      lines.push(line);
    });
    return lines;
  }

  function drawCellText(cell, x, y, width, height, style) {
    const value = cell?.w ?? cell?.v;
    if (value === undefined || value === null || value === '') return;
    const font = style.font || {};
    const alignment = style.alignment || {};
    const fontSize = Math.max(8, Math.round((Number(font.sz) || 10) * 96 / 72));
    const family = font.name ? `"${font.name}", Arial, sans-serif` : 'Arial, sans-serif';
    ctx.font = `${font.bold ? '700' : '400'} ${font.italic ? 'italic ' : ''}${fontSize}px ${family}`;
    ctx.fillStyle = colorFrom(font.color, '#111827');
    const padding = 4;
    const lines = textLines(value, Math.max(1, width - padding * 2), Boolean(alignment.wrapText));
    const lineHeight = Math.round(fontSize * 1.25);
    const fullTextHeight = lines.length * lineHeight;
    const horizontal = alignment.horizontal || 'left';
    const vertical = alignment.vertical || 'center';
    let baseY = y + padding + fontSize;
    if (vertical === 'center') baseY = y + (height - fullTextHeight) / 2 + fontSize;
    if (vertical === 'bottom') baseY = y + height - padding - fullTextHeight + fontSize;

    ctx.save();
    ctx.beginPath(); ctx.rect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2)); ctx.clip();
    lines.forEach((line, lineIndex) => {
      const textWidth = ctx.measureText(line).width;
      let baseX = x + padding;
      if (horizontal === 'center' || horizontal === 'centerContinuous') baseX = x + (width - textWidth) / 2;
      if (horizontal === 'right') baseX = x + width - padding - textWidth;
      ctx.fillText(line, baseX, baseY + lineIndex * lineHeight);
    });
    ctx.restore();
  }

  function drawSheet(layout, geometry) {
    const { worksheet } = layout;
    const { range, xs, ys, mergeAnchors, covered } = geometry;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, geometry.width, geometry.height);
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        if (covered.has(key(row, column))) continue;
        const merge = mergeAnchors.get(key(row, column));
        const endRow = merge ? Math.min(merge.e.r, range.e.r) : row;
        const endColumn = merge ? Math.min(merge.e.c, range.e.c) : column;
        const x = xs[column - range.s.c]; const y = ys[row - range.s.r];
        const width = xs[endColumn - range.s.c + 1] - x;
        const height = ys[endRow - range.s.r + 1] - y;
        if (!width || !height) continue;
        const cell = worksheet[window.XLSX.utils.encode_cell({ r: row, c: column })];
        const style = styleFor(cell);
        ctx.fillStyle = colorFrom(style.fill?.fgColor, '#ffffff'); ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = '#e1e7ee'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, Math.max(0, width - 1), Math.max(0, height - 1));
        drawBorder(x, y, width, height, style.border);
        drawCellText(cell, x, y, width, height, style);
      }
    }
  }

  function fieldRect(field, geometry) {
    const { worksheet } = state.layout;
    const { range, xs, ys } = geometry;
    const merge = mergeForCell(worksheet, field.rowIndex, field.columnIndex);
    const startRow = merge ? merge.s.r : field.rowIndex;
    const endRow = merge ? merge.e.r : field.rowIndex;
    const startColumn = merge ? merge.s.c : field.columnIndex;
    const endColumn = merge ? merge.e.c : field.columnIndex;
    if (startRow < range.s.r || startColumn < range.s.c || endRow > range.e.r || endColumn > range.e.c) return null;
    const x = xs[startColumn - range.s.c]; const y = ys[startRow - range.s.r];
    return { x, y, width: xs[endColumn - range.s.c + 1] - x, height: ys[endRow - range.s.r + 1] - y };
  }

  function fieldAnnotationBottom(geometry) {
    return state.fields.reduce((bottom, field) => {
      if (field.isFound) return bottom;
      const rect = fieldRect(field, geometry);
      return rect ? Math.max(bottom, rect.y + rect.height + 20) : bottom;
    }, geometry.height);
  }

  function drawFieldFrames(geometry) {
    state.fields.forEach((field) => {
      const rect = fieldRect(field, geometry);
      if (!rect || rect.width < 2 || rect.height < 2) return;
      const color = field.isFound ? '#16a34a' : '#e3344b';
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = field.isFound ? 1.5 : 3;
      if (field.isFound) ctx.setLineDash([5, 4]);
      else {
        ctx.shadowColor = 'rgba(227, 52, 75, .28)';
        ctx.shadowBlur = 3;
      }
      ctx.strokeRect(rect.x + ctx.lineWidth / 2, rect.y + ctx.lineWidth / 2, rect.width - ctx.lineWidth, rect.height - ctx.lineWidth);
      ctx.restore();

      if (!field.isFound) {
        const label = '檔名與欄位名請一致';
        const fontSize = 12;
        const labelY = rect.y + rect.height + 14;
        ctx.save();
        ctx.font = `700 ${fontSize}px "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
        const labelWidth = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(255, 255, 255, .92)';
        ctx.fillRect(rect.x + 2, labelY - fontSize, labelWidth + 8, fontSize + 5);
        ctx.fillStyle = '#d7283d';
        ctx.fillText(label, rect.x + 6, labelY);
        ctx.restore();
      }
    });
  }

  function renderEmpty(message) {
    el.resultCanvas.width = 1200; el.resultCanvas.height = 620;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, el.resultCanvas.width, el.resultCanvas.height);
    el.emptyCopy.querySelector('strong').textContent = message || '等待工單資料';
    el.emptyCopy.classList.remove('is-hidden');
  }

  function renderLayout() {
    if (!state.layout) { renderEmpty(); return; }
    const geometry = buildGeometry(state.layout, previewRange(state.layout, state.fields));
    if (geometry.width > MAX_CANVAS_SIDE || geometry.height > MAX_CANVAS_SIDE || !geometry.width || !geometry.height) {
      renderEmpty('Layout_Output 尺寸過大');
      setStatus('Layout_Output 的範圍過大，無法輸出成單張圖片。請確認試算表是否有不必要的超大空白範圍。', 'error');
      return;
    }
    el.emptyCopy.classList.add('is-hidden');
    const annotationHeight = Math.max(0, Math.ceil(fieldAnnotationBottom(geometry) - geometry.height + 4));
    el.resultCanvas.width = Math.ceil(geometry.width); el.resultCanvas.height = Math.ceil(geometry.height + annotationHeight);
    drawSheet(state.layout, geometry);
    if (annotationHeight) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, geometry.height, geometry.width, annotationHeight);
    }
    drawFieldFrames(geometry);
  }

  function setReadyState(layout, fields) {
    state.layout = layout; state.fields = fields; setMetrics(fields); renderLayout(); el.downloadButton.disabled = false;
  }

  async function processFiles(entries) {
    if (!entries.length) return;
    state.files = entries; state.layout = null; state.fields = [];
    buildImageIndex(); setMetrics(); el.downloadButton.disabled = true;
    const spreadsheets = entries.filter((entry) => SPREADSHEET_EXTENSION.test(entry.file.name));
    if (!spreadsheets.length) {
      renderEmpty('找不到試算表');
      setStatus('找不到試算表：請確認資料夾內包含 .xlsx、.xls、.xlsm 或 .csv。', 'error');
      return;
    }
    setStatus(`正在讀取 Layout_Output 與 ${state.images.length} 張圖片…`);
    try {
      const layout = await getLayoutOutput(spreadsheets);
      const fields = scanLayoutFields(layout);
      setReadyState(layout, fields);
      const found = fields.filter((field) => field.isFound).length;
      const missing = fields.length - found;
      if (!fields.length) setStatus('已顯示 Layout_Output，但沒有辨識到商品圖或 LOGO 圖片欄位。', 'error');
      else if (missing) {
        const examples = fields.flatMap((field) => field.missingReferences).slice(0, 3).join('、');
        setStatus(`Layout_Output 已 1:1 繪製：${found} 個綠框、${missing} 個紅框。未找到：${examples}${missing > 3 ? '…' : ''}`, 'error');
      } else setStatus(`Layout_Output 已 1:1 繪製：${found} 個圖片欄位皆已找到。`, 'success');
    } catch (error) {
      console.error(error); renderEmpty('讀取失敗');
      setStatus(`讀取失敗：${error.message || '請確認試算表格式。'}`, 'error');
    }
  }

  async function traverseEntry(entry, path = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      return [fileRecord(file, `${path}${file.name}`)];
    }
    if (!entry.isDirectory) return [];
    const reader = entry.createReader(); const children = [];
    let batch;
    do { batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject)); children.push(...batch); } while (batch.length);
    return (await Promise.all(children.map((child) => traverseEntry(child, `${path}${entry.name}/`)))).flat();
  }

  async function readDroppedFiles(dataTransfer) {
    const entries = Array.from(dataTransfer.items || []).map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
    if (entries.length) return (await Promise.all(entries.map((entry) => traverseEntry(entry)))).flat();
    return Array.from(dataTransfer.files || []).map((file) => fileRecord(file));
  }

  function downloadCanvas() {
    if (!state.layout) return;
    const date = new Date();
    const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('');
    el.resultCanvas.toBlob((blob) => {
      if (!blob) { setStatus('圖片產生失敗，請重新嘗試下載。', 'error'); return; }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `Layout_Output_圖片欄位檢查_${stamp}.png`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }

  el.chooseFolder.addEventListener('click', () => { el.folderInput.value = ''; el.folderInput.click(); });
  el.chooseFiles.addEventListener('click', () => { el.filesInput.value = ''; el.filesInput.click(); });
  el.folderInput.addEventListener('change', (event) => processFiles(Array.from(event.target.files).map((file) => fileRecord(file))));
  el.filesInput.addEventListener('change', (event) => processFiles(Array.from(event.target.files).map((file) => fileRecord(file))));
  el.downloadButton.addEventListener('click', downloadCanvas);

  ['dragenter', 'dragover'].forEach((eventName) => el.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); el.dropZone.classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach((eventName) => el.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); el.dropZone.classList.remove('is-dragging'); }));
  el.dropZone.addEventListener('drop', async (event) => {
    try { processFiles(await readDroppedFiles(event.dataTransfer)); }
    catch (error) { console.error(error); setStatus('讀取拖拉的資料夾失敗，請改用「選擇資料夾」。', 'error'); }
  });

  renderEmpty();
})();
