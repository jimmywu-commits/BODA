# -*- coding: utf-8 -*-
"""
用 PS 參考圖當標準答案，量測「文字垂直位置準不準」。

做法
----
1. 從參考圖量出每個文字圖層筆畫的實際上緣（ground truth）。
2. 算出渲染引擎會把該圖層的內容區上緣放在哪，
   再加上「該字串最高筆畫離內容區上緣幾 em × 字級」，得到預測的筆畫上緣。
3. 兩者相減＝誤差。誤差越接近 0 越好。

同時會分別報「有 topExact（精確定位）」與「沒有 topExact（舊估算）」兩群的誤差，
可以直接看出改用精確定位有沒有比較準。

用法：python3 tools/verify_ink_accuracy.py
"""

import json
import os
from collections import Counter, defaultdict

import numpy as np
from PIL import Image

from apply_css_ink_top import FONT_CONTENT_EM, VCORR, ink_offset_em

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def engine_content_top(layer):
    fs = layer['fontSize']
    if layer.get('topExact') is not None:
        return layer['topExact']
    lh = layer.get('lineHeight')
    mult = 1.0
    if lh is not None:
        try:
            n = float(str(lh).replace('px', ''))
            mult = n if n <= 4 else n / fs
        except ValueError:
            mult = 1.0
    half = (mult - 1) * fs / 2.0
    extra = VCORR.get(str(layer.get('id') or ''), 0)
    pad = max(0.0, (FONT_CONTENT_EM * fs - mult * fs) / 2.0)
    return layer['top'] - fs - half + extra - pad


def is_light(color):
    if not color:
        return False
    nums = [int(n) for n in ''.join(c if c.isdigit() else ' ' for c in color).split()]
    return len(nums) >= 3 and sum(nums[:3]) > 600


def measure_ink_top(img, x0, y0, x1, y1, light):
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
    bdir = os.path.join(ROOT, 'blocks')
    buckets = defaultdict(list)
    rows = []

    for name in sorted(os.listdir(bdir)):
        f = os.path.join(bdir, name, 'block.json')
        if not os.path.isfile(f):
            continue
        blk = json.load(open(f, encoding='utf-8'))
        ref = blk.get('refImage')
        if not ref:
            continue
        p = os.path.join(ROOT, 'msbn-img', ref)
        if not os.path.isfile(p):
            p = os.path.join(ROOT, 'img', ref)
        if not os.path.isfile(p):
            continue
        img = np.array(Image.open(p).convert('RGB')).astype(int)

        for l in blk['layers']:
            if l.get('type') != 'text' or l.get('hidden') or l.get('verticalCenter'):
                continue
            if l.get('left') is None or l.get('width') is None or not l.get('fontSize'):
                continue
            fs = l['fontSize']
            ctop = engine_content_top(l)
            em = ink_offset_em(l.get('default') or '', l.get('fontWeight'))
            predicted = ctop + em * fs
            # 量測窗：以預測位置為中心往外各留 10px，避免量到隔壁元素
            got = measure_ink_top(img, l['left'] - 3, predicted - 10,
                                  l['left'] + l['width'] + 3, predicted + fs * 0.9,
                                  is_light(l.get('color')))
            if got is None:
                continue
            err = predicted - got
            if abs(err) > 12:      # 顯然量到別的東西，不列入
                continue
            key = '精確定位' if l.get('topExact') is not None else '舊估算'
            buckets[key].append(err)
            rows.append((name, l.get('field') or l.get('id') or '?', key, round(err, 2)))

    for key in ('精確定位', '舊估算'):
        a = np.array(buckets.get(key, []))
        if not len(a):
            continue
        within1 = (np.abs(a) <= 1).sum()
        within2 = (np.abs(a) <= 2).sum()
        print('%s：%d 個圖層　平均誤差 %+.2f px、絕對誤差平均 %.2f px、最大 %.1f px；'
              '誤差 ≤1px %d 個（%.0f%%）、≤2px %d 個（%.0f%%）'
              % (key, len(a), a.mean(), np.abs(a).mean(), np.abs(a).max(),
                 within1, 100.0 * within1 / len(a), within2, 100.0 * within2 / len(a)))

    worst = sorted(rows, key=lambda r: -abs(r[3]))[:15]
    print('\n誤差最大的 15 個：')
    for name, fld, key, err in worst:
        print('   %-14s %-11s %-5s %+.2f px' % (name, fld, key, err))


if __name__ == '__main__':
    main()
