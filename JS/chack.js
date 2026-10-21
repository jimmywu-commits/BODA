(() => {
  'use strict';

  const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
  const SPREADSHEET_EXTENSION = /\.(?:xlsx|xls|xlsm|csv)$/i;
  const FIELD_KEYWORD = /(logo|圖片|圖檔|商品圖|商品圖片|商品影像|商品照|商品素材|商品照片|品圖|主圖|副圖|小圖|圖像|image|img|photo|產品圖|贈品圖|贈品圖片|代言人|簽名圖|素材圖)/i;
  const LOGO_KEYWORD = /(logo|品牌標誌|品牌圖示|商標)/i;
  const EMPTY_VALUE = /^(?:-|--|n\/?a|na|none|null|無|未設定|不適用)$/i;
  const CANVAS_WIDTH = 1600;

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
    previewUrls: [],
    items: [],
    renderQueued: false
  };

  function setStatus(message, kind = '') {
    el.status.textContent = message;
    el.status.className = `status ${kind}`.trim();
  }

  function setMetrics(items = []) {
    const found = items.filter((item) => item.match).length;
    const missing = items.length - found;
    el.totalCount.textContent = items.length || '0';
    el.foundCount.textContent = found || '0';
    el.missingCount.textContent = missing || '0';
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
    const filename = normaliseName(value);
    return filename.replace(IMAGE_EXTENSION, '');
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

  function clearPreviewUrls() {
    state.previewUrls.forEach((url) => URL.revokeObjectURL(url));
    state.previewUrls = [];
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
    const exactMatches = state.imageByExactName.get(normaliseName(reference));
    if (exactMatches?.length) return exactMatches[0];

    // 與匯入工單相同：副檔名可不同，但檔名主體要相同；同名多張時不猜測。
    const stemMatches = state.imageByStem.get(fileStem(reference));
    return stemMatches?.length === 1 ? stemMatches[0] : null;
  }

  function isImageField(header) {
    return FIELD_KEYWORD.test(String(header ?? '').trim());
  }

  function hasExplicitImageReference(value) {
    return splitReferences(value).some((part) => IMAGE_EXTENSION.test(normaliseName(part)));
  }

  function isUsableReference(value, forcedByHeader = false) {
    const text = String(value ?? '').trim();
    if (!text || EMPTY_VALUE.test(text)) return false;
    if (hasExplicitImageReference(text)) return true;
    if (!forcedByHeader) return false;
    // 真正的圖片欄位常只填檔名，不一定會保留副檔名。
    return text.length <= 260 && !/^\d+(?:\.\d+)?$/.test(text);
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

  function cellText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
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

  function nearestContext(rows, rowIndex, columnIndex, reference) {
    const row = rows[rowIndex] || [];
    for (let c = 0; c < row.length; c += 1) {
      if (c === columnIndex) continue;
      const value = cellText(row[c]);
      if (value && value !== reference && value.length <= 72) return value;
    }
    return '';
  }

  function classifyType(header) {
    return LOGO_KEYWORD.test(header) ? 'LOGO 圖' : '商品圖';
  }

  function makeItem({ sheetName, rowIndex, columnIndex, header, reference, context }) {
    return {
      sheetName,
      cell: `${excelColumnName(columnIndex)}${rowIndex + 1}`,
      header: cellText(header) || '圖片欄位',
      type: classifyType(header),
      reference: normaliseName(reference) || String(reference).trim(),
      context,
      match: findMatchingImage(reference)
    };
  }

  function scanSheet(sheetName, rows) {
    const items = [];
    const seen = new Set();
    const headerInfo = findHeaderRow(rows);
    const headerRow = rows[headerInfo.row] || [];

    const addReferences = (rowIndex, columnIndex, header, value, context) => {
      if (!isUsableReference(value, isImageField(header))) return;
      splitReferences(value).forEach((reference) => {
        const itemKey = `${sheetName}:${rowIndex}:${columnIndex}:${reference}`;
        if (seen.has(itemKey)) return;
        seen.add(itemKey);
        items.push(makeItem({ sheetName, rowIndex, columnIndex, header, reference, context }));
      });
    };

    // 有可辨識欄位名稱時，欄位下所有非空圖片檔名都會被檢查。
    if (headerInfo.score > 0) {
      headerRow.forEach((header, columnIndex) => {
        if (!isImageField(header)) return;
        for (let rowIndex = headerInfo.row + 1; rowIndex < rows.length; rowIndex += 1) {
          const value = rows[rowIndex]?.[columnIndex];
          addReferences(
            rowIndex,
            columnIndex,
            header,
            value,
            nearestContext(rows, rowIndex, columnIndex, cellText(value))
          );
        }
      });
    }

    // 保留彈性：非標準欄名只要本身明確填了 .png/.jpg 等，也可被找出來。
    rows.forEach((row, rowIndex) => {
      (row || []).forEach((value, columnIndex) => {
        if (!hasExplicitImageReference(value)) return;
        const header = headerRow[columnIndex] || `欄位 ${excelColumnName(columnIndex)}`;
        addReferences(
          rowIndex,
          columnIndex,
          header,
          value,
          nearestContext(rows, rowIndex, columnIndex, cellText(value))
        );
      });
    });
    return items;
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

  async function readSpreadsheet(entry) {
    const { file } = entry;
    if (/\.csv$/i.test(file.name) && !window.XLSX) {
      return [{ name: file.name, rows: parseCsv(await file.text()) }];
    }
    if (!window.XLSX) throw new Error('Excel 讀取模組尚未載入。請連上網路後重新開啟此工具，或改用 CSV 格式。');
    const data = await file.arrayBuffer();
    const workbook = window.XLSX.read(data, { type: 'array', cellText: true, cellDates: false });
    const preferredName = workbook.SheetNames.find((name) => name.trim().toLocaleLowerCase() === 'layout_output')
      || workbook.SheetNames.find((name) => /layout.*output/i.test(name));
    const names = preferredName ? [preferredName] : workbook.SheetNames;
    return names.map((name) => ({
      name,
      rows: window.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: false, blankrows: false })
    }));
  }

  async function collectItems(spreadsheetEntries) {
    const sheets = (await Promise.all(spreadsheetEntries.map(readSpreadsheet))).flat();
    return sheets.flatMap((sheet) => scanSheet(sheet.name, sheet.rows));
  }

  function scheduleRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      drawCanvas();
    });
  }

  function prepareImagePreviews() {
    const uniqueMatches = new Map();
    state.items.forEach((item) => {
      if (item.match) uniqueMatches.set(item.match.path, item.match);
    });
    uniqueMatches.forEach((entry) => {
      const url = URL.createObjectURL(entry.file);
      state.previewUrls.push(url);
      const image = new Image();
      image.onload = () => { entry.preview = image; scheduleRender(); };
      image.onerror = () => scheduleRender();
      image.src = url;
    });
  }

  function roundRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function truncate(text, max) {
    const string = String(text ?? '');
    return string.length > max ? `${string.slice(0, Math.max(1, max - 1))}…` : string;
  }

  function drawFittedImage(context, image, x, y, width, height) {
    const ratio = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * ratio;
    const drawHeight = image.naturalHeight * ratio;
    context.save();
    roundRect(context, x, y, width, height, 8);
    context.clip();
    context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
    context.restore();
  }

  function drawText(context, text, x, y, options = {}) {
    const { color = '#182230', font = '500 21px sans-serif', max = 46 } = options;
    context.fillStyle = color;
    context.font = font;
    context.fillText(truncate(text, max), x, y);
  }

  function drawCard(item, x, y, width, height) {
    const ok = Boolean(item.match);
    const border = ok ? '#20a24a' : '#e1374c';
    const fill = ok ? '#f0fcf4' : '#fff3f5';
    const dark = ok ? '#176a35' : '#a91d32';
    const previewX = x + 18;
    const previewY = y + 18;
    const previewWidth = 154;
    const previewHeight = height - 36;
    const textX = previewX + previewWidth + 20;

    ctx.save();
    ctx.shadowColor = 'rgba(19, 40, 73, .08)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    roundRect(ctx, x, y, width, height, 16);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 4;
    ctx.strokeStyle = border;
    ctx.stroke();
    ctx.restore();

    roundRect(ctx, previewX, previewY, previewWidth, previewHeight, 10);
    ctx.fillStyle = ok ? '#def6e6' : '#ffe0e5';
    ctx.fill();
    if (item.match?.preview?.complete && item.match.preview.naturalWidth) {
      drawFittedImage(ctx, item.match.preview, previewX, previewY, previewWidth, previewHeight);
    } else {
      ctx.fillStyle = ok ? '#51ab6d' : '#e47a8a';
      ctx.font = '700 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ok ? '圖片' : '？', previewX + previewWidth / 2, previewY + previewHeight / 2 + 8);
      ctx.textAlign = 'left';
    }

    roundRect(ctx, textX, y + 18, 108, 34, 17);
    ctx.fillStyle = ok ? '#d9f5e2' : '#ffdce2';
    ctx.fill();
    drawText(ctx, ok ? '✓ 已找到' : '× 未找到', textX + 16, y + 42, { color: dark, font: '700 17px sans-serif', max: 10 });

    drawText(ctx, item.type, textX + 126, y + 42, { color: '#36516e', font: '700 18px sans-serif', max: 12 });
    drawText(ctx, `${item.sheetName} · ${item.cell}`, textX, y + 83, { color: '#60758d', font: '500 16px sans-serif', max: 38 });
    drawText(ctx, `欄位：${item.header}`, textX, y + 116, { color: '#182230', font: '700 20px sans-serif', max: 38 });
    drawText(ctx, `需要：${item.reference}`, textX, y + 150, { color: '#344a62', font: '500 18px sans-serif', max: 42 });

    if (item.context) {
      drawText(ctx, `資料：${item.context}`, textX, y + 181, { color: '#71849a', font: '500 16px sans-serif', max: 42 });
    }
    if (ok) {
      drawText(ctx, `找到：${item.match.file.name}`, textX, y + height - 22, { color: '#16803c', font: '700 17px sans-serif', max: 42 });
    } else {
      drawText(ctx, '檔名與欄位需完全一致', textX, y + height - 22, { color: '#cf253b', font: '700 18px sans-serif', max: 38 });
    }
  }

  function drawCanvas() {
    const { items } = state;
    const columns = items.length > 66 ? 3 : 2;
    const outer = 58;
    const gap = 28;
    const cardHeight = 232;
    const cardWidth = Math.floor((CANVAS_WIDTH - outer * 2 - gap * (columns - 1)) / columns);
    const rowCount = Math.max(1, Math.ceil(items.length / columns));
    const canvasHeight = Math.max(440, 192 + rowCount * cardHeight + Math.max(0, rowCount - 1) * gap + outer);

    el.resultCanvas.width = CANVAS_WIDTH;
    el.resultCanvas.height = canvasHeight;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_WIDTH, canvasHeight);

    ctx.fillStyle = '#182230';
    ctx.font = '800 38px sans-serif';
    ctx.fillText('工單圖片欄位檢查結果', outer, 66);
    ctx.fillStyle = '#64748b';
    ctx.font = '500 20px sans-serif';
    const found = items.filter((item) => item.match).length;
    ctx.fillText(`共 ${items.length} 個圖片欄位 · 已找到 ${found} 個 · 未找到 ${items.length - found} 個`, outer, 104);
    ctx.fillStyle = '#e7edf5';
    ctx.fillRect(outer, 132, CANVAS_WIDTH - outer * 2, 2);

    if (!items.length) {
      ctx.fillStyle = '#50627a';
      ctx.font = '700 26px sans-serif';
      ctx.fillText('試算表中尚未找到可辨識的圖片欄位。', outer, 200);
      ctx.font = '500 19px sans-serif';
      ctx.fillStyle = '#73849a';
      ctx.fillText('請確認欄位名稱含有「商品圖」、「圖片」、「LOGO」等文字，或儲存格填寫 .png／.jpg 檔名。', outer, 236);
      return;
    }

    items.forEach((item, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = outer + column * (cardWidth + gap);
      const y = 166 + row * (cardHeight + gap);
      drawCard(item, x, y, cardWidth, cardHeight);
    });
  }

  function setReadyState(items) {
    state.items = items;
    setMetrics(items);
    el.emptyCopy.classList.add('is-hidden');
    el.downloadButton.disabled = items.length === 0;
    prepareImagePreviews();
    drawCanvas();
  }

  async function processFiles(entries) {
    if (!entries.length) return;
    clearPreviewUrls();
    state.files = entries;
    state.items = [];
    buildImageIndex();
    setMetrics();
    el.downloadButton.disabled = true;
    el.emptyCopy.classList.add('is-hidden');

    const spreadsheets = entries.filter((entry) => SPREADSHEET_EXTENSION.test(entry.file.name));
    if (!spreadsheets.length) {
      drawCanvas();
      setStatus('找不到試算表：請確認資料夾內包含 .xlsx、.xls、.xlsm 或 .csv。', 'error');
      return;
    }
    setStatus(`正在掃描 ${entries.length} 個檔案、${state.images.length} 張圖片與 ${spreadsheets.length} 份試算表…`);
    try {
      const items = await collectItems(spreadsheets);
      setReadyState(items);
      if (!items.length) {
        setStatus('已讀取試算表，但沒有辨識到圖片欄位。請檢查欄位名稱或圖片檔名格式。', 'error');
      } else {
        const found = items.filter((item) => item.match).length;
        const missing = items.length - found;
        setStatus(`檢查完成：${found} 個欄位已對上，${missing} 個欄位尚未找到圖片。`, missing ? 'error' : 'success');
      }
    } catch (error) {
      console.error(error);
      drawCanvas();
      setStatus(`讀取失敗：${error.message || '請確認試算表格式。'}`, 'error');
    }
  }

  async function traverseEntry(entry, path = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      return [fileRecord(file, `${path}${file.name}`)];
    }
    if (!entry.isDirectory) return [];
    const reader = entry.createReader();
    const children = [];
    let batch;
    do {
      batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      children.push(...batch);
    } while (batch.length);
    const nested = await Promise.all(children.map((child) => traverseEntry(child, `${path}${entry.name}/`)));
    return nested.flat();
  }

  async function readDroppedFiles(dataTransfer) {
    const itemEntries = Array.from(dataTransfer.items || [])
      .map((item) => item.webkitGetAsEntry?.())
      .filter(Boolean);
    if (itemEntries.length) return (await Promise.all(itemEntries.map((entry) => traverseEntry(entry)))).flat();
    return Array.from(dataTransfer.files || []).map((file) => fileRecord(file));
  }

  function downloadCanvas() {
    if (!state.items.length) return;
    const date = new Date();
    const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('');
    el.resultCanvas.toBlob((blob) => {
      if (!blob) {
        setStatus('圖片產生失敗，請重新嘗試下載。', 'error');
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `工單圖片欄位檢查_${stamp}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }

  el.chooseFolder.addEventListener('click', () => {
    el.folderInput.value = '';
    el.folderInput.click();
  });
  el.chooseFiles.addEventListener('click', () => {
    el.filesInput.value = '';
    el.filesInput.click();
  });
  el.folderInput.addEventListener('change', (event) => processFiles(Array.from(event.target.files).map((file) => fileRecord(file))));
  el.filesInput.addEventListener('change', (event) => processFiles(Array.from(event.target.files).map((file) => fileRecord(file))));
  el.downloadButton.addEventListener('click', downloadCanvas);

  ['dragenter', 'dragover'].forEach((eventName) => {
    el.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      el.dropZone.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach((eventName) => {
    el.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      el.dropZone.classList.remove('is-dragging');
    });
  });
  el.dropZone.addEventListener('drop', async (event) => {
    try {
      const entries = await readDroppedFiles(event.dataTransfer);
      processFiles(entries);
    } catch (error) {
      console.error(error);
      setStatus('讀取拖拉的資料夾失敗，請改用「選擇資料夾」。', 'error');
    }
  });

  drawCanvas();
})();
