# -*- coding: utf-8 -*-
"""
把 PS 設計稿上的示意文字寫進 block.json 的 `designText`。

用途
----
維修頁本來是用「一二三四五…」這種數字元填滿到字數上限，
看得出長度、但看不出這一格原本設計是要放什麼。
設計稿上寫的是「品名一排最多8字」「促標最多7字內」「逛逛去」，
一眼就知道這欄是什麼、限幾個字，拿來當維修頁的預覽文字最合適。

`designText` 是額外欄位，不會動到 `default`，
所以匯入工單頁「沒填欄位時顯示什麼」的行為完全不變。

配對方式跟 apply_css_ink_top.py 一樣（水平位置 + 字級 + 換算後的垂直位置最接近），
所以同一格裡好幾個同型欄位也不會對錯。

用法
----
    python3 tools/apply_css_design_text.py            # 預覽
    python3 tools/apply_css_design_text.py --write    # 實際寫入
"""

import json
import os
import sys

from apply_css_ink_top import (INK_BIAS, MAX_SHIFT, block_offset, engine_top,
                               ink_offset_em)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv


def num(v):
    return float(str(v).replace('px', '')) if v is not None else None


# 欄位名稱 ↔ 設計稿圖層名稱。幾何配對漏掉的（例如圓標字是垂直置中、
# 走另一條計算路徑）就用這張表補，照「由右到左」的順序對。
FIELD_TO_LAYER = {
    'promo': '促標', 'name': '品名', 'warn': '警語', 'cta': 'CTA',
    'badge': '圓標', 'itemText': '項目', 'content': '內文', 'copy': '文案',
    'signNote': '簽名小字', 'endorserNote': '代言人小字',
}


def base_field(f):
    return str(f or '').rstrip('0123456789')


def fallback_match(blk, css_layers, dx):
    """幾何配對漏掉的欄位，用「欄位名 ↔ 圖層名 + 由右到左的順序」補上"""
    out = {}
    todo = [b for b in blk['layers']
            if b.get('type') == 'text' and b.get('field') and not b.get('hidden')
            and not b.get('designText')]
    for name in {FIELD_TO_LAYER.get(base_field(b['field'])) for b in todo}:
        if not name:
            continue
        group = [b for b in todo if FIELD_TO_LAYER.get(base_field(b['field'])) == name]
        cands = [c for c in css_layers
                 if c['name'] == name and not c['hidden'] and c.get('content')]
        if not cands:
            continue
        # 兩邊都由右到左排：block 的欄位編號本來就是這個順序
        group.sort(key=lambda b: -(b['left'] + (b.get('width') or 0) / 2.0))
        cands.sort(key=lambda c: -(c['left'] - dx + (c['width'] or 0) / 2.0))
        for i, b in enumerate(group):
            if i < len(cands):
                out[id(b)] = cands[i]['content']
    return out


def main():
    with open(os.path.join(ROOT, 'tools', 'msbn-css.json'), encoding='utf-8') as f:
        css = json.load(f)['blocks']

    total, files = 0, 0
    for cid in sorted(css):
        bid = 'msbn_' + cid.replace('MSBN-', '').replace('-', '_')
        path = os.path.join(ROOT, 'blocks', bid, 'block.json')
        if not os.path.isfile(path):
            continue
        blk = json.load(open(path, encoding='utf-8'))
        off = block_offset(css[cid]['layers'], blk)
        if not off:
            continue
        dx, dy = off

        css_texts = [c for c in css[cid]['layers']
                     if c['kind'] == 'text' and not c['hidden']
                     and c.get('fontSize') and c['left'] is not None and c.get('content')]

        rows = []
        used = set()
        for b in blk['layers']:
            if b.get('type') != 'text' or b.get('hidden') or not b.get('fontSize'):
                continue
            if b.get('left') is None or not b.get('field'):
                continue
            bw = b.get('width')
            bcx = b['left'] + (bw / 2.0 if bw else 0)
            fs = b['fontSize']
            em = ink_offset_em(b.get('default') or '', b.get('fontWeight'))
            now = engine_top(b)

            best, bestd, bestc = None, 1e9, None
            for i, c in enumerate(css_texts):
                if i in used or abs(num(c['fontSize']) - fs) > 0.6:
                    continue
                cl_ = c['left'] - dx
                if bw:
                    covered = b['left'] - 2 <= cl_ and cl_ + c['width'] <= b['left'] + bw + 2
                    if abs(cl_ + c['width'] / 2.0 - bcx) > 40 and not covered:
                        continue
                elif abs(cl_ - b['left']) > 40:
                    continue
                cand = (c['top'] - dy) + INK_BIAS - em * fs
                if abs(cand - now) < bestd:
                    best, bestd, bestc = i, abs(cand - now), c
            if best is None or bestd > MAX_SHIFT:
                continue
            used.add(best)
            txt = bestc['content']
            if b.get('designText') != txt:
                rows.append((b['field'], b.get('designText'), txt))
                b['designText'] = txt
                total += 1

        # 幾何配對漏掉的（圓標字等）用名稱＋順序補
        extra = fallback_match(blk, css[cid]['layers'], dx)
        for b in blk['layers']:
            txt = extra.get(id(b))
            if txt and b.get('designText') != txt:
                rows.append((b['field'], b.get('designText'), txt))
                b['designText'] = txt
                total += 1

        if rows:
            files += 1
            print('\n══ %s（%s）' % (cid, bid))
            for fld, old, new in rows:
                print('   %-12s %s' % (fld, new.replace('\n', ' ⏎ ')))
            if WRITE:
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(blk, f, ensure_ascii=False, indent=2)

    print('\n%s：%d 個版位、%d 個欄位帶入設計稿文字'
          % ('已寫入' if WRITE else '預覽（未寫入）', files, total))


if __name__ == '__main__':
    main()
