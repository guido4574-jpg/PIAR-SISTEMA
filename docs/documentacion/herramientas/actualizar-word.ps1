# Abre ENTREGABLE_FINAL_PIAR.docx con Microsoft Word, actualiza la tabla de contenido y los campos,
# lo guarda (sigue siendo .docx editable) y, opcionalmente, exporta un PDF de revisión.
# Uso: powershell -File actualizar-word.ps1 [-Pdf <ruta del PDF de revisión>]
param([string]$Pdf = "")
$ErrorActionPreference = 'Stop'
$docx = Join-Path (Split-Path $PSScriptRoot -Parent) 'ENTREGABLE_FINAL_PIAR.docx'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
    $doc = $word.Documents.Open($docx, $false, $false, $false)
    if ($doc.CompatibilityMode -lt 15) { $doc.SetCompatibilityMode(15) }
    foreach ($toc in $doc.TablesOfContents) { $toc.Update() }
    $null = $doc.Fields.Update()
    $doc.Repaginate()
    $paginas = $doc.ComputeStatistics(2)
    "Páginas: $paginas | Palabras: $($doc.ComputeStatistics(0)) | Tablas: $($doc.Tables.Count) | Imágenes: $($doc.InlineShapes.Count) | Secciones: $($doc.Sections.Count) | Tablas de contenido: $($doc.TablesOfContents.Count) | Entradas del índice: $($doc.TablesOfContents(1).Range.Paragraphs.Count)"
    "Idioma del texto: $($doc.Content.LanguageID) (9226 = español de Colombia) | Errores ortográficos señalados por Word: $($doc.SpellingErrors.Count)"
    $doc.Save()
    if ($Pdf) { $doc.ExportAsFixedFormat($Pdf, 17); "PDF de revisión: $Pdf" }
    $doc.Close($false)
} finally {
    try { $word.Quit() } catch { }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
# Word guarda entradas de carpeta en el ZIP; se reescribe el paquete sin ellas (algunos servicios de coedición las rechazan).
$py = Join-Path $env:TEMP 'piar-docx-sin-carpetas.py'
@'
import sys, zipfile, os
src = sys.argv[1]; tmp = src + ".tmp"
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        if not item.filename.endswith("/"):
            zout.writestr(item, zin.read(item.filename))
os.replace(tmp, src)
'@ | Set-Content -Path $py -Encoding utf8
python -I $py $docx
if ($LASTEXITCODE -ne 0) { throw "No se pudo reescribir el paquete DOCX." }
"Paquete DOCX reescrito sin entradas de carpeta."
