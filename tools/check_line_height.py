# -*- coding: utf-8 -*-
"""
比對「新版 PS CSS 的行距」跟「block.json 目前的行距」。

行距（line-height）決定兩行文字之間的距離。PS CSS 是用 px 給的（例如 48px），
block.json 存的是倍數（48 ÷ 43 ≈ 1.116）。兩邊如果對不上，
多行的品名／警語就會看起來比設計稿鬆或緊。

配對方式跟 apply_css_ink_top.py 一樣：水平位置 + 字級 + 換算後的垂直位置最接近。

用法：
    python3 tools/check_line_height.py            # 只檢查
    python3 tools/check_line_height.py --write    # 順便改成跟 CSS 一致
"""

import json
import os
import sys

from apply_css_ink_top import (FONT_CONTENT_EM, INK_BIAS, VCORR, block_offset,
                               ink_offset_em)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv


def num(v):
    return float(str(v).replace('px', '')) if v is not None else None


def engine_mult(layer):
    lh = layer.get('lineHeight')
    fs = layer['fontSize']
    if lh is None:
        return None
    try:
        n = float(str(lh).replace('px', ''))
    except ValueError:
        return None
    return n if n <= 4 else n / fs


def main():
    with open(os.path.join(ROOT, 'tools', 'msbn-css.json'), encoding='utf-8') as f:
        css = json.load(f)['blocks']

    print('%-14s %-12s %-6s %-12s %-12s %s'
          % ('版位', '欄位', '字級', 'block 行距', 'CSS 行距', '差'))
    n_bad = 0
    for cid in sorted(css):
        dirty = False
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
                     and c.get('fontSize') and c['left'] is not None]
        used = set()
        for b in blk['layers']:
            if b.get('type') != 'text' or b.get('hidden') or not b.get('fontSize'):
                continue
            if b.get('left') is None:
                continue
            bw = b.get('width')
            bcx = b['left'] + (bw / 2.0 if bw else 0)
            fs = b['fontSize']
            em = ink_offset_em(b.get('default') or '', b.get('fontWeight'))
            now = (b.get('topExact') if b.get('topExact') is not None
                   else b['top'] - fs
                   - ((engine_mult(b) or 1) - 1) * fs / 2.0
                   + VCORR.get(str(b.get('id') or ''), 0)
                   - max(0.0, (FONT_CONTENT_EM * fs - (engine_mult(b) or 1) * fs) / 2.0))
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
            if best is None or bestd > 12:
                continue
            used.add(best)
            clh = bestc.get('lineHeight')
            if not clh or clh == 'normal':
                continue
            css_mult = round(num(clh) / fs, 4)
            bm = engine_mult(b)
            if bm is None or abs(bm - css_mult) > 0.01:
                n_bad += 1
                print('%-14s %-12s %-6s %-12s %-12s %s'
                      % (cid, b.get('field') or b.get('id') or '?', fs,
                         '%s（%.1fpx）' % (b.get('lineHeight'), (bm or 1) * fs),
                         '%s（%.4f）' % (clh, css_mult),
                         '差 %.1fpx' % (((bm or 1) - css_mult) * fs)))
                if WRITE:
                    b['lineHeight'] = str(css_mult)
                    dirty = True
        if dirty and WRITE:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(blk, f, ensure_ascii=False, indent=2)

    print('\n行距對不上的圖層：%d 個%s' % (n_bad, '（已改成跟 CSS 一致）' if WRITE else ''))


if __name__ == '__main__':
    main()
