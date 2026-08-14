# -*- coding: utf-8 -*-
"""psdcss —— 把 Photoshop 匯出的 CSS 變成跟設計稿對齊的版位定義檔。

模組：
    parse_css     PS 的 Copy All Layers CSS → 結構化 JSON
    fontmetrics   從字型檔算出「筆畫離內容區上緣多遠」
    build_blocks  主程式：CSS → block.json（含全部定位校正）
    verify_ref    拿設計稿參考圖驗證定位準不準
    preview       把結果畫成圖，跟參考圖上下並排比對
"""

__version__ = '1.0.0'
