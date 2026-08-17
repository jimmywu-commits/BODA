# -*- coding: utf-8 -*-
"""
從字型檔算出「筆畫離內容區上緣有多遠」——整套定位校正的關鍵。

為什麼需要這個
--------------
PS 匯出的文字 `top` 是**筆畫上緣**（墨跡最上面那一點）；
瀏覽器的 `top` 是**內容區上緣**（字型的 ascent 線）。兩者中間隔著一段空隙，
而且這段空隙每個字都不一樣（「一」很矮、「品」很高），不是一個固定值。

這段空隙可以精確算出來，不用猜：

    離內容區上緣的 em 數 = (hhea.ascent − 這個字的 yMax) ÷ unitsPerEm

一串字要取**最小值**（最高的那一筆決定墨跡頂端）。

例：ShopeeNotoSans Bold，「促標文案」→ 0.3030 em；45px 字級就是 13.63px。
"""

import os

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

_cache = {}

# 找不到字時的保底值（中日韓漢字常見落點）
DEFAULT_EM = 0.31


def _load(path):
    if path not in _cache:
        f = TTFont(path)
        _cache[path] = {
            'glyphset': f.getGlyphSet(),
            'cmap': f.getBestCmap(),
            'upem': f['head'].unitsPerEm,
            'ascent': f['hhea'].ascent,
            'descent': f['hhea'].descent,
        }
    return _cache[path]


def content_em(font_path):
    """一個字實際佔的高度（em）＝ (ascent + |descent|) ÷ upem。
       ShopeeNotoSans 是 (1160 + 320) / 1000 = 1.48。
       行距小於這個值時，字的上下會超出行框、被 overflow:hidden 裁掉，
       所以要用它來算補償用的上下 padding。"""
    m = _load(font_path)
    return (m['ascent'] - m['descent']) / float(m['upem'])


def ink_offset_em(text, font_path):
    """這串字裡「最高的筆畫」離內容區上緣幾個 em"""
    m = _load(font_path)
    gs, cmap, upem, asc = m['glyphset'], m['cmap'], m['upem'], m['ascent']
    best = None
    for ch in str(text or ''):
        if ch in ' \n\t　':
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
        em = (asc - bp.bounds[3]) / float(upem)
        if best is None or em < best:
            best = em
    return best if best is not None else DEFAULT_EM


def advance_em(text, font_path):
    """這串字最寬的那一行，佔幾個 em。

    量測參考圖時要用：文字框通常被放寬過（換一段字才不會爆框），
    如果照整個框去找筆畫，會抓到旁邊或上面的元素，量出來的位置就錯了。
    先算出「這串字實際多寬」，只在那個範圍裡找，才量得準。
    """
    m = _load(font_path)
    gs, cmap, upem = m['glyphset'], m['cmap'], m['upem']
    best = 0.0
    for line in str(text or '').split('\n'):
        total = 0.0
        for ch in line:
            gname = cmap.get(ord(ch))
            if not gname:
                continue
            try:
                total += gs[gname].width
            except Exception:
                pass
        best = max(best, total / float(upem))
    return best


class FontSet(object):
    """依字重挑字型檔。config 裡的 fonts 是 {"400": "路徑", "500": ..., "700": ...}"""

    def __init__(self, fonts, root='.'):
        self.paths = {str(k): os.path.join(root, v) for k, v in fonts.items()}
        missing = [p for p in self.paths.values() if not os.path.isfile(p)]
        if missing:
            raise IOError('找不到字型檔：' + '、'.join(missing))

    def path_for(self, weight):
        w = str(weight or '400').lower()
        if w in ('bold', '700', '800', '900'):
            w = '700'
        elif w in ('500', '600', 'medium'):
            w = '500'
        else:
            w = '400'
        return self.paths.get(w) or self.paths.get('400')

    def ink_offset_em(self, text, weight):
        return ink_offset_em(text, self.path_for(weight))

    def advance_em(self, text, weight):
        return advance_em(text, self.path_for(weight))

    def content_em(self, weight='400'):
        return content_em(self.path_for(weight))
