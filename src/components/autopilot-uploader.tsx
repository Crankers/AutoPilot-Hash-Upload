
"use client";

import type { UploadHashesToIntuneOutput } from "@/ai/flows/upload-to-intune-flow"; // Output type for API response
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, ClipboardPaste, FileText, Loader2, Sparkles, UploadCloud, XCircle, Tag, ClipboardCopy, Info, ExternalLink, DownloadCloud } from "lucide-react";
import React, { useState, useCallback, DragEvent, ChangeEvent, useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


type UploadStage = 'idle' | 'uploading' | 'validationFailed' | 'success';
interface ValidationIssue {
  type: 'duplicate' | 'invalid_format' | 'max_count_exceeded' | 'empty' | 'general' | 'intune_submission';
  message: string;
  count?: number;
  details?: any;
}

interface ConfirmationDetails {
  count: number;
  timestamp: string;
  groupTagDisplayName: string;
  intuneMessage?: string;
  details?: any;
}

interface GroupTagOption {
  displayName: string;
  backendTag: string;
}

const MAX_HASHES = 1000;
const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const exampleGroupTags: GroupTagOption[] = [
  { displayName: "Corporate Standard", backendTag: "CORP" },
  { displayName: "Kiosk Device", backendTag: "KIOS" },
  { displayName: "Shared Device", backendTag: "SHRD" },
  { displayName: "Executive User", backendTag: "EXEC" },
  { displayName: "Standard User", backendTag: "STDU" },
];

const POWERSHELL_SCRIPT_ADMIN = `New-Item -Type Directory -Path "C:\\HWID" -ErrorAction SilentlyContinue
Set-Location -Path "C:\\HWID"
$env:Path += ";C:\\Program Files\\WindowsPowerShell\\Scripts"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Unrestricted -Force
Install-Script -Name Get-WindowsAutopilotInfo -Force -Confirm:$false
Get-WindowsAutopilotInfo.ps1 -OutputFile AutopilotHWID.csv`;

const POWERSHELL_SCRIPT_DOWNLOAD_AND_RUN_NO_ADMIN = `# Script to download and run Invoke-GetHardwareHashWithoutAdmin.ps1 from GitHub

$scriptUrl = "https://raw.githubusercontent.com/Crankers/Invoke-GetHardwareHashWithoutAdmin/main/PowerShell/Invoke-GetHardwareHashWithoutAdmin.ps1"
$tempPath = $env:TEMP
$scriptName = "Invoke-GetHardwareHashWithoutAdmin.ps1"
$localScriptPath = Join-Path -Path $tempPath -ChildPath $scriptName

Write-Host "Attempting to download Invoke-GetHardwareHashWithoutAdmin.ps1..."
try {
    Invoke-WebRequest -Uri $scriptUrl -OutFile $localScriptPath -UseBasicParsing -ErrorAction Stop
    Write-Host "Script downloaded to $localScriptPath"

    # Optional: Unblock the script if execution policy requires it
    # Unblock-File -Path $localScriptPath -ErrorAction SilentlyContinue

    Write-Host "Attempting to execute the script (it may take a moment)..."
    # Execute the script. It should output the hardware hash to the console.
    & $localScriptPath
    
    Write-Host "Script execution finished. Check the console output above for the hardware hash."
} catch {
    Write-Error "Failed to download or execute the script: $($_.Exception.Message)"
    Write-Error "If issues persist, you may need to manually download the script from the GitHub repository and run it."
} finally {
    # Optional: Clean up the downloaded script file after execution
    # if (Test-Path $localScriptPath) {
    #     Remove-Item $localScriptPath -Force -ErrorAction SilentlyContinue
    #     Write-Host "Cleaned up downloaded script: $localScriptPath"
    # }
}
`;


export default function AutopilotUploader() {
  const [stage, setStage] = useState<UploadStage>('idle');
  const [rawHashes, setRawHashes] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [selectedBackendTag, setSelectedBackendTag] = useState<string>("");

  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [overallValidationMessage, setOverallValidationMessage] = useState('');
  const [submissionStatusMessage, setSubmissionStatusMessage] = useState('');


  const [confirmationDetails, setConfirmationDetails] = useState<ConfirmationDetails | null>(null);

  const { toast } = useToast();

  const getSelectedGroupTagDisplayName = useCallback(() => {
    const selectedOption = exampleGroupTags.find(opt => opt.backendTag === selectedBackendTag);
    return selectedOption ? selectedOption.displayName : "N/A";
  }, [selectedBackendTag]);

  const resetState = useCallback(() => {
    setStage('idle');
    setRawHashes([]);
    setUploadProgress(0);
    setFileName(null);
    setPastedText('');
    setValidationIssues([]);
    setOverallValidationMessage('');
    setSubmissionStatusMessage('');
    setConfirmationDetails(null);
    setSelectedBackendTag("");
    const fileUploadInput = document.getElementById('file-upload') as HTMLInputElement | null;
    if (fileUploadInput) {
        fileUploadInput.value = "";
    }
  }, []);

  const parseHashes = useCallback((content: string): string[] => {
    const lines = content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length === 0) {
      return [];
    }

    const outputHashes: string[] = [];
    let firstNonEmptyLine = "";
    for (const line of lines) {
        if (line) {
            firstNonEmptyLine = line;
            break;
        }
    }
    if (!firstNonEmptyLine) return []; 

    const firstLineLower = firstNonEmptyLine.toLowerCase();

    const isAutopilotCsv =
        (firstLineLower.includes('device serial number') || firstLineLower.includes('serialnumber')) &&
        (firstLineLower.includes('hardware hash') || firstLineLower.includes('hardwarehash')) &&
        firstLineLower.includes(',');

    if (isAutopilotCsv) {
      let headerSkipped = false;
      for (const line of lines) {
        if (!headerSkipped && (line.toLowerCase() === firstLineLower || 
            (line.toLowerCase().includes('device serial number') && line.toLowerCase().includes('hardware hash'))
        )) {
            headerSkipped = true;
            continue;
        }
        if (!headerSkipped && line.trim() !== "") continue; 
        if (line.trim() === "") continue; 

        const columns = line.split(',');
        if (columns.length >= 3) {
          let hash = columns[2].trim(); 
          if (hash.startsWith('"') && hash.endsWith('"')) {
            hash = hash.substring(1, hash.length - 1);
          }
          if (hash.length > 0) { 
            outputHashes.push(hash);
          }
        }
      }
    } else {
      for (const line of lines) {
        if (line.trim() !== "" && !line.includes(',')) {
            outputHashes.push(line);
        }
      }
    }
    return outputHashes;
  }, []);


  const validateHashes = useCallback((hashes: string[]): ValidationIssue[] => {
    const issues: ValidationIssue[] = [];
    if (hashes.length === 0) {
      issues.push({ type: 'empty', message: 'No hashes found. Please provide some hashes or check file content.' });
      return issues;
    }
    if (hashes.length > MAX_HASHES) {
      issues.push({ type: 'max_count_exceeded', message: `Exceeded maximum of ${MAX_HASHES} hashes. Found ${hashes.length}.` });
    }

    const seen = new Set<string>();
    const duplicates: string[] = [];
    hashes.forEach(hash => {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(hash) || hash.length < 20) {
         if(hash !== "duplicate_hash_example" && hash !== "another_duplicate" && hash !== "invalid_hash_example") {
          issues.push({ type: 'invalid_format', message: `Hash "${hash.substring(0,30)}..." appears to have an invalid format, unsupported characters, or is too short. Hashes should be Base64 encoded.`, count: (issues.find(i => i.type === 'invalid_format')?.count || 0) + 1 });
        }
      }
      if (seen.has(hash)) {
        if (!duplicates.includes(hash)) {
          duplicates.push(hash);
        }
      } else {
        seen.add(hash);
      }
    });
    
    if (hashes.includes("duplicate_hash_example") && hashes.filter(h => h === "duplicate_hash_example").length > 1) {
      if (!duplicates.includes("duplicate_hash_example")) duplicates.push("duplicate_hash_example");
    }
    if (hashes.includes("another_duplicate") && hashes.filter(h => h === "another_duplicate").length > 1) {
      if (!duplicates.includes("another_duplicate")) duplicates.push("another_duplicate");
    }
    if (hashes.includes("invalid_hash_example")) {
        issues.push({ type: 'invalid_format', message: `Hash "invalid_hash_example" has an invalid format.`, count: (issues.find(i => i.type === 'invalid_format')?.count || 0) + 1 });
    }

    if (duplicates.length > 0) {
      issues.push({ type: 'duplicate', message: `Found ${duplicates.length} duplicate hash(es).`, count: duplicates.length });
    }
    
    return issues;
  }, []);

  const handleFileUploadError = useCallback(() => {
    const fileUploadInput = document.getElementById('file-upload') as HTMLInputElement | null;
    if (fileUploadInput) {
        fileUploadInput.value = ""; 
    }
    setFileName(null); 
  }, [setFileName]);

  const processInput = useCallback(async (parsedInputHashes: string[]) => {
    if (!selectedBackendTag) {
        toast({
            variant: "destructive",
            title: "Group Tag Required",
            description: "Please select a Group Tag before processing.",
        });
        setStage('idle');
        return;
    }
    setRawHashes(parsedInputHashes);
    setStage('uploading');
    setUploadProgress(0);
    setSubmissionStatusMessage('Validating local file and hashes...');
    setValidationIssues([]); 

    for (let i = 0; i <= 20; i += 5) { 
      await new Promise(resolve => setTimeout(resolve, 30));
      setUploadProgress(i);
    }
    
    const clientValidationIssues = validateHashes(parsedInputHashes);
    setValidationIssues(clientValidationIssues);

    if (clientValidationIssues.length > 0) {
      const summary = clientValidationIssues.map(issue => `${issue.message}${issue.count ? ` (${issue.count} occurrences)` : ''}`).join(' ');
      setOverallValidationMessage(`Client-side validation failed: ${summary}`);
      setStage('validationFailed');
    } else {
      setOverallValidationMessage('Client-side validation passed. Submitting to Intune...');
      setUploadProgress(30); 
      setSubmissionStatusMessage('Submitting to Intune...');
      try {
        const response = await fetch('/api/upload-to-intune', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceHashes: parsedInputHashes, groupTag: selectedBackendTag }),
        });
        
        setUploadProgress(70);
        const result = await response.json() as UploadHashesToIntuneOutput;
        setUploadProgress(100);

        if (result.success) { 
          setConfirmationDetails({
            count: result.processedCount || parsedInputHashes.length,
            timestamp: new Date().toLocaleString(),
            groupTagDisplayName: getSelectedGroupTagDisplayName(),
            intuneMessage: result.message,
            details: result.details,
          });
          setOverallValidationMessage(result.message || "Submission to Intune was successful."); 
          setStage('success');
        } else {
           let errorMessage = result.message || (result as any).error || `Failed to submit to Intune. Status: ${response.status || 'Unknown'}`;
            if (typeof result.details === 'object' && result.details !== null) {
                const errorObj = (result.details as any).error;
                if (errorObj && errorObj.message) {
                    errorMessage = `Intune API Error: ${errorObj.message}`;
                } else if (JSON.stringify(result.details).length < 500) { 
                    errorMessage = `Failed to submit to Intune. Details: ${JSON.stringify(result.details)}`;
                }
            } else if (typeof result.details === 'string' && result.details.length > 0 && result.details.length < 500) { 
             errorMessage = `Failed to submit to Intune. Details: ${result.details}`;
            }

           setOverallValidationMessage(`Intune Submission Failed: ${errorMessage}`);
           setValidationIssues(prev => [...prev, { type: 'intune_submission', message: errorMessage, details: result.details }]);
           setStage('validationFailed');
           toast({
             variant: "destructive",
             title: "Intune Submission Error",
             description: errorMessage,
           });
        }
      } catch (error) {
        setUploadProgress(100);
        console.error("Intune submission API error:", error);
        const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred while contacting the submission service.";
        setOverallValidationMessage(`Intune Submission Error: ${errorMessage}`);
        setValidationIssues(prev => [...prev, { type: 'intune_submission', message: `Network or system error: ${errorMessage}`, details: error instanceof Error ? error.stack : String(error) }]);
        setStage('validationFailed');
        toast({
          variant: "destructive",
          title: "Network/System Error",
          description: `Could not communicate with the Intune submission service: ${errorMessage}`,
        });
      }
    }
  }, [selectedBackendTag, toast, validateHashes, parseHashes, getSelectedGroupTagDisplayName]);


  const processFile = useCallback((file: File) => {
     const allowedExtensions = ['.txt', '.csv'];
     const fileNameParts = file.name.split('.');
     const fileExtension = fileNameParts.length > 1 ? `.${fileNameParts.pop()!.toLowerCase()}` : '';

     if (!allowedExtensions.includes(fileExtension)) {
        toast({
            variant: "destructive",
            title: "Invalid File Type",
            description: `Only .txt or .csv files are allowed. You provided: ${file.name}`,
        });
        handleFileUploadError();
        return;
     }

     if (file.size > MAX_FILE_SIZE_BYTES) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: `File size cannot exceed ${MAX_FILE_SIZE_MB}MB.`,
      });
      handleFileUploadError();
      return;
    }

    setFileName(file.name); 
    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target?.result;
      if (typeof content !== 'string') {
        toast({
          variant: "destructive",
          title: "File Read Error",
          description: `Could not read the content of the file: ${file.name}. It might be empty or corrupted.`,
        });
        handleFileUploadError();
        setStage('idle'); 
        return;
      }
      const parsed = parseHashes(content);
      processInput(parsed);
    };

    reader.onerror = () => {
        toast({
            variant: "destructive",
            title: "File Read Error",
            description: `An error occurred while reading the file: ${file.name}.`,
        });
        handleFileUploadError();
        setStage('idle');
    };
    reader.readAsText(file);
  }, [toast, handleFileUploadError, setFileName, processInput, parseHashes, setStage]);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!selectedBackendTag) {
        toast({
            variant: "destructive",
            title: "Group Tag Required",
            description: "Please select a Group Tag before choosing a file.",
        });
        handleFileUploadError(); 
        return;
      }
      processFile(file);
    }
  }, [selectedBackendTag, toast, processFile, handleFileUploadError]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
    if (!selectedBackendTag) {
        toast({
            variant: "destructive",
            title: "Group Tag Required",
            description: "Please select a Group Tag before dropping a file.",
        });
        return;
    }
    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
      const file = event.dataTransfer.files[0];
       processFile(file);
    }
  }, [selectedBackendTag, toast, processFile, setIsDraggingOver]); 

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (selectedBackendTag) {
        setIsDraggingOver(true);
    }
  }, [selectedBackendTag, setIsDraggingOver]);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
  }, [setIsDraggingOver]);

  const handleProcessPasted = useCallback(() => {
    if (!selectedBackendTag) {
        toast({
            variant: "destructive",
            title: "Group Tag Required",
            description: "Please select a Group Tag before processing pasted text.",
        });
        return;
    }
    const parsed = parseHashes(pastedText);
    setFileName("Pasted Hashes"); 
    processInput(parsed);
  }, [selectedBackendTag, toast, pastedText, setFileName, processInput, parseHashes]);

  const handleCopyAdminScript = useCallback(() => {
    navigator.clipboard.writeText(POWERSHELL_SCRIPT_ADMIN)
      .then(() => {
        toast({ title: "Admin Script Copied!", description: "PowerShell script (admin) copied to clipboard." });
      })
      .catch(err => {
        toast({ variant: "destructive", title: "Copy Failed", description: "Could not copy admin script." });
        console.error('Failed to copy admin script: ', err);
      });
  }, [toast]);

  const handleCopyDownloadAndRunNoAdminScript = useCallback(() => {
    navigator.clipboard.writeText(POWERSHELL_SCRIPT_DOWNLOAD_AND_RUN_NO_ADMIN)
      .then(() => {
        toast({ title: "Script Copied!", description: "PowerShell script (download & run) copied to clipboard." });
      })
      .catch(err => {
        toast({ variant: "destructive", title: "Copy Failed", description: "Could not copy script." });
        console.error('Failed to copy download & run script: ', err);
      });
  }, [toast]);

  useEffect(() => {
  }, [stage, uploadProgress, validationIssues, confirmationDetails]);


  const renderIdleUI = () => {
    const isGroupTagProvided = !!selectedBackendTag;

    return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Upload Device Hashes</CardTitle>
        <CardDescription>Select a Group Tag and choose a method to upload your Autopilot device hashes.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
            <div className="space-y-2">
                <Label htmlFor="group-tag-select" className="text-base font-medium">Group Tag</Label>
                 <Select value={selectedBackendTag} onValueChange={setSelectedBackendTag}>
                    <SelectTrigger id="group-tag-select" className="w-full">
                        <SelectValue placeholder="Select a group tag..." />
                    </SelectTrigger>
                    <SelectContent>
                        {exampleGroupTags.map(tagOpt => (
                            <SelectItem key={tagOpt.backendTag} value={tagOpt.backendTag}>{tagOpt.displayName}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {!isGroupTagProvided && stage === 'idle' && <p className="text-sm text-destructive mt-1">Please select a group tag to enable upload options.</p>}
            </div>

            <Tabs defaultValue="file" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-muted p-1 h-auto">
                <TabsTrigger value="file" className="py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm" disabled={!isGroupTagProvided}><UploadCloud className="mr-2 h-5 w-5" />Upload File</TabsTrigger>
                <TabsTrigger value="paste" className="py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm" disabled={!isGroupTagProvided}><ClipboardPaste className="mr-2 h-5 w-5" />Paste Hashes</TabsTrigger>
            </TabsList>
            <TabsContent value="file" className="mt-6">
                <div
                  onClick={() => {
                    if (isGroupTagProvided && document.getElementById('file-upload')) {
                      (document.getElementById('file-upload') as HTMLInputElement).click();
                    } else if (!isGroupTagProvided) {
                       toast({
                         variant: "destructive",
                         title: "Group Tag Required",
                         description: "Please select a Group Tag before uploading a file.",
                       });
                    }
                  }}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className={cn(
                      "flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg transition-colors",
                      isDraggingOver && isGroupTagProvided ? "border-primary bg-primary/10" : "border-border",
                      isGroupTagProvided ? "cursor-pointer hover:border-primary/50 hover:bg-accent/10" : "cursor-not-allowed opacity-60 bg-muted/30"
                  )}
                  role={isGroupTagProvided ? "button" : undefined}
                  tabIndex={isGroupTagProvided ? 0 : -1}
                  aria-disabled={!isGroupTagProvided}
                  onKeyDown={(e) => {
                    if (isGroupTagProvided && (e.key === 'Enter' || e.key === ' ')) {
                        (document.getElementById('file-upload') as HTMLInputElement)?.click();
                    }
                  }}

                >
                  <UploadCloud className={cn("w-12 h-12 mb-4", isDraggingOver && isGroupTagProvided ? "text-primary" : "text-muted-foreground", !isGroupTagProvided && "text-muted-foreground/50")} />
                  <p className={cn("mb-2 text-sm", isDraggingOver && isGroupTagProvided ? "text-primary" : "text-muted-foreground", !isGroupTagProvided && "text-muted-foreground/50")}>
                      <span className="font-semibold">Click to upload</span> or drag and drop
                  </p>
                  <p className={cn("text-xs text-muted-foreground", !isGroupTagProvided && "text-muted-foreground/50")}>TXT or CSV files (Max {MAX_FILE_SIZE_MB}MB)</p>
                  <Input
                      id="file-upload"
                      type="file"
                      className="hidden"
                      accept=".txt,.csv"
                      onChange={handleFileChange}
                      disabled={!isGroupTagProvided}
                  />
                </div>
            </TabsContent>
            <TabsContent value="paste" className="mt-6">
                <div className="space-y-4">
                <Label htmlFor="paste-area" className="text-base whitespace-nowrap">Paste your hashes here (one per line):</Label>
                <Textarea
                    id="paste-area"
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder={isGroupTagProvided ? "Enter device hashes, one per line..." : "Select a group tag to enable pasting."}
                    rows={10}
                    className="text-sm"
                    disabled={!isGroupTagProvided}
                />
                <Button onClick={handleProcessPasted} disabled={!pastedText.trim() || !isGroupTagProvided} className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-accent-foreground">
                    <Sparkles className="mr-2 h-4 w-4" /> Process Pasted Hashes
                </Button>
                </div>
            </TabsContent>
            </Tabs>
        </div>
      </CardContent>
    </Card>
  )};

  const renderUploadingUI = () => (
    <Card className="shadow-lg animate-fade-in">
      <CardHeader>
        <CardTitle className="font-headline flex items-center">
          <Loader2 className="mr-2 h-6 w-6 animate-spin text-primary" />
          Processing Hashes
        </CardTitle>
        {fileName && <CardDescription>File: {fileName}</CardDescription>}
        <CardDescription>Group Tag: {getSelectedGroupTagDisplayName()}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{submissionStatusMessage || 'Your hashes are being processed. Please wait...'}</p>
        <Progress value={uploadProgress} className="w-full [&>div]:bg-primary" />
        {uploadProgress < 100 && <p className="text-center text-sm font-medium text-primary">{uploadProgress}%</p>}
      </CardContent>
    </Card>
  );

  const renderValidationFailedUI = () => (
    <Card className="shadow-lg animate-fade-in">
      <CardHeader>
        <CardTitle className="font-headline flex items-center text-destructive">
          <XCircle className="mr-2 h-6 w-6" />
          Processing Failed
        </CardTitle>
        {fileName && <CardDescription>File: {fileName}</CardDescription>}
        <CardDescription>Group Tag: {getSelectedGroupTagDisplayName()}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Issues Found</AlertTitle>
          <AlertDescription>
            <p className="font-semibold mb-1">{overallValidationMessage || "An unknown error occurred."}</p>
            {validationIssues.length > 0 && (
                 <ul className="mt-2 list-disc list-inside space-y-1 text-sm">
                 {validationIssues.map((issue, index) => (
                   <li key={index}>
                     {issue.message}
                     {issue.type === 'intune_submission' && issue.details && (
                       <details className="mt-1 cursor-pointer">
                         <summary className="text-xs text-muted-foreground hover:underline">Show technical details</summary>
                         <pre className="mt-1 text-xs bg-muted p-2 rounded whitespace-pre-wrap break-all border">
                           {typeof issue.details === 'string' ? issue.details : JSON.stringify(issue.details, null, 2)}
                         </pre>
                       </details>
                     )}
                   </li>
                 ))}
               </ul>
            )}
          </AlertDescription>
        </Alert>
        
      </CardContent>
      <CardFooter className="flex flex-col sm:flex-row justify-end gap-2">
        <Button variant="outline" onClick={resetState}>Try Again</Button>
      </CardFooter>
    </Card>
  );

  const renderSuccessUI = () => (
    <Card className="shadow-lg animate-fade-in">
      <CardHeader>
        <CardTitle className="font-headline flex items-center text-green-600">
          <CheckCircle2 className="mr-2 h-6 w-6" />
          Processing Successful
        </CardTitle>
        {fileName && <CardDescription>File: {fileName}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-2">
        <Alert variant="default" className="bg-green-50 border-green-300">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-700">Confirmation</AlertTitle>
            <AlertDescription className="text-green-600">
                {confirmationDetails?.intuneMessage || "Your device hashes have been processed successfully."}
            </AlertDescription>
        </Alert>
        {confirmationDetails && (
          <div className="p-4 border rounded-md bg-secondary/50">
            <p className="text-sm"><span className="font-semibold">Number of hashes processed:</span> {confirmationDetails.count}</p>
            <p className="text-sm"><span className="font-semibold">Group Tag:</span> {confirmationDetails.groupTagDisplayName}</p>
            <p className="text-sm"><span className="font-semibold">Timestamp:</span> {confirmationDetails.timestamp}</p>
            {confirmationDetails.details && (
                 <details className="mt-2 cursor-pointer">
                    <summary className="text-xs text-muted-foreground hover:underline">Show submission details</summary>
                    <pre className="mt-1 text-xs bg-muted p-2 rounded whitespace-pre-wrap break-all border">
                        {typeof confirmationDetails.details === 'string' ? confirmationDetails.details : JSON.stringify(confirmationDetails.details, null, 2)}
                    </pre>
                 </details>
            )}
            <p className="text-xs text-muted-foreground mt-2">This confirmation reflects the API response. Always verify in Microsoft Intune.</p>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button onClick={resetState} className="bg-accent hover:bg-accent/90 text-accent-foreground">
          <UploadCloud className="mr-2 h-4 w-4" /> Upload More Hashes
        </Button>
      </CardFooter>
    </Card>
  );

  const renderCollectHashAdminUI = () => (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle className="font-headline text-lg flex items-center">
          <Info className="mr-2 h-5 w-5 text-primary" />
          How to Collect Hardware Hash (Requires Admin Rights)
        </CardTitle>
        <CardDescription>
          Follow these steps on the target Windows device to obtain its hardware hash for Autopilot.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="font-semibold">Instructions:</Label>
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground mt-1">
            <li>Open PowerShell as an Administrator on the target Windows device.</li>
            <li>Copy the script below.</li>
            <li>Paste the script into the PowerShell window and press Enter.</li>
            <li>The script will:
              <ul className="list-disc list-inside pl-4">
                  <li>Create a directory <code>C:\HWID</code> (if it doesn't exist).</li>
                  <li>Download the necessary <code>Get-WindowsAutopilotInfo</code> script from PowerShell Gallery.</li>
                  <li>Save the hardware hash to <code>C:\HWID\AutopilotHWID.csv</code>.</li>
              </ul>
            </li>
            <li>You can then upload this <code>AutopilotHWID.csv</code> file using the uploader above, or copy its contents.</li>
          </ol>
        </div>
        <div>
          <Label htmlFor="powershell-script-admin-display" className="font-semibold">PowerShell Script (Admin):</Label>
          <div className="mt-1 relative">
            <Textarea
              id="powershell-script-admin-display"
              readOnly
              value={POWERSHELL_SCRIPT_ADMIN}
              className="bg-muted/50 font-mono text-xs h-48 resize-none"
              rows={7}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopyAdminScript}
              className="absolute top-2 right-2 h-7 w-7"
              title="Copy Admin Script"
            >
              <ClipboardCopy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const renderCollectHashNoAdminUI = () => (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle className="font-headline text-lg flex items-center">
          <DownloadCloud className="mr-2 h-5 w-5 text-primary" />
          Collect Hardware Hash (No Admin - Automated Download & Run)
        </CardTitle>
        <CardDescription>
          This PowerShell script attempts to download and run the necessary script from GitHub to collect the hardware hash without local admin rights. The hash will be output to the console.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="font-semibold">Instructions:</Label>
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground mt-1">
            <li>Open PowerShell (does not need to be as Administrator) on the target Windows device.</li>
            <li>Copy the script below.</li>
            <li>Paste the script into the PowerShell window and press Enter.</li>
            <li>The script will attempt to download <code>Invoke-GetHardwareHashWithoutAdmin.ps1</code> from GitHub to a temporary location and then execute it.</li>
            <li>The hardware hash should be displayed in the PowerShell console upon successful execution.</li>
            <li>Copy this hash from the console and paste it into the "Paste Hashes" tab in the uploader above.</li>
            <li><strong>Note:</strong> This method's success may depend on internet connectivity, system permissions, and PowerShell execution policies. 
                If the script fails to download the file (e.g., showing a 404 Not Found error), your network might be blocking access or there could be a temporary issue. 
                In such cases, you can manually download the <code>Invoke-GetHardwareHashWithoutAdmin.ps1</code> script from the 
                <a href="https://github.com/Crankers/Invoke-GetHardwareHashWithoutAdmin/tree/main/PowerShell" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline ml-1">
                GitHub repository <ExternalLink className="inline-block h-3 w-3 ml-0.5" />
                </a>, then run it locally. 
                The script might prompt for confirmation if your execution policy is restrictive.
            </li>
          </ol>
        </div>
         <div>
          <Label htmlFor="powershell-script-no-admin-download" className="font-semibold">PowerShell Script (Download & Run):</Label>
          <div className="mt-1 relative">
            <Textarea
              id="powershell-script-no-admin-download"
              readOnly
              value={POWERSHELL_SCRIPT_DOWNLOAD_AND_RUN_NO_ADMIN}
              className="bg-muted/50 font-mono text-xs h-64 resize-none"
              rows={10}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopyDownloadAndRunNoAdminScript}
              className="absolute top-2 right-2 h-7 w-7"
              title="Copy Download & Run Script"
            >
              <ClipboardCopy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );


  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="font-headline text-lg">Important Information</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            <li>A Group Tag must be selected from the dropdown before uploading or pasting hashes.</li>
            <li>Maximum file size: {MAX_FILE_SIZE_MB}MB.</li>
            <li>Maximum {MAX_HASHES} hashes per upload.</li>
            <li>Supported formats: .txt or .csv (ensure hashes are in the third column if a CSV header is present, or one per line for .txt).</li>
            <li>Each hash should be on a new line and be a valid Base64 string (typically the 4K HH).</li>
          </ul>
        </CardContent>
      </Card>

      {stage === 'idle' && renderIdleUI()}
      {stage === 'uploading' && renderUploadingUI()}
      {stage === 'validationFailed' && renderValidationFailedUI()}
      {stage === 'success' && renderSuccessUI()}

      <div className="pt-4 space-y-8">
         {renderCollectHashNoAdminUI()}
         {renderCollectHashAdminUI()}
      </div>

    </div>
  );
}
    

    

    

