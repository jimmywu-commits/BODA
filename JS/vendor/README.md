# Browser dependencies

These files keep the versions previously loaded by BODA from cdnjs. They load
on demand through `JS/dependency-loader.js`; no CDN request is required.

| Package | Version | Source | SHA-256 |
| --- | --- | --- | --- |
| ExcelJS | 4.4.0 | https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js | `7e49da68588e250dbb8bba190d2caa8ab3787cc0284bda1d8b2f805c4df742c9` |
| html-to-image | 1.11.13 | https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.13/html-to-image.min.js | `d45d4becd261376cfffb9550ce27e0a86e83bfb29f03b22d3d8d90327f6a1bc7` |
| JSZip | 3.10.1 | Existing `shopee/js/vendor/jszip.min.js`, same cdnjs version | `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e` |
| Konva | 9.3.22 | https://unpkg.com/konva@9.3.22/konva.min.js | `4655b6cd12d0d2ee5f6d461fa98c3611b1f9979b9106f18221bf0e6a90ab6745` |
| SheetJS | 0.18.5 | https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js | `c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99` |
| CropperJS script | 1.6.2 | https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.js | `6290a3fa581b17ccf4692cf3ec617a74ae65de88d9140c72d492ae9b47707efb` |
| CropperJS stylesheet | 1.6.2 | https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.css | `23679f552ce73499f817de22b5dcdd9e1e5a1e50cd9d77e34bbd31bf65a85186` |

Absorbed the previous floating `konva@9` response on 2026-11-11: its header
identified 9.3.22. The pinned file above is that exact version, not a major upgrade.
Bottom uses `browser-loader.js`: Konva is required before canvas mounting;
SheetJS and Cropper remain first-use only. Each tries its local asset first and
uses the exact-version URL above only if local loading fails. Cropper waits for
both script and stylesheet; concurrent loads share a Promise and failures retry.
Keep `konva-LICENSE.txt` (MIT), `xlsx-LICENSE.txt` (Apache-2.0), and
`cropper-LICENSE.txt` (MIT) beside these assets. No headers were stripped.

Keep the corresponding `*-LICENSE.txt` files when redistributing. ExcelJS and
html-to-image license text came from each pinned npm package via jsDelivr;
JSZip's existing bundled license also documents its included dependencies.

When updating, verify the version, replace the artifact and license together,
and update the loader release key and this table. Do not load an unversioned
URL or use a timestamp on ordinary requests.
