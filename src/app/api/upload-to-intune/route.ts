
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { uploadHashesToIntune, type UploadHashesToIntuneInput, type UploadHashesToIntuneOutput } from '@/ai/flows/upload-to-intune-flow';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as UploadHashesToIntuneInput;
    const { deviceHashes, groupTag } = body;

    if (!deviceHashes || !Array.isArray(deviceHashes) || !groupTag) {
      return NextResponse.json({ success: false, message: 'Missing deviceHashes or groupTag in request body.' }, { status: 400 });
    }

    // Call the Genkit flow
    // In a real scenario, you might add more error handling, logging, etc.
    // The uploadHashesToIntune flow itself is still a mock/conceptual implementation.
    const result: UploadHashesToIntuneOutput = await uploadHashesToIntune({ deviceHashes, groupTag });

    if (result.success) {
      return NextResponse.json(result, { status: 200 });
    } else {
      // If the flow indicates failure, but processed correctly, return its message.
      // Status 200 indicates the API route processed the request, flow handled business logic.
      // Or choose a 4xx/5xx if the flow's failure means a client/server error respectively.
      // For now, let's assume the flow's `success: false` is a business logic outcome.
      return NextResponse.json(result, { status: 200 });
    }
  } catch (error) {
    console.error('Error in /api/upload-to-intune:', error);
    let errorMessage = 'An unexpected error occurred during Intune submission.';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return NextResponse.json({ success: false, message: errorMessage, errorCount: (error as any).request?.deviceHashes?.length || 0 }, { status: 500 });
  }
}
