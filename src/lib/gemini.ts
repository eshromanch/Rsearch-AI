// src/lib/gemini.ts
import Bottleneck from "bottleneck";
import { CoreApiResponse, CorePaperResponse, ResearchPaper } from "@/types/core";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";

// Define a more comprehensive set of intents
type Intent = 'search' | 'specific_paper' | 'explain' | 'follow-up' | 'paper_number_reference' | 'full_paper';

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(`AIzaSyDTKR5z-BPjz4d3lxfiTYlu-84ITkKyYPI`);

const generationConfig = {
  temperature: 0.7,
  topP: 0.9,
  topK: 32,
  maxOutputTokens: 4096,
};

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

// Rate limiters
const apiLimiter = new Bottleneck({
  minTime: 4000,
  maxConcurrent: 1,
  reservoir: 15,
  reservoirRefreshAmount: 15,
  reservoirRefreshInterval: 60000,
});

// Helper functions
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const retryWithExponentialBackoff = async <T>(
  fn: () => Promise<T>,
  retries: number = 3,
  initialDelay: number = 1000
): Promise<T> => {
  try {
    return await fn();
  } catch (error: unknown) { // Use `unknown` instead of `any`
    if (error instanceof Error && 'code' in error && error.code === 429 && retries > 0) {
      const delayTime = initialDelay * 2 ** (3 - retries);
      console.log(`Rate limit exceeded. Retrying in ${delayTime}ms...`);
      await delay(delayTime);
      return retryWithExponentialBackoff(fn, retries - 1, initialDelay);
    } else {
      throw error;
    }
  }
};

// Detect the user's intent from their message and conversation history
export const detectIntent = async (
  input: string, 
  conversationHistory: string[],
  cachedPapers: ResearchPaper[] = []
): Promise<Intent> => {
  return apiLimiter.schedule(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig, safetySettings });
    
    // Check for numeric references (e.g., "Tell me more about paper 2")
    const paperNumberRegex = /\bpaper\s+(\d+)\b|\bmore\s+about\s+(\d+)\b|^\s*(\d+)\s*$/i;
    const match = input.match(paperNumberRegex);
    
    if (match && (cachedPapers.length > 0)) {
      const paperIndex = parseInt(match[1] || match[2] || match[3]) - 1;
      if (paperIndex >= 0 && paperIndex < cachedPapers.length) {
        return 'paper_number_reference';
      }
    }
    
    // Check for "full paper" request
    if (/\bfull\s+paper\b|\bopen\s+paper\b|\bdownload\s+paper\b|\bview\s+paper\b/i.test(input)) {
      return 'full_paper';
    }

    // For more complex intent detection, use the model
    const prompt = `
      Classify the user's intent into one of the following categories:
      - search: User wants to find academic papers on a topic
      - specific_paper: User wants details about a specific paper
      - explain: User wants general explanation or information
      - follow-up: User is asking a follow-up question about previous results
      
      Return only the category name.
      
      Conversation History:
      ${conversationHistory.join('\n')}
      
      User Input: ${input}
      Intent:`;
      
    const result = await retryWithExponentialBackoff(() => model.generateContent(prompt));
    return (await result.response.text()).trim() as Intent;
  });
};

// Extract paper number from user input
export const extractPaperNumber = (input: string): number | null => {
  const paperNumberRegex = /\bpaper\s+(\d+)\b|\bmore\s+about\s+(\d+)\b|^\s*(\d+)\s*$/i;
  const match = input.match(paperNumberRegex);
  if (match) {
    return parseInt(match[1] || match[2] || match[3]) - 1; // Convert to zero-based index
  }
  return null;
};

// Generate optimized search query
export const generateSearchQuery = async (input: string): Promise<string> => {
  return apiLimiter.schedule(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig, safetySettings });
    const prompt = `
      Generate an optimized academic search query based on the user's question.
      Focus on extracting key concepts and relevant academic terminology.
      Return only the search query without any explanations.
      
      User Input: ${input}
      Search Query:`;
      
    const result = await retryWithExponentialBackoff(() => model.generateContent(prompt));
    return (await result.response.text()).trim();
  });
};

// Generate response with paper information
export const generateResponse = async (
  input: string,
  papers: CoreApiResponse | { results: CorePaperResponse[] },
  conversationHistory: string[]
): Promise<{ 
  text: string; 
  papers: Array<{ id: string; title: string; pdfUrl: string }>;
  html: string;
}> => {
  return apiLimiter.schedule(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig, safetySettings });
    
    const prompt = `
      Generate a helpful response to the user's query using the provided papers.
      Format the response in HTML.
      
      For search results, format the response as follows:
      1. A brief introduction summarizing the search results
      2. A numbered list of the most relevant papers with titles as clickable links using data-paper-id attributes
      3. For each paper, include a brief description of its relevance
      
      For specific paper details, include:
      - Title (as heading)
      - Authors
      - Publication Date
      - Abstract summary
      - Key findings or contributions
      - Link to full paper
      
      For explanations or follow-up questions:
      - Provide a clear, concise answer
      - Reference relevant papers when appropriate
      - Use a conversational, helpful tone
      
      User Input: ${input}
      Conversation History: ${conversationHistory.join('\n')}
      Papers: ${JSON.stringify(papers.results.map(p => ({
        id: p.id,
        title: p.title,
        abstract: p.abstract?.substring(0, 300) + (p.abstract && p.abstract.length > 300 ? '...' : ''),
        authors: p.authors?.map(a => a.name).join(', '),
        publishedDate: p.publishedDate,
        downloadUrl: p.downloadUrl || p.fullTextUrl
      })))}
      
      Response:`;
      
    const result = await retryWithExponentialBackoff(() => model.generateContent(prompt));
    const text = await result.response.text();
    
    // Extract cited papers
    const paperRegex = /data-paper-id="([^"]+)"/g;
    const paperMatches = [...text.matchAll(paperRegex)];
    const citedPaperIds = [...new Set(paperMatches.map(match => match[1]))];
    
    const citedPapers = papers.results
      .filter(p => citedPaperIds.includes(p.id))
      .map(p => ({
        id: p.id,
        title: p.title,
        pdfUrl: p.downloadUrl || p.fullTextUrl || '',
      }));
    
    // Format HTML for display
    const html = text
      .replace(/```html|```/g, '')
      .replace(/data-paper-id="([^"]+)"/g, 'data-paper-id="$1" class="paper-link"');
    
    return { text, papers: citedPapers, html };
  });
};

// Generate a summary for a specific paper
export const generatePaperSummary = async (
  paper: CorePaperResponse,
  conversationHistory: string[]
): Promise<string> => {
  return apiLimiter.schedule(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig, safetySettings });
    
    const prompt = `
      Generate a detailed summary of the following academic paper:
      
      Title: ${paper.title}
      Authors: ${paper.authors?.map(a => a.name).join(', ') || 'Unknown'}
      Publication Date: ${paper.publishedDate || 'Unknown'}
      Abstract: ${paper.abstract || 'No abstract available'}
      
      Your summary should include:
      1. The paper's main research question or objective
      2. Key methodology used
      3. Main findings or contributions
      4. Potential applications or implications
      5. How this paper connects to the user's interests based on conversation history
      
      Conversation History:
      ${conversationHistory.join('\n')}
      
      Format your response in HTML with appropriate headings and paragraphs.
      Summary:`;
      
    const result = await retryWithExponentialBackoff(() => model.generateContent(prompt));
    return await result.response.text();
  });
};