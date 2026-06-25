# Semantic Shield — 打包 Firefox / Chrome / Edge 上架 zip
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Version = "1.4.5"
$OutDir = Join-Path $Root "release"

$RuntimeFiles = @(
  "browser-api.js", "i18n.js", "compliance.js", "blocklist-manager.js",
  "anti-nuisance.js", "unsubscribe-assistant.js", "content.js",
  "popup.html", "popup.js"
)

function Ensure-PngIcons {
  param([string]$IconsDir)
  Add-Type -AssemblyName System.Drawing
  $sizes = @(16, 32, 48, 96, 128)
  foreach ($size in $sizes) {
    $path = Join-Path $IconsDir "icon-$size.png"
    if (Test-Path $path) { continue }
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
    $pad = [math]::Max(1, [int]($size * 0.08))
    $w = $size - $pad * 2
    $h = $size - $pad * 2
    $cx = $size / 2.0
    $top = $pad + $h * 0.05
    $bottom = $pad + $h * 0.95
    $left = $pad + $w * 0.12
    $right = $pad + $w * 0.88
    $pts = @(
      [System.Drawing.PointF]::new($cx, $top),
      [System.Drawing.PointF]::new($right, $top + $h * 0.18),
      [System.Drawing.PointF]::new($right, $top + $h * 0.55),
      [System.Drawing.PointF]::new($cx, $bottom),
      [System.Drawing.PointF]::new($left, $top + $h * 0.55),
      [System.Drawing.PointF]::new($left, $top + $h * 0.18)
    )
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
      [System.Drawing.Point]::new($pad, $pad),
      [System.Drawing.Point]::new($size - $pad, $size - $pad),
      [System.Drawing.Color]::FromArgb(255, 37, 99, 235),
      [System.Drawing.Color]::FromArgb(255, 29, 78, 216)
    )
    $g.FillPolygon($brush, $pts)
    $checkW = $w * 0.35
    $checkH = $h * 0.22
    $cx2 = $cx - $w * 0.02
    $cy2 = $top + $h * 0.52
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([math]::Max(1.5, $size / 16.0))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($pen, $cx2 - $checkW * 0.35, $cy2, $cx2 - $checkW * 0.05, $cy2 + $checkH * 0.45)
    $g.DrawLine($pen, $cx2 - $checkW * 0.05, $cy2 + $checkH * 0.45, $cx2 + $checkW * 0.45, $cy2 - $checkH * 0.35)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $brush.Dispose(); $pen.Dispose()
  }
  Copy-Item (Join-Path $Root "icons\icon.svg") (Join-Path $IconsDir "icon.svg") -ErrorAction SilentlyContinue
}

function New-ExtensionZip {
  param(
    [string]$SourceDir,
    [string]$ZipPath
  )
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

  $sourceFull = (Resolve-Path $SourceDir).Path.TrimEnd('\')
  $zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem -Path $sourceFull -Recurse -File | ForEach-Object {
      $relative = $_.FullName.Substring($sourceFull.Length + 1)
      $entryName = $relative -replace '\\', '/'
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal
      )
    }
  } finally {
    $zip.Dispose()
  }
}

function Build-Package {
  param(
    [string]$Browser,
    [string]$ManifestFile,
    [string]$ZipName
  )
  $stage = Join-Path $env:TEMP "semantic-shield-$Browser-$Version"
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $stage "_locales\en") -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $stage "_locales\zh_CN") -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $stage "icons") -Force | Out-Null

  foreach ($f in $RuntimeFiles) {
    Copy-Item (Join-Path $Root $f) (Join-Path $stage $f)
  }
  Copy-Item (Join-Path $Root "_locales\en\messages.json") (Join-Path $stage "_locales\en\messages.json")
  Copy-Item (Join-Path $Root "_locales\zh_CN\messages.json") (Join-Path $stage "_locales\zh_CN\messages.json")
  Ensure-PngIcons -IconsDir (Join-Path $stage "icons")
  Copy-Item (Join-Path $PSScriptRoot $ManifestFile) (Join-Path $stage "manifest.json")

  $zipPath = Join-Path $OutDir $ZipName
  New-ExtensionZip -SourceDir $stage -ZipPath $zipPath
  Remove-Item $stage -Recurse -Force
  Write-Host "OK $ZipName"
}

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
Ensure-PngIcons -IconsDir (Join-Path $Root "icons")

Build-Package -Browser "firefox" -ManifestFile "manifest.firefox.json" -ZipName "semantic-shield-firefox-v$Version.zip"
Build-Package -Browser "chrome" -ManifestFile "manifest.chrome.json" -ZipName "semantic-shield-chrome-v$Version.zip"
Build-Package -Browser "edge"   -ManifestFile "manifest.edge.json"   -ZipName "semantic-shield-edge-v$Version.zip"

Write-Host "Done -> $OutDir"
