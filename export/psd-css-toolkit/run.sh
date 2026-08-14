#!/usr/bin/env bash
# 一鍵跑完整套流程：產生 → 校正 → 再產生 → 驗證 → 出對照圖
set -e
CFG=${1:-config.json}
echo "① 產生 block.json"          && python3 -m psdcss.build_blocks "$CFG" --write
echo && echo "② 用參考圖量出微調量" && python3 -m psdcss.calibrate    "$CFG" --write
echo && echo "③ 套用微調重新產生"   && python3 -m psdcss.build_blocks "$CFG" --write >/dev/null
echo && echo "④ 驗證定位準確度"     && python3 -m psdcss.verify_ref   "$CFG"
echo && echo "⑤ 產生對照圖"         && python3 -m psdcss.preview      "$CFG" >/dev/null
echo && echo "完成。對照圖在 preview/，用瀏覽器開 demo/index.html 可以互動檢視。"
