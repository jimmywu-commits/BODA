# -*- coding: utf-8 -*-
"""
把 Photoshop 匯出的「Copy All Layers CSS」轉成結構化 JSON。

用途
----
新版 CSS（MSBN_css.txt v1.2）比舊版多了三個關鍵資訊：
  1. border-radius —— 圓角（舊版沒有，所以之前圓邊全都掉了）
  2. GROUP 樹狀結構 —— 每個版位一組（MSBN-C-1-4.jpg 裡面還分「左/中/右」子群組）
  3. /* content: "..." *​/ —— 圖層原本的文案，方便對應到欄位

輸出（tools/msbn-css.json）
--------------------------
{
  "canvas": {"width":..., "height":...},
  "groups": {
     "MSBN-C-1-1": {
        "left":..., "top":..., "width":..., "height":...,
        "layers": [
           {"name":"背景", "cls":"背景-31", "path":["共用"], "kind":"shape/solid-fill",
            "hidden":false, "left":..., "top":..., "width":..., "height":...,
            "borderRadius":"15px", "backgroundColor":"#ffbda9",
            "content":null, "props":{...}},
           ...
        ]
     }
  }
}
座標一律轉成「相對版位左上角」的區域座標（跟 block.json 同一套）。

用法
----
    python3 tools/parse_msbn_css.py <MSBN_css.txt> [輸出.json]
"""

import json
import re
import sys
import os

# /* 圖層名  [flags] */  ──  flags 例如 [text] / [shape/solid-fill] / [hidden, shape/solid-fill]
RE_COMMENT = re.compile(r'^\s*/\*\s*(.*?)\s*\*/\s*$')
RE_SELECTOR = re.compile(r'^\s*\.([^\s{]+)\s*\{\s*$')
RE_PROP = re.compile(r'^\s*([a-zA-Z-]+)\s*:\s*(.+?);\s*$')
RE_GROUP_START = re.compile(r'^=+\s*GROUP:\s*(.+?)\s*=+$')
RE_GROUP_END = re.compile(r'^-+\s*end\s+(.+?)\s*-+$')
RE_CONTENT = re.compile(r'^content:\s*(.*)$')


def _num(v):
    """'123px' -> 123.0；不是純數字就回 None"""
    if v is None:
        return None
    m = re.match(r'^(-?[\d.]+)px$', v.strip())
    return float(m.group(1)) if m else None


def parse(css_text):
    lines = css_text.splitlines()
    i = 0
    n = len(lines)

    canvas = {}
    m = re.search(r'畫布\s*:\s*(\d+)\s*×\s*(\d+)', css_text)
    if m:
        canvas = {'width': int(m.group(1)), 'height': int(m.group(2))}

    # 解析成一棵扁平的事件流：group_start / group_end / rule
    stack = []          # 目前所在的 group 名稱堆疊
    pending_name = None  # 上一行的圖層名稱註解
    pending_flags = []
    records = []        # (path_tuple, name, flags, cls, props, content)
    groups_meta = {}    # group 完整路徑 -> props

    while i < n:
        line = lines[i]
        cm = RE_COMMENT.match(line)
        if cm:
            body = cm.group(1)

            gs = RE_GROUP_START.match(body)
            if gs:
                gname = gs.group(1)
                ghidden = False
                hm = re.match(r'^(.*?)\s*\[(.*?)\]$', gname)
                if hm:
                    gname = hm.group(1)
                    ghidden = 'hidden' in hm.group(2)
                stack.append(gname)
                pending_name = ('__group__', gname, ghidden)
                i += 1
                continue

            ge = RE_GROUP_END.match(body)
            if ge:
                if stack:
                    stack.pop()
                pending_name = None
                i += 1
                continue

            # 一般圖層名稱註解： 名稱  [flags]
            fm = re.match(r'^(.*?)\s*\[(.*?)\]\s*$', body)
            if fm:
                pending_name = ('__layer__', fm.group(1).strip(),
                                [f.strip() for f in fm.group(2).split(',')])
            elif body.startswith('content:'):
                # 屬於「上一條 rule」的內容註解
                if records:
                    raw = RE_CONTENT.match(body).group(1).strip()
                    if raw.startswith('"'):
                        raw = raw[1:]
                    if raw.endswith('"'):
                        raw = raw[:-1]
                    # PS 匯出用「 \n 」表示換行
                    records[-1]['content'] = raw.replace(' \\n ', '\n').replace('\\n', '\n')
                pending_name = None
            elif body and not body.startswith('#') and not body.startswith('='):
                pending_name = ('__layer__', body.strip(), [])
            i += 1
            continue

        sm = RE_SELECTOR.match(line)
        if sm:
            cls = sm.group(1)
            props = {}
            i += 1
            while i < n and '}' not in lines[i]:
                pm = RE_PROP.match(lines[i])
                if pm:
                    props[pm.group(1)] = pm.group(2).strip()
                i += 1
            i += 1  # 跳過 '}'

            if pending_name and pending_name[0] == '__group__':
                groups_meta['/'.join(stack)] = {
                    'name': pending_name[1], 'hidden': pending_name[2],
                    'cls': cls, 'props': props,
                }
            else:
                name = pending_name[1] if pending_name else cls
                flags = pending_name[2] if pending_name else []
                records.append({
                    'path': list(stack),
                    'name': name,
                    'cls': cls,
                    'flags': flags,
                    'hidden': 'hidden' in flags,
                    'kind': next((f for f in flags if f != 'hidden'), None),
                    'props': props,
                    'content': None,
                })
            pending_name = None
            continue

        i += 1

    return canvas, groups_meta, records


def build(css_text):
    canvas, groups_meta, records = parse(css_text)

    # 版位群組＝名稱長得像 MSBN-X-N-N.jpg 的那一層
    blocks = {}
    for gpath, meta in groups_meta.items():
        gname = meta['name']
        if not re.match(r'^MSBN-[A-D](-\d+)+\.jpg$', gname):
            continue
        bid = gname[:-4]
        p = meta['props']
        blocks[bid] = {
            'gpath': gpath,
            'left': _num(p.get('left')), 'top': _num(p.get('top')),
            'width': _num(p.get('width')), 'height': _num(p.get('height')),
            'layers': [],
        }

    # 依 group path 前綴把圖層歸到版位下
    for bid, b in blocks.items():
        prefix = b['gpath']
        ox, oy = b['left'], b['top']
        for r in records:
            rp = '/'.join(r['path'])
            if rp != prefix and not rp.startswith(prefix + '/'):
                continue
            p = r['props']
            sub = r['path'][len(prefix.split('/')):]
            layer = {
                'name': r['name'],
                'cls': r['cls'],
                'path': sub,                    # 版位底下的子群組（例如 ["左"]）
                'kind': r['kind'],
                'hidden': r['hidden'],
                'left': None if _num(p.get('left')) is None else round(_num(p.get('left')) - ox, 3),
                'top': None if _num(p.get('top')) is None else round(_num(p.get('top')) - oy, 3),
                'width': _num(p.get('width')),
                'height': _num(p.get('height')),
                'content': r['content'],
                'props': p,
            }
            for k_css, k_out in [('border-radius', 'borderRadius'),
                                 ('background-color', 'backgroundColor'),
                                 ('opacity', 'opacity'),
                                 ('font-size', 'fontSize'),
                                 ('font-family', 'fontFamily'),
                                 ('font-weight', 'fontWeight'),
                                 ('color', 'color'),
                                 ('line-height', 'lineHeight'),
                                 ('letter-spacing', 'letterSpacing'),
                                 ('text-align', 'textAlign'),
                                 ('box-shadow', 'boxShadow')]:
                if k_css in p:
                    layer[k_out] = p[k_css]
            b['layers'].append(layer)
        # 由上而下、由左至右排序，方便閱讀
        b['layers'].sort(key=lambda l: (l['top'] if l['top'] is not None else 0,
                                        l['left'] if l['left'] is not None else 0))
        b.pop('gpath')

    return {'canvas': canvas, 'blocks': blocks}


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'MSBN_css.txt'
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), 'msbn-css.json')
    with open(src, encoding='utf-8') as f:
        data = build(f.read())
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print('版位數：', len(data['blocks']))
    for bid in sorted(data['blocks']):
        b = data['blocks'][bid]
        print('  %-14s %sx%s  圖層 %d' % (bid, b['width'], b['height'], len(b['layers'])))
    print('已寫出', out)


if __name__ == '__main__':
    main()
