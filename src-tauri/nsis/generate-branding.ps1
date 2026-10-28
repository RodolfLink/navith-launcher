$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outputDirectory = $PSScriptRoot
$logoPath = Join-Path $PSScriptRoot '../../public/navithlabs-logo.png'
$logo = [System.Drawing.Image]::FromFile([System.IO.Path]::GetFullPath($logoPath))

function New-InstallerBitmap([int]$width, [int]$height) {
  $bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  return @($bitmap, $graphics)
}

$headerData = New-InstallerBitmap 150 57
$headerBitmap = $headerData[0]
$headerGraphics = $headerData[1]
$headerRect = [System.Drawing.Rectangle]::new(0, 0, 150, 57)
$headerBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  $headerRect,
  [System.Drawing.Color]::FromArgb(8, 10, 24),
  [System.Drawing.Color]::FromArgb(22, 18, 39),
  0
)
$headerGraphics.FillRectangle($headerBrush, $headerRect)
$headerGraphics.FillRectangle([System.Drawing.Brushes]::Crimson, 0, 0, 3, 57)
$headerGraphics.DrawImage($logo, [System.Drawing.Rectangle]::new(7, 11, 136, 35))
$headerBitmap.Save((Join-Path $outputDirectory 'header.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$headerBrush.Dispose()
$headerGraphics.Dispose()
$headerBitmap.Dispose()

$sidebarData = New-InstallerBitmap 164 314
$sidebarBitmap = $sidebarData[0]
$sidebarGraphics = $sidebarData[1]
$sidebarRect = [System.Drawing.Rectangle]::new(0, 0, 164, 314)
$sidebarBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  $sidebarRect,
  [System.Drawing.Color]::FromArgb(14, 17, 38),
  [System.Drawing.Color]::FromArgb(8, 10, 23),
  90
)
$sidebarGraphics.FillRectangle($sidebarBrush, $sidebarRect)
$sidebarGraphics.FillRectangle([System.Drawing.Brushes]::Crimson, 0, 0, 3, 314)

$gridPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(15, 155, 165, 210), 1)
for ($x = 18; $x -lt 164; $x += 22) { $sidebarGraphics.DrawLine($gridPen, $x, 0, $x, 314) }
for ($y = 12; $y -lt 314; $y += 22) { $sidebarGraphics.DrawLine($gridPen, 0, $y, 164, $y) }

$sidebarGraphics.DrawImage($logo, [System.Drawing.Rectangle]::new(10, 19, 144, 35))
$dividerPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(110, 113, 132, 170), 1)
$sidebarGraphics.DrawLine($dividerPen, 14, 69, 150, 69)

$orbitPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(75, 241, 59, 86), 1)
$sidebarGraphics.DrawEllipse($orbitPen, 42, 83, 80, 62)
$orbitPen.Dispose()
$orbitPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(55, 112, 119, 222), 1)
$sidebarGraphics.DrawEllipse($orbitPen, 31, 91, 102, 47)
$orbitPen.Dispose()

$logoMarkSource = [System.Drawing.Rectangle]::new(296, 9, 76, 77)
$logoMarkDestination = [System.Drawing.Rectangle]::new(57, 84, 50, 51)
$sidebarGraphics.DrawImage($logo, $logoMarkDestination, $logoMarkSource, [System.Drawing.GraphicsUnit]::Pixel)

$redBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 241, 59, 86))
$brightBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 245, 246, 251))
$mutedBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 159, 166, 193))
$softPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(95, 241, 59, 86), 1)
$sidebarGraphics.DrawLine($softPen, 16, 155, 148, 155)

$labelFont = [System.Drawing.Font]::new('Segoe UI', 6.5, [System.Drawing.FontStyle]::Bold)
$headingFont = [System.Drawing.Font]::new('Segoe UI Semibold', 13, [System.Drawing.FontStyle]::Regular)
$bodyFont = [System.Drawing.Font]::new('Segoe UI', 8, [System.Drawing.FontStyle]::Regular)
$tinyFont = [System.Drawing.Font]::new('Segoe UI', 6, [System.Drawing.FontStyle]::Regular)
$sidebarGraphics.DrawString('NAVITHLABS  /  MINECRAFT JAVA', $labelFont, $redBrush, 15, 166)
$sidebarGraphics.DrawString('Tu siguiente', $headingFont, $brightBrush, 15, 185)
$sidebarGraphics.DrawString('aventura', $headingFont, $brightBrush, 15, 204)
$sidebarGraphics.DrawString(('empieza aqu' + [char]0x00ED + '.'), $headingFont, $redBrush, 15, 223)
$sidebarGraphics.DrawString('Instala NavithLabs Launcher', $bodyFont, $mutedBrush, 15, 255)
$sidebarGraphics.DrawString('y prepara tu próximo evento.', $bodyFont, $mutedBrush, 15, 268)
$sidebarGraphics.DrawLine($dividerPen, 14, 291, 150, 291)
$sidebarGraphics.DrawString('NAVITH.LABS  ·  EVENT LAUNCHER', $tinyFont, $mutedBrush, 15, 298)

$sidebarBitmap.Save((Join-Path $outputDirectory 'sidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)

foreach ($resource in @($logo, $sidebarBrush, $gridPen, $dividerPen, $redBrush, $brightBrush, $mutedBrush, $softPen, $labelFont, $headingFont, $bodyFont, $tinyFont, $sidebarGraphics, $sidebarBitmap)) {
  if ($null -ne $resource) { $resource.Dispose() }
}
