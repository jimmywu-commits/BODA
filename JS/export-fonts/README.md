# 按需輸出字型

由 `tools/build-export-font-subsets.py` 從既有 `JS/fonts-embed.js` 的三個原始 WOFF2 產生，保留字重 400／500／700、hinting、字形與度量。瀏覽器只需要靜態檔案，不執行 Python 或字型切割。

重新產生（開發環境需 Python、fontTools、brotli）：

```powershell
python -X utf8 tools/build-export-font-subsets.py --workers 2
```

每種字重的常用拉丁／標點共一片，其餘依 Unicode 256 碼位分片。manifest 指向內容雜湊命名的 scripts；`JS/export-font-loader.js` 依實際文字與 CSS 字重按需取得、快取，最多六個請求同時載入。Script 格式也支援直接開啟本機 HTML，避免 `file://` 的二進位 fetch 限制。

新增或重新生成時須一起交付 loader、manifest、所有 manifest 引用的 chunk，並更新 loader 的 manifest 版本鍵與 dependency-loader 的版本。不要只複製 loader。原字型沒有的字元維持瀏覽器原本的 fallback。

本次共有 339 個字型 scripts（19,757,807 bytes）及 57,869 bytes manifest。完整分片總量大於舊單檔 17.05 MB；改善來自每張圖片只載入需要的片段。這些檔案不在首頁載入。`build-info.json` 保存來源雜湊、涵蓋字元及生成統計；`tmp/export-font-build-cache/` 僅為開發快取，不交付。
