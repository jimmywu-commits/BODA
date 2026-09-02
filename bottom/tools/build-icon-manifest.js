/*
 * 從 img/ 產生 src/icons/manifest.js。
 *
 *   node tools/build-icon-manifest.js
 *
 * 為什麼要有這一步、不能讓 manifest 直接寫 "img/fire.png" 這種相對路徑：
 * 這個工具的設計目標是「雙擊 index.html 就能用」，也就是跑在 file:// 底下。
 * 在 file:// 把相對路徑的圖畫進 canvas 會把 canvas 標記為 tainted，
 * 之後 toDataURL() 會直接丟 SecurityError——匯出整個壞掉，而且是在使用者按下匯出
 * 那一刻才爆，不是載入時。所以圖必須以 data URI 內嵌。
 *
 * 新增素材的流程：把 PNG/SVG 丟進 img/ → 跑這支 → git commit（img/ 與 manifest.js 都要）。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const IMG_DIR = path.join(ROOT, "img");
const OUT_FILE = path.join(ROOT, "src", "icons", "manifest.js");

var MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif" };
/* 這兩個是吸底等級預設用的品牌 LOGO：保持原色，不套橘／紅色。 */
var BRAND_LOGO_IDS = { "bod-logo": true, "mdd-logo": true };

/*
 * 檔名 → id。
 *
 * 刻意保留中日文字元，只把空白與標點換成 -。
 * 早期版本是「轉小寫 slug，純中文檔名退回 icon-1/icon-2…」，那是錯的：
 * 之後在 img/ 多放一張中文檔名的圖，排序一變，icon-3 就指到別張圖，
 * 所有舊的進度存檔會靜默錯位（存檔記的是 iconId）。
 * id 必須只由檔名決定，不能由「它排第幾個」決定。
 */
function toId(name) {
  return name
    .toLowerCase()
    .replace(/[\s._]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function main() {
  if (!fs.existsSync(IMG_DIR)) {
    console.error("找不到 img/ 資料夾：" + IMG_DIR);
    process.exit(1);
  }

  var files = fs
    .readdirSync(IMG_DIR)
    .filter(function (f) {
      var ext = path.extname(f).toLowerCase();
      return ext === ".svg" || MIME[ext];
    })
    .sort(function (a, b) { return a.localeCompare(b, "zh-Hant"); });

  if (!files.length) {
    console.error("img/ 裡沒有任何 .png / .jpg / .gif / .svg");
    process.exit(1);
  }

  var seen = {};
  var entries = files.map(function (file, i) {
    var ext = path.extname(file).toLowerCase();
    var base = path.basename(file, path.extname(file));
    var id = toId(base) || "icon-" + i;
    // id 撞名就補流水號，否則 findLibraryIcon 會永遠只找到第一筆
    if (seen[id]) id = id + "-" + (seen[id] + 1);
    seen[id] = (seen[id] || 0) + 1;

    var buf = fs.readFileSync(path.join(IMG_DIR, file));
    var lines = [
      "  {",
      "    id: " + JSON.stringify(id) + ",",
      "    displayName: " + JSON.stringify(base) + ",",
      "    type: " + (BRAND_LOGO_IDS[id] ? "\"logo\"" : "\"icon\"") + ",",
    ];

    if (ext === ".svg") {
      lines.push("    svg: " + JSON.stringify(buf.toString("utf8")) + ",");
    } else {
      lines.push(
        "    src: " + JSON.stringify("data:" + MIME[ext] + ";base64," + buf.toString("base64")) + ","
      );
    }
    lines.push("  },");
    return { code: lines.join("\n"), file: file, id: id, bytes: buf.length };
  });

  var out =
    "/*\n" +
    " * 【這個檔案是產生出來的，不要手改】\n" +
    " *\n" +
    " * 來源：img/  ·  產生方式：node tools/build-icon-manifest.js\n" +
    " * 新增或替換素材請改 img/ 裡的檔案再重跑，然後把 img/ 與這個檔案一起 commit。\n" +
    " *\n" +
    " * 圖以 data URI 內嵌而不是相對路徑：file:// 下用相對路徑的圖會讓 canvas 變成\n" +
    " * tainted，匯出時 toDataURL() 會丟 SecurityError。\n" +
    " *\n" +
    " * type 一律是 \"icon\"（反白套橘/紅、未選轉灰）。廠商 LOGO 要保持原色的話，\n" +
    " * 把該筆的 type 改成 \"logo\"——但那就要手改這個檔案，重跑會被蓋掉，\n" +
    " * 所以 LOGO 建議走每一格的「⬆ 上傳」。\n" +
    " */\n" +
    "window.ICON_LIBRARY = [\n" +
    entries.map(function (e) { return e.code; }).join("\n") +
    "\n];\n";

  fs.writeFileSync(OUT_FILE, out, "utf8");

  var totalBytes = entries.reduce(function (s, e) { return s + e.bytes; }, 0);
  console.log("寫入 " + path.relative(ROOT, OUT_FILE));
  console.log(
    entries.length + " 個素材 · 原始 " + (totalBytes / 1024).toFixed(1) + "KB · " +
    "產出 " + (Buffer.byteLength(out) / 1024).toFixed(1) + "KB"
  );
  entries.forEach(function (e) {
    console.log("  " + e.id.padEnd(22) + " ← " + e.file);
  });
}

main();
