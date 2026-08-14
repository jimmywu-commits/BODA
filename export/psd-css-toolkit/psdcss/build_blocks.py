# -*- coding: utf-8 -*-
"""
主程式：把 PS 匯出的 CSS 直接產生成一組 block.json（版位定義檔）。

這支做的所有校正，就是「餵 CSS 就能跟設計稿參考圖對齊」的全部祕訣：

1. 原點對齊    CSS 是整張大畫布的絕對座標 → 換成版位內的相對座標
2. 形狀 1:1    色塊的 left/top/width/height 直接照抄，圓角原樣保留
3. 文字校正    PS 的 top 是「筆畫上緣」，瀏覽器的 top 是「內容區上緣」，
               中間差多少用字型檔精確算出來（見 fontmetrics.py）
4. 行距換算    CSS 給 px（48px）→ 存成倍數（48÷43＝1.116），改字級才會等比
5. 裁切補償    文字框 overflow:hidden 會把字的上下切掉，補上下 padding 推開邊界
6. 文字框放寬  CSS 的寬度只是「這串示意字剛好佔的寬」，換一段字就爆框；
               改成以文字中心為軸、在「包住它的那塊色塊」範圍內對稱放寬

用法
----
    python -m psdcss.build_blocks config.json            # 預覽
    python -m psdcss.build_blocks config.json --write    # 實際寫出 block.json
"""

import json
import os
import re
import sys

from .fontmetrics import FontSet
from .parse_css import build as parse_build


# ────────────────────────────────────────────────────────────
# 設定檔
# ────────────────────────────────────────────────────────────
def load_config(path):
    with open(path, encoding='utf-8') as f:
        cfg = json.load(f)
    cfg['_root'] = os.path.dirname(os.path.abspath(path))
    return cfg


def rel(cfg, p):
    return os.path.join(cfg['_root'], p)


# ────────────────────────────────────────────────────────────
# 小工具
# ────────────────────────────────────────────────────────────
def num(v):
    if v is None:
        return None
    m = re.match(r'^(-?[\d.]+)', str(v))
    return float(m.group(1)) if m else None


def block_id(cfg, css_id):
    """MSBN-B-1-1 → msbn_B_1_1"""
    return cfg.get('blockIdPrefix', '') + re.sub(
        r'^' + re.escape(cfg.get('stripIdPrefix', '')), '', css_id).replace('-', '_')


def is_ignored(cfg, layer):
    """設計稿上的輔助圖層（作圖區、安全範圍、系統模擬字…）不要輸出"""
    for g in cfg.get('ignoreGroups', []):
        if any(g in p for p in layer['path']):
            return True
    for nm in cfg.get('ignoreLayers', []):
        if layer['name'].startswith(nm):
            return True
    return False


def match_rule(rules, layer):
    """從設定裡找出這個圖層對應的欄位規則（先試完全比對，再試開頭比對）"""
    for r in rules:
        if r['layer'] == layer['name']:
            return r
    for r in rules:
        if r.get('prefix') and layer['name'].startswith(r['layer']):
            return r
    return None


def smallest_container(layer, shapes):
    """找出「包住這個圖層」的最小色塊，用來決定文字框能放寬到多寬"""
    lx0, ly0 = layer['left'], layer['top']
    lx1, ly1 = lx0 + (layer['width'] or 0), ly0 + (layer['height'] or 0)
    best = None
    for s in shapes:
        if s is layer or not s.get('width') or not s.get('height'):
            continue
        sx0, sy0 = s['left'], s['top']
        sx1, sy1 = sx0 + s['width'], sy0 + s['height']
        if sx0 - 1 <= lx0 and sy0 - 1 <= ly0 and sx1 + 1 >= lx1 and sy1 + 1 >= ly1:
            area = s['width'] * s['height']
            if best is None or area < best[0]:
                best = (area, s)
    return best[1] if best else None


# ────────────────────────────────────────────────────────────
# 版位原點
# ────────────────────────────────────────────────────────────
def visible_bbox(live):
    """看得見的圖層圍出來的範圍＝這一格「實際印出來」的卡片。

    不能直接用 PS 群組宣告的大小：群組通常還包著隱藏的參考框
    （作圖區、安全範圍…），會比卡片本身大一圈，拿來對位就會整格偏掉。
    """
    boxes = [l for l in live if l.get('width') and l.get('height')]
    if not boxes:
        return None
    x0 = min(l['left'] for l in boxes)
    y0 = min(l['top'] for l in boxes)
    x1 = max(l['left'] + l['width'] for l in boxes)
    y1 = max(l['top'] + l['height'] for l in boxes)
    return x0, y0, x1 - x0, y1 - y0


def ref_canvas(cfg, css_id):
    """如果有設計稿參考圖，直接用它的尺寸當畫布大小。

    參考圖就是「這一格最後印出來長什麼樣」，它的寬高就是版位尺寸，
    比任何推算都可靠（實測同一批版位有 1200×400、1200×430、1200×75 三種，
    光看 CSS 圖層是推不出來的）。"""
    pat = cfg.get('refImagePattern', '{id}.jpg')
    for d in cfg.get('refImageDirs', []):
        p = os.path.join(cfg['_root'], d, pat.format(id=css_id))
        if os.path.isfile(p):
            try:
                from PIL import Image
                with Image.open(p) as im:
                    return im.size
            except Exception:
                return None
    return None


def block_frame(cfg, blk, live, css_id=None, calib=None):
    """算出這個版位的畫布尺寸，以及「CSS 座標 → 版位座標」要加多少。

    mode:
      margin（預設）畫布 = 看得見的內容 + 四周留白。留白量由設定檔給，
                    畫布大小則跟著內容自動長 —— 同一份設定就能同時處理
                    高度不一樣的版位（例如有價格區的比較高）。
      fixed         畫布大小寫死，內容水平置中、上方留 padTop。
      group         畫布就是內容大小，四周不留白。

    為什麼預設是 margin：實測同一批版位裡，卡片內容有 370 高也有 400 高，
    但四周留白都是左右 20、上下 15。寫死畫布大小會讓其中一批整個上下偏掉
    （實測偏 5～10px，就是這個原因）。
    """
    c = cfg.get('canvas', {})
    mode = c.get('mode', 'margin')
    bb = visible_bbox(live) or (0.0, 0.0, blk['width'], blk['height'])
    bx, by, bw, bh = bb

    # 有參考圖就以參考圖的尺寸為準，內容水平置中、上方留 marginTop，
    # 剩下的細微偏差交給 calibrate 用參考圖量出來補
    size = ref_canvas(cfg, css_id) if css_id else None
    if size:
        cw, ch = size
        dx = round((cw - bw) / 2.0 - bx, 3)
        dy = round(c.get('marginTop', round((ch - bh) / 2.0, 3)) - by, 3)
        if calib:
            dx += calib.get('dx', 0)
            dy += calib.get('dy', 0)
        return cw, ch, round(dx, 3), round(dy, 3)

    if mode == 'group':
        return int(round(bw)), int(round(bh)), -bx, -by

    if mode == 'fixed':
        cw = int(c.get('width') or round(bw))
        ch = int(c.get('height') or round(bh))
        pad_left = c.get('padLeft', round((cw - bw) / 2.0, 3))
        pad_top = c.get('padTop', round((ch - bh) / 2.0, 3))
        return cw, ch, round(pad_left - bx, 3), round(pad_top - by, 3)

    mx = c.get('marginX', 0)
    mt = c.get('marginTop', 0)
    mb = c.get('marginBottom', mt)
    cw = int(round(bw + mx * 2))
    ch = int(round(bh + mt + mb))
    return cw, ch, round(mx - bx, 3), round(mt - by, 3)


# ────────────────────────────────────────────────────────────
# 圖層轉換
# ────────────────────────────────────────────────────────────
def make_text_layer(cfg, fonts, layer, z, dx, dy, shapes, canvas_w):
    fs = num(layer.get('fontSize'))
    if not fs:
        return None
    content = layer.get('content') or ''
    weight = layer.get('fontWeight')
    align = layer.get('textAlign', 'center')

    left = layer['left'] + dx
    top = layer['top'] + dy
    width = layer['width']

    # ── 校正 3：筆畫上緣 → 內容區上緣 ──────────────────────
    ink_top = top + cfg.get('inkBias', 1.0)
    em = fonts.ink_offset_em(content, weight)
    top_exact = round(ink_top - em * fs, 3)

    # ── 校正 6：文字框以中心為軸對稱放寬 ───────────────────
    if cfg.get('expandTextToContainer', True) and align == 'center' and width:
        host = smallest_container(layer, shapes)
        cx = left + width / 2.0
        if host:
            hl, hr = host['left'] + dx, host['left'] + host['width'] + dx
        else:
            hl, hr = 0.0, float(canvas_w)
        half = min(cx - hl, hr - cx)
        if half > width / 2.0:
            width = round(half * 2, 3)
            left = round(cx - half, 3)

    out = {
        'zIndex': z, 'type': 'text',
        'left': left,
        'top': round(top - fs, 3),      # 只是留個好讀的參考值，實際定位用 topExact
        'topExact': top_exact,
        'width': width,
        'fontSize': fs,
        'fontFamily': cfg.get('fontFamily'),
        'color': layer.get('color', '#000000'),
        'textAlign': align,
        'whiteSpace': 'pre-line',
        'designText': content,          # 設計稿原文，維修／預覽模式可以直接顯示
    }
    # ── 校正 4：行距 px → 倍數 ────────────────────────────
    lh = layer.get('lineHeight')
    if lh and lh != 'normal':
        out['lineHeight'] = str(round(num(lh) / fs, 4))
    if weight:
        out['fontWeight'] = 'bold' if str(weight) == '700' else str(weight)
    ls = num(layer.get('letterSpacing'))
    if ls and layer.get('letterSpacing', '').endswith('em'):
        out['letterSpacing'] = round(ls * fs, 2)
    return out


def make_shape_layer(cfg, layer, z, dx, dy):
    out = {
        'zIndex': z, 'type': 'rect',
        'left': layer['left'] + dx, 'top': layer['top'] + dy,
        'width': layer['width'], 'height': layer['height'],
    }
    if layer.get('backgroundColor'):
        out['backgroundColor'] = layer['backgroundColor']
    # ── 校正 2：圓角原樣保留 ──────────────────────────────
    if layer.get('borderRadius'):
        out['borderRadius'] = layer['borderRadius']
        out['psRadius'] = True
    op = num(layer.get('opacity'))
    if op is not None and op < 1:
        out['opacity'] = op
    if layer.get('boxShadow'):
        out['boxShadow'] = layer['boxShadow']
    return out


# ────────────────────────────────────────────────────────────
# 主流程
# ────────────────────────────────────────────────────────────
def build_block(cfg, fonts, css_id, blk, calib=None):
    bid = block_id(cfg, css_id)
    live = [l for l in blk['layers']
            if not l['hidden'] and l['left'] is not None and not is_ignored(cfg, l)]
    canvas_w, canvas_h, dx, dy = block_frame(cfg, blk, live, css_id, calib)
    shapes = [l for l in live if l['kind'] != 'text' and l.get('width')]

    text_rules = cfg.get('textFields', [])
    color_rules = cfg.get('colorFields', [])
    image_rules = cfg.get('imageFields', [])

    layers = []
    # 先把每一層轉出來，欄位編號等全部轉完再統一分配（要照左右順序）
    pending = []
    for idx, l in enumerate(live):
        z = 100 + l['order']
        rule_img = match_rule(image_rules, l)
        rule_col = match_rule(color_rules, l)
        rule_txt = match_rule(text_rules, l)

        if l['kind'] == 'text':
            out = make_text_layer(cfg, fonts, l, z, dx, dy, shapes, canvas_w)
            if out is None:
                continue
            # 設計稿上的示意字（「商品圖／情境圖」「LOGO」…）不輸出，只留資料
            if any(h in (l.get('content') or '') for h in cfg.get('hintTexts', [])):
                out['hidden'] = True
            pending.append((rule_txt, out, l))
            layers.append(out)
            continue

        if rule_img or l['kind'] == 'smart object':
            out = make_shape_layer(cfg, l, z, dx, dy)
            out['type'] = 'image'
            if rule_img and rule_img.get('clip'):
                out['clipImage'] = True
            # 設計稿上「曝品範圍」這種框，填的是給設計看的參考色（藍色），
            # 實際輸出通常是白色或透明。用設定檔覆寫，不要照抄參考色。
            if rule_img and 'backgroundColor' in rule_img:
                bgc = rule_img['backgroundColor']
                if bgc:
                    out['backgroundColor'] = bgc
                else:
                    out.pop('backgroundColor', None)
            pending.append((rule_img, out, l))
            layers.append(out)
            continue

        out = make_shape_layer(cfg, l, z, dx, dy)
        pending.append((rule_col, out, l))
        layers.append(out)

    # ── 欄位編號：同一種欄位有好幾個時，照「由右到左」給 1、2、3… ──
    right_to_left = cfg.get('numbering', 'rightToLeft') == 'rightToLeft'
    groups = {}
    for rule, out, src in pending:
        if not rule:
            continue
        groups.setdefault(rule['field'], []).append((out, src, rule))
    for base, items in groups.items():
        items.sort(key=lambda t: -(t[0]['left'] + (t[0].get('width') or 0) / 2.0)
                   if right_to_left else (t[0]['left']))
        for i, (out, src, rule) in enumerate(items):
            key = base if i == 0 else '%s%d' % (base, i + 1)
            out['field'] = key
            out['fieldLabel'] = rule.get('label', base) + ('' if len(items) == 1 else ' %d' % (i + 1))
            if rule.get('id'):
                out['id'] = rule['id']
            if out['type'] == 'text':
                out['default'] = rule.get('defaultText') or out.get('designText') or ''
                if rule.get('maxLength'):
                    out['maxLength'] = rule['maxLength']

    # 陣列習慣由上而下（z 大的在前）
    layers.sort(key=lambda l: -l['zIndex'])
    return {
        'id': bid,
        'name': css_id.replace('-', ' ', 1),
        'width': canvas_w, 'height': canvas_h,
        'refImage': cfg.get('refImagePattern', '{id}.jpg').format(id=css_id),
        'layers': layers,
    }


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    write = '--write' in sys.argv
    if not args:
        print(__doc__)
        return 1
    cfg = load_config(args[0])
    fonts = FontSet(cfg['fonts'], cfg['_root'])

    with open(rel(cfg, cfg['css']), encoding='utf-8') as f:
        parsed = parse_build(f.read(), cfg['groupPattern'])

    # calibration.json：用參考圖量出來的逐版位微調量（由 psdcss.calibrate 產生）
    calib_path = rel(cfg, cfg.get('calibration', 'calibration.json'))
    calib = {}
    if os.path.isfile(calib_path):
        with open(calib_path, encoding='utf-8') as f:
            calib = json.load(f).get('blocks', {})
        print('（套用 calibration.json：%d 個版位有微調量）\n' % len(calib))

    out_dir = rel(cfg, cfg.get('out', 'blocks'))
    made, ids = 0, []
    for css_id in sorted(parsed['blocks']):
        b = build_block(cfg, fonts, css_id, parsed['blocks'][css_id], calib.get(css_id))
        fields = sorted({l['field'] for l in b['layers'] if l.get('field')})
        print('%-16s %dx%d　圖層 %2d　欄位：%s'
              % (b['id'], b['width'], b['height'], len(b['layers']),
                 '、'.join(fields) or '（無）'))
        if write:
            d = os.path.join(out_dir, b['id'])
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, 'block.json'), 'w', encoding='utf-8') as f:
                json.dump(b, f, ensure_ascii=False, indent=2)
        ids.append(b['id'])
        made += 1

    if write:
        # 版位清單，demo 頁跟其他程式都靠它知道有哪些版位
        with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as f:
            json.dump(ids, f, ensure_ascii=False, indent=1)

    print('\n%s：%d 個版位%s'
          % ('已寫入' if write else '預覽（未寫入）', made,
             '　→ ' + out_dir if write else '　（加 --write 才會實際寫檔）'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
