一鍵下載案例檔案的公區路徑：<br>
G:\共用雲端硬碟\INT_TWN_SHP_內部-素材\AI審圖\JBP單店<br>
<br>
一、字體路徑：<br>
https://jimmywu-commits.github.io/shopee/fonts/<br>
在coding時將上述的字體路徑提供給GPT, 裡面包含了三種粗細，分別是：<br>
ShopeeNotoSans(content)-Bold.ttf<br>
ShopeeNotoSans(content)-Medium.ttf<br>
ShopeeNotoSans(content)-Regular.ttf<br>

二、共用js位置：
https://jimmywu-commits.github.io/shopee/js/<br>
layout-runtime.js<br>
排版版位的核心引擎，每個 html/ 裡的版位殼都載入它。負責：<br>
讀取 CSS/config 建立圖層<br>
接收 postMessage（文字、顏色、logo、商品圖）<br>
畫布縮放 fit()<br>
文字直接點擊編輯、字數限制<br>
商品圖排版邏輯<br>
底圖核對 overlay<br>
<br>
bn-editor-plugin.js<br>
BN編輯器左側工具列的功能：<br>
Logo 上傳、排序（▲▼）、編輯、移除<br>
商品圖上傳（兩步驟 Modal：選圖→排主/左/右）<br>
商品列表管理（z-index 調整、移除）<br>
下載全部勾選版位（html2canvas）<br>
<br>
bn-state-plugin.js<br>
狀態管理和 banwords 橋接：<br>
本機暫存（localStorage，每 30 秒自動存）<br>
下載暫存 / 上傳暫存 JSON<br>
banwords 引擎橋接（blur 後自動轉換）<br>
banwords.xlsx 載入（含 fallback 手動選取 UI）<br>
<br>
banwords-engine-hbn.js<br>
禁用語引擎核心（獨立運作）：<br>
讀取 banwords.xlsx 規則<br>
transformText()：文字轉換<br>
applyToElement()：套用到元素<br>
支援 dollarExempt（豁免 $ 和千分位）<br>
<br>
logo-editor-plugin.js<br>
Logo 編輯功能（獨立外掛）：<br>
裁切（CropperJS）<br>
加圓角<br>
觸發器（✎ 小按鈕）附加到 logo 縮圖<br>
<br>
editor-plugin.js<br>
商品圖編輯功能（獨立外掛）：<br>
商品圖裁切、調整<br>
跟 bn-editor-plugin.js 配合使用<br>
<br>
index.js<br>
版位清單，只有一個功能：<br>
告訴 BN編輯器有哪些版位要顯示<br>
<br>
三、開發同仁名單：<br>
鄭澤謙	tse.cheng@shopee.com<br>
程祺委	ken.cheng@shopee.com<br>
許書華	jamie.h@shopee.com<br>
李海若	iona.li@shopee.com<br>
