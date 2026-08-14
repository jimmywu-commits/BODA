# -*- coding: utf-8 -*-
"""
把「用參考圖量到的水平中心」寫回 block.json。

只處理真正壞掉的那一批：框寬≈整張版位寬的置中文字圖層。
（那是轉檔時因為不知道文字框多寬，被硬塞成 left:0 / width:版位寬 的結果，
  等於在整張卡片正中間置中。框寬本來就有正常數值的圖層，例如 MSBN B-4-1 的
  品名（寬 275），量測結果跟現況只差 1px 以內，證明那些沒壞，一律不動。）

兩件事：
  1. 水平中心 → 改成參考圖量到的位置
  2. 框寬 → 從「整張版位寬」收斂成這個文字所在那一欄的寬度
     欄寬是看「垂直範圍跟這行字重疊的圖片/色塊」擋在左右哪裡算出來的，
     這樣字太長時會裁在自己那一欄，不會壓到隔壁的商品圖。

用法：
  python3 tools/apply-text-centers.py           # 只試算、印表格，不改檔
  python3 tools/apply-text-centers.py --write   # 實際寫回
"""
import glob
import json
import os
import re
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from measure_ref_centers import (  # noqa: E402
    ROOT, ink_clusters, line_height_mult, parse_rgb, promo_center, rendered_top,
)

# 框寬跟版位寬差距在這個數字以內，就認定是「被硬塞成整卡置中」的壞資料。
# 這種要順便把框寬收斂成欄寬；框寬本來就正常的，只平移、不改寬度。
COLLAPSED_TOL = 60
# 中心差距超過這個 px 才動它（留一點餘裕給量測雜訊：參考圖是 JPG，
# 字邊緣有壓縮雜訊，示意文字本身也可能有多打的字，誤差約 ±10px）
MIN_FIX = 8.0
# 墨跡寬度超過版位寬的這個比例，就判定是「吃到背景」的假量測，不採用
# （白字在淺色底上最容易發生，例如 MSBN C-1-x 的 LOGO 佔位字）
MAX_INK_RATIO = 0.8


def text_band(layer):
    fs = layer.get('fontSize') or 0
    lh = line_height_mult(layer)
    ry = rendered_top(layer)
    return ry, ry + fs * lh


def column_bounds(block, layer, center):
    """算出這行字所在那一欄的左右邊界。

    看「垂直範圍跟這行字重疊」的圖片/色塊：擋在中心左邊的取最右緣當左界，
    擋在右邊的取最左緣當右界。整版滿版的背景不算（那是底圖，不是欄界）。
    """
    card_w = block.get('width') or 1200
    y0, y1 = text_band(layer)
    left, right = 0.0, float(card_w)
    for other in block.get('layers', []):
        if other is layer or other.get('type') == 'text':
            continue
        ol, ow = other.get('left'), other.get('width')
        ot, oh = other.get('top'), other.get('height')
        if None in (ol, ow, ot, oh):
            continue
        if ow >= card_w * 0.95:
            continue                      # 滿版底圖，不是欄界
        if ot >= y1 or ot + oh <= y0:
            continue                      # 垂直不重疊，擋不到這行字
        if ol + ow <= center:
            left = max(left, ol + ow)
        elif ol >= center:
            right = min(right, ol)
    return left, right


def main():
    write = '--write' in sys.argv
    rows = []

    for path in sorted(glob.glob(os.path.join(ROOT, 'blocks', 'msbn*', 'block.json'))):
        block = json.load(open(path, encoding='utf-8'))
        ref = block.get('refImage')
        if not ref:
            continue
        img_path = os.path.join(ROOT, 'msbn-img', ref)
        if not os.path.exists(img_path):
            continue
        img = Image.open(img_path).convert('RGB')
        if img.size != (block.get('width'), block.get('height')):
            continue
        arr = np.asarray(img).astype(np.int16)
        card_w = block['width']

        groups = {}
        for layer in block.get('layers', []):
            if layer.get('type') != 'text' or layer.get('textAlign') != 'center':
                continue
            if layer.get('width') is None or layer.get('verticalCenter'):
                continue
            if str(layer.get('id') or '').startswith('promo'):
                continue
            if parse_rgb(layer.get('color')) is None:
                continue
            key = (re.sub(r'\d+$', '', str(layer.get('id') or '')),
                   round(layer.get('top') or 0, 1), layer.get('fontSize'))
            groups.setdefault(key, []).append(layer)

        changed = False
        for (base_id, top, fs), layers in groups.items():
            color = parse_rgb(layers[0].get('color'))
            lh = line_height_mult(layers[0])
            ry = rendered_top(layers[0])
            clusters = ink_clusters(arr, color, ry - 5, ry + fs * lh + 5)
            max_w = card_w * 0.92
            clusters = [c for c in clusters
                        if fs * 0.8 <= (c[1] - c[0]) <= max_w and c[2] >= fs * 4]
            clusters.sort(key=lambda c: -(c[0] + c[1]) / 2.0)
            if len(clusters) != len(layers):
                continue                  # 對不起來就不猜，維持原狀

            # 同一組有多個實例時，相鄰中心的距離就是欄距；框寬不能超過欄距，
            # 不然字太長會蓋到隔壁那一欄（有些版位左右沒有圖片色塊可以當欄界，
            # 只靠 column_bounds 會算出過寬的框）。
            centers = sorted((c[0] + c[1]) / 2.0 for c in clusters)
            pitch = min((b - a for a, b in zip(centers, centers[1:])), default=None)

            for layer, c in zip(layers, clusters):
                measured = (c[0] + c[1]) / 2.0
                cur = layer['left'] + layer['width'] / 2.0
                ink_w = c[1] - c[0]
                if ink_w > card_w * MAX_INK_RATIO:
                    continue              # 量到的是背景，不是字
                if abs(measured - cur) < MIN_FIX:
                    continue              # 本來就對（框寬正常的圖層量出來都落在這裡）

                collapsed = abs(layer['width'] - card_w) < COLLAPSED_TOL
                lo, hi = column_bounds(block, layer, measured)
                if collapsed:
                    # 被硬塞成整卡置中：框寬也要收斂成這一欄的寬度，
                    # 字太長才會裁在自己那一欄，不會壓到隔壁的商品圖
                    new_w = 2 * min(measured - lo, hi - measured)
                    if pitch is not None:
                        new_w = min(new_w, pitch - 8)
                    new_w = max(new_w, ink_w + 20)
                else:
                    # 框寬本來就是合理數值，只平移。但如果連稿上的示意文字都塞不進
                    # 現在的框（框比字還窄，會被 overflow:hidden 裁掉），就放寬到裝得下。
                    new_w = max(layer['width'], ink_w + 20)
                new_left = measured - new_w / 2.0
                rows.append((block['id'], layer.get('id') or layer.get('field'),
                             round(cur, 1), round(measured, 1),
                             round(measured - cur, 1),
                             layer['width'], round(new_w, 1),
                             round(new_left, 1), round(lo, 1), round(hi, 1)))
                if write:
                    layer['left'] = round(new_left, 3)
                    layer['width'] = round(new_w, 3)
                    layer['_refCenter'] = round(measured, 1)
                    changed = True

        if write and changed:
            json.dump(block, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
            open(path, 'a', encoding='utf-8').write('\n')

    print('%-14s %-10s %9s %9s %8s %8s %8s %9s %s' %
          ('版位', '元素', '原中心', '新中心', '位移', '原框寬', '新框寬', '新left', '欄界'))
    print('-' * 108)
    for r in rows:
        print('%-14s %-10s %9s %9s %+8s %8s %8s %9s  %s..%s' %
              (r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9]))
    print()
    print('共 %d 個文字圖層%s' % (len(rows), '已寫回' if write else '待修（試算，未寫檔）'))
    big = [r for r in rows if abs(r[4]) > 100]
    print('其中位移超過 100px 的：%d 個' % len(big))


if __name__ == '__main__':
    main()
