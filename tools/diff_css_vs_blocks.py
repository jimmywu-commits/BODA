# -*- coding: utf-8 -*-
"""
比對「新版 PS CSS」與「現有 block.json」的座標差異。

為什麼要先比對
--------------
現有 71 份 block.json 是照舊版 CSS 產生、又手動微調過位置的。
新版 CSS 多了圓角等資訊，但如果直接整份覆蓋，會把先前調到位的東西推翻。
所以先算出「兩邊差多少」：
  - 差 0（或只差 <1px）的 → 代表新舊一致，可以放心以新版 CSS 為準
  - 差很多的 → 列出來人工判讀，通常是刻意微調過的地方

原點對齊
--------
PS 的座標是整張大畫布的絕對值，block.json 是版位內的相對值。
兩者的原點差是一個固定平移量，這裡用「尺寸相同的圖層」互相配對，
取平移量的眾數當作該版位的原點，再逐層比對。

用法
----
    python3 tools/diff_css_vs_blocks.py            # 全部
    python3 tools/diff_css_vs_blocks.py B-1-1 D-1-3  # 只看幾個
"""

import json
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def block_id_of(css_id):
    """MSBN-B-1-1 -> msbn_B_1_1"""
    return 'msbn_' + css_id.replace('MSBN-', '').replace('-', '_')


def load_blocks():
    out = {}
    bdir = os.path.join(ROOT, 'blocks')
    for name in os.listdir(bdir):
        p = os.path.join(bdir, name, 'block.json')
        if os.path.isfile(p):
            with open(p, encoding='utf-8') as f:
                out[name] = json.load(f)
    return out


def guess_offset(css_layers, blk_layers):
    """用尺寸相同的圖層配對，找出最常出現的平移量"""
    votes = Counter()
    for c in css_layers:
        if c['hidden'] or c['width'] is None:
            continue
        for b in blk_layers:
            if b.get('width') is None or b.get('height') is None:
                continue
            if abs(b['width'] - c['width']) < 1.5 and abs(b['height'] - c['height']) < 1.5:
                votes[(round(c['left'] - b['left']), round(c['top'] - b['top']))] += 1
    if not votes:
        return None, 0
    (dx, dy), cnt = votes.most_common(1)[0]
    return (dx, dy), cnt


def main():
    with open(os.path.join(ROOT, 'tools', 'msbn-css.json'), encoding='utf-8') as f:
        css = json.load(f)['blocks']
    blocks = load_blocks()
    want = [a.upper() for a in sys.argv[1:]]

    for cid in sorted(css):
        short = cid.replace('MSBN-', '')
        if want and short not in want:
            continue
        bid = block_id_of(cid)
        blk = blocks.get(bid)
        if not blk:
            print('！ %s：找不到對應的 blocks/%s' % (cid, bid))
            continue

        cl = [l for l in css[cid]['layers'] if not l['hidden'] and l['left'] is not None]
        off, votes = guess_offset(cl, blk['layers'])
        if off is None:
            print('！ %s：配不到共同尺寸的圖層，無法對齊原點' % cid)
            continue
        dx, dy = off

        # 逐層配對：先以「尺寸＋位置」找最近的
        used = set()
        rows = []
        for c in cl:
            if c['width'] is None:
                continue
            best, bestd = None, 1e9
            for i, b in enumerate(blk['layers']):
                if i in used or b.get('width') is None:
                    continue
                if abs(b['width'] - c['width']) > 2 or abs(b.get('height', 0) - c['height']) > 2:
                    continue
                d = abs((c['left'] - dx) - b['left']) + abs((c['top'] - dy) - b['top'])
                if d < bestd:
                    best, bestd = i, d
            if best is None:
                rows.append((c['name'], None, None, None))
                continue
            used.add(best)
            b = blk['layers'][best]
            rows.append((c['name'], b.get('id') or b.get('field') or b['type'],
                         round((c['left'] - dx) - b['left'], 1),
                         round((c['top'] - dy) - b['top'], 1)))

        moved = [r for r in rows if r[2] is not None and (abs(r[2]) >= 1 or abs(r[3]) >= 1)]
        missing = [r for r in rows if r[2] is None]
        radius = [(c['name'], c.get('borderRadius')) for c in cl if c.get('borderRadius')]

        print('\n══ %s  →  %s   原點位移(%d,%d) 票數%d' % (cid, bid, dx, dy, votes))
        print('   圖層 CSS %d / block %d；位置一致 %d、有位移 %d、CSS 有但 block 沒有 %d'
              % (len(cl), len(blk['layers']), len(rows) - len(moved) - len(missing),
                 len(moved), len(missing)))
        for name, bidk, ddx, ddy in moved:
            print('     移位 %-22s (%s)  Δx=%s Δy=%s' % (name, bidk, ddx, ddy))
        for name, _, _, _ in missing:
            print('     缺少 %s' % name)
        if radius:
            print('     CSS 圓角：' + '、'.join('%s=%s' % r for r in radius))


if __name__ == '__main__':
    main()
