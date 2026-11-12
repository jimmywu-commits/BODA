/* Optional browser dependencies. Load only at the operation that needs them. */
(function (root) {
  'use strict';
  if (root.BodaDependencies) return;
  var current = document.currentScript;
  var base = new URL('.', current && current.src || new URL('JS/dependency-loader.js', document.baseURI).href).href;
  var VERSION = '20261111-slim1';
  var pending = Object.create(null);
  var definitions = {
    excel: { path: 'vendor/exceljs-4.4.0.min.js', label: '試算表元件', read: function () {
      return root.ExcelJS && typeof root.ExcelJS.Workbook === 'function' ? root.ExcelJS : null;
    } },
    capture: { path: 'vendor/html-to-image-1.11.13.min.js', label: '圖片輸出元件', read: function () {
      return root.htmlToImage && typeof root.htmlToImage.toPng === 'function' ? root.htmlToImage : null;
    } },
    zip: { path: 'vendor/jszip-3.10.1.min.js', label: 'ZIP 元件', read: function () {
      return typeof root.JSZip === 'function' ? root.JSZip : null;
    } },
    fontSubset: { path: 'export-font-loader.js', label: '輸出字型元件', read: function () {
      return root.BodaExportFonts && typeof root.BodaExportFonts.forNode === 'function' ? root.BodaExportFonts : null;
    } },
    exportFonts: { path: 'fonts-embed.js', label: '輸出專用字型', read: function () {
      var css = root.BN_FONTS_EMBED_CSS;
      return typeof css === 'string' && css.indexOf('@font-face') >= 0 && css.indexOf('base64,') >= 0 &&
        [400, 500, 700].every(function (weight) { return css.indexOf('font-weight:' + weight) >= 0; }) ? css : null;
    } }
  };
  function failure(name, code, reason) {
    var definition = definitions[name];
    var error = new Error((definition ? definition.label : '未知元件') + reason + '，請確認專案檔案完整後重試。');
    error.code = code; error.dependency = name;
    return error;
  }
  function ensure(name, options) {
    if (!Object.prototype.hasOwnProperty.call(definitions, name)) {
      return Promise.reject(failure(name, 'DEPENDENCY_UNKNOWN', '無法載入'));
    }
    var definition = definitions[name], available = definition.read();
    if (available) return Promise.resolve(available);
    if (pending[name]) return pending[name];
    var timeout = Number(options && options.timeoutMs);
    /* Embedded export fonts are 17 MB; allow office-network transfers to
       finish without treating a merely slow first export as a missing file. */
    if (!(timeout > 0)) timeout = name === 'exportFonts' ? 120000 : 30000;
    timeout = Math.min(timeout, 120000);
    var task = new Promise(function (resolve, reject) {
      var script = document.createElement('script'), settled = false;
      var timer = root.setTimeout(function () { finish(failure(name, 'DEPENDENCY_TIMEOUT', '載入逾時')); }, timeout);
      function finish(error) {
        if (settled) return;
        settled = true; root.clearTimeout(timer); script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); }
        else resolve(definition.read());
      }
      script.async = true;
      script.src = new URL(definition.path, base).href + '?v=' + VERSION;
      script.setAttribute('data-boda-dependency', name);
      script.onload = function () {
        finish(definition.read() ? null : failure(name, 'DEPENDENCY_MISSING', '未正確初始化'));
      };
      script.onerror = function () { finish(failure(name, 'DEPENDENCY_LOAD', '載入失敗')); };
      document.head.appendChild(script);
    });
    pending[name] = task;
    /* A rejected load must not poison the session: the next user action retries. */
    task.catch(function () { if (pending[name] === task) delete pending[name]; });
    return task;
  }
  root.BodaDependencies = { ensure: ensure, version: VERSION };
})(window);
