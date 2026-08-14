# -*- coding: utf-8 -*-
"""
用設計稿參考圖，自動量出每個版位還差多少，寫成 calibration.json。

為什麼需要這一步
----------------
PS 匯出的 CSS 只有「圖層在整張大畫布的哪裡」，沒有「這一格版位的邊界在哪」。
版位的邊界是規格（1200×400、1200×430…），CSS 裡推不出來——
所以 build_blocks 一開始只能先用「內容置中」當猜測，整格可能還差幾 px。

這支程式把參考圖當標準答案，反過來量出這個差值：

  1. 對每個文字圖層，算出「預測的筆畫位置」
  2. 在參考圖上量出「實際的筆畫位置」
  3. 兩者相減，取整個版位的中位數 → 就是這一格要補的 dx / dy

中位數對雜訊很穩：就算有一兩個圖層量錯（量到隔壁的東西），也不會被帶歪。

流程
----
    python -m psdcss.build_blocks config.json --write     # 先產一版
    python -m psdcss.calibrate     config.json --write    # 量出差值
    python -m psdcss.build_blocks config.json --write     # 再產一次（自動套用）
    python -m psdcss.verify_ref    config.json            # 確認結果
"""

import json
import os
import sys

import numpy as np
from PIL import Image

from .build_blocks import load_config, rel
from .fontmetrics import FontSet
from .verify_ref import is_light, text_span

# 量測窗：預測位置往外放寬多少（要夠大才抓得到偏掉的字，又不能大到抓到隔壁）
PAD_Y = 18
PAD_X = 40
MIN_SAMPLES = 3


def ink_box(img, x0, y0, x1, y1, light, min_run=2):
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
    cols = np.where(m.sum(axis=0) >= min_run)[0]
    if not len(rows) or not len(cols):
        return None
    return (rows.min() + y0, cols.min() + x0, cols.max() + x0)


def calibrate_block(cfg, fonts, blk, img):
    dys, dxs = [], []
    for l in blk['layers']:
        if l.get('type') != 'text' or l.get('hidden') or not l.get('fontSize'):
            continue
        if l.get('topExact') is None or not l.get('width'):
            continue
        fs = l['fontSize']
        text = l.get('designText') or l.get('default') or ''
        if not text.strip():
            continue
        em = fonts.ink_offset_em(text, l.get('fontWeight'))
        pred_top = l['topExact'] + em * fs
        pred_cx = l['left'] + l['width'] / 2.0

        # 量測窗以「這串字實際的寬度」為準，再往外放寬 PAD_X
        # （還沒對準，所以要留比 verify 更多的餘裕）
        x0, x1 = text_span(l, fonts.advance_em(text, l.get('fontWeight')) * fs, PAD_X)
        box = ink_box(img, x0, pred_top - PAD_Y, x1, pred_top + fs * 0.95,
                      is_light(l.get('color')))
        if box is None:
            continue
        top, x0, x1 = box
        dys.append(top - pred_top)
        if l.get('textAlign', 'center') == 'center':
            dxs.append((x0 + x1) / 2.0 - pred_cx)

    if len(dys) < MIN_SAMPLES:
        return None
    out = {'dy': round(float(np.median(dys)), 2), 'samples': len(dys)}
    if len(dxs) >= MIN_SAMPLES:
        out['dx'] = round(float(np.median(dxs)), 2)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    write = '--write' in sys.argv
    if not args:
        print(__doc__)
        return 1
    cfg = load_config(args[0])
    fonts = FontSet(cfg['fonts'], cfg['_root'])
    blocks_dir = rel(cfg, cfg.get('out', 'blocks'))
    ref_dirs = [rel(cfg, d) for d in cfg.get('refImageDirs', ['ref'])]
    pat = cfg.get('refImagePattern', '{id}.jpg')

    # block id → 原本的 CSS id（calibration.json 用 CSS id 當 key）
    prefix = cfg.get('blockIdPrefix', '')
    strip = cfg.get('stripIdPrefix', '')

    old = {}
    calib_path = rel(cfg, cfg.get('calibration', 'calibration.json'))
    if os.path.isfile(calib_path):
        with open(calib_path, encoding='utf-8') as f:
            old = json.load(f).get('blocks', {})

    result = {}
    for name in sorted(os.listdir(blocks_dir)):
        p = os.path.join(blocks_dir, name, 'block.json')
        if not os.path.isfile(p):
            continue
        blk = json.load(open(p, encoding='utf-8'))
        ref = blk.get('refImage')
        path = next((os.path.join(d, ref) for d in ref_dirs
                     if ref and os.path.isfile(os.path.join(d, ref))), None)
        if not path:
            continue
        img = np.array(Image.open(path).convert('RGB')).astype(int)
        if img.shape[1] != blk['width'] or img.shape[0] != blk['height']:
            print('！%s 參考圖尺寸 %dx%d 跟版位 %dx%d 不合，跳過'
                  % (name, img.shape[1], img.shape[0], blk['width'], blk['height']))
            continue

        r = calibrate_block(cfg, fonts, blk, img)
        if not r:
            continue
        css_id = strip + name[len(prefix):].replace('_', '-') if prefix else name
        # 累加：這次量到的差值要疊在上次已經套用的量上面
        prev = old.get(css_id, {})
        merged = {'dx': round(prev.get('dx', 0) + r.get('dx', 0), 2),
                  'dy': round(prev.get('dy', 0) + r['dy'], 2),
                  'samples': r['samples']}
        result[css_id] = merged
        flag = '' if abs(r['dy']) < 0.5 and abs(r.get('dx', 0)) < 0.5 else '  ← 這次有修正'
        print('%-16s 這次量到 dx=%+.2f dy=%+.2f（%d 個字）　累計 dx=%+.2f dy=%+.2f%s'
              % (name, r.get('dx', 0), r['dy'], r['samples'],
                 merged['dx'], merged['dy'], flag))

    if write:
        with open(calib_path, 'w', encoding='utf-8') as f:
            json.dump({'_說明': '由 psdcss.calibrate 用參考圖量出來的逐版位微調量（px）',
                       'blocks': result}, f, ensure_ascii=False, indent=1)
        print('\n已寫入 %s（%d 個版位）' % (calib_path, len(result)))
    else:
        print('\n預覽（未寫入）：%d 個版位　加 --write 才會存檔' % len(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
