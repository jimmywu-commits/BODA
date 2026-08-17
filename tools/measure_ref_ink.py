# -*- coding: utf-8 -*-
"""
從 PS 參考圖量出「某個文字圖層的筆畫實際落在哪裡」，存成 tools/ref_ink.json。

為什麼要量筆畫而不是量文字框
--------------------------
參考圖是一張圖，上面只有畫出來的結果、沒有圖層資訊。
要判斷引擎有沒有把字放對位置，唯一的客觀依據就是「筆畫的上緣在第幾條掃描線」。
量法：在該圖層的預期範圍內找出跟背景色明顯不同的像素，取最上面那一列。

這支只量「白字」跟「深色字」兩種常見情況，範圍用 block.json 的座標推出來，
再往外放寬一點，避免字剛好超出框時量不到。

用法：
    python3 tools/measure_ref_ink.py            # 量所有版位的 promo/name/warn
    python3 tools/measure_ref_ink.py --field promo
"""

import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAD = 14   # 量測範圍往外放寬的 px

FIELDS = sys.argv[sys.argv.index('--field') + 1].split(',') \
    if '--field' in sys.argv else ['promo', 'name', 'warn', 'copy']


def measure(img, box, light_text):
    x0, y0, x1, y1 = box
    x0 = max(0, x0); y0 = max(0, y0)
    x1 = min(img.shape[1], x1); y1 = min(img.shape[0], y1)
    if x1 <= x0 or y1 <= y0:
        return None
    sub = img[y0:y1, x0:x1]
    if light_text:
        m = (sub[:, :, 0] > 225) & (sub[:, :, 1] > 225) & (sub[:, :, 2] > 225)
    else:
        m = sub.sum(axis=2) < 260
    rows = np.where(m.sum(axis=1) > 2)[0]
    cols = np.where(m.sum(axis=0) > 2)[0]
    if not len(rows):
        return None
    return {'top': int(rows.min() + y0), 'bottom': int(rows.max() + y0),
            'left': int(cols.min() + x0), 'right': int(cols.max() + x0)}


def is_light(color):
    """color 形如 'rgb(255, 255, 255)'；判斷是不是淺色字"""
    if not color:
        return False
    nums = [int(n) for n in ''.join(c if c.isdigit() else ' ' for c in color).split()]
    return len(nums) >= 3 and sum(nums[:3]) > 600


def main():
    out = {}
    bdir = os.path.join(ROOT, 'blocks')
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
            fld = l.get('field')
            if l.get('type') != 'text' or not fld or l.get('hidden'):
                continue
            if fld.rstrip('0123456789') not in FIELDS:
                continue
            if l.get('left') is None or l.get('width') is None or not l.get('fontSize'):
                continue
            fs = l['fontSize']
            box = (int(l['left']) - PAD, int(l['top']) - int(fs) - PAD,
                   int(l['left'] + l['width']) + PAD, int(l['top'] + fs * 1.2) + PAD)
            r = measure(img, box, is_light(l.get('color')))
            if r:
                out['%s::%s' % (name, fld)] = r
    with open(os.path.join(ROOT, 'tools', 'ref_ink.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print('量到 %d 個文字圖層 → tools/ref_ink.json' % len(out))


if __name__ == '__main__':
    main()
