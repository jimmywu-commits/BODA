/* ══════════════════════════════════════
   js/index.js
   ★ 排版清單，BN編輯器從這裡讀取版位
══════════════════════════════════════ */
var BN_LAYOUTS = [
  "IG橫logo排版.html",
  "IG方logo排版.html",

  "HBN_橫式LOGO.html",
  "HBN_方式LOGO.html",

  "ddcard方logo.html",
  "ddcard橫logo.html",

  "Coin_pageBN_APP方LOGO.html",
  "Coin_pageBN_APP橫LOGO.html",

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