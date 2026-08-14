# -*- coding: utf-8 -*-
"""
依 2026-08-13 的修正需求，批次調整 block.json。

做四件事
--------
1. LOGO 佔位字（logoText）不再呈現 —— 標成 hidden，資料保留不刪。
   那個框現在是可以直接把圖片拖進來的 LOGO 圖片欄位，字疊在上面反而礙眼。

2. LOGO 圖框加上 clipImage —— 滾輪放大時裁切在框內、連圓角一起吃，
   不會溢出去蓋到卡片其他內容。

3. A-2-4 / A-3-2 的背景圓角標 psRadius —— 這兩個版位的背景是 R20，
   跟卡片統一的 R15 不同，要照 PS 稿的數字畫，不被 render-config 覆寫。

4. D-1-3 / D-2-3 的內文欄位改成跟 D-1-2 / D-2-2 一樣的分欄排版 ——
   原本第 1~4 列被寫成「整條 1160 寬、靠左 20」的滿版文字，
   只有第 5 列是正確的分欄座標，所以看起來跟上一張排版不一樣。
   這裡把每一組（content1~5 / 6~10 / 11~15）的第 1~4 列，
   照該組第 5 列的 left / width / _refCenter 對齊。

用法
----
    python3 tools/patch_blocks_v13.py            # 預覽
    python3 tools/patch_blocks_v13.py --write    # 實際寫入
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLOCKS = os.path.join(ROOT, 'blocks')
WRITE = '--write' in sys.argv

# 背景圓角要照 PS 原值、不被 render-config 統一覆寫的版位
PS_RADIUS_BLOCKS = {'msbn_A_2_4', 'msbn_A_3_2'}

# 內文分欄要對齊的版位
COLUMN_FIX_BLOCKS = {'msbn_D_1_3': 2, 'msbn_D_2_3': 3}  # 值＝有幾組（每組 5 列）

log = []


def is_logo_text(layer):
    if layer.get('type') != 'text':
        return False
    lid = str(layer.get('id') or '')
    if lid.startswith('logoText'):
        return True
    return str(layer.get('default') or '').strip().upper() == 'LOGO' and not layer.get('field')


def is_logo_image(layer):
    if layer.get('type') != 'image':
        return False
    key = (str(layer.get('id') or '') + '|' + str(layer.get('field') or '')).lower()
    return 'logo' in key


def patch(bid, blk):
    changed = False

    for layer in blk['layers']:
        # 1. LOGO 佔位字不呈現
        if is_logo_text(layer) and not layer.get('hidden'):
            layer['hidden'] = True
            log.append('%s：隱藏 LOGO 佔位字（%s）' % (bid, layer.get('id')))
            changed = True

        # 2. LOGO 圖框裁切
        if is_logo_image(layer) and not layer.get('clipImage'):
            layer['clipImage'] = True
            log.append('%s：LOGO 圖框加裁切（%s）' % (bid, layer.get('id') or layer.get('field')))
            changed = True

        # 3. 背景圓角照 PS 原值
        # 這兩個版位的背景層沒有 id、只有 field，所以兩個都要看
        bgkey = str(layer.get('id') or layer.get('field') or '')
        if bid in PS_RADIUS_BLOCKS and bgkey.startswith('bgColor') \
                and layer.get('borderRadius') and not layer.get('psRadius'):
            layer['psRadius'] = True
            log.append('%s：背景圓角改照 PS 原值 %s（%s）'
                       % (bid, layer['borderRadius'], layer.get('id')))
            changed = True

    # 4. 內文分欄對齊
    if bid in COLUMN_FIX_BLOCKS:
        groups = COLUMN_FIX_BLOCKS[bid]
        by_field = {}
        for layer in blk['layers']:
            f = layer.get('field')
            if f and re.match(r'^content\d*$', f):
                by_field[f] = layer
        for g in range(groups):
            names = ['content' + ('' if g * 5 + i == 0 else str(g * 5 + i + 1))
                     for i in range(5)]
            anchor = by_field.get(names[4])   # 每組第 5 列＝目前唯一正確的那一列
            if not anchor:
                continue
            for name in names[:4]:
                l = by_field.get(name)
                if not l:
                    continue
                if l.get('left') == anchor.get('left') and l.get('width') == anchor.get('width'):
                    continue
                log.append('%s：%s 分欄對齊 left %s→%s、width %s→%s'
                           % (bid, name, l.get('left'), anchor.get('left'),
                              l.get('width'), anchor.get('width')))
                l['left'] = anchor['left']
                l['width'] = anchor['width']
                if anchor.get('_refCenter') is not None:
                    l['_refCenter'] = anchor['_refCenter']
                changed = True

    return changed


def main():
    n = 0
    for name in sorted(os.listdir(BLOCKS)):
        path = os.path.join(BLOCKS, name, 'block.json')
        if not os.path.isfile(path):
            continue
        with open(path, encoding='utf-8') as f:
            blk = json.load(f)
        if patch(name, blk):
            n += 1
            if WRITE:
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(blk, f, ensure_ascii=False, indent=2)

    for line in log:
        print(' ', line)
    print('\n%s：%d 個 block.json，共 %d 項調整'
          % ('已寫入' if WRITE else '預覽（未寫入）', n, len(log)))


if __name__ == '__main__':
    main()
