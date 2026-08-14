# -*- coding: utf-8 -*-
"""
盤點「曝品範圍」有沒有做成可以拖圖片的框。

設計稿上標「曝品範圍」「情境圖_圖片」「商品圖+人物圖+情境圖_圖片」的區域，
就是這一格要放商品圖／情境圖的地方。它們在 block.json 裡必須是 image 圖層
（有 field 才會被畫成可拖放的框、匯入工單時也才吃得到圖），
如果只是一個 rect 色塊，畫面上看起來一樣，但圖片拖不進去。

這支程式把 CSS 上的曝品範圍跟 block.json 的圖片框對起來，列出：
  ✓ 已經是圖片框
  ✗ 只有色塊或根本沒有這一層 → 要補

用法：python3 tools/audit_exposure_areas.py
"""

import json
import os

from apply_css_ink_top import block_offset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 設計稿上代表「這裡要放圖」的圖層名稱
AREA_NAMES = ('曝品範圍', '情境圖_圖片', '商品圖+人物圖+情境圖_圖片', 'LOGO_圖片')


def overlap_ratio(a, b):
    """a、b 是 (left, top, w, h)，回傳交集佔 a 的比例"""
    ax0, ay0, aw, ah = a
    bx0, by0, bw, bh = b
    x0 = max(ax0, bx0); y0 = max(ay0, by0)
    x1 = min(ax0 + aw, bx0 + bw); y1 = min(ay0 + ah, by0 + bh)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return (x1 - x0) * (y1 - y0) / float(aw * ah)


def main():
    with open(os.path.join(ROOT, 'tools', 'msbn-css.json'), encoding='utf-8') as f:
        css = json.load(f)['blocks']

    todo = 0
    for cid in sorted(css):
        bid = 'msbn_' + cid.replace('MSBN-', '').replace('-', '_')
        path = os.path.join(ROOT, 'blocks', bid, 'block.json')
        if not os.path.isfile(path):
            continue
        blk = json.load(open(path, encoding='utf-8'))
        off = block_offset(css[cid]['layers'], blk)
        if not off:
            print('！%s 對不到原點' % cid)
            continue
        dx, dy = off

        areas = [l for l in css[cid]['layers']
                 if l['name'] in AREA_NAMES and not l['hidden'] and l['width']]
        if not areas:
            continue

        rows = []
        for a in areas:
            box = (a['left'] - dx, a['top'] - dy, a['width'], a['height'])
            imgs = [l for l in blk['layers'] if l.get('type') == 'image'
                    and l.get('width') and l.get('height')]
            hit = None
            for l in imgs:
                if overlap_ratio(box, (l['left'], l['top'], l['width'], l['height'])) > 0.6:
                    hit = l
                    break
            if hit:
                rows.append(('✓', a['name'], box, hit.get('field'),
                             '裁切' if hit.get('clipImage') else '不裁切'))
            else:
                rects = [l for l in blk['layers'] if l.get('type') == 'rect'
                         and l.get('width') and l.get('height')
                         and overlap_ratio(box, (l['left'], l['top'], l['width'], l['height'])) > 0.6]
                rows.append(('✗', a['name'], box,
                             ('只有色塊 ' + str(rects[0].get('field') or rects[0].get('id') or 'rect'))
                             if rects else '沒有這一層', ''))
                todo += 1

        bad = [r for r in rows if r[0] == '✗']
        print('\n══ %s（%s）　曝品範圍 %d 個，缺 %d 個' % (cid, bid, len(rows), len(bad)))
        for mark, name, box, info, extra in rows:
            print('   %s %-22s L%-7.0f T%-7.0f %.0f×%-4.0f  %s %s'
                  % (mark, name, box[0], box[1], box[2], box[3], info, extra))

    print('\n總計要補 %d 個圖片框' % todo)


if __name__ == '__main__':
    main()
