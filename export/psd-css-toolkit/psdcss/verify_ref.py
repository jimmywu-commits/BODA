# -*- coding: utf-8 -*-
"""
拿設計稿參考圖當「標準答案」，量測產生出來的版位定位準不準。

原理
----
在參考圖上找出每個文字**筆畫最上面那一條掃描線**在第幾列，
跟 block.json 算出來的預測值相減，就是誤差：

    預測筆畫上緣 = topExact + （這串字最高筆畫的 em 值 × 字級）

誤差平均能壓在 1px 以內，就代表整套換算是對的。
沒有這一步就只能用眼睛猜，很容易「看起來差不多、其實差了 7px」。

用法
----
    python -m psdcss.verify_ref config.json
"""

import json
import os
import sys

import numpy as np
from PIL import Image

from .build_blocks import load_config, rel
from .fontmetrics import FontSet


def is_light(color):
    """判斷是不是淺色字（決定要在圖上找白點還是暗點）"""
    if not color:
        return False
    s = str(color)
    if s.startswith('#') and len(s) >= 7:
        v = [int(s[i:i + 2], 16) for i in (1, 3, 5)]
    else:
        nums = [int(n) for n in ''.join(c if c.isdigit() else ' ' for c in s).split()]
        if len(nums) < 3:
            return False
        v = nums[:3]
    return sum(v) > 600


def text_span(layer, ink_w, pad=4):
    """這串字實際會落在哪個水平範圍（依對齊方式算），左右各留一點餘裕"""
    left, width = layer['left'], layer['width'] or ink_w
    align = layer.get('textAlign', 'center')
    if align == 'center':
        cx = left + width / 2.0
        return cx - ink_w / 2.0 - pad, cx + ink_w / 2.0 + pad
    if align == 'right':
        return left + width - ink_w - pad, left + width + pad
    return left - pad, left + ink_w + pad


def measure_ink_top(img, x0, y0, x1, y1, light, min_run=2):
    x0, y0 = max(0, int(x0)), max(0, int(y0))
    x1, y1 = min(img.shape[1], int(x1)), min(img.shape[0], int(y1))
    if x1 <= x0 or y1 <= y0:
        return None
    sub = img[y0:y1, x0:x1]
    if light:
        m = (sub[:, :, 0] > 225) & (sub[:, :, 1] > 225) & (sub[:, :, 2] > 225)
    else:
        m = sub.sum(axis=2) < 260
    rows = np.where(m.sum(axis=1) >= min_run)[0]
    return int(rows.min() + y0) if len(rows) else None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        print(__doc__)
        return 1
    cfg = load_config(args[0])
    fonts = FontSet(cfg['fonts'], cfg['_root'])
    blocks_dir = rel(cfg, cfg.get('out', 'blocks'))
    ref_dirs = [rel(cfg, d) for d in cfg.get('refImageDirs', ['ref'])]

    errs, rows, no_ref, unsure = [], [], 0, 0
    for name in sorted(os.listdir(blocks_dir)):
        p = os.path.join(blocks_dir, name, 'block.json')
        if not os.path.isfile(p):
            continue
        blk = json.load(open(p, encoding='utf-8'))
        ref = blk.get('refImage')
        path = next((os.path.join(d, ref) for d in ref_dirs
                     if ref and os.path.isfile(os.path.join(d, ref))), None)
        if not path:
            no_ref += 1
            continue
        img = np.array(Image.open(path).convert('RGB').resize(
            (blk['width'], blk['height']))).astype(int)

        for l in blk['layers']:
            if l.get('type') != 'text' or l.get('hidden') or not l.get('fontSize'):
                continue
            if l.get('topExact') is None or l.get('width') is None:
                continue
            fs = l['fontSize']
            text = l.get('designText') or l.get('default') or ''
            em = fonts.ink_offset_em(text, l.get('fontWeight'))
            pred = l['topExact'] + em * fs
            # 只在「這串字實際會佔到的寬度」裡找筆畫。
            # 文字框被放寬過，照整個框找會抓到旁邊或上面的元素。
            x0, x1 = text_span(l, fonts.advance_em(text, l.get('fontWeight')) * fs)
            win_top = pred - 10
            got = measure_ink_top(img, x0, win_top, x1, pred + fs * 0.9,
                                  is_light(l.get('color')))
            # 筆畫剛好卡在量測窗最上緣 = 這一層在參考圖上根本沒有（或被別的東西蓋住），
            # 抓到的是窗外飄進來的東西。這種算「量不到」，不能當成「差 10px」。
            if got is None or got <= int(win_top) + 1:
                unsure += 1
                continue
            e = pred - got
            if abs(e) > 12:
                unsure += 1
                continue
            errs.append(e)
            rows.append((blk['id'], l.get('field') or '?', round(e, 2)))

    if not errs:
        print('沒有量到任何文字（確認 refImageDirs 裡有對應的參考圖）')
        return 1

    a = np.array(errs)
    print('量到 %d 個文字圖層' % len(a))
    print('  平均誤差 %+.2f px　絕對誤差平均 %.2f px　最大 %.1f px'
          % (a.mean(), np.abs(a).mean(), np.abs(a).max()))
    print('  誤差 ≤1px：%d 個（%.0f%%）　≤2px：%d 個（%.0f%%）'
          % ((np.abs(a) <= 1).sum(), 100.0 * (np.abs(a) <= 1).mean(),
             (np.abs(a) <= 2).sum(), 100.0 * (np.abs(a) <= 2).mean()))
    if unsure:
        print('  （另有 %d 個圖層在參考圖上量不到，多半是參考圖比 CSS 舊、'
              '或被其他元素蓋住，未列入統計）' % unsure)
    if no_ref:
        print('  （有 %d 個版位找不到參考圖，略過）' % no_ref)

    worst = sorted(rows, key=lambda r: -abs(r[2]))[:12]
    if worst and abs(worst[0][2]) > 1:
        print('\n誤差最大的幾個：')
        for bid, fld, e in worst:
            print('   %-18s %-12s %+.2f px' % (bid, fld, e))
    return 0


if __name__ == '__main__':
    sys.exit(main())
