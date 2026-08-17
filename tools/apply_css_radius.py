# -*- coding: utf-8 -*-
"""
把新版 PS CSS 的 border-radius 補回 block.json。

背景
----
舊版匯出的 CSS 沒有 border-radius，所以產生 block.json 時圓角資訊整批遺失，
畫面上很多本來有圓邊的色塊變成直角。新版 CSS（v1.2）帶了圓角，
這支程式就是把「同一塊形狀」的圓角搬回去。

配對方式
--------
先用尺寸相同的圖層投票算出該版位的原點位移，再用
「寬高一致 + 位移後座標最接近」配對，只搬 shape 類圖層的圓角，
不動任何座標，所以不會推翻你先前微調過的位置。

用法
----
    python3 tools/apply_css_radius.py            # 預覽（不寫檔）
    python3 tools/apply_css_radius.py --write    # 實際寫入
"""

import json
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv

SHAPE_TYPES = {'rect', 'circle', 'image'}


def norm_radius(v):
    """把 '15px 0px 0px 15px' 正規化成可比較的字串"""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return '%gpx' % v
    parts = str(v).split()
    parts = [p if p.endswith('px') or p == '0' else p for p in parts]
    if len(parts) == 4 and len(set(parts)) == 1:
        return parts[0]
    return ' '.join(parts)


def main():
    with open(os.path.join(ROOT, 'tools', 'msbn-css.json'), encoding='utf-8') as f:
        css = json.load(f)['blocks']

    changed_files = 0
    for cid in sorted(css):
        bid = 'msbn_' + cid.replace('MSBN-', '').replace('-', '_')
        path = os.path.join(ROOT, 'blocks', bid, 'block.json')
        if not os.path.isfile(path):
            print('！找不到', path)
            continue
        with open(path, encoding='utf-8') as f:
            blk = json.load(f)

        cl = [l for l in css[cid]['layers']
              if not l['hidden'] and l['left'] is not None and l['width']]

        # 原點位移投票
        votes = Counter()
        for c in cl:
            for b in blk['layers']:
                if b.get('width') is None or b.get('height') is None:
                    continue
                if abs(b['width'] - c['width']) < 1.5 and abs(b['height'] - c['height']) < 1.5:
                    votes[(round(c['left'] - b['left']), round(c['top'] - b['top']))] += 1
        if not votes:
            print('！%s 對不到原點，跳過' % cid)
            continue
        dx, dy = votes.most_common(1)[0][0]

        hits = []
        used = set()
        for c in cl:
            r = norm_radius(c.get('borderRadius'))
            if not r:
                continue
            best, bestd = None, 6.0
            for i, b in enumerate(blk['layers']):
                if i in used or b.get('type') not in SHAPE_TYPES:
                    continue
                if b.get('width') is None or b.get('height') is None:
                    continue
                if abs(b['width'] - c['width']) > 2 or abs(b['height'] - c['height']) > 2:
                    continue
                d = abs((c['left'] - dx) - b['left']) + abs((c['top'] - dy) - b['top'])
                if d < bestd:
                    best, bestd = i, d
            if best is None:
                hits.append(('未配對', c['name'], r, None))
                continue
            used.add(best)
            b = blk['layers'][best]
            old = norm_radius(b.get('borderRadius'))
            if old != r:
                hits.append(('更新', c['name'] + '→' + str(b.get('id') or b.get('field') or b['type']), r, old))
                b['borderRadius'] = r
            else:
                hits.append(('相同', c['name'], r, old))

        updates = [h for h in hits if h[0] == '更新']
        unmatched = [h for h in hits if h[0] == '未配對']
        if updates or unmatched:
            print('\n══ %s（%s）' % (cid, bid))
            for _, name, new, old in updates:
                print('   更新 %-30s %s → %s' % (name, old, new))
            for _, name, new, _ in unmatched:
                print('   ⚠ CSS 有圓角但 block 找不到對應形狀：%s (%s)' % (name, new))
        if updates and WRITE:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(blk, f, ensure_ascii=False, indent=2)
            changed_files += 1

    print('\n%s：%d 個 block.json' % ('已寫入' if WRITE else '預覽（未寫入）', changed_files))


if __name__ == '__main__':
    main()
