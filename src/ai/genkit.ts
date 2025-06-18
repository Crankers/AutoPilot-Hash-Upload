import {genkit} from 'genkit';

// Explicitly initialize Genkit without any AI plugins that require API keys
// if no specific AI models are intended to be used by the flows.
export const ai = genkit({
  plugins: [
    // Add any non-AI related Genkit plugins here if needed in the future.
    // For now, it's empty to avoid initializing AI services that require API keys.
  ],
  // No default model is configured if no AI plugin is active.
});
