/* Export only the font weights and Unicode chunks used by this canvas.
   The build-time subsetter preserves the original embedded font outlines. */
(function (root) {
  'use strict';
  if (root.BodaExportFonts) return;
  var ownScript = document.currentScript;
  var base = new URL('export-fonts/', ownScript && ownScript.src || document.baseURI).href;
  var manifest = null, chunks = Object.create(null), scripts = Object.create(null);
  var scriptJobs = [], activeScripts = 0;
  var manifestFile = 'manifest.js?v=20261111-subset1';
  var family = 'shopeenotosans (content)';

  function pumpScripts() {
    while (activeScripts < 6 && scriptJobs.length) { activeScripts++; scriptJobs.shift()(); }
  }

  function loadScript(filename, ready) {
    var url = new URL(filename, base).href;
    if (scripts[url]) return scripts[url];
    var promise = new Promise(function (resolve, reject) {
      scriptJobs.push(function () {
      var script = document.createElement('script'), settled = false;
      var timer = root.setTimeout(function () { finish(new Error('Export font request timed out: ' + filename)); },
        Number(root.BODA_EXPORT_FONT_TIMEOUT_MS) > 0 ? Number(root.BODA_EXPORT_FONT_TIMEOUT_MS) : 20000);
      function finish(error) {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        script.onload = script.onerror = null;
        if (script.parentNode) script.parentNode.removeChild(script);
        activeScripts--;
        if (error) { delete scripts[url]; reject(error); }
        else resolve();
        pumpScripts();
      }
      script.async = true;
      script.src = url;
      script.onload = function () { finish(ready() ? null : new Error('Export font script did not register: ' + filename)); };
      script.onerror = function () { finish(new Error('Export font unavailable: ' + filename)); };
      (document.head || document.documentElement).appendChild(script);
      });
    });
    scripts[url] = promise;
    pumpScripts();
    return promise;
  }
  function nearestWeight(value) {
    var numeric = parseFloat(value);
    if (!isFinite(numeric)) numeric = String(value).toLowerCase() === 'bold' ? 700 : 400;
    /* Match CSS Fonts' fallback search for the original 400/500/700 faces.
       Requests above 500 try heavier faces first (550 therefore uses 700). */
    return numeric <= 400 ? 400 : numeric <= 500 ? 500 : 700;
  }
  function cssText(content) {
    if (!content || content === 'none' || content === 'normal') return '';
    var result = '', match, quoted = /(["'])((?:\\.|[^\\])*?)\1/g;
    while ((match = quoted.exec(content))) {
      result += match[2].replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\r\n])|\\(?:\r\n|[\r\n])/gi,
        function (_, hex, character) { return hex ? String.fromCodePoint(parseInt(hex, 16) || 0xfffd) : character || ''; });
    }
    return result;
  }
  function collectRuns(node) {
    var result = Object.create(null), doc = node.ownerDocument || document;
    var view = doc.defaultView || root, styles = new WeakMap(), hidden = new WeakMap();
    function styleOf(el) {
      if (!styles.has(el)) styles.set(el, view.getComputedStyle(el));
      return styles.get(el);
    }
    function isHidden(el) {
      if (!el || el.nodeType !== 1) return false;
      if (hidden.has(el)) return hidden.get(el);
      var style = styleOf(el);
      var value = style.display === 'none' ||
        (el !== node && isHidden(el.parentElement));
      hidden.set(el, value);
      return value;
    }
    function add(text, style) {
      if (!text || !style || String(style.fontFamily || '').toLowerCase().indexOf(family) < 0) return;
      var weight = nearestWeight(style.fontWeight);
      var points = result[weight] || (result[weight] = new Set());
      Array.from(String(text)).forEach(function (character) { points.add(character.codePointAt(0)); });
    }
    function visit(element) {
      if (!element || element.nodeType !== 1 || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/i.test(element.tagName) || isHidden(element)) return;
      var style = styleOf(element);
      var visible = style.visibility !== 'hidden' && style.visibility !== 'collapse';
      if (visible && /^(INPUT|TEXTAREA)$/i.test(element.tagName)) add(element.value, style);
      ['::before', '::after'].forEach(function (pseudo) {
        var pseudoStyle = view.getComputedStyle(element, pseudo);
        var content = pseudoStyle.content;
        if (pseudoStyle.visibility !== 'hidden' && pseudoStyle.visibility !== 'collapse' && content && content !== 'none' && content !== 'normal') add(cssText(content) + '0123456789', pseudoStyle);
      });
      Array.prototype.forEach.call(element.childNodes, function (child) {
        if (visible && child.nodeType === 3) add(child.nodeValue, style);
        else if (child.nodeType === 1) visit(child);
      });
    }
    if (node.nodeType === 3) {
      var parentStyle = node.parentElement && styleOf(node.parentElement);
      if (parentStyle && !isHidden(node.parentElement) && parentStyle.visibility !== 'hidden' && parentStyle.visibility !== 'collapse') add(node.nodeValue, parentStyle);
    }
    else visit(node);
    return result;
  }
  function contains(ranges, point) {
    var low = 0, high = ranges.length - 1;
    while (low <= high) {
      var index = (low + high) >> 1, range = ranges[index];
      if (point < range[0]) high = index - 1;
      else if (point > range[1]) low = index + 1;
      else return true;
    }
    return false;
  }
  function forNode(node) {
    if (!node) return Promise.reject(new Error('Export canvas is missing'));
    var runs;
    try { runs = collectRuns(node); }
    catch (error) { return Promise.reject(error); }
    if (!Object.keys(runs).length) return Promise.resolve('');
    return (manifest ? Promise.resolve() : loadScript(manifestFile, function () { return !!manifest; })).then(function () {
      var selected = Object.create(null);
      Object.keys(runs).forEach(function (weight) {
        var record = manifest.weights[weight];
        if (!record) throw new Error('Export font weight is unavailable: ' + weight);
        runs[weight].forEach(function (point) {
          var descriptor = contains(record.common.ranges, point) ? record.common :
            record.pages['u' + (Math.floor(point / manifest.chunkSize) * manifest.chunkSize).toString(16).padStart(4, '0')];
          if (descriptor && contains(descriptor.ranges, point)) selected[descriptor.id] = descriptor;
          /* Characters absent from the original font retain browser fallback. */
        });
      });
      var ids = Object.keys(selected).sort();
      return Promise.all(ids.map(function (id) {
        return chunks[id] ? Promise.resolve() : loadScript(selected[id].file, function () { return typeof chunks[id] === 'string'; });
      })).then(function () { return ids.map(function (id) { return chunks[id]; }).join('\n'); });
    });
  }
  root.BodaExportFonts = {
    forNode: forNode,
    registerManifest: function (value) {
      if (!value || !value.weights || !value.chunkSize || value.family !== 'ShopeeNotoSans (content)') throw new Error('Invalid export font manifest');
      manifest = value;
    },
    registerChunk: function (id, css) {
      if (typeof id !== 'string' || typeof css !== 'string') throw new Error('Invalid export font chunk');
      chunks[id] = css;
    }
  };
})(window);
