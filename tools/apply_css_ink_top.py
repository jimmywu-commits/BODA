# -*- coding: utf-8 -*-
"""
用新版 PS CSS 把 MSBN 版位的文字垂直位置改成「精確定位」。

原理
----
1. 新版 CSS 的文字 top 是「筆畫上緣」，不是文字框上緣。
   （tools/check_css_ink_hypothesis.py 用 200 個圖層對過參考圖：
     差值中位數 +1px、標準差 0.78px，非常穩定。）
2. 瀏覽器排文字時，是把「內容區(content area)」的上緣放在 top，
   筆畫還會再往下一段；這一段可以用字型檔精確算出來：
       筆畫離內容區上緣的 em 數 = (hhea.ascent − 該字最高的 yMax) ÷ unitsPerEm
   一串字取「最小值」（最高的那一筆）。
3. 所以：
       內容區上緣 = 筆畫上緣 − 最小em × 字級
   把這個值寫進 block.json 的 topExact，渲染引擎就直接照用，
   不用再走「減一個字級、減半行距、再加手調補償值」那串估算。

配對方式
--------
CSS 圖層與 block.json 圖層用「水平中心點接近 + 垂直位置最接近」配對。
文字圖層的 left/width 在 block.json 裡為了置中被調整過，
但中心點跟 CSS 是一致的，所以用中心點配對最可靠。

用法
----
    python3 tools/apply_css_ink_top.py            # 預覽
    python3 tools/apply_css_ink_top.py --write    # 實際寫入
"""

import json
import os
import sys
from collections import Counter

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv

# CSS 的文字 top 比實際筆畫上緣少 1px（實測中位數），補回來
INK_BIAS = 1.0

# 新舊位置差超過這個 px，視為「配對配錯了」，不改、只列出來
MAX_SHIFT = 12.0

# render-config 目前的手調補償值（用來重算「引擎現在會放在哪」，好比較差異）
VCORR = {'promo': -2, 'name': -0.5, 'warn': -2, 'badgeText': 0, 'ctaText': -3, 'logoText': 33}

# 字型的內容區高度（ascent 1160 + descent 320，unitsPerEm 1000）
FONT_CONTENT_EM = 1.48

FONTS = {
    400: 'fonts/ShopeeNotoSans(content)-Regular.ttf',
    500: 'fonts/ShopeeNotoSans(content)-Medium.ttf',
    700: 'fonts/ShopeeNotoSans(content)-Bold.ttf',
}
_cache = {}


def font_for(weight):
    w = 700 if str(weight) in ('700', 'bold') else (500 if str(weight) == '500' else 400)
    if w not in _cache:
        f = TTFont(os.path.join(ROOT, FONTS[w]))
        _cache[w] = (f, f.getGlyphSet(), f.getBestCmap(),
                     f['head'].unitsPerEm, f['hhea'].ascent)
    return _cache[w]


def ink_offset_em(text, weight):
    """這串字裡「最高的筆畫」離內容區上緣幾個 em"""
    f, gs, cmap, upm, asc = font_for(weight)
    best = None
    for ch in str(text or ''):
        if ch in ' \n\t':
            continue
        gname = cmap.get(ord(ch))
        if not gname:
            continue
        bp = BoundsPen(gs)
        try:
            gs[gname].draw(bp)
        except Exception:
            continue
        if not bp.bounds:
            continue
        em = (asc - bp.bounds[3]) / upm
        if best is None or em < best:
            best = em
    return best if best is not None else 0.31   # 找不到就用 CJK 常見值


def engine_top(layer):
    """算出這個圖層現在會被放在哪（內容區上緣）。
       已經是精確定位的圖層直接回 topExact，重跑才不會拿舊的 top 去比、
       誤判成「配對錯誤」。"""
    if layer.get('topExact') is not None:
        return layer['topExact']
    fs = layer['fontSize']
    lh = layer.get('lineHeight')
    mult = 1.0
    if lh is not None:
        try:
            n = float(str(lh).replace('px', ''))
            mult = n if n <= 4 else n / fs
        except ValueError:
            mult = 1.0
    half = (mult - 1) * fs / 2.0
    extra = VCORR.get(str(layer.get('id') or ''), 0)
    # 引擎最後還會再扣掉「上下 padding」，扣完才是內容區上緣（＝筆畫的基準）
    pad = max(0.0, (FONT_CONTENT_EM * fs - mult * fs) / 2.0)
    return layer['top'] - fs - half + extra - pad


def block_offset(cl, blk):
    votes = Counter()
    for c in cl:
        if c['hidden'] or not c['width'] or c['left'] is None:
            continue
        for b in blk['layers']:
            if b.get('width') is None or b.get('height') is None:
                continue
            if abs(b['width'] - c['width']) < 1.5 and abs(b['height'] - c['height']) < 1.5:
                votes[(round(c['left'] - b['left']), round(c['top'] - b['top']))] += 1
    return votes.most_common(1)[0][0] if votes else None


def main():
    with open(os.path.join(ROOT, 'tools', 'msbn-css.json'), encoding='utf-8') as f:
        css = json.load(f)['blocks']

    total, files = 0, 0
    suspicious = []
    for cid in sorted(css):
        bid = 'msbn_' + cid.replace('MSBN-', '').replace('-', '_')
        path = os.path.join(ROOT, 'blocks', bid, 'block.json')
        if not os.path.isfile(path):
            continue
        blk = json.load(open(path, encoding='utf-8'))
        off = block_offset(css[cid]['layers'], blk)
        if not off:
            print('！%s 對不到原點，跳過' % cid)
            continue
        dx, dy = off

        css_texts = [c for c in css[cid]['layers']
                     if c['kind'] == 'text' and not c['hidden']
                     and c.get('fontSize') and c['left'] is not None]

        rows = []
        used = set()
        for b_i, b in enumerate(blk['layers']):
            if b.get('type') != 'text' or b.get('verticalCenter') or b.get('hidden'):
                continue
            if b.get('left') is None or not b.get('fontSize'):
                continue
            bw = b.get('width')          # CTA 這類靠左對齊的文字沒有寬度，用左緣比對
            bcx = b['left'] + (bw / 2.0 if bw else 0)
            fs = b['fontSize']
            em = ink_offset_em(b.get('default') or '', b.get('fontWeight'))
            engine_now = engine_top(b)

            # 配對條件：水平中心點接近、字級相同，
            # 再從候選中挑「算出來的位置最接近引擎目前位置」的那一個。
            #
            # 這裡不能直接比 top：block.json 的文字 top 跟 CSS 的差了一個固定量
            # （實測約 42.7px），像 D 系列列高只有 77~80px 的表格，
            # 用 top 比會整整錯開一列。改成比「換算後的最終位置」就不會錯，
            # 因為新舊之間真正的差異只有幾 px。
            best, bestd, best_exact = None, 1e9, None
            for c_i, c in enumerate(css_texts):
                if c_i in used:
                    continue
                cfs = float(str(c['fontSize']).replace('px', ''))
                if abs(cfs - fs) > 0.6:
                    continue
                cl_ = c['left'] - dx
                ccx = cl_ + c['width'] / 2.0
                if bw:
                    # 中心點接近，或 block 的框「橫向包住」CSS 的框
                    # （例如 C-1-4 的三個促標在 block.json 是三層滿版置中文字，
                    #   CSS 則是左/中/右三個各自 242 寬的框，中心點對不上但被包住）
                    covered = b['left'] - 2 <= cl_ and cl_ + c['width'] <= b['left'] + bw + 2
                    if abs(ccx - bcx) > 40 and not covered:
                        continue
                else:
                    if abs(cl_ - b['left']) > 40:
                        continue
                cand = round((c['top'] - dy) + INK_BIAS - em * fs, 3)
                d = abs(cand - engine_now)
                if d < bestd:
                    best, bestd, best_exact = c_i, d, cand
            if best is None:
                continue
            used.add(best)
            exact = best_exact

            # 安全閥：跟目前引擎算出來的位置差太多，多半是配對配錯了圖層，
            # 寧可留著不動、列出來人工看，也不要把版面推歪。
            if abs(exact - engine_now) > MAX_SHIFT:
                suspicious.append((cid, b.get('field') or b.get('id') or '?',
                                   round(engine_now, 1), exact))
                continue

            old = b.get('topExact')
            if old is None or abs(old - exact) > 0.01:
                rows.append((b.get('field') or b.get('id') or '?',
                             round(engine_now, 2), exact, round(exact - engine_now, 2)))
                b['topExact'] = exact
                total += 1

        if rows:
            files += 1
            print('\n══ %s（%s）' % (cid, bid))
            for name, now, exact, delta in rows:
                print('   %-12s 引擎現在 %-9s → topExact %-9s （%+.2f px）'
                      % (name, now, exact, delta))
            if WRITE:
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(blk, f, ensure_ascii=False, indent=2)

    if suspicious:
        print('\n⚠ 以下圖層配對後位移超過 %.0fpx，判定為配對錯誤，維持原狀：' % MAX_SHIFT)
        for cid, name, now, exact in suspicious:
            print('   %-14s %-12s 引擎現在 %s → 算出來 %s' % (cid, name, now, exact))

    print('\n%s：%d 個版位、%d 個文字圖層改為精確定位'
          % ('已寫入' if WRITE else '預覽（未寫入）', files, total))


if __name__ == '__main__':
    main()
