# 04｜版位資料模型與 Schema

文件狀態：現行 JSON 與 renderer 已確認

盤點日期：2026-08-26

## 1. Schema 的定位

每一個 BOD 版位以一份 `blocks/{id}/block.json` 描述。它不是單純的欄位清單，而是「畫布尺寸 + 圖層座標 + 輸入欄位 + 渲染提示 + 參考圖」的可執行版位定義。

註冊與載入入口：

- [`blocks/index.js`](../blocks/index.js)：active block ID registry。
- [`core/core-engine.js`](../core/core-engine.js)：載入 registry 與 JSON，轉交 renderer。
- [`core/schema-renderer.js`](../core/schema-renderer.js)：將 schema 註冊成可渲染 block。

## 2. block.json 的概念結構

以下是目前 renderer 實際使用的概念模型；個別欄位可依版位而異：

```json
{
  "id": "subarea_A_1_1",
  "name": "…",
  "width": 400,
  "height": 350,
  "cornerRadius": 15,
  "refImage": "…",
  "layers": [
    {
      "type": "image",
      "field": "productImg",
      "x": 0,
      "y": 0,
      "width": 200,
      "height": 200,
      "z": 1
    },
    {
      "type": "text",
      "field": "name",
      "x": 10,
      "y": 210,
      "fontSize": 24,
      "colorRole": "mainText"
    }
  ]
}
```

實際欄位名稱與 metadata 以各 block JSON 為準；上例只用來說明層級，不是可直接複製的完整 schema。

## 3. Layer 類型

目前統計到的主要 layer type：

| type | 用途 | 常見資料 |
| --- | --- | --- |
| `image` | 商品、logo、掛標、簽名、贈品等圖片 | `field`、座標、尺寸、裁切/吸附提示 |
| `rect` | 背景、文字底、促銷帶、CTA 底 | `field`、`colorRole`、radius、clip |
| `circle` | 色票、圓形徽章或裝飾 | `field`、顏色、半徑 |
| `text` | 品牌、促銷、商品名、警語、CTA 等文字 | `field`、字型、行高、對齊、限制 |

所有 129 份實體 schema 的 layer 統計（包含 repeats 內的 layer）：

| type | 數量 |
| --- | ---: |
| image | 236 |
| rect | 459 |
| circle | 123 |
| text | 597 |

## 4. Schema → 欄位模型

renderer 會從 layer 的 field metadata 推導可編輯欄位，主頁再把欄位與工單 header、資料值、圖片 gallery 對應。常見欄位包括：

- 圖片：`productImg`、`logoImg`、`endorserImg`、`signImg`、`giftImg`。
- 文字：`promo`、`name`、`warn`、`cta`、`copy`、`content`、`itemText`、`signNote`。
- 色彩：`promoColor`、`bgColor`、`badgeColor`、`swatchColor`。
- 結構化/變體欄位：同一欄位加數字或變體 suffix，例如多商品、多 badge、多文字列。

根頁面目前有：

- `wo-fields`：72 組 subarea 相關欄位組合。
- `wo-msbn-fields`：35 組 MSBN 欄位組合。

這些 inline JSON 是工單解析的欄位契約；如果 schema 新增 field，必須確認生成器輸入、XLSX parser、匯入 UI 與 export 都能識別。

## 5. 常用 schema metadata

### 5.1 版位與文字

- `width`、`height`：設計稿原始尺寸。
- `x`、`y`、`topExact`：layer 位置；`topExact` 用於文字實際 ink top 的精準校正。
- `fontSize`、`lineHeight`、font weight：文字幾何與基線。
- `designText`：產製工具用來保留設計稿文字或做字型量測。
- `hidden`：保留 layer 但不顯示，常用於可選的 logoText 或 fallback layer。

### 5.2 圖片與形狀

- `clipImage`、`clip-path`：圖片裁切形狀。
- `radius`、`psRadius`、`cornerRadius`：圖片或容器圓角。
- `bgField`：由資料欄位控制背景色。
- `z` 或等價順序 metadata：控制前後疊層。

### 5.3 重複與動態列

- `repeats`：一個 schema 內重複產生多個 layer instance；目前 `msbn3p` 是明確含 repeats 的 schema。
- `dynamicRowLayout`：依輸入列數動態調整內容；目前可見於 `msbn_D_1_2`、`msbn_D_1_3`、`msbn_D_2_2`、`msbn_D_2_3`、`msbn_D_3_1`。
- 動態列資料由主頁的 `dynamicRowInfoOf`、`dynamicRowSnapshotOf`、`dynamicRowValuesOf`、`writeDynamicRowEntries` 等流程寫入。

新增動態列時，必須同時考慮：最少/最多列數、每列欄位名稱、插入/刪除後的 field index、文字限制、圖片層 z-order 與匯出結果。

## 6. Theme role 與色彩契約

schema 不應把所有顏色當成孤立的硬編碼。renderer 支援 role-based 顏色，主頁與 JBP 的共用配色功能會依角色重算：

- `mainText`
- `subText`
- `promo`
- `badge`
- `cta`
- `background`
- 其他由 schema 實際宣告的 role

現行文字配色的基礎是 W3C relative luminance / contrast 計算；CTA 的特別規則是「CTA 底色跟隨副標/副文字角色；CTA 文字與三角標根據 CTA 底色選擇最大對比的黑或白」。完整視覺規則見 [08｜技術規範與視覺渲染規則](./08-技術規範與視覺渲染規則.md)。

## 7. 圖片吸附與依賴

renderer 會處理 image absorption：

- donor area 提供圖片來源或已上傳圖片。
- target area 根據 layout metadata 接收圖片。
- `imageAbsorb`、`forceImageAbsorb` 控制是否啟用或強制吸附。
- `roleColorsOf` 與 image/text dependency 可用於依圖片或欄位狀態重算 theme。

目前有 2 份 schema 明確設定 `disableImageAbsorb`：`msbn_A_2_2`、`msbn_A_3_1`。修正版位時不要把所有圖片區都視為可吸附；需先看 schema 的限制。

## 8. 版位 registry 與實體檔案差異

| 範圍 | 數量 | 意義 |
| --- | ---: | --- |
| 實體 `block.json` | 129 | 專案目前存在的 schema 資產 |
| active `blocks/index.js` | 107 | 主 runtime 預設載入與可用的註冊版位 |
| active subarea | 72 | `wo-fields` 對應的主版位欄位群 |
| active MSBN | 35 | `wo-msbn-fields` 對應的主版位欄位群 |

未列入 active 的資產包含 `msbn3p` 以及一批 base/legacy `subarea_A_1` 等候選檔；維護頁會嘗試以註冊 ID 去掉最後一段推導候選，但這不是 active 上線流程。

## 9. 新增或修正 schema 的契約

提交前至少確認：

1. `id` 與資料夾名稱一致。
2. `width`、`height`、`refImage`、layer 座標一致。
3. 所有 field 都能在生成器或匯入工單取得資料。
4. 圖片的裁切、吸附、fallback 與 CORS 行為正常。
5. 文字的最大長度、行高、`topExact` 與下載圖一致。
6. `colorRole` 與 CTA/副標的配色關係正確。
7. 是否要加入 active registry 已明確決定。
8. 執行 `tools/` 中相應的 ref、文字、CSS/block 檢查。
9. 以主頁 preview 與實際 PNG 匯出各看一次。

