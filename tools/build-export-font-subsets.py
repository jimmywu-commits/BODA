"""Build static, on-demand export font scripts from the exact embedded fonts.

Requires Python fontTools and brotli only at build time. No font processing runs
in the browser. Invoke with --workers 2 to keep build memory bounded.
"""
from __future__ import annotations
import argparse
import base64
from concurrent.futures import ProcessPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import re
import time
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FAMILY = 'ShopeeNotoSans (content)'
BUILD_VERSION = 'unicode256-v1'


def ranges(points):
    result = []
    for point in sorted(points):
        if result and result[-1][1] + 1 == point:
            result[-1][1] = point
        else:
            result.append([point, point])
    return result


def css_ranges(points):
    return ','.join('U+%X' % a if a == b else 'U+%X-%X' % (a, b) for a, b in ranges(points))


def build_weight(args):
    weight, binary, source_hash, output, cache, chunk_size = args
    output, cache = Path(output), Path(cache)
    start = time.perf_counter()
    uncompressed = cache / (f'{weight}-{hashlib.sha256(binary).hexdigest()[:16]}.ttf')
    if not uncompressed.exists():
        print(f'[{weight}] Reconstructing original WOFF2 once...', flush=True)
        original = TTFont(io.BytesIO(binary), recalcTimestamp=False)
        original.flavor = None
        original.save(uncompressed)
        original.close()
    font = TTFont(uncompressed, lazy=True, recalcTimestamp=False)
    cmap = font.getBestCmap()
    points = sorted(cmap)
    # The source has only a small Latin/symbol repertoire below U+3000. Keep it
    # with punctuation/full-width forms so Latin combining/shaping stays intact.
    common = [cp for cp in points if cp <= 0x303f or 0xff00 <= cp <= 0xffef]
    groups = {'base': common}
    for cp in points:
        if cp not in common:
            groups.setdefault('u%04x' % (cp // chunk_size * chunk_size), []).append(cp)
    font.close()
    records = {}
    for index, (group, coverage) in enumerate(groups.items()):
        # Reading a cached uncompressed font avoids repeating fontTools' costly
        # WOFF2 glyf reconstruction for every small subset.
        font = TTFont(uncompressed, lazy=True, recalcTimestamp=False)
        options = subset.Options()
        options.layout_features = ['*']
        options.name_IDs = ['*']
        options.name_languages = ['*']
        options.name_legacy = True
        options.hinting = True
        options.notdef_outline = True
        options.recalc_bounds = False
        options.recalc_timestamp = False
        worker = subset.Subsetter(options=options)
        worker.populate(unicodes=coverage)
        worker.subset(font)
        font.flavor = 'woff2'
        font.recalcTimestamp = False
        encoded = io.BytesIO()
        font.save(encoded)
        small = encoded.getvalue()
        font.close()
        css = ('@font-face{font-family:"' + FAMILY + '";font-weight:' + str(weight) +
               ';font-style:normal;src:url(data:font/woff2;base64,' +
               base64.b64encode(small).decode('ascii') + ') format("woff2");unicode-range:' + css_ranges(coverage) + ';}')
        digest = hashlib.sha256(css.encode()).hexdigest()[:12]
        asset_id = f'w{weight}-{group}-{digest}'
        filename = asset_id + '.js'
        script = 'window.BodaExportFonts.registerChunk(' + json.dumps(asset_id) + ',' + json.dumps(css, separators=(',', ':')) + ');\n'
        (output / filename).write_text(script, encoding='utf-8', newline='\n')
        records[group] = {'id': asset_id, 'file': filename, 'ranges': ranges(coverage),
                          'fontBytes': len(small), 'scriptBytes': len(script.encode()), 'codepoints': len(coverage)}
        if index % 20 == 0 or index + 1 == len(groups):
            print(f'[{weight}] {index + 1}/{len(groups)} chunks; {time.perf_counter()-start:.1f}s', flush=True)
    return str(weight), {'common': records.pop('base'), 'pages': records}, {
        'weight': weight, 'originalBytes': len(binary), 'codepoints': len(points),
        'chunks': len(groups), 'seconds': round(time.perf_counter()-start, 2)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--chunk-size', type=int, default=256)
    options = parser.parse_args()
    if options.workers < 1 or options.workers > 2:
        parser.error('--workers must be 1 or 2')
    if options.chunk_size not in [256, 512, 1024]:
        parser.error('--chunk-size must be 256, 512 or 1024')
    output = ROOT / 'JS' / 'export-fonts'
    cache = ROOT / 'tmp' / 'export-font-build-cache'
    output.mkdir(exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    source = (ROOT / 'JS' / 'fonts-embed.js').read_text(encoding='utf-8')
    matches = re.findall(r'data:font/woff2;base64,([a-zA-Z0-9+/=]+)', source)
    if len(matches) != 3:
        raise RuntimeError('Expected the original 400/500/700 embedded WOFF2 fonts')
    original = [base64.b64decode(value) for value in matches]
    source_hash = hashlib.sha256(b''.join(original)).hexdigest()
    jobs = [(weight, binary, source_hash, str(output), str(cache), options.chunk_size)
            for weight, binary in zip([400, 500, 700], original)]
    weights, timing = {}, []
    with ProcessPoolExecutor(max_workers=options.workers) as pool:
        for weight, data, info in pool.map(build_weight, jobs):
            weights[weight] = data
            timing.append(info)
    manifest = {'version': BUILD_VERSION + '-' + source_hash[:16], 'family': FAMILY,
                'sourceSha256': source_hash, 'chunkSize': options.chunk_size, 'weights': weights}
    script = 'window.BodaExportFonts.registerManifest(' + json.dumps(manifest, separators=(',', ':')) + ');\n'
    (output / 'manifest.js').write_text(script, encoding='utf-8', newline='\n')
    stats = {'source': 'JS/fonts-embed.js', 'sourceSha256': source_hash, 'weights': timing,
             'manifestBytes': len(script.encode()), 'totalScriptBytes': sum(
                 record['scriptBytes'] for item in weights.values()
                 for record in [item['common'], *item['pages'].values()])}
    (output / 'build-info.json').write_text(json.dumps(stats, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(stats, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
