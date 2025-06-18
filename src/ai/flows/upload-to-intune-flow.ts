
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
      };
    }

    if (!deviceHashes || deviceHashes.length === 0) {
      return {
        success: false,
        message: 'No device hashes provided for Intune upload.',
        errorCount: 0,
      };
    }

    try {
      const accessToken = await getGraphApiToken(clientId, clientSecret, tenantId);

      const devicesToImport = deviceHashes.map((hash, index) => ({
        '@odata.type': '#microsoft.graph.importedWindowsAutopilotDeviceIdentity',
        groupTag: groupTag,
        hardwareIdentifier: hash, // Assuming the hash is already in the correct Base64 format from Get-WindowsAutopilotInfo
        // SerialNumber is required by the API. Generate a placeholder if not provided.
        // In a real scenario, you might want to include actual serial numbers in the input.
        serialNumber: `SERIAL_${hash.substring(0, 10)}_${index}`, 
        productKey: '', // Often empty
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
        // The import API might return 202 Accepted for async processing,
        // or 200/201 with a list of successfully imported/updated devices or import job details.
        // For simplicity, we'll treat any 2xx as a successful initiation.
        // A robust implementation would handle polling for status if 202 is returned.
        let responseData;
        try {
            responseData = await importResponse.json();
        } catch (e) {
            responseData = await importResponse.text(); // if not json
        }

        // Check if the response contains information about failures
        // This is a simplified check; the actual response structure for partial failures can be complex (e.g., 207 Multi-Status)
        let successfulImports = devicesToImport.length;
        let failedImports = 0;
        let message = `Successfully initiated import of ${devicesToImport.length} devices to Intune with group tag "${groupTag}".`;

        if (importResponse.status === 200 || importResponse.status === 201) {
             // If API returns array of created/updated objects, `responseData.value` might exist
            if (Array.isArray(responseData.value)) {
                successfulImports = responseData.value.filter((item: any) => !item.error).length;
                failedImports = devicesToImport.length - successfulImports;
                if (failedImports > 0) {
                    message = `Import attempt to Intune for group tag "${groupTag}": ${successfulImports} succeeded, ${failedImports} failed. Check details.`;
                } else {
                     message = `Successfully imported ${successfulImports} devices to Intune with group tag "${groupTag}".`;
                }
            }
        }


        return {
          success: true,
          message: message,
          processedCount: devicesToImport.length,
          errorCount: failedImports,
          details: responseData,
        };
      } else {
        const errorData = await importResponse.json().catch(() => importResponse.text());
        console.error('Intune Import API Error:', errorData);
        return {
          success: false,
          message: `Failed to import devices to Intune: ${importResponse.status} ${importResponse.statusText}.`,
          errorCount: deviceHashes.length,
          details: errorData,
        };
      }
    } catch (error: any) {
      console.error('Error in uploadHashesToIntuneFlow:', error);
      return {
        success: false,
        message: `An unexpected error occurred: ${error.message}`,
        errorCount: deviceHashes.length,
        details: error.toString(),
      };
    }
  }
);
