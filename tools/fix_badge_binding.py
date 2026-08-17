# -*- coding: utf-8 -*-
"""
把 MSBN 的圓標文字綁定到它自己的圓標底圈。

問題：CSS→block.json 轉檔時，center 對齊的文字圖層失去了真正的 left，
      被統一改成 left:0 / width:整張版位寬，等於「在整張卡片正中間置中」。
      圓標字因此離真正的圓標圈最遠可以差 500px。
      同一個版位裡多顆圓標的文字圖層還共用同一個 id（badgeText），
      圓標底圈則完全沒有 id，導致「統一改圓標底色」也抓不到。

做法：圓標文字 badge{n} ↔ 圓標底圈 badgeColor{n} 依編號配對，
      改成跟副區同一套「綁定式」寫法：
        _boxLeft / _boxWidth = 圓標圈的 left / width
        top / height         = 圓標圈的 top / height
        verticalCenter=True, whiteSpace='normal'
      渲染引擎看到 verticalCenter 就會 flex 置中在圈內，
      並跳過「top − fontSize」那條垂直修正，因此永遠不會跑版。
      同時補上 id：badgeText{n} / badgeBg{n}。
"""
import json
import glob
import os
import re
import sys

BADGE_TEXT_FIELD = re.compile(r'^badge(\d*)$')
BADGE_BG_FIELD = re.compile(r'^badgeColor(\d*)$')

# 跟副區既有寫法一致；渲染時寬度/行距其實會被 render-config 的
# badge.maxWidth / badge.lineHeight 覆寫，這裡只是留一組合理的預設值。
BADGE_BOX_WIDTH = 80
BADGE_LINE_HEIGHT = 53


def iter_layer_lists(block):
    """block.json 的圖層可能在最上層，也可能在 repeats 裡面。"""
    yield block.get('layers', []), None
    for idx, rep in enumerate(block.get('repeats', []) or []):
        yield rep.get('layers', []), idx


def fix_block(path, report):
    with open(path, encoding='utf-8') as fh:
        block = json.load(fh)

    block_id = block.get('id') or os.path.basename(os.path.dirname(path))
    changed = 0

    for layers, rep_idx in iter_layer_lists(block):
        # 先把這一組圖層裡的圓標底圈依編號收起來
        circles = {}
        for layer in layers:
            m = BADGE_BG_FIELD.match(str(layer.get('field') or ''))
            if m and layer.get('type') in ('circle', 'rect'):
                circles[m.group(1)] = layer

        for layer in layers:
            if layer.get('type') != 'text':
                continue
            m = BADGE_TEXT_FIELD.match(str(layer.get('field') or ''))
            if not m:
                continue
            suffix = m.group(1)
            circle = circles.get(suffix)

            if circle is None:
                report.append(
                    '  ! %s badge%s 找不到對應的 badgeColor%s，跳過（維持原狀）'
                    % (block_id, suffix, suffix))
                continue
            if circle.get('left') is None or circle.get('width') is None:
                report.append('  ! %s badgeColor%s 沒有 left/width，跳過'
                              % (block_id, suffix))
                continue

            if rep_idx is not None:
                # 引擎的圓標路徑會直接用 _boxLeft 覆寫 left，不會再加上 repeat 位移，
                # 所以 repeat 裡的圓標不能用這套綁定，寧可不動也不要弄壞。
                report.append('  ! %s badge%s 在 repeats 裡，引擎的圓標置中不支援，跳過'
                              % (block_id, suffix))
                continue

            before = (layer.get('left'), layer.get('width'), layer.get('id'))

            layer['id'] = 'badgeText' + suffix
            layer['_boxLeft'] = circle['left']
            layer['_boxWidth'] = circle['width']
            layer['left'] = circle['left'] + (circle['width'] - BADGE_BOX_WIDTH) / 2.0
            layer['width'] = BADGE_BOX_WIDTH
            layer['top'] = circle['top']
            layer['height'] = circle['height']
            layer['verticalCenter'] = True
            layer['whiteSpace'] = 'normal'
            layer['lineHeight'] = BADGE_LINE_HEIGHT
            layer.setdefault('textAlign', 'center')
            layer.setdefault('fieldLabel', '圓標文字')
            layer.setdefault('default', '圓標')

            circle['id'] = 'badgeBg' + suffix
            circle.setdefault('fieldLabel', '圓標底色')

            report.append(
                '  %-16s badge%-2s  left %s→%.1f (寬 %s→%d)  圈在 %s..%s  位移 %+.1fpx'
                % (block_id, suffix or '1', before[0], layer['left'],
                   before[1], BADGE_BOX_WIDTH,
                   circle['left'], circle['left'] + circle['width'],
                   layer['left'] - (before[0] or 0)))
            changed += 1

    if changed:
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(block, fh, ensure_ascii=False, indent=2)
            fh.write('\n')
    return changed


def main():
    pattern = sys.argv[1] if len(sys.argv) > 1 else 'blocks/msbn*/block.json'
    report = []
    total = 0
    files = 0
    for path in sorted(glob.glob(pattern)):
        n = fix_block(path, report)
        if n:
            files += 1
            total += n
    print('\n'.join(report))
    print('\n完成：%d 個版位、%d 個圓標文字圖層改成綁定式' % (files, total))


if __name__ == '__main__':
    main()
