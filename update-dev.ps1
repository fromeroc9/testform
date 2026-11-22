$destModule = "C:\Users\flavi\AppData\Roaming\npm\node_modules\@fromeroc9\testform"
$item = Get-Item $destModule -ErrorAction SilentlyContinue

if ($item -and ($item.LinkType -eq "Junction" -or $item.LinkType -eq "SymbolicLink")) {
    Write-Host "Testform ya está enlazado directamente a este repositorio con npm link." -ForegroundColor Green
    Write-Host "Target: $($item.Target)" -ForegroundColor DarkGray
    Write-Host "Cualquier 'npm run build' actualiza el CLI global en tiempo real sin necesidad de copiar." -ForegroundColor Cyan
} else {
    Copy-Item "C:\Users\flavi\Desktop\repositorio\testform\dist\index.js" "$destModule\dist\index.js" -Force
    Write-Host "Archivo copiado con éxito a la instalación global." -ForegroundColor Green
}
