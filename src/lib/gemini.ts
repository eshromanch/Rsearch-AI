
import Bottleneck from "bottleneck";
import { CoreApiResponse } from "@/types/core";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";

interface IntentResult {
  intent: 'search' | 'specific_paper' | 'explain' | 'follow-up' | 'clarification';
  confidence: number;
}



const genAI = new GoogleGenerativeAI(`AIzaSyDTKR5z-BPjz4d3lxfiTYlu-84ITkKyYPI`);

const generationConfig = {
  temperature: 0.7,
  topP: 0.9,
  topK: 32,
  maxOutputTokens: 4096,
};

const generationConfigForDetect = {
  temperature: 0.7,
  topP: 0.9,
  topK: 32,
  maxOutputTokens: 2096,
};

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

// Rate limiters for different models
const limiterFlashLite = new Bottleneck({
  minTime: 4000, // 15 RPM (60/15 = 4 req/sec)
  maxConcurrent: 1,
  reservoir: 15,
  reservoirRefreshAmount: 15,
  reservoirRefreshInterval: 60000, // Refresh every 60 seconds
});

const limiterFlash = new Bottleneck({
  minTime: 4000, // 15 RPM (60/15 = 4 req/sec)
  maxConcurrent: 1,
  reservoir: 15,
  reservoirRefreshAmount: 15,
  reservoirRefreshInterval: 60000, // Refresh every 60 seconds
});

// Track daily quota usage
let dailyQuotaUsed = 0;
const DAILY_QUOTA_LIMIT = 1500; // Daily limit for both models

const checkDailyQuota = () => {
  if (dailyQuotaUsed >= DAILY_QUOTA_LIMIT) {
    throw new Error("Daily quota exhausted. Please try again tomorrow.");
  }
};

// Retry mechanism with exponential backoff
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const retryWithExponentialBackoff = async <T>(
  fn: () => Promise<T>,
  retries: number = 3,
  initialDelay: number = 1000
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 429 && retries > 0) {
      const delayTime = initialDelay * 2 ** (3 - retries); // Exponential backoff
      console.log(`Rate limit exceeded. Retrying in ${delayTime}ms...`);
      await delay(delayTime);
      return retryWithExponentialBackoff(fn, retries - 1, initialDelay);
    } else {
      throw error;
    }
  }
};

// Function to wrap API calls with rate limiting and quota tracking
const limitedCall = <T>(
  limiter: Bottleneck,
  fn: (...args: unknown[]) => Promise<T>,
  ...args: unknown[]
): Promise<T> => {
  checkDailyQuota();
  return limiter.schedule(async () => {
    try {
      const result = await retryWithExponentialBackoff(() => fn(...args));
      dailyQuotaUsed++;
      return result;
    } catch (error) {
      // Type guard to check if error is an object with a `code` property
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 429) {
        console.error("Rate limit exceeded. Please try again later.");
      } else if (error instanceof Error) {
        // Narrow the type of error to `Error` before accessing `error.message`
        console.error("An error occurred:", error.message);
      } else {
        // Handle cases where the error is not an Error object
        console.error("An unknown error occurred:", error);
      }
      throw error;
    }
  });
};

export const detectIntent = async (input: string, conversationHistory: string[]): Promise<'search' | 'specific_paper' | 'explain' | 'follow-up'> => {
  return limitedCall(limiterFlashLite, async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: generationConfigForDetect, safetySettings });
    const prompt = `Classify the user's intent into one of the following categories: search, specific_paper, explain, or follow-up. Return only the category name.
    
    Conversation History:
    ${conversationHistory.join('\n')}
    
    User Input: ${input}
    Intent:`;

    const result = await model.generateContent(prompt);
    return (await result.response.text()).trim() as 'search' | 'specific_paper' | 'explain' | 'follow-up';
  });
};

export const detectIntentWithConfidence = async (
  input: string,
  conversationHistory: string[]
): Promise<IntentResult[]> => {
  return limitedCall(limiterFlashLite, async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: generationConfigForDetect, safetySettings });
    const prompt = `Classify the user's intent into one or more of the following categories: search, specific_paper, explain, follow-up, or clarification. For each intent, provide a confidence score between 0 and 1. Return the results as a JSON array.
    
    Conversation History:
    ${conversationHistory.join('\n')}
    
    User Input: ${input}
    Intents:`;

    const result = await model.generateContent(prompt);
    const intents = JSON.parse(await result.response.text()) as IntentResult[];
    return intents;
  });
};

export const generateSearchQuery = async (input: string,): Promise<string> => {
  return limitedCall(limiterFlashLite, async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: generationConfigForDetect, safetySettings });
    const prompt = `Generate an optimized academic search query based on the user's question. Return only the search query.
    
    User Input: ${input}
    Search Query:`;

    const result = await model.generateContent(prompt);
    return (await result.response.text()).trim();
  });
};

export const generateResponse = async (
  input: string,
  papers: CoreApiResponse,
  conversationHistory: string[]
): Promise<{ text: string; papers: Array<{ id: string; title: string; pdfUrl: string }> }> => {
  return limitedCall(limiterFlash, async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig, safetySettings });
    const prompt = `Generate a response to the user's query using the provided papers. Format the response in HTML.
    
    conversation History:
    ${conversationHistory.join('\n')}

    User Input: ${input}
    Papers: ${JSON.stringify(papers.results)}
    Response:`;

    const result = await model.generateContent(prompt);
    const text = await result.response.text();
    const citedPapers = extractCitedPapers(text, papers);
    return { text, papers: citedPapers };
  });
};

const extractCitedPapers = (text: string, papers: CoreApiResponse): Array<{ id: string; title: string; pdfUrl: string }> => {
  const citedIds = Array.from(new Set(text.match(/data-id="([^"]+)"/g)?.map(m => m.replace('data-id="', '').replace('"', '')) || []));
  return papers.results
    .filter(p => citedIds.includes(p.id))
    .map(p => ({
      id: p.id,
      title: p.title,
      pdfUrl: p.downloadUrl || '' // Ensure pdfUrl is included, defaulting to an empty string if missing
    }));
};



// Utility to reset daily quota (e.g., at midnight)
// const resetDailyQuota = () => {
//   dailyQuotaUsed = 0;
// };

// Example usage of resetDailyQuota (call this at midnight using a scheduler)
// resetDailyQuota();