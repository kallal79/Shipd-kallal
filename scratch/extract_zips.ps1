$dest1 = 'C:\Users\USER\OneDrive\Desktop\JAGAN\extracted_monsha'
$dest2 = 'C:\Users\USER\OneDrive\Desktop\JAGAN\extracted_callback'

$zip1 = 'C:\Users\USER\OneDrive\Desktop\JAGAN\agent-runs - KALI - MONSHA.zip'
$zip2 = 'C:\Users\USER\OneDrive\Desktop\JAGAN\agent-runs-CLLBACK-AGENT FINQL ONE...zip'

if (!(Test-Path $dest1)) {
    Write-Host "Extracting $zip1 to $dest1..."
    Expand-Archive -Path $zip1 -DestinationPath $dest1 -Force
    Write-Host "Extracted monsha!"
}

if (!(Test-Path $dest2)) {
    Write-Host "Extracting $zip2 to $dest2..."
    Expand-Archive -Path $zip2 -DestinationPath $dest2 -Force
    Write-Host "Extracted callback!"
}

Write-Host "Done!"
