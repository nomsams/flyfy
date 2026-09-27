# Packs original photos (folders men/ and women/) into 32x32 colour crops (centre / upper / tight),
# for tools/pack-faces.mjs and tools/data-headroom.mjs. Windows only: uses System.Drawing to decode
# JPEG/PNG/GIF. Usage:
#   powershell -File tools/pack-faces.ps1 -Src ..\man-woman-dataset\data -Out packs
#   node tools/pack-faces.mjs packs upper
param(
  [string]$Src = (Join-Path $PSScriptRoot '..\..\man-woman-dataset\data'),
  [string]$Out = (Join-Path $PSScriptRoot '..\packs')
)
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $Out | Out-Null
$src = (Resolve-Path $Src).Path
$out = (Resolve-Path $Out).Path
$size = 32
# crop variants: name, (w, h) -> (x0, y0, side)
$variants = @('center', 'upper', 'tight')
$streams = @{}
foreach ($v in $variants) { $streams[$v] = [System.IO.File]::Create((Join-Path $out "$v.rgb")) }
$labels = New-Object System.Collections.Generic.List[int]
$names = New-Object System.Collections.Generic.List[string]
$buf = New-Object byte[] ($size * $size * 3)
$ok = 0; $bad = 0
foreach ($pair in @(@('men', 0), @('women', 1))) {
  foreach ($f in (Get-ChildItem (Join-Path $src $pair[0]) -File | Sort-Object Name)) {
    try { $img = [System.Drawing.Image]::FromFile($f.FullName) } catch { $bad++; continue }
    try {
      $w = $img.Width; $h = $img.Height; $side = [Math]::Min($w, $h)
      foreach ($v in $variants) {
        if ($v -eq 'center') { $s = $side; $x0 = ($w - $s) / 2; $y0 = ($h - $s) / 2 }
        elseif ($v -eq 'upper') { $s = $side; $x0 = ($w - $s) / 2; $y0 = ($h - $s) * 0.2 }
        else { $s = [int]($side * 0.7); $x0 = ($w - $s) / 2; $y0 = [Math]::Max(0, ($h - $side) * 0.2 + ($side - $s) * 0.3) }
        $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
        $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $size, $size), [int]$x0, [int]$y0, [int]$s, [int]$s, [System.Drawing.GraphicsUnit]::Pixel)
        $g.Dispose()
        $data = $bmp.LockBits((New-Object System.Drawing.Rectangle 0, 0, $size, $size), 'ReadOnly', [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        for ($y = 0; $y -lt $size; $y++) {
          [System.Runtime.InteropServices.Marshal]::Copy([IntPtr]($data.Scan0.ToInt64() + $y * $data.Stride), $buf, $y * $size * 3, $size * 3)
        }
        $bmp.UnlockBits($data); $bmp.Dispose()
        $streams[$v].Write($buf, 0, $buf.Length)   # stored as B,G,R per pixel
      }
      $labels.Add($pair[1]); $names.Add($pair[0] + '/' + $f.Name); $ok++
    } catch { $bad++ } finally { $img.Dispose() }
    if ($ok % 250 -eq 0) { "$ok done" }
  }
}
foreach ($v in $variants) { $streams[$v].Close() }
@{ size = $size; channels = 'BGR'; count = $ok; labels = $labels.ToArray(); names = $names.ToArray() } | ConvertTo-Json -Compress | Set-Content -Encoding utf8 (Join-Path $out 'meta.json')
"packed $ok photos, $bad unreadable"
