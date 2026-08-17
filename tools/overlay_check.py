# -*- coding: utf-8 -*-
"""
把「引擎算出來的文字位置」用紅字畫在 PS 參考圖上，直接目視確認有沒有對位。

參考圖上的字是設計稿的正確位置（黑/灰字），紅字是程式現在會畫的位置。
兩者重疊 = 對位正確；紅字偏開 = 還有跑版。

跟 measure-ref-centers.py 的差別：那支是「量數字」，這支是「畫出來給人看」，
兩個一起用才不會被數字騙。

用法：
  python3 tools/overlay-check.py msbn_A_1_1 msbn_B_1_1 msbn_C_1_1
  → 產出 tools/overlay-<版位>.png
"""
import json
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(os.path.join(__file__, '..')))
FONT_DIR = os.path.join(ROOT, 'fonts')
FONT_BY_WEIGHT = {
    400: 'ShopeeNotoSans(content)-Regular.ttf',
    500: 'ShopeeNotoSans(content)-Medium.ttf',
    700: 'ShopeeNotoSans(content)-Bold.ttf',
}


def norm_weight(w):
    s = str(w or '400').strip().lower()
    if s in ('bold', 'bolder'):
        return 700
    if s in ('normal', ''):
        return 400
    try:
        n = int(float(s))
    except ValueError:
        return 400
    return min(FONT_BY_WEIGHT, key=lambda k: abs(k - n))


def lh_mult(layer):
    try:
        n = float(layer.get('lineHeight'))
    except (TypeError, ValueError):
        return 1.2
    fs = layer.get('fontSize') or 1
    return n if n <= 4 else n / fs


def load_vcorr():
    src = open(os.path.join(ROOT, 'JS', 'render-config.js'), encoding='utf-8').read()
    m = re.search(r'textVerticalCorrection\s*:\s*\{(.*?)\}', src, re.S)
    out = {}
    if m:
        for k, v in re.findall(r'(\w+)\s*:\s*(-?[\d.]+)', m.group(1)):
            out[k] = float(v)
    return out


VCORR = load_vcorr()

# 參考圖上示意文字的內容不在 block.json 裡（default 被換成通用字了），
# 這裡用長度差不多的字串代替，重點是看「中心對不對」而不是字一不一樣。
STAND_IN = {
    'name': '品名一排最多8字',
    'warn': '警語最多放8個字',
    'promo': '促標最多7字內',
    'badgeText': '圓標',
    'ctaText': '逛逛去',
    'logoText': 'LOGO',
}


def main():
    names = sys.argv[1:]
    if not names:
        print('請指定版位，例如：python3 tools/overlay-check.py msbn_A_1_1')
        return
    for name in names:
        path = os.path.join(ROOT, 'blocks', name, 'block.json')
        block = json.load(open(path, encoding='utf-8'))
        ref = os.path.join(ROOT, 'msbn-img', block['refImage'])
        img = Image.open(ref).convert('RGB')
        draw = ImageDraw.Draw(img)

        for layer in block.get('layers', []):
            if layer.get('type') != 'text':
                continue
            fs = layer.get('fontSize')
            if not fs:
                continue
            lid = str(layer.get('id') or '')
            text = STAND_IN.get(re.sub(r'\d+$', '', lid)) or layer.get('default') or '字'
            font = ImageFont.truetype(
                os.path.join(FONT_DIR, FONT_BY_WEIGHT[norm_weight(layer.get('fontWeight'))]),
                int(round(fs)))

            if layer.get('verticalCenter'):
                # 圓標：flex 置中在圓標圈內
                cx = layer['_boxLeft'] + layer['_boxWidth'] / 2.0
                cy = layer['top'] + (layer.get('height') or fs) / 2.0
                draw.text((cx, cy), text, font=font, fill=(255, 0, 0), anchor='mm')
                draw.rectangle([layer['_boxLeft'], layer['top'],
                                layer['_boxLeft'] + layer['_boxWidth'],
                                layer['top'] + (layer.get('height') or fs)],
                               outline=(255, 140, 0), width=2)
                continue

            lh = lh_mult(layer)
            top = layer['top'] - fs - (lh - 1) * fs / 2.0 + VCORR.get(lid, 0.0)
            # 瀏覽器會把字放在「行框」正中間，所以要畫在行框中心（anchor 用 mm）。
            # 之前用 top + anchor='ma'（PIL 的 ascender 基準）跟 CSS 基準不同，
            # 畫出來會整批偏高，害人誤判成垂直跑版。
            cy = top + fs * lh / 2.0
            if layer.get('textAlign') == 'center' and layer.get('width') is not None:
                cx = layer['left'] + layer['width'] / 2.0
                draw.text((cx, cy), text, font=font, fill=(255, 0, 0), anchor='mm')
                # 框的範圍畫成細線，看得出字被限制在哪一欄
                draw.line([(layer['left'], top), (layer['left'], top + fs)],
                          fill=(0, 160, 255), width=1)
                draw.line([(layer['left'] + layer['width'], top),
                           (layer['left'] + layer['width'], top + fs)],
                          fill=(0, 160, 255), width=1)
            else:
                draw.text((layer['left'], cy), text, font=font, fill=(255, 0, 0), anchor='lm')

        out = os.path.join(ROOT, 'tools', 'overlay-%s.png' % name)
        img.save(out)
        print('produced', out)


if __name__ == '__main__':
    main()
