# -*- coding: utf-8 -*-
"""
把渲染引擎產生的 HTML 畫成圖片，跟 PS 參考圖並排比對。

為什麼需要這支
--------------
這個環境裡沒有瀏覽器可以截圖，但改完版位總要看得到結果。
所以這裡用 Pillow 把引擎輸出的絕對定位 <div> 重畫一遍：
矩形、圓角、圓形、虛線漸層、圖片、文字（用專案自己的字型檔）都畫得出來，
足以確認「形狀對不對、位置對不對」。

注意：這是「近似」的重畫，不是瀏覽器。細部的字距、抗鋸齒不會完全一樣，
要看最終成品還是要開網頁；但用來抓跑版、缺元素、形狀錯誤非常夠用。

用法：
    python3 tools/raster_preview.py msbn_C_1_1 msbn_C_1_4
    python3 tools/raster_preview.py --all-c
產出：tools/_preview/<版位>.png（上：參考圖　下：重畫結果）
"""

import json
import os
import re
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tools', '_preview')

FONTS = {
    '400': 'fonts/ShopeeNotoSans(content)-Regular.ttf',
    '500': 'fonts/ShopeeNotoSans(content)-Medium.ttf',
    'bold': 'fonts/ShopeeNotoSans(content)-Bold.ttf',
    '700': 'fonts/ShopeeNotoSans(content)-Bold.ttf',
}
_fc = {}


def font(weight, size):
    key = (str(weight), int(round(size)))
    if key not in _fc:
        path = FONTS.get(str(weight), FONTS['400'])
        _fc[key] = ImageFont.truetype(os.path.join(ROOT, path), int(round(size)))
    return _fc[key]


def render_html(block_id, data_override=None):
    """跑 node 拿到引擎產生的 HTML（一定要用產品程式碼，不能自己重算）。
       data_override 可以指定欄位內容，例如用設計稿上的示意文字來跟參考圖對齊比對。"""
    js = r'''
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=process.argv[2], id=process.argv[3];
const override=process.argv[4]?JSON.parse(fs.readFileSync(process.argv[4],'utf8')):{};
const registered={};const stub=()=>({appendChild(){},setAttribute(){},style:{},textContent:'',id:''});
const sb={console:{error(){},warn(){},log(){}},BNCore:{registerBlock:b=>registered[b.id]=b},
 document:{getElementById:()=>null,createElement:stub,head:stub(),body:stub()}};
sb.window=sb;vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT,'JS/render-config.js'),'utf8'),sb);
vm.runInContext(fs.readFileSync(path.join(ROOT,'core/schema-renderer.js'),'utf8'),sb);
const s=JSON.parse(fs.readFileSync(path.join(ROOT,'blocks',id,'block.json'),'utf8'));
sb.BNSchemaRenderer.registerFromSchema(s);
const d={};(registered[id].fields||[]).forEach(f=>d[f.key]=f.type==='image'?'':(f.default||''));
Object.keys(override).forEach(k=>{d[k]=override[k];});
process.stdout.write(JSON.stringify({w:s.width,h:s.height,ref:s.refImage,
  html:registered[id].render(d,{editable:false})}));
'''
    p = os.path.join(OUT, '_render.js')
    os.makedirs(OUT, exist_ok=True)
    open(p, 'w', encoding='utf-8').write(js)
    args = ['node', p, ROOT, block_id]
    if data_override:
        # 圖片是 data URL，動輒好幾百 KB，塞進命令列參數會超過長度上限，改用暫存檔傳
        op = os.path.join(OUT, '_override.json')
        with open(op, 'w', encoding='utf-8') as fh:
            json.dump(data_override, fh, ensure_ascii=False)
        args.append(op)
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return json.loads(r.stdout)


# 圖層本身用單引號寫 style，內層的圖片群組容器用雙引號，兩種都要吃
DIV = re.compile(r"""<div([^>]*?)style=(['"])(.*?)\2([^>]*)>(.*?)(?=<div|</div>|$)""", re.S)


def parse_divs(html):
    """把引擎輸出的 HTML 拆成一層一層。

    圖片是包在內層的 .bn-imggroup 容器裡（那一層沒有座標），
    所以遇到沒有座標的區塊時，把它的 <img> 掛回上一個有座標的圖層。"""
    out = []
    for m in DIV.finditer(html):
        d = {}
        for part in m[3].split(';'):
            if ':' in part:
                k, v = part.split(':', 1)
                d[k.strip()] = v.strip()
        inner = m[5]
        src = re.search(r'<img src="([^"]*)"', inner)
        text = re.sub(r'<[^>]*>', '', inner).strip()
        if 'left' not in d and out:
            if src and out[-1][1] is None:
                out[-1] = (out[-1][0], src[1], out[-1][2])
            continue
        out.append((d, src[1] if src else None, text))
    return out


def px(d, k, default=None):
    v = d.get(k)
    if v is None:
        return default
    m = re.match(r'^(-?[\d.]+)px$', v)
    return float(m[1]) if m else default


def parse_color(v):
    if not v:
        return None
    v = v.strip()
    m = re.match(r'^#([0-9a-fA-F]{6})$', v)
    if m:
        return tuple(int(m[1][i:i + 2], 16) for i in (0, 2, 4))
    m = re.match(r'^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)', v)
    if m:
        return tuple(int(m[i]) for i in (1, 2, 3))
    return None


def radii(v, w, h):
    """把 border-radius 解析成四個角的半徑（左上、右上、右下、左下）"""
    if not v:
        return [0, 0, 0, 0]
    if v.strip() == '50%':
        r = min(w, h) / 2
        return [r] * 4
    parts = v.split()
    vals = []
    for p in parts:
        m = re.match(r'^(-?[\d.]+)', p)
        vals.append(float(m[1]) if m else 0)
    if len(vals) == 1:
        vals = vals * 4
    while len(vals) < 4:
        vals.append(vals[-1])
    return [min(x, min(w, h) / 2) for x in vals[:4]]


def rounded_mask(w, h, rr):
    """做出一張圓角遮罩。四個角的半徑可以差很多（例如「左邊直角、右邊整個半圓」
       的 15px/185px/185px/15px），所以不能用疊方塊＋畫圓那種近似法，
       直接逐點判斷「有沒有落在該角的橢圓外面」最準。"""
    import numpy as np
    w, h = int(round(w)), int(round(h))
    if w <= 0 or h <= 0:
        return None
    m = np.ones((h, w), dtype=bool)
    ys = np.arange(h)[:, None] + 0.5
    xs = np.arange(w)[None, :] + 0.5
    tl, tr, br, bl = rr
    for r, cx, cy, xin, yin in [
            (tl, tl, tl, xs < tl, ys < tl),
            (tr, w - tr, tr, xs > w - tr, ys < tr),
            (br, w - br, h - br, xs > w - br, ys > h - br),
            (bl, bl, h - bl, xs < bl, ys > h - bl)]:
        if r <= 0:
            continue
        outside = ((xs - cx) ** 2 + (ys - cy) ** 2) > r * r
        m &= ~(xin & yin & outside)
    return m


def rounded(draw_img, box, rr, fill):
    """把一個（可能有圓角的）矩形貼到圖層上"""
    import numpy as np
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    w, h = x1 - x0, y1 - y0
    m = rounded_mask(w, h, rr)
    if m is None:
        return
    patch = np.zeros((h, w, 4), dtype=np.uint8)
    patch[..., 0], patch[..., 1], patch[..., 2] = fill[0], fill[1], fill[2]
    patch[..., 3] = np.where(m, fill[3] if len(fill) > 3 else 255, 0)
    draw_img.alpha_composite(Image.fromarray(patch, 'RGBA'), (x0, y0))


def draw_block(info):
    W, H = info['w'], info['h']
    canvas = Image.new('RGB', (W, H), (238, 226, 207))
    # 瀏覽器是照 z-index 疊圖，不是照 HTML 出現順序；這裡要一樣，
    # 否則像 D 系列那種「背景寫在最後、z-index 最低」的版位會被背景整片蓋掉
    layers = sorted(parse_divs(info['html']),
                    key=lambda t: float(t[0].get('z-index') or 0))
    for d, src, text in layers:
        left = px(d, 'left'); top = px(d, 'top')
        if left is None or top is None:
            continue
        w = px(d, 'width'); h = px(d, 'height')
        rr = radii(d.get('border-radius'), w or 0, h or 0)
        layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        dr = ImageDraw.Draw(layer)

        bg = parse_color(d.get('background-color'))
        if bg and w and h:
            rounded(layer, [left, top, left + w, top + h], rr, bg + (255,))

        # 虛線是用 repeating-linear-gradient 畫的，這裡照著它的參數重畫
        grad = d.get('background-image')
        if grad and w and h:
            m = re.search(r'(#[0-9a-fA-F]{6})[^,]*,\s*#[0-9a-fA-F]{6}\s+([\d.]+)px,'
                          r'\s*transparent\s+[\d.]+px,\s*transparent\s+([\d.]+)px', grad)
            if m:
                col = parse_color(m[1]); dash = float(m[2]); pitch = float(m[3])
                y = top
                while y < top + h:
                    dr.rectangle([left, y, left + w, min(y + dash, top + h)], fill=col + (255,))
                    y += pitch

        if src and w and h:
            im = None
            if src.startswith('data:'):
                # block.json 裡的 LOGO 是內嵌的 data URL
                import base64
                import io
                im = Image.open(io.BytesIO(
                    base64.b64decode(src.split(',', 1)[1]))).convert('RGBA')
            elif os.path.isfile(os.path.join(ROOT, src)):
                im = Image.open(os.path.join(ROOT, src)).convert('RGBA')
            if im is not None:
                scale = min(w / im.width, h / im.height)
                im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))))
                layer.alpha_composite(im, (int(left + (w - im.width) / 2),
                                           int(top + (h - im.height) / 2)))

        if text:
            fs = px(d, 'font-size')
            if fs:
                col = parse_color(d.get('color')) or (0, 0, 0)
                f = font(d.get('font-weight', '400'), fs)
                asc, _ = f.getmetrics()
                lh = d.get('line-height')
                try:
                    lhv = float(lh) * fs if lh and float(lh) <= 4 else fs * 1.2
                except (TypeError, ValueError):
                    lhv = fs * 1.2
                # 引擎的 top 是「內容區上緣」，PIL 的基準是字型的 ascent
                y = top + (1.16 * fs - asc)
                for i, line in enumerate(text.split('\n')):
                    tw = dr.textlength(line, font=f)
                    x = left
                    if d.get('text-align') == 'center' and w:
                        x = left + (w - tw) / 2
                    dr.text((x, y + i * lhv), line, font=f, fill=col + (255,))

        canvas = Image.alpha_composite(canvas.convert('RGBA'), layer).convert('RGB')
    return canvas


def main():
    ids = [a for a in sys.argv[1:] if not a.startswith('--')]
    if '--all-c' in sys.argv:
        ids = ['msbn_C_1_1', 'msbn_C_1_2', 'msbn_C_1_3', 'msbn_C_1_4', 'msbn_C_1_5']
    os.makedirs(OUT, exist_ok=True)
    for bid in ids:
        info = render_html(bid)
        mine = draw_block(info)
        refp = os.path.join(ROOT, 'msbn-img', info['ref'] or '')
        if not os.path.isfile(refp):
            refp = os.path.join(ROOT, 'img', info['ref'] or '')
        W, H = info['w'], info['h']
        if os.path.isfile(refp):
            ref = Image.open(refp).convert('RGB').resize((W, H))
            sheet = Image.new('RGB', (W, H * 2 + 12), (255, 255, 255))
            sheet.paste(ref, (0, 0)); sheet.paste(mine, (0, H + 12))
        else:
            sheet = mine
        p = os.path.join(OUT, bid + '.png')
        sheet.save(p)
        print('產出', p, '（上＝PS 參考圖，下＝引擎輸出）')


if __name__ == '__main__':
    main()
