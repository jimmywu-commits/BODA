/* ══════════════════════════════════════
   js/index.js
   ★ 排版清單，BN編輯器從這裡讀取版位
══════════════════════════════════════ */
var BN_LAYOUTS = [
  "LPBN_APP.html",
  "LPBN_PC.html",
  "IG橫logo排版.html",
  "IG方logo排版.html",

  "HBN_橫式LOGO.html",
  "HBN_方式LOGO.html",

  "活動總覽_橫式LOGO.html",
  "活動總覽_方式LOGO.html",

  "首頁LOGO牆.html",

  "AMS BN-橫logo.html",
  "AMS BN-方logo.html",

  "ddcard方logo.html",
  "ddcard橫logo.html",

  "Coin_pageBN_APP方LOGO.html",
  "Coin_pageBN_APP橫LOGO.html",
  "AR.html",
  "AR_LOGO.html",

  "FB_POST_方LOGO.html",
  "FB_POST_橫LOGO.html",

  "SCBN_APP.html",

  "Search_Image1logo.html",
  "Search_Image2logo.html",
  "Search_Image3logo.html",

  "SearchICON_LOGO.html",
  "SearchICON_PRODUCT.html",
  "SearchICON_TEXT.html"
];

/* ★ 這行不要刪 */
if (typeof window._bn_scan_cb === 'function') window._bn_scan_cb(BN_LAYOUTS);