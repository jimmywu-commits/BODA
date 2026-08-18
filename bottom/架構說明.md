# 吸底圖便捷編輯器 — 程式架構

給要維護或擴充這支程式的人。
只講程式本身：模組怎麼切、資料怎麼流、哪些地方不能亂動。

- 操作方式 → [使用說明.md](使用說明.md)
- 每個設計決策的量測數字與取捨 → [README.md](README.md)

---

## 1. 技術底盤

| 項目 | 選擇 | 原因 |
|------|------|------|
| 建置流程 | **無**。傳統 `<script>` 標籤，非 ES module | 目標是雙擊 `index.html` 就能用。ES module 在 `file://` 下會被 CORS 擋 |
| 模組化 | IIFE + `window.XXX` 全域 | 同上。沒有 import，相依關係靠 `index.html` 的載入順序保證 |
| 語法 | ES5 風格（`var`、`function`） | 全檔一致，沒有轉譯器 |
| 畫布 | Konva 9（CDN unpkg） | 節點式場景圖，群組即一個整體，貼合「icon+文字是一個單位」的模型 |
| 打包下載 | JSZip 3（CDN unpkg） | — |
| 裁切 | CropperJS 1.6.2（CDN jsdelivr，**動態載入**） | 只有開啟圖片編輯器時才下載 |
| 試算表 | SheetJS 0.18.5（CDN jsdelivr，**動態載入**） | 只有匯入工單時才下載 |

> ⚠️ CDN 分屬 **unpkg.com** 與 **cdn.jsdelivr.net** 兩個網域。
> 公司網路只擋其中一個時，會出現「主功能正常、但裁切或匯入壞掉」的局部故障。

---

## 2. 檔案結構

```
index.html                      進入點，唯一決定載入順序的地方
src/
  app.js                        啟動流程：字體閘門 → 掛載畫布 → 掛載面板

  state/                        ── 狀態層（純資料，不碰 DOM）
    actions.js                  action 型別與建構函式
    reducers.js                 純函式 reducer + INITIAL_STATE + BannerFactory
    selectors.js                把「多分頁 state」投影成「單條視圖」
    store.js                    dispatch / subscribe / undo / redo / batch
    projectFile.js              進度存檔 JSON 的序列化、解析、套回 store

  templates/
    templates.js                LAYOUT 版位常數 + TEMPLATES 中心點 + LayoutEngine

  icons/
    manifest.js                 【產生檔】素材庫，圖以 data URI 內嵌

  render/                       ── 繪製層（吃 view，不碰 store）
    colorTheme.js               配色規則 + 三個像素濾鏡
    bgRemove.js                 去背演算法（邊界泛洪 / 全域門檻）
    fontLoader.js               FontFace 預載，就緒前不繪製
    iconImageCache.js           圖片載入與快取，失敗一律回 null
    viewport.js                 縮放與平移（操作 Konva Stage）
    canvas.js                   場景組裝，預覽與匯出共用

  export/
    exportBatch.js              N 張變體圖 + zip 打包

  importers/
    workOrderImporter.js        xlsx/csv 工單解析與區塊定位

  ui/                           ── 介面層（唯一碰 DOM 的地方）
    panel.js                    右側控制面板與分頁列
    startupDialog.js            開場的「上傳工單」對話框
    iconPicker.js               圖像化素材選單（浮動）
    imageEditor.js              裁切 / 外擴 / 去背視窗
    zoomBar.js                  畫布右下角縮放列
    style.css                   全部樣式

  util/
    textLimit.js                全形/半形字數計算

img/                            素材原圖（manifest.js 的來源，執行時不讀）
tools/build-icon-manifest.js    img/ → manifest.js 的產生器
```

---

## 3. 載入順序（動了會壞）

`index.html` 的 `<script>` 順序**就是相依關係圖**。沒有 import，後面的檔案在載入當下就會讀
前面掛上去的 `window.XXX`，順序錯了會直接 `undefined`。

```
konva → jszip                          （CDN）
  ↓
textLimit                              無相依
  ↓
actions → reducers → selectors → store 狀態層（reducers 讀 Actions.types）
  ↓
templates → manifest                   純資料
  ↓
projectFile                            讀 BannerFactory、SLOT_LIMITS
  ↓
colorTheme → bgRemove                  渲染工具
  ↓
fontLoader → iconImageCache
  ↓
viewport → canvas                      canvas 掛載時呼叫 Viewport.attach
  ↓
exportBatch                            讀 CanvasRenderer、Selectors、FontLoader
  ↓
workOrderImporter
  ↓
imageEditor → zoomBar → iconPicker → panel
  ↓
startupDialog                          用 PanelUI.mount() 的回傳值，必須排在 panel 之後
  ↓
app                                    最後啟動
```

**新增模組時**：放在所有它依賴的模組之後、所有依賴它的模組之前。

---

## 4. 狀態形狀

```js
{
  banners: [                   // 一個分頁一條吸底圖
    {
      id: "banner-1",
      activeSlotIndex: 0,      // 預覽反白哪一顆（不影響匯出張數）
      accentColor: "orange",   // "orange" | "red"
      slots: [
        {
          id: "slot-0",
          type: "icon",        // "icon" | "logo"
          text: "",            // 下方那行說明文字（Medium 22px）
          iconId: null,        // 指向 library 的 id
          iconText: null       // icon 區的模式旗標，見下方說明
        }
      ]
    }
  ],
  activeBannerIndex: 0,
  library: [ /* manifest.js 的素材 + 本次上傳的 */ ],  // 跨分頁共用
  sharpen: true                // 補銳化，預設開啟。全域偏好，同時影響預覽與匯出
}
```

三個層級要分清楚：

| 層級 | 例子 | reducer 怎麼處理 |
|------|------|-----------------|
| 全域 | `library`、`sharpen`、`activeBannerIndex` | 直接 `Object.assign` 頂層 |
| 分頁 | `accentColor`、`activeSlotIndex` | `updateActive()` |
| 欄位 | `text`、`iconId`、`iconText` | `updateActiveSlot()` |
| **跨分頁** | 把 icon 套到其他分頁 | `COPY_ICONS_TO_ALL` / `COPY_SLOT_ICON_TO_ALL`，直接 map `state.banners` |

### `iconFieldsOf(slot)`：什麼算「icon 區的內容」

跨分頁套用 icon 時搬的就是這三個欄位，要搬就三個一起搬：

```js
{ iconId, type, iconText }
```

- `type` 一定要跟著搬，否則廠商 LOGO 到了別頁會被當成一般 icon 染成橘/灰。
- **`slot.text` 刻意不在裡面。** 跨分頁套用的前提就是文案各自不同（工單匯入的結果），
  碰它等於把匯入的東西洗掉。

### `slot.iconText`：icon 區是圖還是字

一格的 icon 區只能是圖片或文字（9.9 / 10.10 這類檔期數字），二選一。
這個欄位**同時是模式旗標與內容**：

| 值 | 意義 |
|----|------|
| `null` | 圖片模式，用 `iconId` |
| `""` | **文字模式**，目前是空的 |
| `"10.10"` | 文字模式，內容是 10.10 |

**空字串必須算文字模式。** 若用「字串是否為空」判斷模式，使用者把 9.9 全部刪掉
準備改打 10.10 的那一瞬間，輸入框會在游標底下消失。所以判斷一律用 `!= null`。

互斥在 **reducer** 強制（設圖清字、設字清圖），不交給 UI ——
工單匯入、載入存檔都能改到這兩個欄位，靠 UI 自律遲早會出現「圖蓋在字上面」的狀態。

---

## 5. 資料流

### 主線：使用者操作 → 畫面

```
UI 事件
  │
  ├─ store.dispatch(Actions.xxx())
  │      │
  │      ├─ rootReducer(state, action)      純函式，不可變更新
  │      ├─ 記錄 undo 快照
  │      └─ 通知所有 subscriber
  │
  ├─→ CanvasRenderer 的 draw(state)
  │      └─ Selectors.viewState(state) → { slots, activeSlotIndex, accentColor, library, sharpen }
  │            └─ render(layer, view, isPreview=true)
  │
  └─→ PanelUI 的 renderAll(state)
         └─ 重建面板 DOM
```

**`Selectors.viewState()` 是關鍵的一層**。state 從「單條」改成「多分頁」時，
renderer 與 exporter 完全沒動 —— 因為 selector 把多分頁投影回它們原本認得的扁平形狀。
之後要再加「一次預覽多條」之類的功能，也是從這裡切入。

### 匯出：同一份 state 跑 N 次

```
ExportBatch.exportView(view)
  │
  ├─ assertFontReady()                    字體沒好就中止
  ├─ preloadOrThrow(所有 icon 的 dataUri)  有圖載不進來就中止，不交出缺圖成品
  │
  └─ withOffscreenStage(1200, 150)        另開離屏 stage，不動使用者正在編輯的畫布
       └─ for i in 0..N-1
            frame = { ...view, activeSlotIndex: i }    只換反白那一顆
            CanvasRenderer.renderToLayer(layer, frame) 不傳 isPreview
            stage.toDataURL({ pixelRatio: 1 })
```

匯出之所以能「重跑同一個 render」，是因為 `render()` 對 view 是純函式。

### 工單匯入

```
選檔 → 動態載入 SheetJS → 逐工作表 analyseWorkbook()
  → detectBlocks() 多重訊號評分，找出吸底圖區塊
  → buildSpans() 依 Icon： 的實際欄號推導每一格的欄範圍
  → toBanners() 產生 banner 陣列 + 逐項明細
  → store.dispatch(Actions.setBanners(...))
```

---

## 6. 各模組職責

### 狀態層

| 模組 | 對外介面 | 說明 |
|------|---------|------|
| `actions.js` | `Actions.types`、各 action 建構函式 | 純資料，無邏輯 |
| `reducers.js` | `rootReducer`、`INITIAL_STATE`、`SLOT_LIMITS`、`BannerFactory` | **必須保持純函式與不可變更新** |
| `selectors.js` | `activeBanner`、`viewState`、`bannerLabel`、`bannerMeta` | 多分頁 → 單條視圖的投影層 |
| `store.js` | `getState`、`dispatch`、`subscribe`、`undo`、`redo`、`canUndo`、`canRedo`、`beginBatch`、`endBatch`、`historyDepth` | 見下方「undo 機制」 |
| `projectFile.js` | `serialize`、`parse`、`applyToStore`、`readFile` | 存檔格式 v2，可讀 v1 |

### 繪製層

| 模組 | 對外介面 | 說明 |
|------|---------|------|
| `templates.js` | `LAYOUT`、`TEMPLATES`、`LayoutEngine.getSlotLayout()`、`measureDateText()` | **版位是資料不是程式碼**。PS 公版改了只要改這裡的數字 |
| `colorTheme.js` | `resolveSlotColor`、`getIconSourceUri`、`createSolidTintFilter`、`createLogoGrayFilter`、`createSharpenFilter` | 配色規則與像素濾鏡 |
| `bgRemove.js` | `apply(imageData, opts)` | 邊界泛洪 BFS，`Uint8Array` 訪問標記 + `Int32Array` 堆疊 |
| `fontLoader.js` | `load()`、`isReady()` | FontFace 預載，**失敗不退回預設字體** |
| `iconImageCache.js` | `loadImage(uri, cb)`、`getScaled(uri, img, w, h)` | 成功回 `Image`、**失敗回 `null`**；`getScaled` 是漸進減半的降取樣快取 |
| `viewport.js` | `attach(stage, container, onChange, onSettled)` → `fit / actualSize / zoomIn / zoomOut / getScale` | 縮放平移，含 ResizeObserver |
| `canvas.js` | `renderToLayer(layer, view, isPreview)`、`mount()` | 場景組裝 |

### 介面層

| 模組 | 對外介面 |
|------|---------|
| `panel.js` | `PanelUI.mount(host, store, Actions)` → `{ importWorkOrder(file, cb), loadProject(file, cb) }` |
| `startupDialog.js` | `StartupDialog.mount(panelApi)`、`open`、`close` |
| `iconPicker.js` | `IconPicker.buildTrigger(library, selectedId, onPick)`、`open`、`close`、`isOpen` |
| `imageEditor.js` | `ImageEditor.open(src, onApply, onError)`、`isOpen()` |
| `zoomBar.js` | `ZoomBar.mount(host, viewport)` → 回傳倍率更新函式 |

---

## 7. 三個核心機制

### undo / redo：快照式

`store.js` 保存的是**整棵 state 的參考**，不是 diff。這只有在 reducer 真的是純函式 +
不可變更新時才安全 —— 舊 state 物件必須永遠不被修改。

```
HISTORY_LIMIT = 50          最多 50 步
COALESCE_MS   = 700         同一格連續打字 700ms 內合併成一步
NON_UNDOABLE  = @@INIT, SET_LIBRARY
```

`beginBatch()` / `endBatch()` 把多個 dispatch 併成**一步歷史、一次通知**。
用在：載入進度存檔、上傳素材（加素材＋套用是同一件事）、圖片編輯完成。

### 字體閘門

依規範**嚴禁用系統預設字體頂替**。所以 `app.js` 的啟動流程是：

```
顯示載入畫面 → FontLoader.load() → 成功才 mountApp()
                                 → 失敗顯示錯誤畫面，不繪製也不開放匯出
```

`exportBatch` 另外還有一道 `assertFontReady()`，防止任何繞過閘門的路徑交出錯字體的圖。

### 輸出倍率：來源圖、濾鏡快取、最終像素三者對齊

點陣素材從原檔到 PNG 上的像素，中間**只允許一次降取樣**，而且那一次必須由我們自己做。

```js
// canvas.js
outputRatio = 匯出 ? 1
                   : min(8, 2^ceil(log2(max(1, 目前縮放))) × devicePixelRatio)
```

這個倍率同時決定三件事，三者必須是同一個值：

| 用途 | 做法 |
|------|------|
| 來源圖降到多少像素 | `IconImageCache.getScaled(uri, img, box.w × ratio, box.h × ratio)` |
| 濾鏡快取的解析度 | `node.cache({ pixelRatio: ratio })` |
| 節點在場景裡的尺寸 | `box.w × box.h`（整數，見下） |

對齊之後 Konva 一路都是 1:1，不會再有第二次重新取樣。

**為什麼降取樣要自己做**：canvas 的 `drawImage` 只取 2×2 鄰域做雙線性，
一步縮 5～6 倍會直接跳過大部分來源像素——那是**混疊不是模糊**，細筆畫會斷斷續續。
`getScaled()` 改成漸進減半（每步最多砍一半，雙線性在 2 倍內夠用）。
實測同一張 600×300 測試 LOGO 匯出後對照理想的面積平均：

| | RMS（0~255） | 平均梯度（理想 14.05） |
|---|---|---|
| 一步 drawImage（修正前） | 27.32 | 15.35（高於理想 = 鋸齒） |
| 漸進減半（修正後） | **7.95** | 11.97 |

`imageSmoothingQuality = "high"` 在單獨的 canvas 上有效，但實測把它強加到 Konva
建立的每一張畫布上，匯出的無濾鏡 LOGO 完全沒有變化（27.32 → 27.32），
所以不能靠這個瀏覽器提示。

**其他兩個配套**：

- `fitIntoBox()` 的座標與尺寸一律取整數。置中算出來是 `centerX - w/2` 這種小數，
  落在半像素上一定會被再取樣一次；匯出倍率是 1，取整之後場景座標就等於 PNG 像素座標。
- 縮放停止 140ms 後**整層重畫**（`viewport.js` 的 `scheduleResettle`），
  不能只重做濾鏡快取——來源圖本身是依倍率縮好的，只重做快取會把小圖放大反而更糊。
  預覽倍率量化成 2 的次方，否則滾輪每動一格都會生一份新尺寸的點陣圖。

> **只有大圖會受影響。** 內建 `img/` 的素材原始尺寸是 54~70px，本來就接近 107×58，
> `getScaled()` 判定不需要縮小就原樣回傳。這也解釋了「只有上傳的 LOGO 糊」——
> 只有它們經歷過那次 5~6 倍的一步降取樣。

### 補銳化：icon 與文字走同一條路

`sharpen` 預設**開啟**。它對兩種節點做同一件事——`cache()` 之後套 unsharp mask：

| 節點 | 為什麼有效 |
|------|-----------|
| `Konva.Image` | 107×58 的框，降取樣一定會流失邊緣對比 |
| `Konva.Text` | canvas 的 `fillText` 是**無 hinting 的灰階 AA**，PS 的文字消除鋸齒會把筆畫吸附到像素格線。這是光柵化器的差異，canvas 沒有 API 可以要求 hinting，只能事後補 |

**文字之所以能套同一支濾鏡**，是因為字形完全存在 alpha 通道，
而 `createSharpenFilter` 本來就會銳化 alpha（那是為了單色覆蓋的 icon 加的）。

實測（匯出的說明文字區，中間調像素比例，越低越銳利）：`0.510 → 0.426`（-16.5%），無暗側溢出。

> **文字座標一律取整。** `centerX - width/2` 對中文永遠是整數（全形字寬是 22 的整數倍），
> 但數字與英文不是——`"10.10"` 量到 104.44，置中後 x = 147.78。
> 取整後中間調比例 0.272 → 0.255（-6.3%）。

> **匯出本身零損失。** 匯出的「免運費」像素 vs 同字體同字級直接 `fillText`：**RMS 0**。
> 也就是說這個字級能畫到的最好結果就是它，剩下的差距只能靠銳化補。


---

## 8. 不能亂動的地方

> 以下每一條都是踩過才寫下來的。

### `file://` 的兩個限制

1. **資料檔一律是 `.js` 而不是 `.json`**（`templates.js`、`manifest.js`）。
   `fetch()` 讀本機 JSON 會被 CORS 擋，`<script>` 標籤不受影響。
2. **圖片一律是 data URI，不能用相對路徑。**
   `file://` 下把相對路徑的圖畫進 canvas 會讓 canvas 變成 tainted，
   之後 `toDataURL()` 直接丟 `SecurityError` —— **匯出在使用者按下按鈕那一刻才爆**。

### Konva `Text` 不要設 `width`

- 設 `width` + 預設 `wrap: "word"` → 換行，第二行從垂直置中的固定高度盒子擠進 icon 區。
- 設 `width` + `wrap: "none"` → **靜默截字**，14 字量出來 176px 塞進 180px 盒子，
  少掉的字沒有任何視覺跡象。

正確作法是**完全不設 `width`**，用 `textNode.x(centerX - textNode.width() / 2)` 手動置中。
超長的字就對稱溢出到隔壁 —— 那正是「太長了」的訊號。

### 非同步圖片載入要有世代計數器

Konva 9 的 `Node` **沒有 `isDestroyed()`**。圖片非同步載完時，使用者可能早就切了顆數或分頁，
原本的 group 已被銷毀。`canvas.js` 用 `renderGeneration` 計數器擋掉過期的回呼。

### 圖片載入失敗必須回 `null`

`iconImageCache` 只寫 `img.onload` 的話，載入失敗的圖永遠不會呼叫回呼，
`Promise.all` 就永遠不 resolve —— 使用者看到的是**永遠轉不完的「匯出中…」**，沒有錯誤訊息。

### 預覽專屬的東西不能畫進匯出

假字（`文字5字內`）、空 icon 虛線框、畫布範圍外框線，全部走 `isPreview` 分流：
畫面上的 stage 傳 `true`，`exportBatch` 不傳（`undefined` → falsy）。

### 檔期文字用即時 Konva 文字，不要噴成 PNG

「打字代替 icon」的直覺作法是開一個打字視窗、噴成 107×58 的 PNG 存進素材庫。
**不要這樣做**：

- 點陣圖要走 `cache()` + 單色覆蓋濾鏡，白白吃掉一次重新取樣；
  文字節點用 `fill` 上色，不需要 cache 也不需要濾鏡，是渲染器裡最銳利的路徑。
  文字全是細筆畫，這個差距比 icon 明顯得多。
- 9.9 → 10.10 → 11.11 是同一張圖一年做好幾次。噴成圖要重做，即時文字改 3 個字。
- 存檔只存幾個字，不是一段 base64。
- 而且噴成圖**程式碼更多**——要多做一整套打字視窗（畫布、即時預覽、字級、對齊）。

### 檔期文字的字級由 `measureDateText()` 單一來源決定

面板要知道「塞不塞得下」才能決定亮不亮紅框，畫布要知道「畫多大」。
兩邊必須用同一支 `LayoutEngine.measureDateText()`，各算各的遲早會不一致。

字級固定 `dateFontSize`（40px）、塞不下才等比縮小、但不低於 `dateFontMin`（16px）。
**縮到下限仍然塞不下時字會真的溢出框外**，`fits` 回 `false`，UI 負責亮紅框。
不做成「自動填滿框」是因為「9.9」（3 字）會放到約 50px、「10.10」（5 字）只能到約 34px，
同一個框裡兩張圖大小差一半。

### 打字時不能重建輸入框 DOM

中文輸入法組字中若把 `<input>` 換掉，組字會被打斷。
`panel.js` 的 `syncTextRow()` / `syncDateRow()` 只回寫值與切 class，**永不重建輸入框**。
另有 `compositionstart` / `compositionend` 守衛，組字中不攔 Ctrl+Z。

這兩個 sync 函式**也要負責回寫 `input.value`**，不能只靠輸入事件：
undo / redo 與載入存檔同樣會改到那些欄位，而它們不經過輸入框。

### 素材 id 由檔名決定，不能由排序決定

進度存檔記的是 `iconId`。若 id 是 `icon-1` / `icon-2` 這種流水號，
在 `img/` 多放一張圖、排序一變，舊存檔就會靜默指到別張圖。

### 單色覆蓋不能用 `Konva.Filters.RGB`

它的實作是 `data[i] = brightness * red`，會把目標色乘上原圖亮度，
染出來是「帶明暗的橘」而不是單色，**純黑的地方永遠染不上色**。
`colorTheme.js` 的 `createSolidTintFilter` 直接把不透明像素的 RGB 設成目標色、只保留 alpha。

### 銳化必須同時作用在 alpha，半徑要跟著快取倍率放大

單色覆蓋過的 icon 每個不透明像素 RGB 完全相同，形狀**全部存在 alpha 通道**。
而濾鏡是在 3 倍快取上跑的，半徑 1 等於輸出解析度的 1/3，縮回去會被平均掉。

### 浮動面板要在重繪與捲動時關閉

`iconPicker` 是 `position: fixed` 掛在 `body` 上（側邊面板 `overflow: auto` 會裁切），
位置由 JS 依按鈕算出來。捲動、改變視窗大小、面板重繪都會讓那個位置失效，
所以三種情況一律關閉。

**但「捲動」只能算面板外面的捲動。** `scroll` 事件不會冒泡，要收到側邊面板內部的捲動
必須用捕獲階段（`addEventListener("scroll", fn, true)`），而捕獲階段同樣收得到
選單自己 `.icon-grid` 的捲動。早期版本直接把 `close` 掛上去，等於
**「選單一被滾動就自己關掉」**——素材少的時候網格不溢出，沒有人發現；
素材加到 23 個（內容 480px、可視 402px）之後，選單完全不能捲，
超出可視範圍的素材就永遠選不到。修法是在處理器裡排除自己：

```js
function onScroll(e) {
  if (panel.contains(e.target)) return;  // 選單自己的捲動不算
  close();
}
```

`e.target` 對 `scroll` 而言就是被捲動的那個元素，所以 `panel.contains` 判得準。
移除監聽時要移除 `onScroll` 本身，不是 `close`——`removeEventListener` 比對的是函式參考。

---

## 9. 常見修改怎麼下手

| 要做的事 | 改哪裡 |
|---------|-------|
| PS 公版數值變了 | `templates.js` 的 `LAYOUT` 與 `TEMPLATES`，不用動渲染邏輯 |
| 換品牌色 / 灰色 | `colorTheme.js` 最上方的 `ACCENT_COLORS`、`GRAY` |
| 字數上限不是 5 | `textLimit.js` 的 `MAX_UNITS` |
| 檔期文字字級要調 | `templates.js` 的 `dateFontSize` / `dateFontMin` / `dateFontWeight` |
| 加載新的字重 | `fontLoader.js` 的 `FACES`（注意每個字重約 11MB） |
| 加新素材 | 圖丟 `img/` → `node tools/build-icon-manifest.js` |
| 加一個新的可編輯欄位 | `actions.js` 加型別 → `reducers.js` 加 case → `selectors.js` 若要進畫面就加進 `viewState` → `panel.js` 加 UI → `canvas.js` 畫出來 |
| 支援 6 顆以上 | `reducers.js` 的 `MAX_SLOTS` + `templates.js` 的 `TEMPLATES` 補中心點 |
| 換掉 CDN | `index.html`（Konva、JSZip）、`imageEditor.js`（CropperJS）、`workOrderImporter.js`（SheetJS） |

---

## 10. 目前的架構債

1. **沒有自動化測試。** 所有驗證都是用 Playwright 手寫一次性腳本跑完就丟。
   要長期維護的話，把那些腳本收進 `tests/` 會比較踏實。
2. **`panel.js` 約 800 行**，是最大的單一檔案。分頁列、匯入區、每格卡片、匯出區
   其實可以各自拆出去。
3. **相依關係只存在 `index.html` 的順序裡**，任何靜態分析工具都看不到模組關係。
   這是無建置流程的直接代價。
4. **素材的 `type` 無法在 `img/` 標記。** 產生器一律輸出 `type: "icon"`，
   廠商 LOGO 只能走每格的「⬆ 上傳」。若之後 `img/` 也要放 LOGO，
   加一個 `img/logo/` 子資料夾讓產生器自動判定即可。
