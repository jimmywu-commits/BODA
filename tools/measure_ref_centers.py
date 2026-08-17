# -*- coding: utf-8 -*-
"""
用 PS 參考圖當「標準答案」，量出置中文字真正的水平中心。

為什麼需要這支工具：
  PS 匯出置中文字時只給 left（那串示意文字實際畫出來的左緣），不給文字框寬度。
  當初 CSS→block.json 轉檔時因為不知道框多寬，就一律填成
  left:0 / width:整張版位寬 —— 等於「在整張卡片正中間置中」。
  單品版位剛好看起來還行，但只要文字其實只佔半邊、或一張卡放多品，
  文字就會整個跑到卡片中央去。

量法：
  參考圖跟版位同尺寸（1200×430 等），圖上的字就是設計稿的正確位置。
  每個文字圖層都有自己的顏色（品名深灰 rgb(18,24,39)、警語灰 rgb(116,116,116)…），
  在該圖層的垂直範圍內，把顏色相符的像素找出來，取水平範圍的中點，
  就是這個文字真正該置中的位置。用顏色篩選可以避開旁邊的商品圖干擾。

用法：
  python3 tools/measure-ref-centers.py                 # 全部版位
  python3 tools/measure-ref-centers.py msbn_A_1_1 ...  # 指定版位
"""
import glob
import json
import os
import re
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(os.path.join(__file__, '..')))

# 顏色容差：三個通道的差距總和。太鬆會吃到背景，太緊會漏掉反鋸齒邊緣。
TOL = 40
# 一個「有墨」的欄位至少要幾個像素才算，用來濾掉零星雜點
MIN_COL_PIXELS = 1


def parse_rgb(s):
    nums = re.findall(r'[\d.]+', str(s or ''))
    if len(nums) < 3:
        return None
    return tuple(int(float(x)) for x in nums[:3])


def line_height_mult(layer):
    try:
        n = float(layer.get('lineHeight'))
    except (TypeError, ValueError):
        return 1.2
    fs = layer.get('fontSize') or 1
    return n if n <= 4 else n / fs


def load_vertical_corrections():
    """從 JS/render-config.js 讀 textVerticalCorrection，跟渲染引擎用同一組數字。"""
    src = open(os.path.join(ROOT, 'JS', 'render-config.js'), encoding='utf-8').read()
    m = re.search(r'textVerticalCorrection\s*:\s*\{(.*?)\}', src, re.S)
    out = {}
    if m:
        for k, v in re.findall(r'(\w+)\s*:\s*(-?[\d.]+)', m.group(1)):
            out[k] = float(v)
    return out


VCORR = load_vertical_corrections()


def rendered_top(layer):
    """算出這個文字圖層「實際被畫在畫面上的 y」，公式跟 core/schema-renderer.js 一致：
         top = PS的top − 字體大小 − 半行距 + 微調
       參考圖上的字就在這個位置，所以要在這裡找，不是在 PS 的 top 找。
       （之前找錯地方，才會有一大票『參考圖上找不到這個顏色的字』。） """
    fs = layer.get('fontSize') or 0
    lh = line_height_mult(layer)
    nudge = VCORR.get(str(layer.get('id') or ''), 0.0)
    return layer['top'] - fs - (lh - 1) * fs / 2.0 + nudge


def ink_clusters(img_arr, color, y0, y1, gap=44):
    """在 [y0,y1) 這條帶子裡找顏色相符的像素，並依水平空白把它們分成幾團。

    同一種元素在一張卡上可能出現多次（多品版位的品名、雙欄的文案），
    顏色跟垂直位置完全一樣，所以整條帶子一起量會把好幾團連成一大團、
    量出來的中心變成它們的中點（錯的）。依水平空白切開才能一團一團對。
    """
    H, W, _ = img_arr.shape
    y0 = max(0, int(y0)); y1 = min(H, int(y1))
    if y1 <= y0:
        return []
    band = img_arr[y0:y1]
    mask = np.abs(band - np.array(color, dtype=np.int16)).sum(axis=2) < TOL
    cols = mask.sum(axis=0)
    xs = np.where(cols >= MIN_COL_PIXELS)[0]
    if len(xs) == 0:
        return []
    clusters = []
    start = prev = xs[0]
    for x in xs[1:]:
        if x - prev > gap:
            clusters.append((int(start), int(prev), int(cols[start:prev + 1].sum())))
            start = x
        prev = x
    clusters.append((int(start), int(prev), int(cols[start:prev + 1].sum())))
    return clusters


def measure(img_arr, color, y0, y1, x_lo=0, x_hi=None):
    """在 [y0,y1) 這條帶子裡找顏色相符的像素，回傳 (xmin, xmax, 像素數, 有墨的列範圍)"""
    H, W, _ = img_arr.shape
    y0 = max(0, int(y0)); y1 = min(H, int(y1))
    if y1 <= y0:
        return None
    x_hi = W if x_hi is None else min(W, int(x_hi))
    x_lo = max(0, int(x_lo))
    band = img_arr[y0:y1, x_lo:x_hi]
    mask = np.abs(band - np.array(color, dtype=np.int16)).sum(axis=2) < TOL
    cols = mask.sum(axis=0)
    xs = np.where(cols >= MIN_COL_PIXELS)[0]
    if len(xs) == 0:
        return None
    rows = np.where(mask.sum(axis=1) > 0)[0]
    return (int(xs.min()) + x_lo, int(xs.max()) + x_lo, int(mask.sum()),
            (int(rows.min()) + y0, int(rows.max()) + y0))


def block_paths(names):
    if names:
        return [os.path.join(ROOT, 'blocks', n, 'block.json') for n in names]
    return sorted(glob.glob(os.path.join(ROOT, 'blocks', 'msbn*', 'block.json')))


def promo_center(block):
    """促標底色塊的中心。促標文字當初保留了底色塊的框，所以這個中心是可信的。"""
    for l in block.get('layers', []):
        if str(l.get('id') or '') in ('promoBar', 'promoBg') and l.get('left') is not None and l.get('width'):
            return l['left'] + l['width'] / 2.0
    return None


def main():
    names = [a for a in sys.argv[1:] if not a.startswith('-')]
    results = []

    for path in block_paths(names):
        if not os.path.exists(path):
            continue
        block = json.load(open(path, encoding='utf-8'))
        ref = block.get('refImage')
        if not ref:
            continue
        img_path = os.path.join(ROOT, 'msbn-img', ref)
        if not os.path.exists(img_path):
            img_path = os.path.join(ROOT, 'img', ref)
        if not os.path.exists(img_path):
            continue
        img = Image.open(img_path).convert('RGB')
        if img.size != (block.get('width'), block.get('height')):
            # 參考圖尺寸跟版位不一樣就沒辦法直接對座標
            results.append((block['id'], '-', None, None, None,
                            '參考圖尺寸 %s 與版位 %sx%s 不符' % (img.size, block.get('width'), block.get('height'))))
            continue
        arr = np.asarray(img).astype(np.int16)
        pc = promo_center(block)

        # 把同一種元素的多個實例（品名/品名2/品名3…）湊成一組，一起量才對得起來
        groups = {}
        for layer in block.get('layers', []):
            if layer.get('type') != 'text':
                continue
            if layer.get('textAlign') != 'center' or layer.get('width') is None:
                continue
            if layer.get('verticalCenter'):
                continue        # 圓標已改成綁定圓標圈
            if str(layer.get('id') or '').startswith('promo'):
                continue        # 促標當初保留了底色塊的框，本來就是對的，不用量
            if parse_rgb(layer.get('color')) is None:
                continue
            key = (re.sub(r'\d+$', '', str(layer.get('id') or '')),
                   round(layer.get('top') or 0, 1), layer.get('fontSize'))
            groups.setdefault(key, []).append(layer)

        for (base_id, top, fs), layers in groups.items():
            color = parse_rgb(layers[0].get('color'))
            lh = line_height_mult(layers[0])
            # 只量「第一行」：置中文字每一行的中心都一樣，量一行就夠，
            # 帶子越窄越不會誤吃到上下的其他元素。
            ry = rendered_top(layers[0])
            clusters = ink_clusters(arr, color, ry - 5, ry + fs * lh + 5)
            # 只留寬度合理的團：至少一個字寬，最多不超過版位寬的 92%
            #（上限不能用「幾個字寬」，警語這種一排可以很長，會被誤殺）
            max_w = (block.get('width') or 1200) * 0.92
            clusters = [c for c in clusters
                        if fs * 0.8 <= (c[1] - c[0]) <= max_w and c[2] >= fs * 4]
            # block.json 的實例順序是右→左（PS 圖層順序），所以團也按 x 由大到小排
            clusters.sort(key=lambda c: -(c[0] + c[1]) / 2.0)

            if len(clusters) != len(layers):
                for layer in layers:
                    cur = layer['left'] + layer['width'] / 2.0
                    results.append((block['id'], layer.get('id') or layer.get('field'),
                                    cur, None, pc,
                                    '參考圖上量到 %d 團、block.json 有 %d 個，對不起來'
                                    % (len(clusters), len(layers))))
                continue

            for layer, c in zip(layers, clusters):
                cur = layer['left'] + layer['width'] / 2.0
                measured = (c[0] + c[1]) / 2.0
                results.append((block['id'], layer.get('id') or layer.get('field'),
                                cur, measured, pc,
                                'x %d..%d（寬 %d）' % (c[0], c[1], c[1] - c[0])))

    # ── 輸出 ──
    print('%-14s %-10s %10s %10s %9s %10s  %s' %
          ('版位', '元素', '現在中心', '量到中心', '差距', '促標中心', '備註'))
    print('-' * 104)
    off = 0
    aligned_with_promo = 0
    measurable = 0
    for bid, lid, cur, measured, pc, note in results:
        if measured is None:
            print('%-14s %-10s %10s %10s %9s %10s  %s' %
                  (bid, lid, round(cur, 1) if cur is not None else '-', '-', '-',
                   round(pc, 1) if pc else '-', note))
            continue
        measurable += 1
        d = measured - cur
        if abs(d) > 3:
            off += 1
        flag = ''
        if pc is not None and abs(measured - pc) <= 4:
            aligned_with_promo += 1
            flag = ' ← 跟促標同一條中線'
        print('%-14s %-10s %10.1f %10.1f %+9.1f %10s  %s%s' %
              (bid, lid, cur, measured, d, round(pc, 1) if pc else '-', note, flag))

    print()
    print('可量測的置中文字：%d 個' % measurable)
    print('  水平中心偏掉超過 3px：%d 個' % off)
    print('  量到的中心與促標中線一致（±4px）：%d 個' % aligned_with_promo)


if __name__ == '__main__':
    main()
