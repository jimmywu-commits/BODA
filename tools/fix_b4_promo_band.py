# -*- coding: utf-8 -*-
"""
修正 MSBN B-4-1 / B-4-2 的促標色帶被當成 LOGO 的問題。

原本的誤解（連 schema-renderer.js 的註解都寫錯了）：
  「B-4-1、B-4-2 沒有促標底的 rect，那條藍綠色帶其實是 LOGO 圖片範圍自己的底色」
實際看參考圖，那條色帶就是**一般的促標底色**，上面放的是**促標文字**，跟 LOGO 無關。

造成的後果：
  1. 色帶被存成 image + field=logoImg，畫布上出現 LOGO 佔位卡
     （截圖裡色帶上那個「LOGO4」就是它），工單也多長出一欄「LOGO圖」。
  2. B-4-1 更嚴重：色帶上的促標文字被命名成 name（品名），
     所以整個版位有 8 個 name、完全沒有 promo 欄位。
     匯入工單時「促標」那一列對不到任何欄位、內容直接被丟掉，
     而「品名」會同時填進色帶和下面那行 —— 就是截圖看到的兩行都是品名。

修法：
  - 色帶：image(field=logoImg*) → rect(id=promoBg*, field=promoColor*)
    這樣它會吃到「統一改促標底色」，也會自動套上促標底該有的上方圓角。
  - B-4-1 的文字改名：色帶上那行 → promo*（促標）、下面那行 → name*（品名）
    編號沿用這個專案的慣例：最右邊那一欄不帶編號，往左依序 2、3、4。

用法：
  python3 tools/fix_b4_promo_band.py            # 試算
  python3 tools/fix_b4_promo_band.py --write    # 寫回
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(os.path.join(__file__, '..')))
TEAL = 'rgb(79,159,162)'


def norm(c):
    return str(c or '').replace(' ', '')


def suffix_from(field, base):
    m = re.match(r'^%s(\d*)$' % base, field or '')
    return m.group(1) if m else None


def fix(block_id, write, log):
    path = os.path.join(ROOT, 'blocks', block_id, 'block.json')
    block = json.load(open(path, encoding='utf-8'))
    layers = block.get('layers', [])
    changed = False

    # ── 1. 藍綠色帶：從「LOGO 圖片範圍」改成「促標底色塊」 ──
    for layer in layers:
        if layer.get('type') != 'image' or norm(layer.get('backgroundColor')) != TEAL:
            continue
        sfx = suffix_from(layer.get('field'), 'logoImg')
        if sfx is None:
            continue
        old = layer.get('field')
        layer['type'] = 'rect'
        layer['id'] = 'promoBg' + sfx
        layer['field'] = 'promoColor' + sfx
        layer['fieldLabel'] = '促標底色'
        for k in ('imageScale', 'keepBgWithImage', 'default'):
            layer.pop(k, None)
        log.append('  %s  色帶 %-10s → rect id=%-10s field=%-13s（不再是 LOGO 欄位）'
                   % (block_id, old, layer['id'], layer['field']))
        changed = True

    # ── 2. B-4-1 的文字改名：色帶上那行是促標，不是品名 ──
    if block_id == 'msbn_B_4_1':
        # 找出色帶的垂直範圍，用來判斷哪一行文字是「在色帶上」
        bands = [l for l in layers if str(l.get('id') or '').startswith('promoBg')]
        if bands:
            band_top = min(l['top'] for l in bands)
            band_bottom = max(l['top'] + l['height'] for l in bands)
            # 依 left 由大到小排（最右邊那一欄不帶編號，這是本專案的編號慣例）
            texts = [l for l in layers if l.get('type') == 'text'
                     and re.match(r'^name\d*$', str(l.get('field') or ''))]
            on_band, below = [], []
            for l in texts:
                # 文字的 top 是 PS 的文字框頂端，落在色帶範圍內就是色帶上那行
                (on_band if band_top <= l['top'] <= band_bottom else below).append(l)
            on_band.sort(key=lambda l: -l['left'])
            below.sort(key=lambda l: -l['left'])

            for i, l in enumerate(on_band):
                sfx = '' if i == 0 else str(i + 1)
                old = l.get('field')
                l['id'] = 'promo'
                l['field'] = 'promo' + sfx
                l['fieldLabel'] = '促標' + sfx
                l['default'] = '促標文案'
                log.append('  %s  色帶上的文字 %-6s → id=promo field=%-8s（原本被當成品名）'
                           % (block_id, old, l['field']))
                changed = True
            for i, l in enumerate(below):
                sfx = '' if i == 0 else str(i + 1)
                old = l.get('field')
                l['id'] = 'name'
                l['field'] = 'name' + sfx
                l['fieldLabel'] = '品名' + sfx
                l['default'] = '品名文案'
                if old != l['field']:
                    log.append('  %s  下方品名     %-6s → field=%-8s（編號往前遞補）'
                               % (block_id, old, l['field']))
                    changed = True

    if write and changed:
        json.dump(block, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        open(path, 'a', encoding='utf-8').write('\n')
    return changed


def main():
    write = '--write' in sys.argv
    log = []
    for bid in ('msbn_B_4_1', 'msbn_B_4_2'):
        fix(bid, write, log)
    print('\n'.join(log))
    print('\n%s' % ('已寫回' if write else '以上為試算，未寫檔'))


if __name__ == '__main__':
    main()
