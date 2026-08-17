# 工單生成器｜素材庫頁簽 ↔ 畫布捲動同步 —— 需求與除錯紀錄

檔案位置：`index.html`（工單生成器 / `#view-generator`）
相關程式：搜尋關鍵字 `UX-SYNC`、`syncTabFromScroll`、`scrollCanvasToTab`、`revealNewMsbnRow`

---

## 1. 需求

在右邊畫布跟左邊素材庫頁簽之間，做三個互動同步 + 一個拖放回饋：

1. **畫布捲動 → 頁簽跟著換**：右邊畫布捲到「MSBN 區塊」進入可視範圍時，左邊素材庫頁簽自動從「副區」切成「MSBN」；捲回副區範圍，頁簽自動切回副區。
2. **點頁簽 → 畫布跟著捲**：手動點左邊「MSBN」頁簽，右邊畫布自動捲到 MSBN 那一塊。
3. **但書（避免吸回頂端）**：如果畫布本來就已經停在 MSBN 區塊範圍內（不管停在哪一張），點頁簽不會把畫布吸回第一張，維持原本捲動位置。
4. **拖放回饋**：從 MSBN 頁簽拖一張圖放進畫布後，畫布自動往下滑一小段，讓剛放的完整那張圖、跟下一格可拖放的虛線格子都能看到；就算畫面本來就看得到（沒被擋住），也保證有一個「一格」的下移動作，讓使用者感覺到「東西真的放進去了」。

---

## 2. 問題現象

功能寫完後，實測時完全沒有反應：捲動畫布頁簽不會換、點頁簽畫布不會捲、拖圖進去也不會滑動。畫布裡已經放了不少排版內容，理論上應該早就超出可視高度了。

---

## 3. 除錯過程

1. **先排除「檔案沒更新」**：確認瀏覽器網址列路徑正確、Console 沒有紅字錯誤、程式碼確實有跑（用 F12 → Console 沒有噴例外）。排除 JS crash 導致整段程式沒執行的可能。
2. **懷疑「內容還不夠多、沒有捲軸」**：一開始以為是畫布還沒溢出可視高度，所以加了 `canvasIsScrollable()` 判斷式，只有在真的有捲軸時才觸發同步／捲動；並讓拖放回饋至少保底捲動一小段（`MIN_NUDGE`）。這一步修掉了「畫布還沒有捲軸時，點 MSBN 頁簽會被 500ms 校正機制推回副區」的一個真實 bug，但主功能仍然完全沒反應。
3. **直接量測 DOM**：請使用者在 Console 貼上量測腳本，印出 `#shell`、`#views`、`#view-generator`、`#app`、`#canvas-area`、`#stage` 各自的 `scrollHeight` / `clientHeight`。結果發現：

   | 元素 | scrollHeight | clientHeight | 會捲動嗎 |
   |---|---|---|---|
   | `#shell` ~ `#canvas-area` | 相等 | 相等 | **false** |
   | `#stage` | 明顯大於 clientHeight | — | **true** |

   關鍵發現：**真正會出現捲軸的是 `#stage`（畫布裡那張白色照片卡片），不是我原本監聽的 `#canvas-area`。**

---

## 4. 根本原因

`#stage` 的 CSS 只設了：

```css
#stage{ ...; width:fit-content; max-width:100%; overflow-x:auto; }
```

只設定了 `overflow-x:auto`，沒有設定 `overflow-y`。瀏覽器對 overflow 有一條規則：**如果 overflow-x 跟 overflow-y 其中一個是 `visible`、另一個不是，`visible` 的那一軸會被瀏覽器強制改成 `auto`**。也就是說 `#stage` 實際上等於同時有了 `overflow-y:auto`。

`#canvas-area` 是 `display:flex; flex-direction:column`，`#stage` 是裡面其中一個子項目。當內容（副區排版 + MSBN 圖片疊起來）超過 `#canvas-area` 可用高度時，flexbox 預設會把子項目（`#stage`）**壓縮**到剩餘空間，而不是讓 `#canvas-area` 自己溢出。`#stage` 被壓縮之後，因為它自己有效等於 `overflow-y:auto`，就會自己長出捲軸來裝下被壓縮掉的那些內容。

結果就是：**`#canvas-area` 永遠量不到溢出（子項目會自動幫它把內容收好），真正在捲動的其實是內層的 `#stage`。** 我一開始把整套同步邏輯監聽／量測的對象抓成 `#canvas-area`，所以怎麼測都判斷「不需要捲動」。

---

## 5. 修復方式

只需要把抓取的目標元素換成 `#stage`：

```js
// 修改前
var canvasArea = document.getElementById('canvas-area');
// 修改後
var canvasArea = document.getElementById('stage');
```

其餘邏輯完全不用動，因為 `#msbn-area`、`#row` / `#empty-drop` 本來就是 `#stage` 底下的子元素，量測的相對位置關係沒有變。

---

## 6. 新增／修改的程式內容（供之後維護對照）

都在 `index.html` 裡，關鍵字 `UX-SYNC` 可以全部搜到：

- `setPaletteTab(tab)`：切換左側頁簽內容（含 active 樣式），統一入口。
- `getPaletteSectionEl(tab)`：回傳某個頁簽在畫布上對應的區塊元素（`subarea` → `#row`/`#empty-drop`；`msbn` → `#msbn-area`；`sticky` 目前還沒有對應區塊，回傳 `null`）。
- `isSectionAtScrollLine(tab, line)`：判斷某個區塊目前是否落在「捲動參考線」上，用來判斷畫布目前顯示的是哪一區。
- `canvasIsScrollable()`：畫布內容是否已經超過可視高度（沒有捲軸就不用/不該自動切頁簽或強制捲動）。
- `syncTabFromScroll()`：畫布捲動時呼叫，依目前捲動位置自動切換左側頁簽。
- `scrollCanvasToTab(tab)`：點頁簽時呼叫，把畫布捲到對應區塊；如果畫布本來就已經在那一區，不會吸回頂端。
- `revealNewMsbnRow()`：拖圖進 MSBN 後呼叫，保證至少往下捲一小段（`MIN_NUDGE=90`），確保被擋住更多時捲動量也足夠。
- `suppressScrollSync`：程式自己主動捲動時暫停 scroll→tab 同步，避免兩邊互相干擾造成頁簽被錯誤推回。
- 左側素材庫最下面新增「🧹 清除本機暫存並重新整理」按鈕（`btn-clear-cache`），一鍵清掉這個工具自己存在瀏覽器裡的 `wo_` 開頭 localStorage/sessionStorage（上次畫面、畫布內容、系列改名、匯入工單暫存、縮放比例、解鎖狀態），清完自動重新整理。

---

## 7. 待辦 / 提醒

- 目前程式裡還留著 `WO_DEBUG = true` 開頭的除錯用 `console.log('[UX-SYNC] ...')`，確認穩定後可以整段刪掉或把 `WO_DEBUG` 改成 `false`。
- 「吸底」頁簽目前還是佔位狀態，畫布上沒有對應區塊，所以不參與這套捲動同步；之後真的做出「吸底」的畫布區塊時，只要在 `getPaletteSectionEl()` 裡補一行對應的元素 id，就會自動接上整套同步機制，不用重寫邏輯。

---

## 8. 給團隊的通用排錯心法（不只適用這次）

以後遇到「明明加了 `overflow:auto`，容器卻量不到 `scrollHeight > clientHeight`」的狀況，可以照這個順序排查：

1. 先確認事件/量測有沒有真的綁在對的元素上：在 Console 對「懷疑的容器」跟它的每一層祖先／子孫，逐一印出 `scrollHeight`、`clientHeight`、`getBoundingClientRect().height`，找出哪一層的 `scrollHeight` 真的大於 `clientHeight`——那一層才是實際會出現捲軸的元素。
2. 檢查該元素的 CSS 是不是只設了 `overflow-x` 或只設了 `overflow-y`（沒有設的那一軸，瀏覽器會自動把它也變成 `auto`，可能因此把捲動行為「轉移」到不是原本預期的那一層）。
3. 如果容器是 flex/grid 的子項目，記得 flexbox 預設會壓縮子項目來塞進固定高度的父容器，真正的溢出／捲動常常會發生在被壓縮的那個子項目身上，而不是外層看起來「應該負責捲動」的容器。
