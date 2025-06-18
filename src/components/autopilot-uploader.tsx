
"use client";

import { suggestRemediation } from "@/ai/flows/suggest-remediation";
import { UploadHashesToIntuneOutput } from "@/ai/flows/upload-to-intune-flow"; // Output type for API response
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, ClipboardPaste, FileText, Loader2, Sparkles, UploadCloud, XCircle, Tag } from "lucide-react";
import React, { useState, useCallback, DragEvent, ChangeEvent, useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


type UploadStage = 'idle' | 'uploading' | 'validationFailed' | 'success';
interface ValidationIssue {
  type: 'duplicate' | 'invalid_format' | 'max_count_exceeded' | 'empty' | 'general' | 'intune_submission';
  message: string;
  count?: number;
}

interface ConfirmationDetails {
  count: number;
  timestamp: string;
  groupTag: string;
  intuneMessage?: string; // For message from Intune flow
}

const MAX_HASHES = 1000;
const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const exampleGroupTags = ["FinanceDept", "ITSupport", "SalesTeam", "HRDepartment", "Engineering"];

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

  const [aiSuggestions, setAiSuggestions] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showAiDialog, setShowAiDialog] = useState(false);

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
    setAiSuggestions(null);
    setIsAiLoading(false);
    setShowAiDialog(false);
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
      if (hash.length < 10 && !hash.startsWith("VALID-")) { 
        if(hash !== "duplicate_hash_example" && hash !== "another_duplicate" && hash !== "invalid_hash_example") {
          issues.push({ type: 'invalid_format', message: `Hash "${hash}" has an invalid format.`, count: (issues.find(i => i.type === 'invalid_format')?.count || 0) + 1 });
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

    for (let i = 0; i <= 100; i += 10) {
      await new Promise(resolve => setTimeout(resolve, 50));
      setUploadProgress(i);
    }
    
    const clientValidationIssues = validateHashes(parsedInputHashes);
    setValidationIssues(clientValidationIssues);

    if (clientValidationIssues.length > 0) {
      const summary = clientValidationIssues.map(issue => `${issue.message}${issue.count ? ` (${issue.count} occurrences)` : ''}`).join(' ');
      setOverallValidationMessage(`Client-side validation failed: ${summary}`);
      setStage('validationFailed');
    } else {
      setOverallValidationMessage('Client-side validation passed.');
      setSubmissionStatusMessage('Submitting to Intune (simulated)...');
      try {
        const response = await fetch('/api/upload-to-intune', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceHashes: parsedInputHashes, groupTag: selectedGroupTag }),
        });

        const result = await response.json() as UploadHashesToIntuneOutput;

        if (response.ok && result.success) {
          setConfirmationDetails({
            count: result.processedCount || parsedInputHashes.length,
            timestamp: new Date().toLocaleString(),
            groupTag: selectedGroupTag,
            intuneMessage: result.message,
          });
          setOverallValidationMessage(result.message); // Display Intune success message
          setStage('success');
        } else {
           const errorMessage = result.message || (result as any).error || `Failed to submit to Intune. Status: ${response.status}`;
           setOverallValidationMessage(`Intune Submission Failed: ${errorMessage}`);
           setValidationIssues(prev => [...prev, { type: 'intune_submission', message: errorMessage }]);
           setStage('validationFailed');
           toast({
             variant: "destructive",
             title: "Intune Submission Error",
             description: errorMessage,
           });
        }
      } catch (error) {
        console.error("Intune submission API error:", error);
        const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred while contacting the submission service.";
        setOverallValidationMessage(`Intune Submission Error: ${errorMessage}`);
        setValidationIssues(prev => [...prev, { type: 'intune_submission', message: `Network or system error: ${errorMessage}` }]);
        setStage('validationFailed');
        toast({
          variant: "destructive",
          title: "Network/System Error",
          description: `Could not communicate with the Intune submission service: ${errorMessage}`,
        });
      }
    }
  }, [selectedGroupTag, toast, fileName]);


  const handleFileUploadError = () => {
    const fileUploadInput = document.getElementById('file-upload') as HTMLInputElement | null;
    if (fileUploadInput) {
        fileUploadInput.value = ""; 
    }
    setFileName(null); 
  };

  const processFile = (file: File) => {
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
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
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
  };

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
  }, [processInput, toast, selectedGroupTag]); 

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (selectedGroupTag) {
        setIsDraggingOver(true);
    }
  }, [selectedGroupTag]);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
  }, []);

  const handleProcessPasted = () => {
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
  };

  const handleGetAiSuggestions = async () => {
    if (!overallValidationMessage) return;
    setIsAiLoading(true);
    setAiSuggestions(null);
    setShowAiDialog(true);

    // Prepare a summary of issues for the AI
    let issuesForAI = overallValidationMessage;
    if (validationIssues.length > 0) {
        issuesForAI = "Validation issues found:\n" + validationIssues.map(issue => `- ${issue.message}${issue.count ? ` (${issue.count} occurrences)` : ''}`).join('\n');
    }

    try {
      const result = await suggestRemediation({ validationResults: issuesForAI });
      setAiSuggestions(result.suggestions);
    } catch (error) {
      console.error("AI suggestion error:", error);
      setAiSuggestions("Failed to get AI suggestions. Please try again later.");
      toast({
        variant: "destructive",
        title: "AI Error",
        description: "Could not fetch AI remediation suggestions.",
      });
    } finally {
      setIsAiLoading(false);
    }
  };
  
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
            {overallValidationMessage || "An unknown error occurred."}
            {validationIssues.length > 0 && (
                 <ul className="mt-2 list-disc list-inside space-y-1">
                 {validationIssues.map((issue, index) => (
                   <li key={index}>{issue.message}</li>
                 ))}
               </ul>
            )}
          </AlertDescription>
        </Alert>
        
      </CardContent>
      <CardFooter className="flex flex-col sm:flex-row justify-end gap-2">
        <Button variant="outline" onClick={resetState}>Try Again</Button>
        {(validationIssues.length > 0 || overallValidationMessage) && (
            <Button onClick={handleGetAiSuggestions} className="bg-accent hover:bg-accent/90 text-accent-foreground">
            <Sparkles className="mr-2 h-4 w-4" /> Get AI Remediation
            </Button>
        )}
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
            <p className="text-xs text-muted-foreground mt-2">This is a conceptual confirmation. In a real scenario, check Microsoft Intune for actual import status.</p>
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
            <li>Each hash should be on a new line.</li>
            <li>For AI Remediation, ensure your validation messages are descriptive.</li>
            <li>The Intune upload is currently a **simulated** process for prototyping.</li>
          </ul>
        </CardContent>
      </Card>

      {stage === 'idle' && renderIdleUI()}
      {stage === 'uploading' && renderUploadingUI()}
      {stage === 'validationFailed' && renderValidationFailedUI()}
      {stage === 'success' && renderSuccessUI()}

      <Dialog open={showAiDialog} onOpenChange={setShowAiDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center font-headline">
              <Sparkles className="mr-2 h-5 w-5 text-primary" />
              AI Remediation Suggestions
            </DialogTitle>
            <DialogDescription>
              Here are AI-powered suggestions based on the validation results.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 max-h-[60vh] overflow-y-auto">
            {isAiLoading && (
              <div className="flex items-center justify-center space-x-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground">Generating suggestions...</p>
              </div>
            )}
            {aiSuggestions && (
              <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap p-4 bg-muted/50 rounded-md">
                {aiSuggestions}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowAiDialog(false)} variant="outline">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
