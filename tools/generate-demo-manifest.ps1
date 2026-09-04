<#
.SYNOPSIS
  從「測試工單與圖片」產生 Demo 匯入索引。
.DESCRIPTION
  資料夾必須剛好有一份 .xlsx/.xls 試算表；所有常見圖片格式都會納入 manifest。
  靜態 GitHub 網頁不能列出目錄，替換 Demo 素材後請在專案根目錄執行：
    powershell -ExecutionPolicy Bypass -File .\tools\generate-demo-manifest.ps1
#>
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$folder=Join-Path $projectRoot '測試工單與圖片'
if(-not (Test-Path -LiteralPath $folder -PathType Container)){throw "找不到 Demo 資料夾：$folder"}
$workbooks=@(Get-ChildItem -LiteralPath $folder -File | Where-Object { $_.Extension -match '^\.xlsx?$' })
if($workbooks.Count -ne 1){throw "Demo 資料夾必須只有一份試算表；目前找到 $($workbooks.Count) 份。"}
$images=@(Get-ChildItem -LiteralPath $folder -File | Where-Object { $_.Extension -match '^\.(png|jpe?g|webp|gif|bmp)$' } | Sort-Object Name | ForEach-Object { $_.Name })
if(-not $images.Count){throw 'Demo 資料夾沒有可匯入的圖片。'}
$manifest=[ordered]@{version=1;workorder=$workbooks[0].Name;images=$images}
$out=Join-Path $folder 'demo-manifest.json'
[IO.File]::WriteAllText($out,($manifest | ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
Write-Output "已更新 $out：$($workbooks[0].Name)，$($images.Count) 張圖片。"