# -*- coding: utf-8 -*-
"""
驗證一個假設：新版 PS CSS 的文字 top，是不是「筆畫上緣」而不是「文字框上緣」。

為什麼要驗這件事
----------------
舊的做法是拿 block.json 的 top，減掉一個字級、再減半行距、再加一個手調的補償值，
才推回瀏覽器該用的 top。那串公式裡的補償值是靠肉眼比對湊出來的，
所以字級一變就對不準（實測 40px 差 0～2.4px、45px 差 2.5px、55px 差 7.1px）。

如果新版 CSS 的 top 直接就是筆畫上緣，那就完全不用猜了：
    瀏覽器該用的 top = 筆畫上緣 − (該字串最高筆畫的 em 高度) × 字級
其中「em 高度」可以從字型檔精確算出來，不是估的。

這支程式把三邊擺在一起比：
    CSS 的 top ／ 參考圖上實際量到的筆畫上緣 ／ 兩者的差
差值如果穩定落在同一個小數字上，假設就成立。

用法：python3 tools/check_css_ink_hypothesis.py
"""

import json
import os
from collections import Counter

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_css():
    with open(os.path.join(ROOT, 'tools', 'msbn-css.json'), encoding='utf-8') as f:
        return json.load(f)['blocks']


def block_offset(cid, css, blk):
    """用尺寸相同的圖層投票，算出 CSS 座標 → block 座標 的平移量"""
    votes = Counter()
    for c in css[cid]['layers']:
        if c['hidden'] or not c['width'] or c['left'] is None:
            continue
        for b in blk['layers']:
            if b.get('width') is None or b.get('height') is None:
                continue
            if abs(b['width'] - c['width']) < 1.5 and abs(b['height'] - c['height']) < 1.5:
                votes[(round(c['left'] - b['left']), round(c['top'] - b['top']))] += 1
    return votes.most_common(1)[0][0] if votes else None


def ink_top(img, x0, y0, x1, y1, light):
    x0 = max(0, int(x0)); y0 = max(0, int(y0))
    x1 = min(img.shape[1], int(x1)); y1 = min(img.shape[0], int(y1))
    if x1 <= x0 or y1 <= y0:
        return None
    sub = img[y0:y1, x0:x1]
    if light:
        m = (sub[:, :, 0] > 225) & (sub[:, :, 1] > 225) & (sub[:, :, 2] > 225)
    else:
        m = sub.sum(axis=2) < 260
    rows = np.where(m.sum(axis=1) > 2)[0]
    return int(rows.min() + y0) if len(rows) else None


def main():
    css = load_css()
    diffs = []
    print('%-14s %-22s %-6s %-9s %-9s %s' % ('版位', '圖層', '字級', 'CSS top', '參考圖筆畫', '差'))
    for cid in sorted(css):
        bid = 'msbn_' + cid.replace('MSBN-', '').replace('-', '_')
        bpath = os.path.join(ROOT, 'blocks', bid, 'block.json')
        ipath = os.path.join(ROOT, 'msbn-img', cid + '.jpg')
        if not (os.path.isfile(bpath) and os.path.isfile(ipath)):
            continue
        blk = json.load(open(bpath, encoding='utf-8'))
        off = block_offset(cid, css, blk)
        if not off:
            continue
        dx, dy = off
        img = np.array(Image.open(ipath).convert('RGB')).astype(int)

        for c in css[cid]['layers']:
            if c['kind'] != 'text' or c['hidden'] or not c.get('fontSize'):
                continue
            if c['name'] not in ('促標', '品名', '警語', 'CTA', '內文', '項目', '文案'):
                continue
            fs = float(str(c['fontSize']).replace('px', ''))
            left = c['left'] - dx
            top = c['top'] - dy
            light = str(c.get('color', '')).lower() in ('#ffffff', '#fefefe', '#fff')
            it = ink_top(img, left - 4, top - 6, left + c['width'] + 4, top + fs * 1.1, light)
            if it is None:
                continue
            d = it - top
            if abs(d) > 12:      # 量到隔壁元素了，不列入統計
                continue
            diffs.append(d)
            print('%-14s %-22s %-6s %-9s %-9s %+.0f' % (cid, c['name'], fs, top, it, d))

    if diffs:
        a = np.array(diffs)
        print('\n樣本 %d 個：差值 中位數 %+.1f px、平均 %+.2f px、標準差 %.2f、範圍 %+d..%+d'
              % (len(a), np.median(a), a.mean(), a.std(), a.min(), a.max()))


if __name__ == '__main__':
    main()
