# -*- coding: utf-8 -*-
"""
把設計稿上的「曝品範圍」補成可以拖圖片進去的圖片框。

問題
----
設計稿標「曝品範圍」的地方，就是這一格要放商品圖／情境圖的位置。
但有 34 個這種區域在 block.json 裡只是一塊 rect 色塊，
畫面上看起來一樣，圖片卻拖不進去、匯入工單時也吃不到圖。

做法
----
1. 從新版 CSS 找出所有「曝品範圍」。
2. 跟 block.json 對位：
   - 已經有尺寸幾乎一樣的 rect（通常就是那塊底色）→ 直接把它改成 image 圖層，
     原本的顏色欄位改掛在 `bgField`，所以底色還是可以在匯入頁改。
   - 沒有對應的 rect（曝品範圍只是卡片裡的一小塊）→ 插一層新的 image 圖層，
     疊在該格背景的上面、文字的下面。
3. 欄位編號沿用專案慣例「由右到左」：最右邊是 productImg，往左 productImg2、3…
   如果這一格本來就有部分圖片框但編號跟慣例不一致，會一起重排，
   這樣匯入工單時同一直行才會對到同一欄。
4. 圖片放大時裁切在這個色塊內（`clipImage`），不會蓋到旁邊的內容。

同時把設計稿上的示意字（「商品圖／人物圖／情境圖」這種標示用的文字）標成 hidden，
那是給設計看的標註，不是要輸出的內容。

用法
----
    python3 tools/add_exposure_frames.py            # 預覽
    python3 tools/add_exposure_frames.py --write    # 實際寫入
"""

import json
import os
import re
import sys

from apply_css_ink_top import block_offset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv

AREA_NAME = '曝品範圍'
# 設計稿上的示意字：這些文字只是標註「這裡要放什麼圖」，不是要輸出的內容
HINT_TEXTS = ('商品圖', '情境圖', '人物圖', '信用卡圖')

# 要「圖片放大也不能超出範圍」的版位。
# 只列你指定過的那幾個：這些版位的曝品範圍在設計稿上是一塊看得到的色塊，
# 圖片溢出去會直接蓋到卡片其他內容。其他版位的曝品範圍只是設計稿上的參考框，
# 畫面上並沒有邊界，硬裁反而會讓人搞不清楚圖為什麼被切掉，所以維持可超出。
# 想讓某個版位也裁切，把它的 id 加進這個集合再跑一次即可。
CLIP_BLOCKS = {'msbn_B_1_1', 'msbn_B_1_2', 'msbn_B_1_3', 'msbn_B_1_4', 'msbn_B_3_4'}

SAME_TOL = 3.0        # 位置/尺寸差在這個範圍內視為「同一塊」
COVER_MIN = 0.6       # 判斷某個 rect 有沒有包住這塊區域


def near(a, b):
    return abs(a - b) <= SAME_TOL


def covers(box, l):
    bx, by, bw, bh = box
    x0 = max(bx, l['left']); y0 = max(by, l['top'])
    x1 = min(bx + bw, l['left'] + l['width']); y1 = min(by + bh, l['top'] + l['height'])
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return (x1 - x0) * (y1 - y0) / float(bw * bh)


def field_name(rank):
    return 'productImg' if rank == 0 else 'productImg%d' % (rank + 1)


def side_label(rank, total):
    if total == 1:
        return '商品圖／情境圖'
    names = {1: ['右', '左'], 2: ['右', '中', '左'],
             3: ['右', '中右', '中左', '左']}.get(total - 1)
    if names:
        return '商品圖／情境圖（%s）' % names[rank]
    return '商品圖／情境圖 %d' % (rank + 1)


def main():
    with open(os.path.join(ROOT, 'tools', 'msbn-css.json'), encoding='utf-8') as f:
        css = json.load(f)['blocks']

    changed_files = 0
    for cid in sorted(css):
        bid = 'msbn_' + cid.replace('MSBN-', '').replace('-', '_')
        path = os.path.join(ROOT, 'blocks', bid, 'block.json')
        if not os.path.isfile(path):
            continue
        blk = json.load(open(path, encoding='utf-8'))
        off = block_offset(css[cid]['layers'], blk)
        if not off:
            continue
        dx, dy = off

        areas = [l for l in css[cid]['layers']
                 if l['name'] == AREA_NAME and not l['hidden'] and l['width']]
        if not areas:
            continue
        # 由右到左排（left 大的排前面）＝ productImg、productImg2、productImg3…
        areas.sort(key=lambda a: -a['left'])

        log = []
        zmax = max([l.get('zIndex') or 0 for l in blk['layers']] or [0])

        for rank, a in enumerate(areas):
            box = (a['left'] - dx, a['top'] - dy, a['width'], a['height'])
            fld = field_name(rank)
            label = side_label(rank, len(areas))
            radius = a.get('borderRadius')

            # 1. 已經有尺寸幾乎一樣的圖片框 → 只補設定
            same_img = next((l for l in blk['layers']
                             if l.get('type') == 'image' and l.get('width')
                             and near(l['left'], box[0]) and near(l['top'], box[1])
                             and near(l['width'], box[2]) and near(l['height'], box[3])), None)
            if same_img:
                if same_img.get('field') != fld:
                    log.append('　改欄位名 %s → %s（統一由右到左編號）'
                               % (same_img.get('field'), fld))
                    same_img['field'] = fld
                    same_img['fieldLabel'] = label
                if bid in CLIP_BLOCKS and not same_img.get('clipImage'):
                    same_img['clipImage'] = True
                    log.append('　%s 加裁切（放大不超出色塊）' % fld)
                if radius and same_img.get('borderRadius') != radius:
                    same_img['borderRadius'] = radius
                    same_img['psRadius'] = True
                continue

            # 2. 有尺寸幾乎一樣的色塊 → 就地改成圖片框，顏色欄位改掛 bgField
            same_rect = next((l for l in blk['layers']
                              if l.get('type') == 'rect' and l.get('width')
                              and near(l['left'], box[0]) and near(l['top'], box[1])
                              and near(l['width'], box[2]) and near(l['height'], box[3])), None)
            if same_rect:
                old_field = same_rect.get('field')
                same_rect['type'] = 'image'
                same_rect['field'] = fld
                same_rect['fieldLabel'] = label
                if bid in CLIP_BLOCKS:
                    same_rect['clipImage'] = True
                if old_field:
                    same_rect['bgField'] = old_field
                    same_rect['bgFieldLabel'] = same_rect.pop('fieldLabel', None) or '底色'
                    same_rect['bgFieldLabel'] = '曝品範圍底色'
                    same_rect['fieldLabel'] = label
                if radius:
                    same_rect['borderRadius'] = radius
                    same_rect['psRadius'] = True
                log.append('　色塊改成圖片框：%s（底色欄位 %s 保留）' % (fld, old_field))
                continue

            # 3. 都沒有 → 插一層新的圖片框，疊在包住它的那塊背景上面
            host = None
            for l in blk['layers']:
                if l.get('type') in ('rect', 'image') and l.get('width') and l.get('height'):
                    if covers(box, l) > COVER_MIN:
                        if host is None or (l['width'] * l['height'] < host['width'] * host['height']):
                            host = l
            zi = (host.get('zIndex') or zmax) + 1 if host else zmax + 1
            # 不給底色：設計稿上這一塊本來就是透明的（藍色是給設計看的參考框，不會輸出）。
            # 空的時候引擎會畫一張淡淡的虛線佔位卡，提示「這裡可以拖圖片進來」，
            # 放了圖就消失，不會平白多出一塊色塊。
            layer = {
                'zIndex': zi, 'type': 'image',
                'left': box[0], 'top': box[1], 'width': box[2], 'height': box[3],
                'field': fld, 'fieldLabel': label,
            }
            if bid in CLIP_BLOCKS:
                layer['clipImage'] = True
            if radius:
                layer['borderRadius'] = radius
                layer['psRadius'] = True
            # 陣列是由上而下（z 大的在前），插在 host 前面就等於疊在 host 上面
            idx = blk['layers'].index(host) if host else len(blk['layers'])
            blk['layers'].insert(idx, layer)
            log.append('　新增圖片框 %s　L%.0f T%.0f %.0f×%.0f'
                       % (fld, box[0], box[1], box[2], box[3]))

        # 設計稿示意字不輸出
        for l in blk['layers']:
            if l.get('type') != 'text' or l.get('field') or l.get('hidden'):
                continue
            txt = str(l.get('default') or '')
            if any(h in txt for h in HINT_TEXTS):
                l['hidden'] = True
                log.append('　隱藏示意字「%s」' % txt.replace('\n', '／'))

        if log:
            changed_files += 1
            print('\n══ %s（%s）' % (cid, bid))
            for line in log:
                print(line)
            if WRITE:
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(blk, f, ensure_ascii=False, indent=2)

    print('\n%s：%d 個版位' % ('已寫入' if WRITE else '預覽（未寫入）', changed_files))


if __name__ == '__main__':
    main()
