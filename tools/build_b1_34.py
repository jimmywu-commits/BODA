# -*- coding: utf-8 -*-
"""
重建 MSBN B-1-3 / B-1-4 的 block.json。

為什麼要重建
------------
這兩格的排版跟設計稿差很多，原因不只是座標偏掉：

1. **文案跑到整條置中**：設計稿上「文案最多10個字以內」是靠右半邊、寬 438、置中；
   舊的 block.json 卻寫成 left 20、寬 1160（整條卡片置中），
   結果整句話往左偏了將近 290px。
2. **白色圓角膠囊被當成促標底色**：那一塊 300×90、圓角 45 的白色膠囊，
   在設計稿上是放 LOGO 的框（裡面就是「LOGO」示意字），
   舊的 block.json 卻把它做成「促標底色」的色塊，
   所以既不能放 LOGO，改促標顏色時還會把它染色。
3. **曝品範圍不能放圖**：左半邊（B-1-4 是整片）的白色區域是曝品範圍，
   舊的做法是一塊純色 rect，圖片拖不進去。
4. B-1-4 幾乎整格都沒做出來，只有背景跟代言人小字。

座標全部取自新版 PS CSS，文字垂直位置用「筆畫上緣 + 字型字高」精確反推。

用法
----
    python3 tools/build_b1_34.py            # 預覽
    python3 tools/build_b1_34.py --write    # 實際寫入
"""

import json
import os
import sys

from apply_css_ink_top import INK_BIAS, ink_offset_em

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv

# CSS 座標 → block 座標的平移量（這兩格都是卡片內縮 20 / 15）
DX, DY = 20, 15

_z = [0]


def z():
    _z[0] += 1
    return _z[0]


def num(v):
    return float(str(v).replace('px', '')) if v is not None else None


def css_layers(cid):
    with open(os.path.join(ROOT, 'tools', 'msbn-css.json'), encoding='utf-8') as f:
        return json.load(f)['blocks'][cid]['layers']


def pick(layers, name):
    return next((l for l in layers if l['name'] == name and not l['hidden']), None)


def text_layer(c, field, label, extra=None):
    fs = num(c['fontSize'])
    default = c.get('content') or ''
    weight = c.get('fontWeight')
    lh = c.get('lineHeight')
    em = ink_offset_em(default, weight)
    layer = {
        'zIndex': z(), 'type': 'text',
        'left': c['left'] + DX,
        'top': round(c['top'] + DY - fs, 3),
        'topExact': round(c['top'] + DY + INK_BIAS - em * fs, 3),
        'width': c['width'],
        'fontSize': fs,
        'fontFamily': 'ShopeeNotoSans (content)',
        'color': c.get('color', '#000000'),
        'textAlign': c.get('textAlign', 'center'),
        'whiteSpace': 'pre-line',
        'field': field, 'fieldLabel': label, 'default': default,
    }
    if lh and lh != 'normal':
        layer['lineHeight'] = str(round(num(lh) / fs, 3))
    if weight == '700':
        layer['fontWeight'] = 'bold'
    elif weight:
        layer['fontWeight'] = weight
    if extra:
        layer.update(extra)
    return layer


def box(c):
    return c['left'] + DX, c['top'] + DY, c['width'], c['height']


def build(cid, name):
    css = css_layers(cid)
    _z[0] = 500 if cid.endswith('1-3') else 540
    out = {'id': 'msbn_' + cid.replace('MSBN-', '').replace('-', '_'),
           'name': name, 'width': 1200, 'height': 400,
           'refImage': cid + '.jpg', 'layers': []}
    L = out['layers']

    # 卡片背景（B-1-4 沒有這一層，整格就是曝品範圍）
    bg = pick(css, '背景')
    if bg:
        l, t, w, h = box(bg)
        L.append({'zIndex': z(), 'type': 'rect', 'left': l, 'top': t,
                  'width': w, 'height': h, 'backgroundColor': '#ffbda9',
                  'borderRadius': bg.get('borderRadius', '15px'),
                  'field': 'bgColor2', 'fieldLabel': '卡片背景色'})

    # 曝品範圍：做成可以拖圖片進來的框，底色欄位保留、圖片放大裁切在框內
    ex = pick(css, '曝品範圍')
    l, t, w, h = box(ex)
    L.append({'zIndex': z(), 'type': 'image', 'left': l, 'top': t,
              'width': w, 'height': h,
              'backgroundColor': '#ffffff',
              'borderRadius': ex.get('borderRadius', '15px'), 'psRadius': True,
              'field': 'productImg', 'fieldLabel': '商品圖／情境圖',
              'bgField': 'bgColor', 'bgFieldLabel': '曝品範圍底色',
              'clipImage': True})

    # 白色圓角膠囊＝放 LOGO 的框（設計稿圖層名是「促標_底圖」，但裡面是 LOGO 示意字，
    # 參考圖上印的也是 LOGO，所以以實際用途為準做成 LOGO 圖框）
    pill = pick(css, '促標_底圖')
    if pill:
        l, t, w, h = box(pill)
        L.append({'zIndex': z(), 'type': 'image', 'left': l, 'top': t,
                  'width': w, 'height': h,
                  'backgroundColor': '#ffffff',
                  'borderRadius': pill.get('borderRadius', '45px'), 'psRadius': True,
                  'field': 'logoImg', 'fieldLabel': 'LOGO圖片網址',
                  'keepBgWithImage': True, 'clipImage': True})

    # 文案（設計稿圖層名叫「促標」，但它是黑字文案、沒有色底）
    pt = pick(css, '促標')
    if pt:
        L.append(text_layer(pt, 'promo', '文案', {'id': 'promo', 'maxLength': 10}))

    # CTA
    cb = pick(css, 'CTA_底圖')
    if cb:
        l, t, w, h = box(cb)
        L.append({'zIndex': z(), 'type': 'rect', 'left': l, 'top': t,
                  'width': w, 'height': h, 'backgroundColor': '#d0011b',
                  'id': 'ctaColor', 'borderRadius': '35px',
                  'field': 'ctaColor', 'fieldLabel': 'CTA底色'})
        ct = pick(css, 'CTA')
        L.append(text_layer(ct, 'cta', 'CTA文字', {'id': 'ctaText'}))
        tri = pick(css, 'CTA_三角形')
        l, t, w, h = box(tri)
        L.append({'zIndex': z(), 'type': 'rect', 'left': l, 'top': t,
                  'width': w, 'height': h, 'backgroundColor': '#fefefe',
                  'clipPath': 'polygon(0 0,100% 50%,0 100%)'})

    # 代言人小字
    en = pick(css, '代言人小字')
    if en:
        L.append(text_layer(en, 'endorserNote', '代言人小字',
                            {'id': 'endorserNote', 'textAlign': 'left'}))

    # 陣列習慣是 z 大的排前面（跟其他版位一致）
    L.sort(key=lambda x: -x['zIndex'])
    return out


def main():
    for cid, name in [('MSBN-B-1-3', 'MSBN B-1-3'), ('MSBN-B-1-4', 'MSBN B-1-4')]:
        b = build(cid, name)
        fields = sorted({l['field'] for l in b['layers'] if l.get('field')}
                        | {l['bgField'] for l in b['layers'] if l.get('bgField')})
        print('%-12s 圖層 %d 個　欄位：%s' % (b['id'], len(b['layers']), '、'.join(fields)))
        for l in b['layers']:
            print('   %-6s %-13s L%-8s T%-9s %sx%s %s'
                  % (l['type'], l.get('field') or l.get('id') or '', l.get('left'),
                     l.get('topExact', l.get('top')), l.get('width'), l.get('height'),
                     l.get('borderRadius') or ''))
        if WRITE:
            p = os.path.join(ROOT, 'blocks', b['id'], 'block.json')
            with open(p, 'w', encoding='utf-8') as f:
                json.dump(b, f, ensure_ascii=False, indent=2)
    print('\n%s' % ('已寫入' if WRITE else '預覽（未寫入）'))


if __name__ == '__main__':
    main()
