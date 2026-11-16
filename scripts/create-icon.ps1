# Geometric Z mark matching src/assets/zetty-mark.svg.
Add-Type -AssemblyName System.Drawing
$destination = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\build'))
[System.IO.Directory]::CreateDirectory($destination) | Out-Null

function New-ZettyBitmap([int]$size) {
    $bitmap = New-Object System.Drawing.Bitmap $size,$size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.ScaleTransform(($size / 256.0),($size / 256.0))
    $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tile.AddArc(5,5,108,108,180,90)
    $tile.AddArc(143,5,108,108,270,90)
    $tile.AddArc(143,143,108,108,0,90)
    $tile.AddArc(5,143,108,108,90,90)
    $tile.CloseFigure()
    $ink = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#23221f'))
    $orange = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#f27243'))
    $paper = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#f0ece2'))
    $outline = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(62,240,236,226)),1.5
    $graphics.FillPath($ink,$tile)
    $graphics.DrawPath($outline,$tile)
    $points = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF 66,73), (New-Object System.Drawing.PointF 190,73),
        (New-Object System.Drawing.PointF 190,98), (New-Object System.Drawing.PointF 111,157),
        (New-Object System.Drawing.PointF 183,157), (New-Object System.Drawing.PointF 183,188),
        (New-Object System.Drawing.PointF 56,188), (New-Object System.Drawing.PointF 56,163),
        (New-Object System.Drawing.PointF 135,104), (New-Object System.Drawing.PointF 66,104)
    )
    $graphics.FillPolygon($orange,$points)
    $graphics.FillEllipse($paper,186,42,20,20)
    $graphics.Dispose(); $tile.Dispose(); $ink.Dispose(); $orange.Dispose(); $paper.Dispose(); $outline.Dispose()
    return ,$bitmap
}

$preview = New-ZettyBitmap 512
$preview.Save((Join-Path $destination 'icon.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$preview.Dispose()
$sizes = @(16,20,24,32,40,48,64,128,256)
$images = New-Object 'System.Collections.Generic.List[byte[]]'
foreach ($size in $sizes) {
    $bitmap = New-ZettyBitmap $size
    $memory = New-Object System.IO.MemoryStream
    $bitmap.Save($memory,[System.Drawing.Imaging.ImageFormat]::Png)
    $images.Add($memory.ToArray())
    $memory.Dispose(); $bitmap.Dispose()
}
$file = [System.IO.File]::Create((Join-Path $destination 'icon.ico'))
$writer = New-Object System.IO.BinaryWriter($file)
$writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
    $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
    $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([UInt16]1); $writer.Write([UInt16]32)
    $writer.Write([UInt32]$images[$i].Length); $writer.Write([UInt32]$offset)
    $offset += $images[$i].Length
}
foreach ($bytes in $images) { $writer.Write($bytes) }
$writer.Dispose()
