
'use server';
/**
 * @fileOverview Flow for uploading device hashes to Microsoft Intune Autopilot.
 *
 * - uploadHashesToIntune - A function to handle the device hash upload process to Intune.
 * - UploadHashesToIntuneInput - The input type for the uploadHashesToIntune function.
 * - UploadHashesToIntuneOutput - The return type for the uploadHashesToIntune function.
 *
 * IMPORTANT: This flow attempts real integration with Microsoft Intune.
 * It requires an Azure AD App Registration with appropriate Graph API permissions
 * (e.g., DeviceManagementServiceConfig.ReadWrite.All or DeviceManagementManagedDevices.ReadWrite.All)
 * and the following environment variables to be set:
 * - GRAPH_CLIENT_ID: Your Azure AD App's Client ID.
 * - GRAPH_CLIENT_SECRET: Your Azure AD App's Client Secret.
 * - GRAPH_TENANT_ID: Your Azure AD Tenant ID.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const UploadHashesToIntuneInputSchema = z.object({
  deviceHashes: z.array(z.string()).describe('A list of device hardware hashes. These should be the 4K HH / PKID, typically Base64 encoded.'),
  groupTag: z.string().describe('The Autopilot group tag to assign to the devices.'),
});
export type UploadHashesToIntuneInput = z.infer<typeof UploadHashesToIntuneInputSchema>;

const UploadHashesToIntuneOutputSchema = z.object({
  success: z.boolean().describe('Whether the upload to Intune was successful or initiated successfully.'),
  message: z.string().describe('A message detailing the outcome of the upload attempt.'),
  processedCount: z.number().optional().describe('Number of hashes attempted to process.'),
  errorCount: z.number().optional().describe('Number of hashes that failed based on API response (if applicable).'),
  details: z.any().optional().describe('Additional details or error information from the API call.'),
});
export type UploadHashesToIntuneOutput = z.infer<typeof UploadHashesToIntuneOutputSchema>;

// Helper function to get Microsoft Graph API access token
async function getGraphApiToken(clientId: string, clientSecret: string, tenantId: string): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('scope', 'https://graph.microsoft.com/.default');
  params.append('client_secret', clientSecret);
  params.append('grant_type', 'client_credentials');

  const response = await fetch(tokenUrl, {
    method: 'POST',
    body: params,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Failed to obtain Graph API token: ${response.status} ${response.statusText} - ${errorData}`);
  }

  const tokenData = await response.json();
  return tokenData.access_token;
}

export async function uploadHashesToIntune(input: UploadHashesToIntuneInput): Promise<UploadHashesToIntuneOutput> {
  return uploadHashesToIntuneFlow(input);
}

const uploadHashesToIntuneFlow = ai.defineFlow(
  {
    name: 'uploadHashesToIntuneFlow',
    inputSchema: UploadHashesToIntuneInputSchema,
    outputSchema: UploadHashesToIntuneOutputSchema,
  },
  async (input) => {
    const { deviceHashes, groupTag } = input;
    const clientId = process.env.GRAPH_CLIENT_ID;
    const clientSecret = process.env.GRAPH_CLIENT_SECRET;
    const tenantId = process.env.GRAPH_TENANT_ID;

    if (!clientId || !clientSecret || !tenantId) {
      return {
        success: false,
        message: 'Azure AD client credentials (GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_TENANT_ID) are not configured in environment variables.',
        errorCount: deviceHashes.length,
        processedCount: 0,
      };
    }

    if (!deviceHashes || deviceHashes.length === 0) {
      return {
        success: false,
        message: 'No device hashes provided for Intune upload.',
        errorCount: 0,
        processedCount: 0,
      };
    }

    try {
      const accessToken = await getGraphApiToken(clientId, clientSecret, tenantId);

      const devicesToImport = deviceHashes.map((hash, index) => ({
        '@odata.type': '#microsoft.graph.importedWindowsAutopilotDeviceIdentity',
        groupTag: groupTag,
        hardwareIdentifier: hash, 
        serialNumber: `SERIAL_${hash.substring(0, 10)}_${index}`, 
        productKey: '', 
      }));

      const importUrl = 'https://graph.microsoft.com/v1.0/deviceManagement/importedWindowsAutopilotDeviceIdentities/import';
      
      const importResponse = await fetch(importUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          importedWindowsAutopilotDeviceIdentities: devicesToImport,
        }),
      });

      if (importResponse.ok) {
        let responseData;
        try {
            responseData = await importResponse.json();
        } catch (e) {
            responseData = await importResponse.text(); 
        }

        let successfulImports = 0;
        let failedImports = 0;
        let responseMessage = "";
        const individualErrorMessages: string[] = [];

        if (importResponse.status === 202) {
            responseMessage = `Successfully submitted ${devicesToImport.length} devices for asynchronous import to Intune with group tag "${groupTag}". Check Intune for status.`;
            successfulImports = devicesToImport.length;
        } else if (responseData.value && Array.isArray(responseData.value)) {
            // This logic assumes responseData.value contains results for each device if status is 200, 201 or 207
            // For 200/201, items in .value are typically successful imports.
            // For 207, items in .value could be mixed results (e.g. importedDeviceIdentityResult)
            responseData.value.forEach((item: any) => {
                if (importResponse.status === 207) { // Multi-Status
                    if (item.importStatus === true || (item.error == null && item.id != null)) { // Check for positive import status or lack of error
                        successfulImports++;
                    } else {
                        failedImports++;
                        if (item.error) individualErrorMessages.push(`Device ${item.hardwareIdentifier || 'unknown'}: ${item.error}`);
                        else individualErrorMessages.push(`Device ${item.hardwareIdentifier || 'unknown'}: Failed with unknown error in multi-status response.`);
                    }
                } else { // For 200/201, assume item in value is a success unless it explicitly has an error property
                    if (item.error) {
                         failedImports++;
                         let itemErrorMsg = (typeof item.error === 'string') ? item.error : (item.error.message || 'Unknown item error');
                         individualErrorMessages.push(`Device ${item.hardwareIdentifier || item.id || 'unknown'}: ${itemErrorMsg}`);
                    } else {
                        successfulImports++;
                    }
                }
            });
            
            if (failedImports > 0) {
                responseMessage = `Import to Intune for group tag "${groupTag}": ${successfulImports} succeeded, ${failedImports} failed.`;
                if(individualErrorMessages.length > 0) responseMessage += " Specific errors: " + individualErrorMessages.join("; ");
            } else if (successfulImports > 0) {
                responseMessage = `Successfully imported ${successfulImports} devices to Intune with group tag "${groupTag}".`;
            } else if (devicesToImport.length > 0) {
                 responseMessage = `Attempted to import ${devicesToImport.length} devices. Intune response did not confirm successful import for any.`;
                 failedImports = devicesToImport.length; // Mark all as failed if no positive confirmation
            } else {
                responseMessage = "No devices were processed.";
            }

        } else { // Non-array response for 2xx, or empty value array
             if(devicesToImport.length > 0 && successfulImports === 0 && failedImports === 0) {
                // If no items were parsed from responseData.value but it was a 2xx
                successfulImports = devicesToImport.length; // Assume all ok if 2xx and no specific errors reported
                responseMessage = `Successfully imported ${devicesToImport.length} devices to Intune with group tag "${groupTag}". (Response format not fully parsed for details)`;
             } else if (devicesToImport.length === 0) {
                responseMessage = "No devices were processed.";
             }
        }
        
        return {
          success: failedImports === 0 && (successfulImports > 0 || devicesToImport.length === 0), // Success if no failures and at least one import (or no devices to import)
          message: responseMessage,
          processedCount: successfulImports,
          errorCount: failedImports,
          details: responseData,
        };

      } else { // importResponse NOT ok (4xx, 5xx errors)
        const errorData = await importResponse.json().catch(() => importResponse.text());
        console.error('Intune Import API Error:', errorData);
        let detailedMessage = `Failed to import devices to Intune: ${importResponse.status} ${importResponse.statusText}.`;
        
        if (typeof errorData === 'object' && errorData !== null && errorData.error && errorData.error.message) {
          detailedMessage += ` Details: ${errorData.error.message}`;
        } else if (typeof errorData === 'string' && errorData.length > 0 && errorData.length < 500) { // Avoid overly long string details here
          detailedMessage += ` Response: ${errorData}`;
        } else if (typeof errorData === 'object' && errorData !== null) {
            // Try to get a general message if error.message is not present
            const genericError = JSON.stringify(errorData).substring(0, 200); // Cap length
            detailedMessage += ` Raw error: ${genericError}...`;
        }

        return {
          success: false,
          message: detailedMessage,
          processedCount: 0,
          errorCount: deviceHashes.length,
          details: errorData, // Pass full error data for frontend display
        };
      }
    } catch (error: any) {
      console.error('Error in uploadHashesToIntuneFlow:', error);
      let errorMessage = `An unexpected error occurred: ${error.message}`;
      if (error.cause) { // Fetch API often includes original error in cause
        errorMessage += ` Caused by: ${error.cause}`;
      }
      return {
        success: false,
        message: errorMessage,
        errorCount: deviceHashes.length,
        processedCount: 0,
        details: error.toString(),
      };
    }
  }
);
