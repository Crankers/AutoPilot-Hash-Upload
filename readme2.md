
# Collect Hardware Hash (No Admin - Download & Run Full Repo)

This PowerShell script attempts to download the entire `Invoke-GetHardwareHashWithoutAdmin` GitHub repository, extract it, and then run the script from the `PowerShell` subfolder. This ensures that if `oa3tool.exe` and `OA3.cfg` are included in the repository's `PowerShell` folder, they will be available to the script.

## Instructions:

1.  Open PowerShell (does not need to be as Administrator) on the target Windows device.
2.  Copy the script below.
3.  Paste the script into the PowerShell window and press Enter.
4.  The script will:
    *   Download the [Crankers/Invoke-GetHardwareHashWithoutAdmin](https://github.com/Crankers/Invoke-GetHardwareHashWithoutAdmin) repository as a ZIP file to your temporary directory.
    *   Extract the ZIP file.
    *   Navigate into the extracted `PowerShell` subfolder.
    *   Attempt to execute `Invoke-GetHardwareHashWithoutAdmin.ps1`.
5.  The hardware hash will be saved to a `hash.txt` file in your Downloads folder.
6.  **Troubleshooting:**
    *   If the script fails (e.g., because `oa3tool.exe` is still not found within the repository's `PowerShell` folder, or due to network/permission issues), you may need to manually ensure `oa3tool.exe` (typically part of the Windows Assessment and Deployment Kit - ADK) is available where the script expects it.
    *   PowerShell execution policies might also prevent script execution. You may need to adjust them (e.g., `Set-ExecutionPolicy RemoteSigned -Scope Process -Force`) or unblock the downloaded `.ps1` file manually if it's still present in the temp folder after a failed run.
    *   Ensure your PowerShell version is 5.0 or higher for `Expand-Archive` to work correctly.

## PowerShell Script:

```powershell
# Script to download the Crankers/Invoke-GetHardwareHashWithoutAdmin repository, unzip it, and run the script.

$repoOwner = "Crankers"
$repoName = "Invoke-GetHardwareHashWithoutAdmin"
$branch = "main"
$zipFileName = "${repoName}-${branch}.zip"
$extractedFolderName = "${repoName}-${branch}"
$scriptSubPath = "PowerShell" # The subfolder within the repo containing the script and its dependencies

$tempPath = $env:TEMP
$localZipPath = Join-Path -Path $tempPath -ChildPath $zipFileName
$extractionBase = Join-Path -Path $tempPath -ChildPath "" # Expand-Archive extracts to a folder named by zip inside this path
$extractedRepoPath = Join-Path -Path $extractionBase -ChildPath $extractedFolderName
$scriptExecutionDir = Join-Path -Path $extractedRepoPath -ChildPath $scriptSubPath
$scriptToRun = Join-Path -Path $scriptExecutionDir -ChildPath "Invoke-GetHardwareHashWithoutAdmin.ps1"

Write-Host "Starting process to get hardware hash..."
Write-Host "Temporary path for downloads/extraction: $tempPath"

# Cleanup previous attempts if they exist
if (Test-Path $localZipPath) {
    Write-Host "Removing old zip file: $localZipPath"
    Remove-Item $localZipPath -Force -ErrorAction SilentlyContinue
}
if (Test-Path $extractedRepoPath) {
    Write-Host "Removing old extracted folder: $extractedRepoPath"
    Remove-Item $extractedRepoPath -Recurse -Force -ErrorAction SilentlyContinue
}

$repoZipUrl = "https://github.com/${repoOwner}/${repoName}/archive/refs/heads/${branch}.zip"

Write-Host "Attempting to download repository ZIP from $repoZipUrl..."
try {
    Invoke-WebRequest -Uri $repoZipUrl -OutFile $localZipPath -UseBasicParsing -ErrorAction Stop
    Write-Host "Repository ZIP downloaded to $localZipPath"
} catch {
    Write-Error "Failed to download repository ZIP: $($_.Exception.Message)"
    Write-Error "Please ensure you have an internet connection and the URL is accessible."
    Write-Error "URL: $repoZipUrl"
    exit 1
}

Write-Host "Attempting to extract $localZipPath to $extractionBase..."
try {
    Expand-Archive -Path $localZipPath -DestinationPath $extractionBase -Force -ErrorAction Stop
    Write-Host "Successfully extracted. Expected repository folder: $extractedRepoPath"
} catch {
    Write-Error "Failed to extract repository ZIP: $($_.Exception.Message)"
    Write-Error "Ensure PowerShell version is 5.0 or higher for Expand-Archive, or that you have permissions to write to $tempPath."
    if (Test-Path $localZipPath) { Remove-Item $localZipPath -Force -ErrorAction SilentlyContinue }
    exit 1
}

if (-not (Test-Path $scriptToRun)) {
    Write-Error "Script Invoke-GetHardwareHashWithoutAdmin.ps1 not found at expected location: $scriptToRun"
    Write-Error "The repository structure might have changed, or the extraction was not as expected."
    if (Test-Path $localZipPath) { Remove-Item $localZipPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path $extractedRepoPath) { Remove-Item $extractedRepoPath -Recurse -Force -ErrorAction SilentlyContinue }
    exit 1
}

Write-Host "Changing location to $scriptExecutionDir"
try {
    Set-Location -Path $scriptExecutionDir -ErrorAction Stop
    Write-Host "Successfully changed location. Current directory: $(Get-Location)"
} catch {
    Write-Error "Failed to change directory to ${scriptExecutionDir}: $($_.Exception.Message)"
    if (Test-Path $localZipPath) { Remove-Item $localZipPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path $extractedRepoPath) { Remove-Item $extractedRepoPath -Recurse -Force -ErrorAction SilentlyContinue }
    exit 1
}

Write-Host "Attempting to execute $($scriptToRun) (it may take a moment)..."
Write-Host "This script relies on oa3tool.exe and OA3.cfg being in the same directory ($scriptExecutionDir)."
& .\Invoke-GetHardwareHashWithoutAdmin.ps1
```
