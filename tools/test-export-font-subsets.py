"""Verify the static export font assets preserve the exact source glyphs."""
import base64
import hashlib
import io
import json
from pathlib import Path
import re
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
folder = root / 'JS' / 'export-fonts'
script = (folder / 'manifest.js').read_text(encoding='utf-8')
manifest = json.loads(script.removeprefix('window.BodaExportFonts.registerManifest(').strip().removesuffix(';').removesuffix(')'))
embedded = re.findall(r'data:font/woff2;base64,([A-Za-z0-9+/=]+)', (root / 'JS/fonts-embed.js').read_text(encoding='utf-8'))
originals = [base64.b64decode(value) for value in embedded]
assert hashlib.sha256(b''.join(originals)).hexdigest() == manifest['sourceSha256']
count = 0
outline_count = 0


def metric(font):
    return (font['head'].unitsPerEm, font['hhea'].ascent, font['hhea'].descent, font['hhea'].lineGap,
            font['OS/2'].sTypoAscender, font['OS/2'].sTypoDescender, font['OS/2'].sTypoLineGap,
            font['OS/2'].usWinAscent, font['OS/2'].usWinDescent)


def outline(font, glyph_set, name):
    pen = DecomposingRecordingPen(glyph_set)
    glyph_set[name].draw(pen)
    return pen.value


for weight, binary in zip([400, 500, 700], originals):
    original = TTFont(io.BytesIO(binary), lazy=True)
    cmap = original.getBestCmap()
    expected_metric = metric(original)
    record = manifest['weights'][str(weight)]
    coverage = set()
    cached = root / 'tmp' / 'export-font-build-cache' / f'{weight}-{hashlib.sha256(binary).hexdigest()[:16]}.ttf'
    outline_original = TTFont(cached, lazy=True) if cached.exists() else original
    original_glyphs = outline_original.getGlyphSet()
    for descriptor in [record['common'], *record['pages'].values()]:
        asset = (folder / descriptor['file']).read_text(encoding='utf-8')
        args = asset.removeprefix('window.BodaExportFonts.registerChunk(').strip().removesuffix(';').removesuffix(')')
        asset_id, css = json.loads('[' + args + ']')
        assert asset_id == descriptor['id']
        small = base64.b64decode(re.search(r'data:font/woff2;base64,([A-Za-z0-9+/=]+)', css)[1])
        assert len(small) == descriptor['fontBytes']
        font = TTFont(io.BytesIO(small), lazy=True)
        subset_cmap = font.getBestCmap()
        points = {cp for a, b in descriptor['ranges'] for cp in range(a, b + 1)}
        assert set(subset_cmap) == points, descriptor['id']
        assert not coverage.intersection(points), 'Unicode chunks must never overlap'
        coverage.update(points)
        assert metric(font) == expected_metric, 'Source line metrics must remain unchanged'
        glyphs = font.getGlyphSet()
        ordered = sorted(points)
        for cp in {ordered[0], ordered[len(ordered)//2], ordered[-1]}:
            source_name, subset_name = cmap[cp], subset_cmap[cp]
            assert outline(outline_original, original_glyphs, source_name) == outline(font, glyphs, subset_name), (weight, cp)
            assert outline_original['hmtx'][source_name] == font['hmtx'][subset_name], (weight, cp, 'advance/side bearing')
            outline_count += 1
        font.close()
        count += 1
    assert coverage == set(cmap), 'All and only original Unicode characters must be preserved'
    original.close()
    if outline_original is not original:
        outline_original.close()
print(f'PASS {count} static subsets cover all original codepoints exactly; line metrics and {outline_count} sample glyph outlines/advances remain identical')
