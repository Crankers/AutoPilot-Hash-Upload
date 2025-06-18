// src/ai/flows/suggest-remediation.ts
'use server';

/**
 * @fileOverview A remediation suggestion AI agent.
 *
 * - suggestRemediation - A function that handles the validation results and provides AI-powered suggestions.
 * - SuggestRemediationInput - The input type for the suggestRemediation function.
 * - SuggestRemediationOutput - The return type for the suggestRemediation function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SuggestRemediationInputSchema = z.object({
  validationResults: z.string().describe('The validation results from the autopilot device hashes upload.'),
});
export type SuggestRemediationInput = z.infer<typeof SuggestRemediationInputSchema>;

const SuggestRemediationOutputSchema = z.object({
  suggestions: z.string().describe('AI-powered suggestions for resolving issues based on the validation results.'),
});
export type SuggestRemediationOutput = z.infer<typeof SuggestRemediationOutputSchema>;

export async function suggestRemediation(input: SuggestRemediationInput): Promise<SuggestRemediationOutput> {
  return suggestRemediationFlow(input);
}

const prompt = ai.definePrompt({
  name: 'suggestRemediationPrompt',
  input: {schema: SuggestRemediationInputSchema},
  output: {schema: SuggestRemediationOutputSchema},
  prompt: `You are an AI assistant designed to provide remediation suggestions for autopilot device hash upload issues.

  Based on the following validation results, provide clear and actionable suggestions for resolving any identified issues:

  Validation Results:
  {{validationResults}}

  Suggestions: `,
});

const suggestRemediationFlow = ai.defineFlow(
  {
    name: 'suggestRemediationFlow',
    inputSchema: SuggestRemediationInputSchema,
    outputSchema: SuggestRemediationOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
