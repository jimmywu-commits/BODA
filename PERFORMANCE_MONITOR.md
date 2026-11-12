# BODA 效能監測

這個工具用來記錄實際文書筆電操作 BODA 的瓶頸，無須安裝外掛，也不會向外部服務傳送紀錄。

## 開始

1. 將 `performance-monitor.html`、`CSS/performance-monitor.css`、`JS/performance-monitor.js`、`JS/performance-agent.js` 與本次 `index.html` 一起部署，監測頁與 BODA 必須使用相同的協定、網域及連接埠。
2. 從 BODA 最左側的「效能監測」開啟監測頁。
3. 要量首次載入，使用監測頁的「開啟 BODA 並開始紀錄」。要保留目前的編輯作業，使用「連接已開啟的 BODA」。後者無法完整補回連線前的卡頓與流程紀錄。
4. 回到 BODA 正常操作。需要時在監測頁標記上傳、曝光、換背景、影子、活動頁或匯出階段。
5. 完成後停止紀錄，匯出 JSON；摘要報告方便閱讀，JSON 保留較完整的診斷資料。

「連接已開啟的 BODA」會連接同來源中可回應的 BODA 分頁，多個分頁會列為不同來源。要單獨量一個案例，請使用「開啟 BODA 並開始紀錄」。每次都另開新分頁，不會重新整理既有作品。關閉監測頁會要求停止本次採樣；重新整理監測頁前請先匯出，紀錄不會自動存到硬碟。

匯出時會要求最後一次現況，最多等待 2 秒；無回應時仍可下載最後收到的資料，報告會註記同步逾時。BODA 超過 20 秒沒回應時也會顯示提醒，可能是忙碌、背景節流、關閉或崩潰，不能只憑逾時判斷原因。

請使用 HTTP／HTTPS 頁面。直接雙擊本機 HTML 的 `file://` 頁面不適合跨分頁連線，也無法反映 GitHub Pages 的下載速度。監測頁是另一個分頁，不會另外載入 BODA 的字型、圖片或編輯器。

## 建議的測試方式

使用實際配發的文書筆電，記下型號、CPU、RAM、瀏覽器版本、是否接電和使用的網路。瀏覽器提供的核心數與記憶體容量是參考值，不能代替電腦規格。

- 固定同一份工單與 20 張、37 張兩組圖片。
- 先測首次載入，再測再次載入；註明是否清除瀏覽器快取，避免混在一起比較。不要為測快取清除未備份的網站資料。
- 操作順序：匯入 → 裁切／縮放 → 曝光 → 換背景 → 開關影子 → 活動頁 → 切回曝光 → 下載。
- 測試時讓 BODA 在前景，避免背景分頁節流影響判讀；監測頁可放在背景。
- 每次使用相近的其他應用程式負載。正常視訊會議等負載可另做一組，標記測試條件。
- 同步用瀏覽器工作管理員記錄 BODA 的整體記憶體峰值。監測頁的 JS heap 不包括全部圖片、GPU、原生記憶體。

## 本次延後載入的實機驗收（2026-11-12）

本次將尚未使用的畫布、影子與子工具同步延後到真正需要時。驗收不能只量「上傳完成」：部分工作改在首次進活動／曝光頁或首次下載執行，應分開標記各階段，再比較同樣完整流程。先備份作品；用同一份原工單與圖片對照測試，不清除未備份的網站資料。

1. 在 HTTP／HTTPS 的上傳頁開始紀錄，匯入工單和圖片後先停留該頁。記錄上傳耗時、長任務、iframe 數與整體 RAM；確認沒有為尚未開啟的活動頁提前建立整份畫布／吸底預覽。
2. 不開活動頁，先儲存／備份，再重新整理並檢查工單、圖片、既有裁切與縮放／位置仍在。存檔應保留正式資料及待處理狀態，不以先渲染畫布作為存檔前提。
3. 標記「首次活動頁」，進活動頁並等最新內容就緒；記錄此段準備耗時。修改商品裁切、大小及位置，切回上傳／曝光再回活動，標記「再次活動頁」，確認配色、內容和編輯成果不跳回預設。
4. 另用一個已備份的測試案例，從上傳頁直接下載尚未開過的活動資源。確認輸出非空白且是最新資料，目前頁面和網址 hash 不被強制切換。不包含吸底的獨立資源輸出，不應順便建立吸底預覽；選擇包含吸底時，等待其準備完成再核對成品。
5. 切入曝光／吸底工具，確認待同步的是最新工單與圖片，而不是上一次資料；往返同一頁不能再次匯入覆蓋已裁切或已調整作品。連續匯入 A、B 測試工單後，只能出現最後 B 的資料和輸出。
6. 固定操作次數再做一次完整流程，記錄首次／再次開頁、首次／再次下載、總耗時、長任務和瀏覽器工作管理員的 RAM 峰值。冷、熱快取各自比較；正式 GitHub 部署另記網路環境，不用本機 HTTP 結果代替。

DOM 是否保留、隱藏頁零 mount、影子排程和儲存旗標的程式斷言由下方開發測試核對；監測頁的 iframe／heap 曲線不能單獨證明這些內部條件。背景分頁節流、垃圾回收與監測開銷也會影響數字。此次尚無同條件原工單／低配筆電／GitHub 實網的修改前後測量，不能提供本次 RAM 或網路改善百分比。

## 紀錄能說明什麼

| 資料 | 用途與界限 |
| --- | --- |
| 資源耗時、傳輸量、TTFB、下載時間 | 找出慢字型、腳本、模板與重複網址。跨來源未允許 Resource Timing 時，大小與部分時間會是 0；0 傳輸不等於快取命中。 |
| Long Task（超過 50ms 的主執行緒工作） | 找到卡住的時段；瀏覽器不一定能直接指出內部哪個函式。只觀察外層的長任務，避免同一個 iframe 工作重複計數。 |
| 前景事件迴圈延遲 | 每 500ms 採樣，延遲至少 100ms 才逐筆記錄。背景與剛返回前景的樣本排除，不當成硬體卡頓。 |
| JS heap | 支援此 API 的 Chromium 才提供，約每 5 秒採樣；不能當成整體 RAM，不能單憑回落較慢就判定洩漏。 |
| iframe 數量 | 觀察頁面／版位是否持續累積；同源文件最多監測 96 個，超出或跨來源會標記限制。 |
| 工作流程耗時 | 區分同步重畫、影子批次、圖片讀取、儲存、素材同步與 ZIP 打包。階段可能包含彼此，不可全部相加當 CPU 時間。 |
| 畫布與儲存操作 | 啟用期間暫時包裝原生方法，記錄耗時、尺寸或字元數，不讀取內容；停止時還原。 |

`view.switch.dispatch` 只量同步切頁派工，不代表 iframe 和圖片全部就緒。`exposure.assets.posted` 只表示素材訊息已送出，不代表曝光編輯器處理完成。`autosave.prepare` 是準備資料；IDB 的 transaction 完成才是交易完成。`export.zip.*` 是打包階段，截圖耗時要配合 canvas 與其他工作紀錄閱讀。

首次監測載入會用 `bodaPerf=1` 參數啟用；未啟用時不建立效能觀察器或採樣計時器。啟用後每秒批次傳送事件，最多 8,000 筆、待送佇列最多 400 筆；超出仍保留統計並標記 dropped。監測頁本身亦有事件保留上限，報告會標明截斷。因此摘要統計與保留明細可能不完全相等。

紀錄不含工單文字、圖片像素、Base64、表單值或錯誤訊息正文；資源網址會移除 query 和 hash，但仍保留靜態資源路徑。沒有額外網速測試下載。這是低負擔診斷，不是零負擔，正式前後比較都應使用相同監測設定。

## 開發驗證

在已安裝 Node 22+ 與 Chrome／Edge 的開發機執行：

```powershell
node tools/test-performance-monitor.js
```

測試使用本機 HTTP fixture，不載入完整 BODA，不需下載額外套件。這驗證監測功能與原生 API 的相容性，不代替低規格筆電的實際效能測試。

第二輪另提供實際載入 BODA 的受控批次工具（開發機需可用 Playwright 與 Chrome／Edge）。以下 `round2` 命令與報告路徑對應 2026-11-11 的歷史驗證，不是 2026-11-12 修改後已重測的結果：

~~~powershell
node tools/test-batch-workflow.js --images=20 --report=output/performance/batch-20-round2.json
node tools/test-batch-workflow.js --images=37 --report=output/performance/batch-37-round2.json
node tools/test-slimming.js --report=output/performance/verification-round2-final-20261111.txt
~~~

批次工具使用合成 XLSX／不同的 1200×1000 PNG，驗證 DOM 重用、幾何保存、IDB-only 重新整理與真 PNG 輸出。同一 band 匯出一個副區資源。它不取代原工單／低配筆電／GitHub 實網測試；階段邊界 JS heap 不可當成整體 RAM 或 GPU 峰值。需要前後比較時須固定相同資料與條件，不能用兩個圖片數的單次結果推算改善比例。執行命令會覆寫指定的報告檔，需要保留舊數據時請更換 --report 路徑。

### 2026-11-12 新增流程回歸

```powershell
node tools/test-lazy-workflow.js
node tools/test-lazy-child-sync.js
node tools/test-lazy-bottom-preview.js
node tools/test-lazy-exposure-export.js
node tools/test-lazy-preview-state.js
node tools/test-slimming.js --report=output/performance/verification-lazy-20261112.txt
```

本次新增五檔：`test-lazy-workflow.js`（真瀏覽器匯入／備份／未開頁與預覽後輸出／往返保留）、`test-lazy-child-sync.js`（隱藏子工具同步最新資料）、`test-lazy-bottom-preview.js`（吸底預覽與明確輸出需求）、`test-lazy-exposure-export.js`（曝光延後準備及輸出）、`test-lazy-preview-state.js`（預覽隔離與正式資源輸出）。2026-11-12 最終完整回歸 **30／30 通過**，紀錄為 `output/performance/verification-lazy-20261112.txt`；其後正式碼僅修正舊誤導註解，未改功能。

中途測試曾因 Chrome `DevToolsActivePort` 暫時檔案鎖定（`EBUSY`）失敗；僅補測試的有界輪詢，處理鎖定或尚未寫完整內容，未改正式功能或放寬功能斷言。重跑完整套件後 30／30 通過。

這些是正確性／按需執行的驗證，不是效能百分比測量。請先確認新增項目已收錄套件，再使用新檔名保存報告，避免以歷史 25／25 紀錄誤判本次完成。

本次另重跑20／37圖受控批次：`output/performance/batch-20-lazy-20261112.json` 與 `output/performance/batch-37-lazy-20261112.json` 均通過（`valid:true`，無 runtime errors、HTTP／外網失敗或實際下載）。包含幾何保存、IDB-only 還原、RGBA 一致、DOM 重用與非空白 PNG。這不是原工單／低配筆電／GitHub 實網測量；單次階段邊界 heap 不可換算 RAM 改善比例。2026-11-11 的 `round2` 報告保留為歷史，不以新執行覆寫。

最終程式獨立本機冷啟動三次：18 次請求、2,332,037 body bytes、`appReadyObserved` 中位數 530 ms、load 中位數 239.1 ms，無 HTTP／failed／runtime errors 或 CDN 請求。紀錄：`output/performance/lazy-20261112/startup-after.json`。條件為空白上傳頁、本機未壓縮 HTTP 與新瀏覽器資料／快取；不是 GitHub 實際傳輸或低配筆電效能保證，也不代表整體 RAM／GPU 或完整工作流程耗時。
