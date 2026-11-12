/* Shared IndexedDB image storage. Public snapshots stay portable data URLs. */
(function (root) {
  'use strict';
  if (root.BodaStateAssets) return;
  var FORMAT = 'boda-state-assets-v1';
  var REF = '__bodaAssetId';
  var PARTS = '__bodaAssetParts';

  function copyTree(value, transform, seen, shareBinary) {
    if (typeof value === 'string') return transform ? transform(value) : value;
    if (!value || typeof value !== 'object') return value;
    var tag = Object.prototype.toString.call(value);
    if (tag === '[object Date]') return new Date(value.getTime());
    if (tag === '[object Blob]') return value;
    if (tag === '[object ArrayBuffer]') return shareBinary ? value : value.slice(0);
    if (ArrayBuffer.isView(value)) {
      if (shareBinary) return value;
      return tag === '[object DataView]' ? new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)) : new value.constructor(value);
    }
    seen = seen || new WeakMap();
    if (seen.has(value)) return seen.get(value);
    var out = Array.isArray(value) ? new Array(value.length) : {};
    seen.set(value, out);
    Object.keys(value).forEach(function (key) {
      var next = copyTree(value[key], transform, seen, shareBinary);
      Object.defineProperty(out, key, { value: next, enumerable: true, writable: true, configurable: true });
    });
    return out;
  }

  /* A data URL's first comma belongs to its header. Base64 payloads contain no
     commas, so a comma-delimited image field can be encoded without splitting
     that header or losing the original separators / surrounding spaces. */
  function imageTokens(value) {
    var tokens = [], match;
    if (!/data:image\/|blob:/i.test(value)) return tokens;
    var starts = /(^|,)(\s*)(data:image\/|blob:)/ig;
    while ((match = starts.exec(value))) {
      var start = match.index + match[1].length + match[2].length;
      var end;
      if (/^blob:/i.test(value.slice(start, start + 5))) {
        var blobTail = /^[^,\s]+/.exec(value.slice(start));
        end = start + (blobTail ? blobTail[0].length : 0);
      } else {
        var comma = value.indexOf(',', start);
        if (comma < 0) continue;
        var header = value.slice(start, comma);
        if (/;base64$/i.test(header)) {
          var body = /^[a-z0-9+/=_\-\r\n]*/i.exec(value.slice(comma + 1));
          end = comma + 1 + body[0].length;
        } else {
          var next = /,\s*(?:data:image\/|blob:|https?:\/\/)/ig;
          next.lastIndex = comma + 1;
          var boundary = next.exec(value);
          end = boundary ? boundary.index : value.length;
        }
      }
      if (end > start) tokens.push({ start: start, end: end, source: value.slice(start, end) });
      starts.lastIndex = Math.max(starts.lastIndex, end);
    }
    return tokens;
  }

  function readBlob(blob, asText) {
    if (asText && typeof blob.text === 'function') return blob.text();
    return new Promise(function (resolve, reject) {
      var reader = new root.FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('Asset read failed')); };
      reader.onabort = function () { reject(new Error('Asset read aborted')); };
      if (asText) reader.readAsText(blob);
      else reader.readAsDataURL(blob);
    });
  }

  function makeRecord(source, id) {
    function originalText() {
      return { id: id, encoding: 'data-url', blob: new root.Blob([source], { type: 'text/plain;charset=utf-8' }) };
    }
    if (/^blob:/i.test(source)) {
      return root.fetch(source).then(function (response) {
        if (!response.ok) throw new Error('Image asset unavailable');
        return response.blob();
      }).then(function (blob) { return { id: id, encoding: 'blob-url', blob: blob }; });
    }
    var comma = source.indexOf(',');
    var header = source.slice(0, comma + 1);
    var payload = source.slice(comma + 1);
    if (comma < 0 || !/;base64,$/i.test(header) || payload.length % 4 || !/^[a-z0-9+/]*={0,2}$/i.test(payload)) {
      return Promise.resolve(originalText());
    }
    function decodedBlob() {
      if (typeof root.fetch === 'function') {
        return root.fetch(source).then(function (response) {
          if (!response.ok) throw new Error('Image decode failed');
          return response.blob();
        });
      }
      var binary = root.atob(payload);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return Promise.resolve(new root.Blob([bytes], { type: header.slice(5).split(';')[0] }));
    }
    return Promise.resolve().then(decodedBlob).then(function (blob) {
      return { id: id, encoding: 'base64', header: header, blob: blob };
    }).catch(function () { return originalText(); });
  }

  function recordDataUrl(record) {
    if (!record || !record.blob) return Promise.reject(new Error('Missing image asset'));
    if (record.encoding === 'data-url') return readBlob(record.blob, true);
    return readBlob(record.blob, false).then(function (url) {
      if (record.encoding === 'base64') return record.header + url.slice(url.indexOf(',') + 1);
      return url;
    });
  }

  /* A live exposure snapshot may still contain object URLs. Freeze metadata
     immediately, then resolve each unique URL once before a portable download.
     Existing data URLs stay byte-for-byte unchanged, including image lists. */
  function toPortable(value) {
    var sources = new Map(), snapshot;
    try {
      snapshot = copyTree(value, function (text) {
        imageTokens(text).forEach(function (token) {
          if (/^blob:/i.test(token.source)) sources.set(token.source, null);
        });
        return text;
      });
    } catch (error) { return Promise.reject(error); }
    var chain = Promise.resolve();
    sources.forEach(function (_, source) {
      chain = chain.then(function () { return makeRecord(source, 'portable'); })
        .then(recordDataUrl).then(function (url) { sources.set(source, url); });
    });
    return chain.then(function () {
      var strings = new Map(), seen = new WeakSet();
      function replace(node) {
        if (typeof node === 'string') {
          if (strings.has(node)) return strings.get(node);
          var tokens = imageTokens(node).filter(function (token) { return sources.has(token.source); });
          if (!tokens.length) return node;
          var out = '', offset = 0;
          tokens.forEach(function (token) {
            out += node.slice(offset, token.start) + sources.get(token.source); offset = token.end;
          });
          out += node.slice(offset); strings.set(node, out); return out;
        }
        if (!node || typeof node !== 'object' || seen.has(node)) return node;
        var tag = Object.prototype.toString.call(node);
        if (tag === '[object Date]' || tag === '[object Blob]' || tag === '[object ArrayBuffer]' || ArrayBuffer.isView(node)) return node;
        seen.add(node);
        Object.keys(node).forEach(function (key) { node[key] = replace(node[key]); });
        return node;
      }
      return replace(snapshot);
    });
  }

  function create(options) {
    options = options || {};
    var stateStore = options.stateStore || 'states';
    var assetStore = options.assetStore || 'assets';
    var key = options.key || 'current';
    var cache = new Map();
    var serial = Promise.resolve();
    var sequence = 0;
    var instance = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);

    function enqueue(operation) {
      var task = serial.then(operation);
      serial = task.catch(function () {});
      return task;
    }

    function open() {
      return new Promise(function (resolve, reject) {
        if (!root.indexedDB) { reject(new Error('IndexedDB not supported')); return; }
        var settled = false;
        var request = root.indexedDB.open(options.dbName, options.dbVersion || 2);
        request.onupgradeneeded = function () {
          var db = request.result;
          if (!db.objectStoreNames.contains(stateStore)) db.createObjectStore(stateStore);
          if (!db.objectStoreNames.contains(assetStore)) db.createObjectStore(assetStore);
        };
        request.onsuccess = function () {
          var db = request.result;
          db.onversionchange = function () { db.close(); };
          if (settled) { db.close(); return; }
          settled = true;
          resolve(db);
        };
        request.onerror = function () {
          if (settled) return;
          settled = true;
          reject(request.error || new Error('IndexedDB open failed'));
        };
        request.onblocked = function () {
          if (settled) return;
          settled = true;
          var error = new Error('Close older editor tabs before upgrading storage');
          error.name = 'BlockedError';
          reject(error);
        };
      });
    }

    function prepare(state) {
      var entries = new Map(), jobs = [], encodedStrings = new Map();
      function reference(source) {
        var entry = entries.get(source) || cache.get(source);
        if (!entry) {
          entry = { id: instance + '-' + (++sequence), record: null };
          jobs.push({ source: source, entry: entry });
        }
        entries.set(source, entry);
        var ref = {}; ref[REF] = entry.id; return ref;
      }
      var packed = copyTree(state, function (value) {
        if (encodedStrings.has(value)) return encodedStrings.get(value);
        var tokens = imageTokens(value);
        if (!tokens.length) return value;
        if (tokens.length === 1 && tokens[0].start === 0 && tokens[0].end === value.length) {
          var single = reference(tokens[0].source); encodedStrings.set(value, single); return single;
        }
        var parts = [], offset = 0;
        tokens.forEach(function (token) {
          if (token.start > offset) parts.push(value.slice(offset, token.start));
          parts.push(reference(token.source));
          offset = token.end;
        });
        if (offset < value.length) parts.push(value.slice(offset));
        var result = {}; result[PARTS] = parts; encodedStrings.set(value, result); return result;
      }, undefined, true);
      var chain = Promise.resolve();
      jobs.forEach(function (job) {
        chain = chain.then(function () { return makeRecord(job.source, job.entry.id); }).then(function (record) {
          job.entry.record = record;
          /* New image bytes are converted one at a time, yielding between them. */
          return new Promise(function (resolve) { root.setTimeout(resolve, 0); });
        });
      });
      return chain.then(function () {
        var assets = [];
        entries.forEach(function (entry) { assets.push(entry.record); });
        return { state: packed, entries: entries, assets: assets, convertedCount: jobs.length };
      });
    }

    function put(state) {
      /* Capture mutable geometry / typed buffers at invocation, even if an
         earlier save is still queued. Image strings and Blobs are immutable. */
      var snapshot;
      try { snapshot = copyTree(state); } catch (error) { return Promise.reject(error); }
      return enqueue(function () {
        return prepare(snapshot).then(function (plan) {
          return open().then(function (db) {
            return new Promise(function (resolve, reject) {
              var tx;
              try {
                tx = db.transaction([stateStore, assetStore], 'readwrite');
                var states = tx.objectStore(stateStore), assets = tx.objectStore(assetStore);
                var ids = plan.assets.map(function (record) { return record.id; });
                var keep = new Set(ids);
                var previous = states.get(key);
                previous.onsuccess = function () {
                  var old = previous.result;
                  if (old && old.storageFormat === FORMAT) (old.assetIds || []).forEach(function (id) {
                    if (!keep.has(id)) assets.delete(id);
                  });
                };
                plan.assets.forEach(function (record) {
                  var existing = assets.get(record.id);
                  existing.onsuccess = function () { if (!existing.result) assets.put(record, record.id); };
                });
                states.put({ storageFormat: FORMAT, storageVersion: 1, ts: snapshot && snapshot.ts || 0,
                  assetIds: ids, state: plan.state }, key);
                tx.oncomplete = function () {
                  db.close(); cache = plan.entries;
                  resolve({ assetCount: ids.length, convertedAssetCount: plan.convertedCount });
                };
                tx.onabort = tx.onerror = function () { db.close(); reject(tx.error || new Error('IndexedDB write failed')); };
              } catch (error) {
                if (tx) try { tx.abort(); } catch (_) {}
                db.close(); reject(error);
              }
            });
          });
        });
      });
    }

    function hydrate(stored, records) {
      var urls = new Map(), nextCache = new Map(), chain = Promise.resolve();
      (stored.assetIds || []).forEach(function (id) {
        chain = chain.then(function () { return recordDataUrl(records.get(id)); }).then(function (url) {
          urls.set(id, url); nextCache.set(url, { id: id, record: records.get(id) });
        });
      });
      return chain.then(function () {
        function restore(value, seen) {
          if (!value || typeof value !== 'object') return value;
          var tag = Object.prototype.toString.call(value);
          if (tag === '[object Date]') return new Date(value.getTime());
          if (tag === '[object Blob]' || tag === '[object ArrayBuffer]' || ArrayBuffer.isView(value)) return value;
          if (Object.keys(value).length === 1 && typeof value[REF] === 'string') {
            if (!urls.has(value[REF])) throw new Error('Missing image asset: ' + value[REF]);
            return urls.get(value[REF]);
          }
          if (Object.keys(value).length === 1 && Array.isArray(value[PARTS])) return value[PARTS].map(function (part) {
            return typeof part === 'string' ? part : restore(part);
          }).join('');
          seen = seen || new WeakMap();
          if (seen.has(value)) return seen.get(value);
          var out = Array.isArray(value) ? new Array(value.length) : {};
          seen.set(value, out);
          Object.keys(value).forEach(function (key) {
            Object.defineProperty(out, key, { value: restore(value[key], seen), enumerable: true, writable: true, configurable: true });
          });
          return out;
        }
        var state = restore(stored.state);
        cache = nextCache;
        return state;
      });
    }

    function get() {
      return enqueue(function () {
        return open().then(function (db) {
          return new Promise(function (resolve, reject) {
            var stored = null, records = new Map();
            var tx = db.transaction([stateStore, assetStore], 'readonly');
            var request = tx.objectStore(stateStore).get(key);
            request.onsuccess = function () {
              stored = request.result || null;
              if (!stored || stored.storageFormat !== FORMAT) return;
              if (!Array.isArray(stored.assetIds) || stored.assetIds.some(function (id) { return typeof id !== 'string'; })) {
                reject(new Error('Invalid image asset index'));
                try { tx.abort(); } catch (_) {}
                return;
              }
              (stored.assetIds || []).forEach(function (id) {
                var asset = tx.objectStore(assetStore).get(id);
                asset.onsuccess = function () { if (asset.result) records.set(id, asset.result); };
              });
            };
            tx.oncomplete = function () { db.close(); resolve({ stored: stored, records: records }); };
            tx.onabort = tx.onerror = function () { db.close(); reject(tx.error || new Error('IndexedDB read failed')); };
          });
        }).then(function (result) {
          if (!result.stored || result.stored.storageFormat !== FORMAT) return result.stored;
          return hydrate(result.stored, result.records);
        });
      });
    }

    function clear() {
      return enqueue(function () {
        return open().then(function (db) {
          return new Promise(function (resolve, reject) {
            var tx = db.transaction([stateStore, assetStore], 'readwrite');
            var states = tx.objectStore(stateStore), assets = tx.objectStore(assetStore);
            var previous = states.get(key);
            previous.onsuccess = function () {
              var old = previous.result;
              if (old && old.storageFormat === FORMAT) (old.assetIds || []).forEach(function (id) { assets.delete(id); });
            };
            states.delete(key);
            tx.oncomplete = function () { db.close(); cache.clear(); resolve(); };
            tx.onabort = tx.onerror = function () { db.close(); reject(tx.error || new Error('IndexedDB clear failed')); };
          });
        });
      });
    }
    return { put: put, get: get, clear: clear };
  }
  root.BodaStateAssets = {
    create: create, copy: copyTree, toPortable: toPortable, storageFormat: FORMAT,
    /* Queue metadata immediately; shareBinary is only for buffers the caller
       guarantees never to mutate (for example the original workbook file).
       put() still captures one isolated binary copy before asynchronous work. */
    snapshot: function (value, options) { return copyTree(value, null, undefined, !!(options && options.shareBinary)); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
