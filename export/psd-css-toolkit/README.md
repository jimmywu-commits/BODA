# psd-css-toolkit

**把 Photoshop 匯出的 CSS，變成跟設計稿參考圖對得起來的版位定義檔（block.json）。**

丟一份 PS 的「Copy All Layers CSS」進去，跑三行指令，
就會得到一組座標、圓角、字級、行距、文字位置都跟設計稿對齊的 JSON，
以及一支能把它畫出來的渲染引擎。實測文字定位 **95% 落在 1px 以內、平均誤差 0.35px**。

---

## 為什麼不能直接用 PS 的 CSS

PS 匯出的 CSS 看起來像網頁 CSS，但**直接貼上去會跑版**，主要有四個坑：

| 坑 | 症狀 | 這套工具怎麼解 |
|---|---|---|
| PS 的文字 `top` 是**筆畫上緣**，瀏覽器的 `top` 是**內容區上緣** | 字整排偏高，而且字級越大偏越多（實測 40px 差 0～2px、55px 差 7px） | 用字型檔算出兩者的差，逐圖層精算 |
| 座標是整張大畫布的絕對值 | 每一格都要自己減掉原點 | 自動換算，原點還能用參考圖自動校正 |
| 版位邊界不在 CSS 裡 | 整格上下偏移 | 有參考圖就用參考圖尺寸；沒有就用「內容 + 留白」 |
| 文字框寬度只是「這串示意字剛好佔的寬」 | 換一段字就爆框 | 以文字中心為軸，在包住它的色塊內對稱放寬 |

色塊反而不用補償——`left/top/width/height` 直接照抄就準，
以前會出錯是因為舊版匯出**沒有 `border-radius`**，圓角整批遺失。

---

## 安裝

```bash
pip install -r requirements.txt      # fonttools / numpy / Pillow
# 預覽功能還需要 Node.js（跑 renderer/block-renderer.js）
```

## 快速上手

```
psd-css-toolkit/
  config.json          ← 從 config.example.json 複製後修改
  input/
    MSBN_css.txt       ← PS 匯出的 Copy All Layers CSS
    ref/               ← 設計稿參考圖（檔名要對得上版位 id）
  fonts/               ← 實際會用來渲染的字型檔（.ttf）
```

```bash
cp config.example.json config.json          # 改成你的專案設定

python -m psdcss.build_blocks config.json --write   # ① 產生 block.json
python -m psdcss.calibrate    config.json --write   # ② 用參考圖量出每格的微調量
python -m psdcss.build_blocks config.json --write   # ③ 再產一次（自動套用微調）
python -m psdcss.verify_ref   config.json           # ④ 確認準不準
python -m psdcss.preview      config.json           # ⑤ 產出對照圖，用眼睛看
```

②③ 可以多跑一輪，通常兩輪就收斂。④ 的目標是「絕對誤差平均 < 1px」。

---

## 五支程式在做什麼

| 檔案 | 做什麼 |
|---|---|
| `psdcss/parse_css.py` | PS 的 CSS → 結構化 JSON。處理群組樹、隱藏圖層、`content:` 原文、相對座標 |
| `psdcss/fontmetrics.py` | 從字型檔算「筆畫離內容區上緣幾 em」「字實際多寬」「字實際多高」 |
| `psdcss/build_blocks.py` | **主程式**。所有校正都在這裡，產出 block.json |
| `psdcss/calibrate.py` | 拿參考圖量出每一格還差多少，寫成 `calibration.json` |
| `psdcss/verify_ref.py` | 拿參考圖驗收，報告誤差分佈 |
| `psdcss/preview.py` | 把渲染結果畫成圖，跟參考圖上下並排 |
| `renderer/block-renderer.js` | 吃 block.json 吐 HTML 的渲染引擎（無相依，Node/瀏覽器都能跑） |

---

## 核心：文字為什麼要這樣算

```
筆畫上緣   = CSS top + 原點位移 + inkBias
topExact  = 筆畫上緣 − （這串字最高筆畫的 em 值 × 字級）
```

- **最高筆畫的 em 值**：`(hhea.ascent − 該字 yMax) ÷ unitsPerEm`，一串字取最小值。
  例：ShopeeNotoSans Bold「促標文案」＝ 0.3030 em，45px 字級就是 13.63px。
  這是從字型檔算出來的**精確值**，不是估的，所以換字級、換字重都不會失準。
- **inkBias**：PS 的 top 比實際筆畫少 1px（實測 200 個圖層，中位數 +1、標準差 0.78）。
  換 PS 版本可能不同，用 `verify_ref` 重新校一次即可。

渲染端還要做一件事——**裁切補償**：

```
上下 padding = (字高 em × 字級 − 行距 × 字級) ÷ 2
```

文字框都是 `overflow:hidden`，但行框常常比字本身矮（行距 0.956 < 字高 1.48），
不補 padding，字的上下會被切掉一截。padding 只推開裁切邊界、不影響行框位置，
所以字不會跑掉。這段已經寫在 `block-renderer.js` 裡。

---

## block.json 的欄位

除了一般的 `left/top/width/height/zIndex`，這套工具會多寫幾個屬性，
渲染引擎必須認得（`block-renderer.js` 已經實作）：

| 屬性 | 意思 |
|---|---|
| `topExact` | 文字內容區上緣的精確值。**有這個就直接用，不要再做任何推算** |
| `designText` | 設計稿上原本的字（「品名一排最多8字」）。預覽／維修模式直接顯示 |
| `psRadius` | 這個圓角照 PS 原值畫，不要被專案的統一圓角規則覆寫 |
| `clipImage` | 圖片放大時裁切在框內（連圓角一起吃）；沒標就允許超出框 |
| `bgField` | 這個圖片框同時是一塊看得到的色塊，放了圖之後底色要留著 |
| `hidden` | 設計稿上的標註圖層，不輸出（資料保留，之後想開回來很容易） |

---

## 設定檔重點

| 設定 | 說明 |
|---|---|
| `groupPattern` | 怎麼認出「一個版位」。第一個括號 group 就是版位 id |
| `canvas` | 版位尺寸。**有參考圖就自動用參考圖的尺寸**，不用手動填 |
| `fonts` | 一定要用**實際渲染會用到的同一份字型檔**，換字型要重跑 |
| `ignoreGroups` / `ignoreLayers` | 設計稿的輔助圖層（作圖區、安全範圍、系統模擬字…）不要輸出 |
| `hintTexts` | 含這些字的文字圖層是標註（「商品圖」「LOGO」），標成 hidden |
| `textFields` / `colorFields` / `imageFields` | PS 圖層名 → 欄位。同名多個時照 `numbering` 編號 |
| `imageFields[].clip` | 這個圖框要不要「放大也不超出範圍」 |
| `imageFields[].backgroundColor` | 覆寫設計稿的參考色（曝品範圍在 PS 裡通常填藍色，實際要白色或透明） |

---

## 移植到新專案的順序

1. 把 PS 的 CSS 放進 `input/`，參考圖放 `input/ref/`，字型放 `fonts/`
2. 改 `config.json` 的 `groupPattern`（先跑 `parse_css` 確認認得出幾個版位）
3. 跑 `build_blocks` 看欄位對不對 → 補 `textFields` / `imageFields` 的圖層名對照
4. 跑 `calibrate` → `build_blocks` → `verify_ref`，把誤差壓進 1px
5. 跑 `preview` 用眼睛掃一遍，確認形狀、圓角、圖片框都在
6. 把 `renderer/block-renderer.js` 接進你的專案；如果專案已經有渲染引擎，
   只要補上表格裡那幾個屬性的支援就好（大約 30 行）

---

## 已知限制

- **不會自動判斷圓形**。PS 匯出的圓形是帶 `border-radius` 的方框，
  要圓形請在 block.json 把 `type` 改成 `circle`，或在設定裡加規則。
- **智慧型物件沒有圖檔**。PS 只匯出座標，圖要另外從參考圖裁或請設計提供。
- **參考圖比 CSS 舊的時候**，`verify_ref` 會把量不到的圖層另外列出來，
  不會混進統計裡——看到數字偏多時先確認參考圖是不是該更新了。
- 複合造型（例如優惠券的半圓缺口、虛線）PS 匯不出來，要自己補圖層。
