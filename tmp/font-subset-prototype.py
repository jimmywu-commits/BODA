import base64
import io
import json
from pathlib import Path
import re
import time
from fontTools.ttLib import TTFont
from fontTools import subset

root = Path(__file__).resolve().parents[1]
out = root / 'tmp' / 'font-subset-prototype'
out.mkdir(exist_ok=True)
source = (root / 'JS' / 'fonts-embed.js').read_text(encoding='utf-8')
embedded = re.findall(r'data:font/woff2;base64,([a-zA-Z0-9+/=]+)', source)
assert len(embedded) == 3
text = '瘦身測試商品優惠$123 ABC'
css = []
metrics = []
for weight, data in zip([400, 500, 700], embedded):
    binary = base64.b64decode(data)
    font = TTFont(io.BytesIO(binary))
    cmap = font.getBestCmap()
    options = subset.Options()
    options.layout_features = ['*']
    options.name_IDs = ['*']
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=sorted(set(map(ord, text))))
    t = time.perf_counter()
    sub.subset(font)
    font.flavor = 'woff2'
    result = io.BytesIO()
    font.save(result)
    small = result.getvalue()
    filename = out / f'test-{weight}.woff2'
    filename.write_bytes(small)
    face = '@font-face{font-family:"ShopeeNotoSans (content)";font-weight:' + str(weight) + ';font-style:normal;src:url(data:font/woff2;base64,' + base64.b64encode(small).decode('ascii') + ') format("woff2");}'
    css.append(face)
    metrics.append({'weight': weight, 'originalBytes': len(binary), 'originalCodepoints': len(cmap), 'subsetBytes': len(small), 'subsetCodepoints': len(font.getBestCmap()), 'seconds': round(time.perf_counter()-t, 3)})
(out / 'test.css').write_text('\n'.join(css), encoding='utf-8')
(out / 'metrics.json').write_text(json.dumps({'text': text, 'cssBytes': sum(map(len,css)), 'fonts':metrics},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'text': text, 'cssBytes': sum(map(len,css)), 'fonts':metrics}, ensure_ascii=False))
