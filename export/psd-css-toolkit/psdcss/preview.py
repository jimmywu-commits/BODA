# -*- coding: utf-8 -*-
"""
把渲染結果畫成圖片，跟設計稿參考圖上下並排，用眼睛確認。

verify_ref 給的是數字（差幾 px），這支給的是畫面：
形狀有沒有少、圓角對不對、圖片框在不在該在的位置，用看的最快。

作法是跑真正的 renderer/block-renderer.js 拿到 HTML，
再用 Pillow 依照那些 inline style 重畫一遍。
這是「近似」重畫（字距、抗鋸齒跟瀏覽器不會完全一樣），
但抓跑版、缺元素、形狀錯誤非常夠用。

用法
----
    python -m psdcss.preview config.json                    # 全部
    python -m psdcss.preview config.json msbn_B_1_1         # 指定版位
    python -m psdcss.preview config.json --mode design      # 用設計稿文字（預設）
產出：preview/<版位>.png（上＝參考圖，下＝渲染結果）
"""

import json
import os
import re
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .build_blocks import load_config, rel
from .fontmetrics import FontSet

NODE_SNIPPET = r'''
const fs=require('fs'), path=require('path');
const R=require(process.argv[2]);
const schema=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const mode=process.argv[4]||'design';
const data=R.sampleData(schema, mode);
process.stdout.write(JSON.stringify({html:R.render(schema,data,{})}));
'''

DIV = re.compile(r"""<div([^>]*?)style=(['"])(.*?)\2([^>]*)>(.*?)(?=<div|</div>|$)""", re.S)


def render_html(cfg, block_path, mode):
    tmp = os.path.join(rel(cfg, cfg.get('previewOut', 'preview')), '_render.js')
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(NODE_SNIPPET)
    renderer = os.path.join(cfg['_root'], 'renderer', 'block-renderer.js')
    r = subprocess.run(['node', tmp, renderer, block_path, mode],
                       capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return json.loads(r.stdout)['html']


def parse_divs(html):
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
        if 'left' not in d and out:            # 內層的圖片容器，把 <img> 掛回上一層
            if src and out[-1][1] is None:
                out[-1] = (out[-1][0], src[1], out[-1][2])
            continue
        out.append((d, src[1] if src else None, text))
    return out


def px(d, k):
    v = d.get(k)
    m = re.match(r'^(-?[\d.]+)px$', v) if v else None
    return float(m[1]) if m else None


def parse_color(v):
    if not v:
        return None
    v = v.strip()
    m = re.match(r'^#([0-9a-fA-F]{6})$', v)
    if m:
        return tuple(int(m[1][i:i + 2], 16) for i in (0, 2, 4))
    m = re.match(r'^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)', v)
    return tuple(int(m[i]) for i in (1, 2, 3)) if m else None


def radii(v, w, h):
    if not v:
        return [0, 0, 0, 0]
    if v.strip() == '50%':
        return [min(w, h) / 2.0] * 4
    vals = [float(re.match(r'^(-?[\d.]+)', p)[1]) if re.match(r'^(-?[\d.]+)', p) else 0
            for p in v.split()]
    if len(vals) == 1:
        vals *= 4
    while len(vals) < 4:
        vals.append(vals[-1])
    return [min(x, min(w, h) / 2.0) for x in vals[:4]]


def rounded(layer_img, box, rr, fill):
    """圓角矩形。四個角半徑可能差很多（例如左邊直角、右邊整個半圓），
       所以逐點判斷，不用「疊方塊＋畫圓」那種近似法。"""
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return
    m = np.ones((h, w), dtype=bool)
    ys = np.arange(h)[:, None] + 0.5
    xs = np.arange(w)[None, :] + 0.5
    tl, tr, br, bl = rr
    for r, cx, cy, xin, yin in [
            (tl, tl, tl, xs < tl, ys < tl),
            (tr, w - tr, tr, xs > w - tr, ys < tr),
            (br, w - br, h - br, xs > w - br, ys > h - br),
            (bl, bl, h - bl, xs < bl, ys > h - bl)]:
        if r > 0:
            m &= ~(xin & yin & (((xs - cx) ** 2 + (ys - cy) ** 2) > r * r))
    patch = np.zeros((h, w, 4), dtype=np.uint8)
    patch[..., 0], patch[..., 1], patch[..., 2] = fill[0], fill[1], fill[2]
    patch[..., 3] = np.where(m, 255, 0)
    layer_img.alpha_composite(Image.fromarray(patch, 'RGBA'), (x0, y0))


def draw(cfg, fonts, html, w, h):
    canvas = Image.new('RGBA', (w, h), (238, 226, 207, 255))
    # 瀏覽器照 z-index 疊圖，不是照出現順序
    layers = sorted(parse_divs(html), key=lambda t: float(t[0].get('z-index') or 0))
    for d, src, text in layers:
        left, top = px(d, 'left'), px(d, 'top')
        if left is None or top is None:
            continue
        lw, lh = px(d, 'width'), px(d, 'height')
        img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        dr = ImageDraw.Draw(img)

        bg = parse_color(d.get('background-color'))
        if bg and lw and lh:
            rounded(img, [left, top, left + lw, top + lh],
                    radii(d.get('border-radius'), lw, lh), bg)

        grad = d.get('background-image')
        if grad and lw and lh:
            m = re.search(r'(#[0-9a-fA-F]{6})[^,]*,\s*#[0-9a-fA-F]{6}\s+([\d.]+)px,'
                          r'\s*transparent\s+[\d.]+px,\s*transparent\s+([\d.]+)px', grad)
            if m:
                col, dash, pitch = parse_color(m[1]), float(m[2]), float(m[3])
                y = top
                while y < top + lh:
                    dr.rectangle([left, y, left + lw, min(y + dash, top + lh)],
                                 fill=col + (255,))
                    y += pitch

        if src and lw and lh:
            im = None
            if src.startswith('data:'):
                import base64
                import io
                im = Image.open(io.BytesIO(base64.b64decode(src.split(',', 1)[1])))
            elif os.path.isfile(os.path.join(cfg['_root'], src)):
                im = Image.open(os.path.join(cfg['_root'], src))
            if im is not None:
                im = im.convert('RGBA')
                s = min(lw / im.width, lh / im.height)
                im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))))
                img.alpha_composite(im, (int(left + (lw - im.width) / 2),
                                         int(top + (lh - im.height) / 2)))

        if text:
            fs = px(d, 'font-size')
            if fs:
                col = parse_color(d.get('color')) or (0, 0, 0)
                weight = d.get('font-weight', '400')
                f = ImageFont.truetype(fonts.path_for(weight), int(round(fs)))
                asc = f.getmetrics()[0]
                try:
                    mult = float(d.get('line-height', 1.2))
                except ValueError:
                    mult = 1.2
                # 引擎的 top 是內容區上緣；PIL 的基準是 ascent
                y = top + (fonts.content_em(weight) / 1.48 * 1.16 * fs - asc)
                for i, line in enumerate(text.split('\n')):
                    x = left
                    if d.get('text-align') == 'center' and lw:
                        x = left + (lw - dr.textlength(line, font=f)) / 2
                    dr.text((x, y + i * mult * fs), line, font=f, fill=col + (255,))

        canvas = Image.alpha_composite(canvas, img)
    return canvas.convert('RGB')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        print(__doc__)
        return 1
    cfg = load_config(args[0])
    fonts = FontSet(cfg['fonts'], cfg['_root'])
    mode = sys.argv[sys.argv.index('--mode') + 1] if '--mode' in sys.argv else 'design'
    want = args[1:]

    blocks_dir = rel(cfg, cfg.get('out', 'blocks'))
    ref_dirs = [rel(cfg, d) for d in cfg.get('refImageDirs', ['ref'])]
    out_dir = rel(cfg, cfg.get('previewOut', 'preview'))
    os.makedirs(out_dir, exist_ok=True)

    for name in sorted(os.listdir(blocks_dir)):
        if want and name not in want:
            continue
        p = os.path.join(blocks_dir, name, 'block.json')
        if not os.path.isfile(p):
            continue
        blk = json.load(open(p, encoding='utf-8'))
        mine = draw(cfg, fonts, render_html(cfg, p, mode), blk['width'], blk['height'])

        ref = blk.get('refImage')
        rp = next((os.path.join(d, ref) for d in ref_dirs
                   if ref and os.path.isfile(os.path.join(d, ref))), None)
        if rp:
            r = Image.open(rp).convert('RGB').resize((blk['width'], blk['height']))
            sheet = Image.new('RGB', (blk['width'], blk['height'] * 2 + 12),
                              (255, 255, 255))
            sheet.paste(r, (0, 0))
            sheet.paste(mine, (0, blk['height'] + 12))
        else:
            sheet = mine
        sheet.save(os.path.join(out_dir, name + '.png'))
        print('產出 %s.png（上＝參考圖，下＝渲染結果）' % name)
    return 0


if __name__ == '__main__':
    sys.exit(main())
