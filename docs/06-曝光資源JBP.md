# 06｜曝光資源 JBP

文件狀態：現行程式已確認；Firebase 雲端部署狀態需實機/環境確認

盤點日期：2026-08-26

入口：[`jbp/jbpbn.html`](../jbp/jbpbn.html)

補充文件：[`jbp/README.md`](../jbp/README.md)、[`jbp/JBP編輯器使用說明書.pdf`](../jbp/JBP編輯器使用說明書.pdf)

## 1. 定位

JBP 是曝光資源編輯器，採「主控制頁 + 多個 layout iframe」架構。主頁統一處理素材與操作面板，各個 `jbp/html/*.html` 只負責一種曝光版型的 DOM/CSS 與局部 runtime。

這個子系統與主 BOD 的 `blocks/` schema 不同：JBP 的版型來源主要是固定 HTML、CSS、config CSS 與共用 `layout-runtime.js`。

同一目錄也保留 `sba.html`、`logo-editor-plugin.js`、`jbpbn.html.bak-*` 等獨立版/備份檔。本文件以主入口實際嵌入的 `jbpbn.html` 與其 `js/` 模組為現行基線；修改 legacy/backup 前應先確認是否仍有部署或使用者依賴。

## 2. 目前版型 registry

檔案：[`jbp/js/index.js`](../jbp/js/index.js)

`BN_LAYOUTS` 目前宣告 17 種 HTML 版型：

1. `IG橫logo排版.html`
2. `IG方logo排版.html`
3. `HBN_橫式LOGO.html`
4. `HBN_方式LOGO.html`
5. `ddcard方logo.html`
6. `ddcard橫logo.html`
7. `Coin_pageBN_APP方LOGO.html`
8. `Coin_pageBN_APP橫LOGO.html`
9. `FB_POST_方LOGO.html`
10. `FB_POST_橫LOGO.html`
11. `SCBN_APP.html`
12. `Search_Image1logo.html`
13. `Search_Image2logo.html`
14. `Search_Image3logo.html`
15. `SearchICON_LOGO.html`
16. `SearchICON_PRODUCT.html`
17. `SearchICON_TEXT.html`

主頁會動態載入 `js/index.js?t=timestamp`，從 `BN_LAYOUTS` 取得清單，再建立 `html/{file}?bnid={id}` iframe。

## 3. 載入與渲染流程

```text
jbpbn.html
   │
   ├─ 動態載入 js/index.js
   │       └─ 回傳 BN_LAYOUTS
   │
   ├─ 動態載入四個核心 plugin（帶 timestamp）
   │       ├─ bn-editor-plugin.js
   │       ├─ bn-state-plugin.js
   │       ├─ bn-workorder-upload-plugin.js
   │       └─ bn-bg-library-plugin.js
   │
   ├─ 建立每個 layout iframe
   │       └─ layout-runtime.js 接收 postMessage
   │
   └─ 共用素材/文字/配色廣播至所有 ready iframe
```

JBP 以 `async=false` 動態插入四個核心 plugin，並以 query timestamp 降低瀏覽器拿到舊版快取的機率。新增 plugin 或調整初始化順序時要注意這個刻意的同步載入行為。

## 4. 核心模組

| 模組 | 主要職責 |
| --- | --- |
| `jbp/js/layout-runtime.js` | iframe 內建立 layers、讀 HTML/CSS/config、fit/zoom、contenteditable、圖片 layout、overlay/reference、ready/snapshot |
| `jbp/js/bn-editor-plugin.js` | logo/商品/人物圖上傳、排序、編輯、刪除、背景控制、廣播、批次下載 |
| `jbp/js/bn-state-plugin.js` | IndexedDB 完整狀態、localStorage fallback、auto-save/load、JSON 匯入/匯出、banwords bridge |
| `jbp/js/bn-workorder-upload-plugin.js` | XLSX 動態載入、版型區段辨識、品牌/主標/副標/日期與模板代碼映射 |
| `jbp/js/bn-bg-library-plugin.js` | 讀取 `bgimg/index.json`、`brand.json`、背景分類、色彩取樣與自動文字配色 |
| `jbp/js/logo-editor-plugin.js` | logo 上傳、排序、CropperJS 裁切與編輯 |
| `jbp/js/editor-plugin.js` | 商品圖片編輯、裁切、去背等操作 |
| `jbp/js/product-zoom-plugin.js` | 商品圖片縮放與版面配置 |
| `jbp/js/banwords-engine-hbn.js` | Excel 禁用語規則、輸入攔截、文字轉換、例外規則 |
| `jbp/js/feedback-plugin.js` | 使用者反饋與 Firebase 初始化/匿名登入/送出 |
| `jbp/js/feedback-admin.js` | 管理者反饋查詢、更新、刪除 |
| `jbp/js/manual-plugin.js` | 使用說明/FAQ 相關 UI |

## 5. layout-runtime 的責任

每個 layout iframe 會：

- 以固定 HTML/CSS 建構設計版面。
- 依 config 或 DOM metadata 找到文字、logo、商品、背景與 CTA 元素。
- 接收父頁的文字、顏色、logo、product、background message。
- 提供 contenteditable 編輯與文字長度檢查。
- 依實際 DOM 尺寸做 fit、zoom、capture 尺寸校正。
- 處理 `html2canvas` 對 `object-fit`、flex、偽元素與外部圖片的限制。
- 回報 ready/snapshot，使主頁知道何時可操作或匯出。

若只修改單一版型，應先找該版型的 `.html`、`.css`、`.config.css`；若要改所有版型的訊息、縮放或匯出，才修改 `layout-runtime.js`。

## 6. 背景與文字配色

背景資產索引：

- [`jbp/bgimg/index.json`](../jbp/bgimg/index.json)
- `jbp/bgimg/brand.json`：plugin 預設會讀取的品牌索引路徑；本次盤點的 checkout 中目前未找到此檔案，需依部署環境確認是否由外部/未提交資產提供。
- 根目錄 [`bgimg/`](../bgimg/)

`bn-bg-library-plugin.js` 會取樣背景（包含左上或指定區域），依 W3C relative luminance / HSL 等計算自動文字 palette。共用角色的語意為：

| 角色 | 現行規則 |
| --- | --- |
| 主標/主文字 | 依所在底色選擇可讀的深/淺色 |
| 副標/副文字 | 依副文字角色與背景對比計算 |
| CTA 底色 | 跟隨副標/副文字角色 |
| CTA 文字 | 針對 CTA 底色選黑或白，以最大化對比 |
| CTA 三角標 | 與 CTA 文字採同一反色規則，避免被 CTA 底吃色 |

這是目前的產品配色契約；修改 palette 時必須同看 HTML preview、下載 PNG 與不同亮暗背景。

## 7. 狀態保存

主要完整狀態放在 IndexedDB：

- DB：`bn_editor_state_db`
- object store：`states`
- key：`current`

localStorage 另有 `bn_editor_state_v1` 與 `bn_editor_state_v1_full` 類型的 fallback/light snapshot；大型圖片會從輕量備份移除，以免超過 localStorage 容量。

JBP 也會處理 JSON export/import、清除全部狀態與自動 save/load。除錯時應先確認資料來自 IndexedDB 還是 localStorage，不要只清其中一個就推斷已恢復初始值。

## 8. 工單與禁用語

- 工單 parser 會動態嘗試 `jsdelivr` 的 SheetJS，再以 cdnjs 作 fallback。
- JBP 主頁可從同層的 `BOD A曝光資源版位詳情表.xlsx` 做等級/版位過濾。
- 禁用語規則來源為 `banwords.xlsx` 的指定工作表；直接雙擊 HTML 時 fetch 可能被瀏覽器擋下，系統提供手動選取 fallback。
- 文字 input/contenteditable 的轉換與提示由 `banwords-engine-hbn.js` 和 state/plugin bridge 共同完成。

## 9. 回饋與 Firebase

`feedback-plugin.js` 會在需要時動態載入 Firebase 10.14.1 compat 的 app/auth/firestore，使用匿名登入或管理者帳密，並由 `feedback-config.js` 提供設定。`firestore.rules`、`storage.rules` 位於 `jbp/`。

工程上應將它視為可選的外部整合：主編輯與下載流程不應因 feedback service 暫時不可用而無法使用。實際 Firebase project、規則部署與權限仍需在目標環境驗證。

