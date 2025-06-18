import {genkit} from 'genkit';
// import {googleAI} from '@genkit-ai/googleai'; // Removed googleAI plugin

export const ai = genkit({
  plugins: [
    // googleAI() // Removed googleAI plugin
  ],
  // model: 'googleai/gemini-2.0-flash', // Model configuration removed as no default AI plugin
});
