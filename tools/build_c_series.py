# -*- coding: utf-8 -*-
"""
重建 MSBN C 系列（優惠券）的 block.json。

為什麼要整組重建
----------------
C 系列跟其他版位不一樣，主體是「優惠券」這個複合造型：
白色券底 + 左側色塊 + 上下兩個半圓缺口 + 中間虛線 + 品牌 LOGO。
舊的 block.json 只留下了白底跟色塊兩個方塊，券的形狀、虛線、蝦皮 LOGO、
中間的「＋」全都沒有，所以看起來跟設計稿差很多。
這些元素彼此的座標是連動的（缺口要正好卡在券的上下緣、虛線要對齊缺口），
一個一個手改很容易對不齊，用程式一次算出來比較可靠。

座標來源
--------
- 版面座標：tools/msbn-css.json（由新版 PS CSS 解析而來）
- 圓角、缺口半徑、虛線間距：從 msbn-img/ 的參考圖實際量出來的
- 文字垂直位置：用新版 CSS 的筆畫上緣 + 字型檔的字高精確反推（topExact）

欄位命名沿用既有慣例
--------------------
同一種欄位有多個時，編號是「由右到左」（跟 B-3-3 等三品版位一致）：
    promo=右、promo2=中、promo3=左
這樣匯入工單時，同一直行的促標／CTA 才會對到同一欄。

用法
----
    python3 tools/build_c_series.py            # 預覽（印出圖層數）
    python3 tools/build_c_series.py --write    # 實際寫入
"""

import base64
import json
import os
import sys

from apply_css_ink_top import INK_BIAS, ink_offset_em

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv

# ── 從參考圖量出來的造型參數 ─────────────────────────────
COUPON_RADIUS = 6                      # 券底四角圓角
COUPON_SHADOW = '0 2px 7px rgba(0,0,0,0.29)'
DOT_COLOR = '#a2a2a2'
DOT_DASH = 3                           # 虛線每一段的長度
DOT_PITCH = 9.5                        # 兩段之間的間距（含段本身）

LOGO_DIR = 'msbn-img/logo/'


def logo_data_url(name):
    """把 LOGO 圖直接內嵌成 data URL 寫進 block.json。

    為什麼不用檔案路徑：下載成品 PNG 是靠 html-to-image 把畫面上的圖片抓下來重畫，
    如果 index.html 是用檔案總管直接點開（file:// 開頭），瀏覽器會擋掉讀取本機圖片，
    LOGO 就會在輸出的 PNG 裡消失。內嵌成 data URL 就完全沒有這個問題，
    也不用擔心有人搬動資料夾之後圖片連結失效。原始 PNG 仍保留在 msbn-img/logo/ 供檢視。"""
    p = os.path.join(ROOT, LOGO_DIR, name)
    return 'data:image/png;base64,' + base64.b64encode(open(p, 'rb').read()).decode()
CARD_BG = '#ffbda9'          # 卡片底色的預設值（缺口要跟它同色才看不出接縫）

_z = [0]


def z():
    """由下往上發號碼：先呼叫的在下層"""
    _z[0] += 1
    return _z[0]


def css_layers(cid):
    with open(os.path.join(ROOT, 'tools', 'msbn-css.json'), encoding='utf-8') as f:
        return json.load(f)['blocks'][cid]['layers']


def pick(layers, name, path=None, nth=0, prefix=False):
    """從 CSS 圖層裡挑出指定名稱（可再指定所屬的左/中/右群組）。
       預設是完全比對，避免「促標」誤抓到「促標_底圖」；
       prefix=True 才用開頭比對（LOGO_蝦皮商城／LOGO_蝦皮購物 這種變動名稱要用）。"""
    def hit(l):
        return l['name'].startswith(name) if prefix else l['name'] == name
    hits = [l for l in layers
            if hit(l) and (path is None or (l['path'] and l['path'][-1] == path))]
    return hits[nth] if nth < len(hits) else None


def num(v):
    return float(str(v).replace('px', '')) if v is not None else None


def text_layer(c, field, label, default, extra=None):
    """把一個 CSS 文字圖層轉成 block.json 的文字圖層（含精確垂直定位）"""
    fs = num(c['fontSize'])
    weight = c.get('fontWeight')
    lh = c.get('lineHeight')
    mult = None
    if lh and lh != 'normal':
        mult = round(num(lh) / fs, 3)
    em = ink_offset_em(default, weight)
    layer = {
        'zIndex': z(),
        'type': 'text',
        'left': c['left'],
        'top': round(c['top'] - fs, 3),          # 只是留個參考值，實際用 topExact
        'topExact': round(c['top'] + INK_BIAS - em * fs, 3),
        'width': c['width'],
        'fontSize': fs,
        'fontFamily': 'ShopeeNotoSans (content)',
        'color': c.get('color', '#000000'),
        'textAlign': c.get('textAlign', 'center'),
        'whiteSpace': 'pre-line',
    }
    if mult:
        layer['lineHeight'] = str(mult)
    if weight == '700':
        layer['fontWeight'] = 'bold'
    elif weight:
        layer['fontWeight'] = weight
    if field:
        layer['field'] = field
        layer['fieldLabel'] = label
        layer['default'] = default
    else:
        layer['default'] = default
    if extra:
        layer.update(extra)
    return layer


def rect(left, top, w, h, color, **kw):
    l = {'zIndex': z(), 'type': 'rect', 'left': left, 'top': top,
         'width': w, 'height': h, 'backgroundColor': color}
    l.update(kw)
    return l


def circle(cx, cy, r, color, **kw):
    l = {'zIndex': z(), 'type': 'circle', 'left': cx - r, 'top': cy - r,
         'width': r * 2, 'height': r * 2, 'backgroundColor': color}
    l.update(kw)
    return l


def image(left, top, w, h, field, label, **kw):
    l = {'zIndex': z(), 'type': 'image', 'left': left, 'top': top,
         'width': w, 'height': h, 'field': field, 'fieldLabel': label}
    l.update(kw)
    return l


def dotted(left, top, h):
    """券中間那條垂直虛線。用漸層畫，不用一堆小方塊，縮放時也不會有鋸齒。"""
    return rect(left, top, 3, h, None, backgroundImage=(
        'repeating-linear-gradient(to bottom,%s 0,%s %dpx,transparent %dpx,transparent %.1fpx)'
        % (DOT_COLOR, DOT_COLOR, DOT_DASH, DOT_DASH, DOT_PITCH)))


def plus_sign(c):
    """設計稿上的「＋」。改用兩個白色方塊拼出來，不依賴字型也不會因字重跑位。"""
    left, top, w, h = c['left'], c['top'], c['width'], c['height']
    bar = round(min(w, h) * 0.21)          # 桿的粗細（實測 81 高配 17 粗）
    out = [rect(round(left + (w - bar) / 2), top, bar, h, '#ffffff'),
           rect(left, round(top + (h - bar) / 2), w, bar, '#ffffff')]
    return out


def coupon(css, side, colorblock_color, logo_src, notch_r,
           logo_field, logo_label, copy_field, copy_label,
           logo_circle=None, logo_circle_field=None):
    """組出一整張優惠券：券底 → 色塊 → 缺口 → 虛線 → LOGO → 文案"""
    cp = pick(css, '優惠券', side)
    blk = pick(css, '色塊', side)
    dot = pick(css, '.', side, prefix=True)
    out = []

    # 券底：用「色塊 + 白底」的聯集當作券的真正範圍
    # （CSS 的「優惠券」框含了陰影，比看得到的券大一圈，不能直接拿來用）
    cx0 = cp['left'] + 6
    cy0 = cp['top'] + 4
    cw = cp['width'] - 13
    ch = cp['height'] - 13

    out.append(rect(cx0, cy0, cw, ch, '#ffffff',
                    borderRadius='%dpx' % COUPON_RADIUS,
                    psRadius=True, boxShadow=COUPON_SHADOW))
    if blk:
        out.append(rect(cx0, cy0, blk['width'], ch, colorblock_color,
                        borderRadius='%dpx 0px 0px %dpx' % (COUPON_RADIUS, COUPON_RADIUS),
                        psRadius=True))

    # 上下兩個半圓缺口：直接畫兩個「卡片底色」的圓，正好卡在券的上下緣
    # 顏色綁 bgColor，使用者在匯入頁換卡片底色時缺口會跟著換，不會露餡
    if dot:
        nx = dot['left'] + 1.5
        out.append(circle(nx, cy0, notch_r, CARD_BG, field='bgColor'))
        out.append(circle(nx, cy0 + ch, notch_r, CARD_BG, field='bgColor'))
        out.append(dotted(dot['left'], dot['top'], dot['height']))

    # 品牌 LOGO（蝦皮購物／商城／直營）：預設就是設計稿上那一顆，
    # 但也可以拖自己的圖進來換掉
    if logo_src:
        lg = pick(css, 'LOGO_蝦皮', side, prefix=True) or pick(css, 'LOGO_蝦皮', prefix=True)
        if lg:
            out.append(image(lg['left'], lg['top'], lg['width'], lg['height'],
                             logo_field, logo_label,
                             defaultSrc=logo_data_url(logo_src), clipImage=True))

    # 圓形 LOGO 框：可以直接把圖片拖進來，放大也不會超出圓框
    if logo_circle is not None:
        out.append(image(logo_circle['left'], logo_circle['top'],
                         logo_circle['width'], logo_circle['height'],
                         logo_circle_field, 'LOGO圖片網址',
                         backgroundColor=logo_circle['backgroundColor'],
                         borderRadius=logo_circle['borderRadius'],
                         psRadius=True, clipImage=True, keepBgWithImage=True))

    cp_text = pick(css, '文案', side)
    if cp_text:
        out.append(text_layer(cp_text, copy_field, copy_label, cp_text['content']))
    return out


def base(cid, name):
    _z[0] = 1300
    return {'id': 'msbn_' + cid.replace('MSBN-', '').replace('-', '_'),
            'name': name, 'width': 1200, 'height': 400,
            'refImage': cid + '.jpg', 'layers': []}


def build_c1(cid, name, left_color, left_logo, right_mode, right_color=None, right_logo=None):
    """C-1-1 / C-1-2 / C-1-3：上面一條促標，下面左右兩張券"""
    css = css_layers(cid)
    b = base(cid, name)
    L = b['layers']

    bg = pick(css, '背景')
    L.append(rect(bg['left'], bg['top'], bg['width'], bg['height'], '#ffbda9',
                  borderRadius='15px', field='bgColor', fieldLabel='卡片背景色'))

    pb = pick(css, '促標_底圖')
    L.append(rect(pb['left'], pb['top'], pb['width'], pb['height'], '#4f9fa2',
                  id='promoBar', borderRadius='10px',
                  field='promoColor', fieldLabel='促標底色'))
    pt = pick(css, '促標')
    L.append(text_layer(pt, 'promo', '促標文字', pt['content'],
                        {'id': 'promo', 'maxLength': 7}))

    # 左券（編號較大：欄位編號一律由右到左）
    L += coupon(css, '左', left_color, left_logo, 7,
                'brandLogoImg2', '品牌LOGO（左）', 'copy2', '券文案（左）')

    # 右券
    if right_mode == 'circle':
        lc = pick(css, 'LOGO_底圖', '右')
        L += coupon(css, '右', None, None, 7,
                    None, None, 'copy', '券文案（右）',
                    logo_circle=lc, logo_circle_field='logoImg')
    else:
        L += coupon(css, '右', right_color, right_logo, 7,
                    'brandLogoImg', '品牌LOGO（右）', 'copy', '券文案（右）')

    L += plus_sign(pick(css, '+'))

    wn = pick(css, '警語')
    L.append(text_layer(wn, 'warn', '警語', wn['content'], {'id': 'warn'}))
    return b


def build_c14():
    css = css_layers('MSBN-C-1-4')
    b = base('MSBN-C-1-4', 'MSBN C-1-4')
    L = b['layers']

    bg = pick(css, '背景')
    L.append(rect(bg['left'], bg['top'], bg['width'], bg['height'], '#ffbda9',
                  borderRadius='15px', field='bgColor', fieldLabel='卡片背景色'))

    # 三行促標：右→promo、中→promo2、左→promo3（跟 CTA 的編號方向一致）
    for path, field, label in [('右', 'promo', '促標文字（右）'),
                               ('中', 'promo2', '促標文字（中）'),
                               ('左', 'promo3', '促標文字（左）')]:
        c = pick(css, '促標', path)
        L.append(text_layer(c, field, label, c['content'],
                            {'id': 'promo'}))

    L += coupon(css, '中', '#d0011b', 'shopee-3c.png', 5,
                'brandLogoImg', '品牌LOGO（中）', 'copy', '券文案（中）')
    L += coupon(css, '左', '#ee4d2d', 'shopee-shopping-s.png', 5,
                'brandLogoImg2', '品牌LOGO（左）', 'copy2', '券文案（左）')

    # 右邊那格是圖片區（設計稿標「信用卡圖」），做成可以拖圖片進來的框
    sc = pick(css, '情境圖_圖片', '右')
    L.append(image(sc['left'], sc['top'] - 40, sc['width'], sc['height'] + 80,
                   'productImg', '情境圖／信用卡圖'))

    for c in [l for l in css if l['name'].startswith('+')]:
        L += plus_sign(c)

    for path, cf, tf, label in [('右', 'ctaColor', 'cta', 'CTA（右）'),
                                ('中', 'ctaColor2', 'cta2', 'CTA（中）'),
                                ('左', 'ctaColor3', 'cta3', 'CTA（左）')]:
        cb = pick(css, 'CTA_底圖', path)
        L.append(rect(cb['left'], cb['top'], cb['width'], cb['height'], '#d0011b',
                      id='ctaColor', borderRadius='35px', field=cf, fieldLabel=label + '底色'))
        ct = pick(css, 'CTA', path)
        L.append(text_layer(ct, tf, label, ct['content'], {'id': 'ctaText'}))
        tri = pick(css, 'CTA_三角形', path)
        L.append(rect(tri['left'], tri['top'], tri['width'], tri['height'], '#fefefe',
                      clipPath='polygon(0 0,100% 50%,0 100%)'))
    return b


def build_c15():
    css = css_layers('MSBN-C-1-5')
    b = base('MSBN-C-1-5', 'MSBN C-1-5')
    L = b['layers']

    bg = pick(css, '背景')
    L.append(rect(bg['left'], bg['top'], bg['width'], bg['height'], '#ffbda9',
                  borderRadius='15px', field='bgColor', fieldLabel='卡片背景色'))

    # 左邊的曝品範圍：左邊切齊卡片、右邊是整個半圓（R = 高度的一半），
    # 而且是可以直接拖商品圖進來的框，圖片放大會裁在這個形狀裡面
    ex = pick(css, '曝品範圍', '左')
    L.append(image(ex['left'], ex['top'], ex['width'], ex['height'],
                   'productImg', '商品圖／情境圖',
                   backgroundColor='#ffffff',
                   borderRadius='15px %dpx %dpx 15px' % (ex['height'] / 2, ex['height'] / 2),
                   psRadius=True, clipImage=True))

    for path, field, label in [('右', 'promo', '促標文字（右）'),
                               ('中', 'promo2', '促標文字（中）')]:
        c = pick(css, '促標', path)
        L.append(text_layer(c, field, label, c['content'],
                            {'id': 'promo'}))

    lc = pick(css, 'LOGO_底圖', '右')
    L += coupon(css, '右', None, None, 5, None, None, 'copy', '券文案（右）',
                logo_circle=lc, logo_circle_field='logoImg')
    # 注意：PSD 這一層叫「LOGO_蝦皮商城」，但參考圖上實際印的是「蝦皮購物」，以參考圖為準
    L += coupon(css, '中', '#d0011b', 'shopee-shopping-s.png', 5,
                'brandLogoImg', '品牌LOGO（中）', 'copy2', '券文案（中）')

    for c in [l for l in css if l['name'].startswith('+')]:
        L += plus_sign(c)

    cb = pick(css, 'CTA_底圖')
    L.append(rect(cb['left'], cb['top'], cb['width'], cb['height'], '#d0011b',
                  id='ctaColor', borderRadius='35px', field='ctaColor', fieldLabel='CTA底色'))
    ct = pick(css, 'CTA')
    L.append(text_layer(ct, 'cta', 'CTA文字', ct['content'], {'id': 'ctaText'}))
    tri = pick(css, 'CTA_三角形')
    L.append(rect(tri['left'], tri['top'], tri['width'], tri['height'], '#fefefe',
                  clipPath='polygon(0 0,100% 50%,0 100%)'))
    return b


def main():
    blocks = [
        build_c1('MSBN-C-1-1', 'MSBN C-1-1', '#d0011b', 'shopee-mall.png', 'circle'),
        build_c1('MSBN-C-1-2', 'MSBN C-1-2', '#ee4d2d', 'shopee-shopping.png', 'circle'),
        build_c1('MSBN-C-1-3', 'MSBN C-1-3', '#ee4d2d', 'shopee-shopping.png', 'logo',
                 '#d0011b', 'shopee-mall.png'),
        build_c14(),
        build_c15(),
    ]
    for b in blocks:
        path = os.path.join(ROOT, 'blocks', b['id'], 'block.json')
        fields = sorted({l['field'] for l in b['layers'] if l.get('field')})
        print('%-12s 圖層 %2d 個　欄位：%s' % (b['id'], len(b['layers']), '、'.join(fields)))
        if WRITE:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(b, f, ensure_ascii=False, indent=2)
    print('\n%s' % ('已寫入 5 個 block.json' if WRITE else '預覽（未寫入）'))


if __name__ == '__main__':
    main()
