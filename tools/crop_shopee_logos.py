# -*- coding: utf-8 -*-
"""
從 PS 參考圖裁切出 C 系列用的蝦皮 LOGO，存成去背 PNG。

為什麼要這樣做
--------------
這幾個 LOGO 在 PSD 裡是智慧型物件，匯出的 CSS 只有座標、沒有圖檔內容，
所以只能從 1:1 的參考圖（msbn-img/MSBN-C-*.jpg，剛好就是 1200×400）裁下來。

去背方式
--------
這些 LOGO 是「純白圖案疊在單一純色色塊上」（連 S 都是把底色挖空露出來的），
所以可以用標準的線性去背：把每個像素投影到「底色 → 白色」這條線上，
投影的比例就是不透明度，顏色一律是白色。
這樣邊緣的半透明像素不會殘留一圈紅邊。

裁切範圍是自動量出來的：在指定的色塊範圍內，找出所有「不是底色」的像素的外框，
不用手動抓座標，也不會像照 CSS 標示的框去裁那樣把邊緣切掉。

產出：msbn-img/logo/*.png

用法：python3 tools/crop_shopee_logos.py
"""

import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'msbn-img', 'logo')

# (輸出檔名, 參考圖, 色塊範圍 left/top/width/height, 底色)
# 色塊範圍就是 block.json 裡那個純色矩形，LOGO 一定在它裡面。
JOBS = [
    ('shopee-mall.png',     'MSBN-C-1-1.jpg', (75, 132, 155, 157), (208, 1, 27)),
    ('shopee-shopping.png', 'MSBN-C-1-2.jpg', (75, 132, 155, 157), (238, 77, 45)),
    ('shopee-3c.png',       'MSBN-C-1-4.jpg', (443, 142, 106, 120), (208, 1, 27)),
    ('shopee-shopping-s.png', 'MSBN-C-1-4.jpg', (42, 142, 106, 120), (238, 77, 45)),
]

INSET = 6        # 色塊邊緣往內縮，避免把色塊本身的邊緣鋸齒當成圖案
PAD = 1          # 量到外框後再往外留一點點
MIN_RUN = 2      # 一整列/一整行至少要有這麼多個不透明像素才算「有圖案」


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, ref, (bx, by, bw, bh), bg in JOBS:
        im = np.array(Image.open(os.path.join(ROOT, 'msbn-img', ref)).convert('RGB')).astype(float)
        region = im[by + INSET:by + bh - INSET, bx + INSET:bx + bw - INSET]

        bgv = np.array(bg, dtype=float)
        white = np.array([255.0, 255.0, 255.0])
        axis = white - bgv
        # 投影到「底色→白色」這條線上的比例＝不透明度
        alpha = ((region - bgv) @ axis) / (axis @ axis)
        alpha = np.clip(alpha, 0.0, 1.0)

        solid = alpha > 0.35
        rows = np.where(solid.sum(axis=1) >= MIN_RUN)[0]
        cols = np.where(solid.sum(axis=0) >= MIN_RUN)[0]
        if not len(rows) or not len(cols):
            print('！%s 在指定範圍內找不到圖案' % name)
            continue
        y0, y1 = max(0, rows.min() - PAD), min(alpha.shape[0], rows.max() + 1 + PAD)
        x0, x1 = max(0, cols.min() - PAD), min(alpha.shape[1], cols.max() + 1 + PAD)
        a = alpha[y0:y1, x0:x1]

        rgb = np.full(a.shape + (3,), 255.0)
        out = np.dstack([rgb, a * 255]).astype(np.uint8)
        Image.fromarray(out, 'RGBA').save(os.path.join(OUT, name))
        print('%-24s ← %s  裁出 %d×%d（色塊內偏移 %d,%d）'
              % (name, ref, x1 - x0, y1 - y0, x0 + INSET, y0 + INSET))


if __name__ == '__main__':
    main()
