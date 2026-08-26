# 09｜工具腳本與 PSD 產製流程

文件狀態：依目前 `tools/` 與 `export/psd-css-toolkit/` 檔案整理

盤點日期：2026-08-26

## 1. 工具鏈定位

BOD 的版位不是只靠手動編輯 JSON。現有工具鏈涵蓋 Photoshop CSS 解析、block 生成、座標/字面量測、批次修補、raster preview、差異檢查與工單欄位檢查。

兩個主要區域：

- [`export/psd-css-toolkit/`](../export/psd-css-toolkit/)：從 PSD 匯出的 CSS 與參考圖產生/校準 `block.json`。
- [`tools/`](../tools/)：日常 QA、量測、修補、預覽與專案特定驗證。

## 2. PSD/CSS toolkit

補充說明：[`export/psd-css-toolkit/README.md`](../export/psd-css-toolkit/README.md)

### 2.1 主要模組

| 模組 | 目的 |
| --- | --- |
| `psdcss/parse_css.py` | 解析 Photoshop Copy All Layers CSS |
| `psdcss/fontmetrics.py` | 字型與文字 metrics |
| `psdcss/build_blocks.py` | 依 config/CSS/參考圖建立 block JSON |
| `psdcss/calibrate.py` | 依參考圖校準座標與尺寸 |
| `psdcss/verify_ref.py` | 驗證生成結果與 reference |
| `psdcss/preview.py` | 產生預覽 |
| `node/renderer/block-renderer.js` | Node 端 block renderer/預覽支援 |

常見輸入：Photoshop CSS、reference PNG、字型與 toolkit `config.json`。常見輸出：`blocks/{id}/block.json`、預覽與校準報告。

### 2.2 建議產製流程

在 `export/psd-css-toolkit/` 執行：

```text
複製 config.example.json 為 config.json
python -m psdcss.build_blocks config.json --write
python -m psdcss.calibrate config.json --write
python -m psdcss.build_blocks config.json --write
python -m psdcss.verify_ref config.json
python -m psdcss.preview config.json
```

第一次 build 產生基線，calibrate 以 reference 校正，再 build 產生校正後結果，最後 verify/preview。若跳過第二次 build，校準資料可能沒有回寫到最終 schema。

### 2.3 產製規則

toolkit 會處理或保留：

- `topExact`
- `designText`
- `psRadius`
- `clipImage`
- `bgField`
- `hidden`
- 圖片/文字 layer 的座標、尺寸、順序

`README.md` 所描述的目標是讓 Photoshop 匯出的 CSS 與設計稿 reference 對得起來，校準目標平均偏差約小於 1 px；實際結果仍需依字型、rasterizer 與 reference 驗證。

## 3. tools 腳本分類

### 3.1 產生與批次修補

| 腳本 | 用途 |
| --- | --- |
| `tools/build_b1_34.py` | 產製/整理 B1～B34 類版位 |
| `tools/build_c_series.py` | 產製 C series |
| `tools/patch_blocks_v13.py` | v13 block 批次修補 |
| `tools/fix_b4_promo_band.py` | B4 promo band 修正 |
| `tools/fix_badge_binding.py` | badge 欄位綁定修正 |
| `tools/add_exposure_frames.py` | 增加曝光 frame |
| `tools/apply_css_design_text.py` | 由 CSS 套入 design text |
| `tools/apply_css_ink_top.py` | 套用文字 ink top 校正 |
| `tools/apply_css_radius.py` | 套用 CSS 圓角 |
| `tools/apply_text_centers.py` | 批次套用文字中心位置 |

這類腳本可能直接改寫 `blocks/*/block.json`；執行前要先確認輸入範圍、輸出目錄與版本控制差異。

### 3.2 CSS/Schema 差異與結構檢查

| 腳本 | 用途 |
| --- | --- |
| `tools/diff_css_vs_blocks.py` | 比較 CSS 與 block JSON 的尺寸/位置/屬性 |
| `tools/check_workorder_fields.js` | 檢查工單欄位與版位定義 |
| `tools/dump_layout.js` | 傾印 layout 結構、欄位或 layer |
| `tools/check_css_ink_hypothesis.py` | 驗證 CSS ink top 假設 |

### 3.3 參考圖量測與 raster

| 腳本 | 用途 |
| --- | --- |
| `tools/measure_ref_centers.py` | 量測 reference 視覺中心 |
| `tools/measure_ref_ink.py` | 量測文字/圖形 ink bounds |
| `tools/verify_ink_accuracy.py` | 驗證 ink 位置精度 |
| `tools/check_line_height.py` | 檢查 line-height/文字幾何 |
| `tools/raster_preview.py` | 產生 raster 預覽 |
| `tools/overlay_check.py` | 疊圖檢查 reference 與輸出 |

視覺修正應優先使用這一組工具取得數據，再調整 schema；人工只看縮放後畫面容易把字型 ink 偏移誤判成容器問題。

### 3.4 資產與內容處理

| 腳本 | 用途 |
| --- | --- |
| `tools/crop_shopee_logos.py` | logo 裁切 |
| `tools/audit_exposure_areas.py` | 曝光區域/資產稽核 |
| `tools/parse_msbn_css.py` | 解析 MSBN CSS |
| `tools/msbn-css.json` | MSBN CSS 解析資料 |
| `tools/ref_ink.json` | reference ink 量測資料 |

### 3.5 Node/瀏覽器流程驗證

| 腳本 | 用途 |
| --- | --- |
| `tools/build-qa-preview.js` | 建立 QA preview |
| `tools/check_text_vs_ref.js` | 比較文字輸出與 reference |
| `tools/test_canvas_drop.js` | 測試畫布圖片 drop |
| `tools/test_maint_view.js` | 測試維護頁載入/顯示 |
| `tools/verify-text-layout.js` | 驗證文字 layout |
| `tools/_preview/_render.js` | preview renderer 輔助 |

吸底圖另有 [`bottom/tools/build-icon-manifest.js`](../bottom/tools/build-icon-manifest.js)，用來產生 `bottom/src/icons/manifest.js`；產生後應檢查 manifest diff，不要手動在產物檔修一行就結案。

## 4. 一個版位從設計到上線的建議流程

```text
PSD/CSS/reference
      │
      ▼
parse_css / config
      │
      ▼
build_blocks --write
      │
      ▼
calibrate --write
      │
      ▼
build_blocks --write（回寫校準後 schema）
      │
      ├─ verify_ref / overlay / ink / line-height
      ├─ check_workorder_fields
      └─ 主 BOD 預覽 + PNG 匯出實機驗收
```

## 5. 使用腳本的安全規則

- 先讀腳本的 CLI help、輸入 config 與輸出路徑。
- 批次改寫前保留 git diff 或另存產製輸出。
- 不把 `_preview`、overlay PNG、歷史 JSON 當成 runtime 資產直接加入 active registry。
- 修完 schema 後同時驗證 reference、工單欄位、主頁 render、匯出 PNG。
- 如果結果受字型/Chrome 版本影響，記錄執行環境，避免只保留一個無法重現的數字。

