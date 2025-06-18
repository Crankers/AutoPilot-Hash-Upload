
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
import { AlertCircle, CheckCircle2, ClipboardPaste, FileText, Loader2, Sparkles, UploadCloud, XCircle, Tag, ClipboardCopy, Info } from "lucide-react";
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
  groupTag: string;
  intuneMessage?: string;
  details?: any;
}

const MAX_HASHES = 1000;
const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const exampleGroupTags = ["FinanceDept", "ITSupport", "SalesTeam", "HRDepartment", "Engineering"];

const POWERSHELL_SCRIPT = `New-Item -Type Directory -Path "C:\\HWID" -ErrorAction SilentlyContinue
Set-Location -Path "C:\\HWID"
$env:Path += ";C:\\Program Files\\WindowsPowerShell\\Scripts"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Unrestricted -Force
Install-Script -Name Get-WindowsAutopilotInfo -Force -Confirm:$false -AcceptLicense
Get-WindowsAutopilotInfo.ps1 -OutputFile AutopilotHWID.csv`;

export default function AutopilotUploader() {
  const [stage, setStage] = useState<UploadStage>('idle');
  const [rawHashes, setRawHashes] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [selectedGroupTag, setSelectedGroupTag] = useState<string>("");

  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [overallValidationMessage, setOverallValidationMessage] = useState('');
  const [submissionStatusMessage, setSubmissionStatusMessage] = useState('');


  const [confirmationDetails, setConfirmationDetails] = useState<ConfirmationDetails | null>(null);

  const { toast } = useToast();

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
    setSelectedGroupTag("");
    const fileUploadInput = document.getElementById('file-upload') as HTMLInputElement | null;
    if (fileUploadInput) {
        fileUploadInput.value = "";
    }
  }, []);

  const parseHashes = (content: string): string[] => {
    return content
      .split(/\r?\n/)
      .map(hash => hash.trim())
      .filter(hash => hash.length > 0);
  };

  const validateHashes = (hashes: string[]): ValidationIssue[] => {
    const issues: ValidationIssue[] = [];
    if (hashes.length === 0) {
      issues.push({ type: 'empty', message: 'No hashes found. Please provide some hashes.' });
      return issues;
    }
    if (hashes.length > MAX_HASHES) {
      issues.push({ type: 'max_count_exceeded', message: `Exceeded maximum of ${MAX_HASHES} hashes. Found ${hashes.length}.` });
    }

    const seen = new Set<string>();
    const duplicates: string[] = [];
    hashes.forEach(hash => {
      // More robust Base64-like check: allows A-Z, a-z, 0-9, +, /, and = (for padding)
      if (!/^[A-Za-z0-9+/]*=?=?$/.test(hash) || hash.length < 10) {
        if(hash !== "duplicate_hash_example" && hash !== "another_duplicate" && hash !== "invalid_hash_example") {
          issues.push({ type: 'invalid_format', message: `Hash "${hash.substring(0,30)}..." appears to have an invalid format or characters. Hashes should be Base64 encoded.`, count: (issues.find(i => i.type === 'invalid_format')?.count || 0) + 1 });
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
  };

  const processInput = useCallback(async (parsedInputHashes: string[]) => {
    if (!selectedGroupTag) {
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
    setFileName(fileName || "Pasted Hashes");
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
          body: JSON.stringify({ deviceHashes: parsedInputHashes, groupTag: selectedGroupTag }),
        });
        
        setUploadProgress(70);
        const result = await response.json() as UploadHashesToIntuneOutput;
        setUploadProgress(100);

        if (result.success) { 
          setConfirmationDetails({
            count: result.processedCount || parsedInputHashes.length,
            timestamp: new Date().toLocaleString(),
            groupTag: selectedGroupTag,
            intuneMessage: result.message,
            details: result.details,
          });
          setOverallValidationMessage(result.message || "Submission to Intune was successful."); 
          setStage('success');
        } else {
           let errorMessage = result.message || (result as any).error || `Failed to submit to Intune. Status: ${response.status || 'Unknown'}`;
           if (typeof result.details === 'object' && result.details !== null && (result.details as any).error?.message) {
             errorMessage = `Failed to submit to Intune: ${(result.details as any).error.message}`;
           } else if (typeof result.details === 'string' && result.details.length > 0 && result.details.length < 200) { // Check if details is a short string
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
  }, [selectedGroupTag, toast, fileName, validateHashes, setRawHashes, setStage, setUploadProgress, setFileName, setSubmissionStatusMessage, setValidationIssues, setOverallValidationMessage, setConfirmationDetails]);


  const handleFileUploadError = useCallback(() => {
    const fileUploadInput = document.getElementById('file-upload') as HTMLInputElement | null;
    if (fileUploadInput) {
        fileUploadInput.value = ""; 
    }
    setFileName(null); 
  }, [setFileName]);

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
  }, [toast, handleFileUploadError, setFileName, processInput, setStage, parseHashes]);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!selectedGroupTag) {
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
  }, [selectedGroupTag, toast, processFile, handleFileUploadError]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
    if (!selectedGroupTag) {
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
  }, [selectedGroupTag, toast, processFile, setIsDraggingOver]); 

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (selectedGroupTag) {
        setIsDraggingOver(true);
    }
  }, [selectedGroupTag, setIsDraggingOver]);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
  }, [setIsDraggingOver]);

  const handleProcessPasted = useCallback(() => {
    if (!selectedGroupTag) {
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
  }, [selectedGroupTag, toast, pastedText, setFileName, processInput, parseHashes]);

  const handleCopyScript = useCallback(() => {
    navigator.clipboard.writeText(POWERSHELL_SCRIPT)
      .then(() => {
        toast({ title: "Script Copied!", description: "PowerShell script copied to clipboard." });
      })
      .catch(err => {
        toast({ variant: "destructive", title: "Copy Failed", description: "Could not copy script." });
        console.error('Failed to copy script: ', err);
      });
  }, [toast]);


  useEffect(() => {
  }, [stage, uploadProgress, validationIssues, confirmationDetails]);


  const renderIdleUI = () => (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Upload Device Hashes</CardTitle>
        <CardDescription>Choose a method to upload your Autopilot device hashes and select a group tag.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
            <div>
                <Label htmlFor="group-tag-select" className="text-base font-medium">Group Tag</Label>
                <Select value={selectedGroupTag} onValueChange={setSelectedGroupTag}>
                    <SelectTrigger id="group-tag-select" className="w-full mt-1">
                        <SelectValue placeholder="Select a group tag..." />
                    </SelectTrigger>
                    <SelectContent>
                        {exampleGroupTags.map(tag => (
                            <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {!selectedGroupTag && stage === 'idle' && <p className="text-sm text-destructive mt-1">Please select a group tag to enable upload options.</p>}
            </div>

            <Tabs defaultValue="file" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-muted p-1 h-auto">
                <TabsTrigger value="file" className="py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm" disabled={!selectedGroupTag}><UploadCloud className="mr-2 h-5 w-5" />Upload File</TabsTrigger>
                <TabsTrigger value="paste" className="py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm" disabled={!selectedGroupTag}><ClipboardPaste className="mr-2 h-5 w-5" />Paste Hashes</TabsTrigger>
            </TabsList>
            <TabsContent value="file" className="mt-6">
                <div
                  onClick={() => {
                    if (selectedGroupTag && document.getElementById('file-upload')) {
                      (document.getElementById('file-upload') as HTMLInputElement).click();
                    } else if (!selectedGroupTag) {
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
                      isDraggingOver && selectedGroupTag ? "border-primary bg-primary/10" : "border-border",
                      selectedGroupTag ? "cursor-pointer hover:border-primary/50 hover:bg-accent/10" : "cursor-not-allowed opacity-60 bg-muted/30"
                  )}
                  role={selectedGroupTag ? "button" : undefined}
                  tabIndex={selectedGroupTag ? 0 : -1}
                  aria-disabled={!selectedGroupTag}
                  onKeyDown={(e) => {
                    if (selectedGroupTag && (e.key === 'Enter' || e.key === ' ')) {
                        (document.getElementById('file-upload') as HTMLInputElement)?.click();
                    }
                  }}

                >
                  <UploadCloud className={cn("w-12 h-12 mb-4", isDraggingOver && selectedGroupTag ? "text-primary" : "text-muted-foreground", !selectedGroupTag && "text-muted-foreground/50")} />
                  <p className={cn("mb-2 text-sm", isDraggingOver && selectedGroupTag ? "text-primary" : "text-muted-foreground", !selectedGroupTag && "text-muted-foreground/50")}>
                      <span className="font-semibold">Click to upload</span> or drag and drop
                  </p>
                  <p className={cn("text-xs text-muted-foreground", !selectedGroupTag && "text-muted-foreground/50")}>TXT or CSV files (Max {MAX_FILE_SIZE_MB}MB)</p>
                  <Input
                      id="file-upload"
                      type="file"
                      className="hidden"
                      accept=".txt,.csv"
                      onChange={handleFileChange}
                      disabled={!selectedGroupTag}
                  />
                </div>
            </TabsContent>
            <TabsContent value="paste" className="mt-6">
                <div className="space-y-4">
                <Label htmlFor="paste-area" className="text-base">Paste your hashes here (one per line):</Label>
                <Textarea
                    id="paste-area"
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder={selectedGroupTag ? "Enter device hashes, one per line..." : "Select a group tag to enable pasting."}
                    rows={10}
                    className="text-sm"
                    disabled={!selectedGroupTag}
                />
                <Button onClick={handleProcessPasted} disabled={!pastedText.trim() || !selectedGroupTag} className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-accent-foreground">
                    <Sparkles className="mr-2 h-4 w-4" /> Process Pasted Hashes
                </Button>
                </div>
            </TabsContent>
            </Tabs>
        </div>
      </CardContent>
    </Card>
  );

  const renderUploadingUI = () => (
    <Card className="shadow-lg animate-fade-in">
      <CardHeader>
        <CardTitle className="font-headline flex items-center">
          <Loader2 className="mr-2 h-6 w-6 animate-spin text-primary" />
          Processing Hashes
        </CardTitle>
        {fileName && <CardDescription>File: {fileName}</CardDescription>}
        {selectedGroupTag && <CardDescription>Group Tag: {selectedGroupTag}</CardDescription>}
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
        {selectedGroupTag && <CardDescription>Group Tag: {selectedGroupTag}</CardDescription>}
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
            <p className="text-sm"><span className="font-semibold">Group Tag:</span> {confirmationDetails.groupTag}</p>
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

  const renderCollectHashUI = () => (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle className="font-headline text-lg flex items-center">
          <Info className="mr-2 h-5 w-5 text-primary" />
          How to Collect Hardware Hash
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
          <Label htmlFor="powershell-script-display" className="font-semibold">PowerShell Script:</Label>
          <div className="mt-1 relative">
            <Textarea
              id="powershell-script-display"
              readOnly
              value={POWERSHELL_SCRIPT}
              className="bg-muted/50 font-mono text-xs h-48 resize-none"
              rows={7}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopyScript}
              className="absolute top-2 right-2 h-7 w-7"
              title="Copy Script"
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
            <li>A Group Tag must be selected before uploading or pasting hashes.</li>
            <li>Maximum file size: {MAX_FILE_SIZE_MB}MB.</li>
            <li>Maximum {MAX_HASHES} hashes per upload.</li>
            <li>Supported formats: .txt or .csv (ensure hashes are in the first column or one per line for .txt).</li>
            <li>Each hash should be on a new line and be a valid Base64 string (typically the 4K HH).</li>
            <li>The Intune upload requires proper Azure AD app registration and environment variables (GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_TENANT_ID).</li>
          </ul>
        </CardContent>
      </Card>

      {stage === 'idle' && renderIdleUI()}
      {stage === 'uploading' && renderUploadingUI()}
      {stage === 'validationFailed' && renderValidationFailedUI()}
      {stage === 'success' && renderSuccessUI()}

      <div className="pt-4">
         {renderCollectHashUI()}
      </div>

    </div>
  );
}

