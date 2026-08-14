# -*- coding: utf-8 -*-
"""
把 Photoshop「Copy All Layers CSS」匯出的 .txt 轉成結構化 JSON。

PS 匯出的東西長這樣：

    /* ===== GROUP: MSBN-B-1-1.jpg ===== */
    .MSBN-B-1-1jpg { position: absolute; left: 4676px; ... }

        /* 背景  [shape/solid-fill] */
        .背景-8 { position:absolute; left:4676px; top:313px;
                  width:1160px; height:370px;
                  background-color:#ffbda9; border-radius:15px; }

        /* 促標  [text] */
        .促標-7 { ... font-size:45px; line-height:43px; ... }
        /* content: "促標最多7字內" */

這支程式把它整理成：

    {
      "canvas": {"width":..., "height":...},
      "groups": {
         "MSBN-B-1-1": {
            "left":..., "top":..., "width":..., "height":...,
            "layers": [ {name, cls, path, kind, hidden, order,
                         left, top, width, height, content, props, ...}, ... ]
         }
      }
    }

重點：
- 座標一律轉成「相對於所屬 group 左上角」，不是整張大畫布的絕對值
- `order` 保留 PS 匯出的原始順序（由下而上），之後直接拿來當 z-index
- 群組被隱藏時，底下所有圖層一併標成 hidden
"""

import json
import re
import sys

RE_COMMENT = re.compile(r'^\s*/\*\s*(.*?)\s*\*/\s*$')
RE_SELECTOR = re.compile(r'^\s*\.([^\s{]+)\s*\{\s*$')
RE_PROP = re.compile(r'^\s*([a-zA-Z-]+)\s*:\s*(.+?);\s*$')
RE_GROUP_START = re.compile(r'^=+\s*GROUP:\s*(.+?)\s*=+$')
RE_GROUP_END = re.compile(r'^-+\s*end\s+(.+?)\s*-+$')
RE_CONTENT = re.compile(r'^content:\s*(.*)$')

# 這幾個屬性直接抬成好讀的欄位名（其餘原樣留在 props 裡）
PROP_ALIAS = [
    ('border-radius', 'borderRadius'), ('background-color', 'backgroundColor'),
    ('opacity', 'opacity'), ('font-size', 'fontSize'), ('font-family', 'fontFamily'),
    ('font-weight', 'fontWeight'), ('color', 'color'), ('line-height', 'lineHeight'),
    ('letter-spacing', 'letterSpacing'), ('text-align', 'textAlign'),
    ('box-shadow', 'boxShadow'), ('border', 'border'),
]


def px(v):
    """'123px' → 123.0；不是純數字就回 None"""
    if v is None:
        return None
    m = re.match(r'^(-?[\d.]+)px$', str(v).strip())
    return float(m.group(1)) if m else None


def _split_flags(name):
    """'背景  [hidden, shape/solid-fill]' → ('背景', True, 'shape/solid-fill')"""
    m = re.match(r'^(.*?)\s*\[(.*?)\]\s*$', name)
    if not m:
        return name.strip(), False, None
    flags = [f.strip() for f in m.group(2).split(',')]
    kind = next((f for f in flags if f != 'hidden'), None)
    return m.group(1).strip(), ('hidden' in flags), kind


def parse(css_text):
    """回傳 (canvas, groups_meta, records)。records 依 PS 原始順序。"""
    lines = css_text.splitlines()
    i, n = 0, len(lines)

    canvas = {}
    m = re.search(r'畫布\s*[:：]\s*(\d+)\s*[×x]\s*(\d+)', css_text)
    if m:
        canvas = {'width': int(m.group(1)), 'height': int(m.group(2))}

    stack = []            # 目前所在的群組名稱堆疊
    hidden_depth = []     # 每一層群組是不是隱藏的
    pending = None        # 上一行讀到的圖層名稱註解
    records = []
    groups_meta = {}

    while i < n:
        line = lines[i]
        cm = RE_COMMENT.match(line)
        if cm:
            body = cm.group(1)

            gs = RE_GROUP_START.match(body)
            if gs:
                gname, ghidden, _ = _split_flags(gs.group(1))
                stack.append(gname)
                hidden_depth.append(ghidden)
                pending = ('group', gname, ghidden)
                i += 1
                continue

            if RE_GROUP_END.match(body):
                if stack:
                    stack.pop()
                    hidden_depth.pop()
                pending = None
                i += 1
                continue

            if body.startswith('content:'):
                # 這是「上一條規則」的文字內容
                if records:
                    raw = RE_CONTENT.match(body).group(1).strip()
                    if raw.startswith('"'):
                        raw = raw[1:]
                    if raw.endswith('"'):
                        raw = raw[:-1]
                    # PS 用「 \n 」表示換行
                    records[-1]['content'] = raw.replace(' \\n ', '\n').replace('\\n', '\n')
                pending = None
                i += 1
                continue

            if body and not body.startswith('#') and not body.startswith('='):
                name, hid, kind = _split_flags(body)
                pending = ('layer', name, hid, kind)
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
            i += 1   # 跳過 '}'

            if pending and pending[0] == 'group':
                groups_meta['/'.join(stack)] = {
                    'name': pending[1], 'hidden': pending[2], 'cls': cls, 'props': props,
                }
            else:
                name = pending[1] if pending else cls
                hid = pending[2] if pending else False
                kind = pending[3] if pending and len(pending) > 3 else None
                records.append({
                    'path': list(stack),
                    'name': name, 'cls': cls, 'kind': kind,
                    # 群組隱藏 → 底下的圖層也視為隱藏
                    'hidden': hid or any(hidden_depth),
                    'order': len(records),
                    'props': props, 'content': None,
                })
            pending = None
            continue

        i += 1

    return canvas, groups_meta, records


def build(css_text, group_pattern):
    """把 records 依 group_pattern 分配到各個版位，並轉成相對座標。

    group_pattern：認出「一個版位」的群組名稱規則，例如
        r'^(MSBN-[A-D](?:-\\d+)+)\\.jpg$'
    第一個括號group就是這個版位的 id。
    """
    canvas, groups_meta, records = parse(css_text)
    rx = re.compile(group_pattern)

    blocks = {}
    for gpath, meta in groups_meta.items():
        m = rx.match(meta['name'])
        if not m:
            continue
        p = meta['props']
        blocks[m.group(1)] = {
            'gpath': gpath,
            'left': px(p.get('left')), 'top': px(p.get('top')),
            'width': px(p.get('width')), 'height': px(p.get('height')),
            'layers': [],
        }

    for bid, b in blocks.items():
        prefix = b['gpath']
        depth = len(prefix.split('/'))
        ox, oy = b['left'], b['top']
        for r in records:
            rp = '/'.join(r['path'])
            if rp != prefix and not rp.startswith(prefix + '/'):
                continue
            p = r['props']
            layer = {
                'name': r['name'], 'cls': r['cls'], 'kind': r['kind'],
                'hidden': r['hidden'], 'order': r['order'],
                'path': r['path'][depth:],          # 版位底下的子群組，如 ["左"]
                'left': None if px(p.get('left')) is None else round(px(p['left']) - ox, 3),
                'top': None if px(p.get('top')) is None else round(px(p['top']) - oy, 3),
                'width': px(p.get('width')), 'height': px(p.get('height')),
                'content': r['content'], 'props': p,
            }
            for k_css, k_out in PROP_ALIAS:
                if k_css in p:
                    layer[k_out] = p[k_css]
            b['layers'].append(layer)
        b['layers'].sort(key=lambda l: l['order'])
        b.pop('gpath')

    return {'canvas': canvas, 'blocks': blocks}


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        print('用法：python -m psdcss.parse_css <PS匯出.txt> <輸出.json> [group正規式]')
        return 1
    pattern = sys.argv[3] if len(sys.argv) > 3 else r'^(.+?)\.(?:jpg|jpeg|png)$'
    with open(sys.argv[1], encoding='utf-8') as f:
        data = build(f.read(), pattern)
    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print('解析出 %d 個版位 → %s' % (len(data['blocks']), sys.argv[2]))
    for bid in sorted(data['blocks']):
        b = data['blocks'][bid]
        print('   %-16s %sx%s  圖層 %d'
              % (bid, b['width'], b['height'], len(b['layers'])))
    return 0


if __name__ == '__main__':
    sys.exit(main())
