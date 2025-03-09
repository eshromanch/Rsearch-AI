// src/lib/gemini.ts
import Bottleneck from "bottleneck";
import { CoreApiResponse, CorePaperResponse, ResearchPaper } from "@/types/core";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import { fetchAndParseHTML } from "./pdfExtractor";

// Define a more comprehensive set of intents
type Intent = 'search' | 'specific_paper' | 'explain' | 'follow-up' | 'paper_number_reference' | 'full_paper' | 
              'clarification_needed' | 'out_of_scope' | 'comparison' | 'specific_sections' | 'implementation';

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

// Rate limiters with more generous settings for production
const apiLimiter = new Bottleneck({
  minTime: 3000,
  maxConcurrent: 2,
  reservoir: 20,
  reservoirRefreshAmount: 20,
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
  } catch (error: unknown) {
    if (retries > 0) {
      // Check for rate limit errors (429) or network-related errors
      const isRateLimitError = error instanceof Error && 
        ('code' in error && (error.code === 429 || error.code === 'ECONNRESET'));
      
      if (isRateLimitError || (error instanceof Error && error.message.includes('rate'))) {
        const delayTime = initialDelay * 2 ** (3 - retries);
        console.log(`Rate limit or network error. Retrying in ${delayTime}ms...`);
        await delay(delayTime);
        return retryWithExponentialBackoff(fn, retries - 1, initialDelay);
      }
    }
    throw error;
  }
};

// Process conversation history to extract relevant context
const processConversationHistory = (history: string[], maxEntries: number = 10): string => {
  // Keep only the most recent entries to avoid context overflow
  const recentHistory = history.slice(-maxEntries);
  
  // Format the conversation in a structured way for better context
  return recentHistory.map((entry, index) => {
    // Add numbering to help the model understand the sequence
    return `[${index + 1}] ${entry}`;
  }).join('\n');
};

// Detect the user's intent from their message and conversation history
export const detectIntent = async (
  input: string, 
  conversationHistory: string[],
  cachedPapers: ResearchPaper[] = []
): Promise<Intent> => {
  return apiLimiter.schedule(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig, safetySettings });
    
    // Quick pattern matching for common intents
    
    // Check for numeric references (e.g., "Tell me more about paper 2")
    const paperNumberRegex = /\bpaper\s+(\d+)\b|\bmore\s+about\s+(\d+)\b|\bsee\s+(\d+)\b|^\s*(\d+)\s*$/i;
    const match = input.match(paperNumberRegex);
    
    if (match && (cachedPapers.length > 0)) {
      const paperIndex = parseInt(match[1] || match[2] || match[3] || match[4]) - 1;
      if (paperIndex >= 0 && paperIndex < cachedPapers.length) {
        return 'paper_number_reference';
      }
    }
    
    // Check for "full paper" request
    if (/\bfull\s+paper\b|\bopen\s+paper\b|\bdownload\s+paper\b|\bview\s+paper\b|\bpdf\b|\bretrieve\s+full\b/i.test(input)) {
      return 'full_paper';
    }
    
    // Check for comparison requests
    if (/\bcompare\b|\bcomparison\b|\bdifference\b|\bversus\b|\bvs\.?\b|\bdistinguish\b/i.test(input)) {
      return 'comparison';
    }
    
    // Check for methodology questions
    if (/\b(methodology|results|conclusion|introduction|discussion|abstract)\b/i.test(input)) {
      return 'specific_sections';
    }
    
    // Check for implementation questions
    if (/\bimplementation\b|\bimplementing\b|\bcode\b|\balgorithm\b|\bhow\s+to\s+implement\b/i.test(input)) {
      return 'implementation';
    }

    // For more complex intent detection, use the model
    const processedHistory = processConversationHistory(conversationHistory);
    
    const prompt = `
      Carefully analyze the user's message and determine their intent.
      Classify the user's intent into one of the following categories:
      - search: User wants to find academic papers on a topic
      - specific_paper: User wants details about a specific paper
      - explain: User wants general explanation or information
      - follow-up: User is asking a follow-up question about previous results
      - clarification_needed: User's query is ambiguous and needs clarification
      - out_of_scope: User's query is unrelated to academic research
      - comparison: User wants to compare papers, methods, or concepts
      - methodology: User is asking about research methods used
      - implementation: User wants implementation details or code
      
      Return only the category name, nothing else.
      
      Conversation History:
      ${processedHistory}
      
      User Input: ${input}
      Intent:`;
      
    const result = await retryWithExponentialBackoff(() => model.generateContent(prompt));
    const detectedIntent = (await result.response.text()).trim().toLowerCase();
    
    // Map the detected intent to our defined Intent type
    const validIntents: Intent[] = [
      'search', 'specific_paper', 'explain', 'follow-up', 'paper_number_reference', 
      'full_paper', 'clarification_needed', 'out_of_scope', 'comparison', 
      'specific_sections', 'implementation'
    ];
    
    // Default to 'search' if the detected intent is not in our list
    return validIntents.includes(detectedIntent as Intent) 
      ? detectedIntent as Intent 
      : 'search';
  });
};

// Extract paper number from user input
export const extractPaperNumber = (input: string): number | null => {
  const paperNumberRegex = /\bpaper\s+(\d+)\b|\bmore\s+about\s+(\d+)\b|\bsee\s+(\d+)\b|^\s*(\d+)\s*$/i;
  const match = input.match(paperNumberRegex);
  if (match) {
    return parseInt(match[1] || match[2] || match[3] || match[4]) - 1; // Convert to zero-based index
  }
  return null;
};

export const extractSection = async (
  paperId: string,
  fullTextUrl: string,
  section: string,
  cachedPapers: ResearchPaper[] 
): Promise<string | null> => {
  // Check if the full paper content is already cached
  const cachedPaper = cachedPapers.find(p => p.id === paperId);
  let fullText = cachedPaper?.fullTextUrl;

  // If not cached, fetch and parse the full paper
  if (!fullText) {
    fullText = await fetchAndParseHTML(fullTextUrl);
    // Cache the full paper content
    if (cachedPaper) {
      cachedPaper.fullTextUrl= fullText;
    }
  }

  // Extract the requested section using regex
  const sectionRegex = new RegExp(`\\b${section}\\b[\\s\\S]*?(\\n\\n|$)`, 'i');
  const match = fullText.match(sectionRegex);
  return match ? match[0] : null;
};
export const extractSectionName = (input: string): string | null => {
  const sectionRegex = /\b(methodology|results|conclusion|introduction|discussion|abstract)\b/i;
  const match = input.match(sectionRegex);
  return match ? match[0].toLowerCase() : null;
};

// Generate optimized search query
export const generateSearchQuery = async (input: string): Promise<string> => {
  return apiLimiter.schedule(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig, safetySettings });
    const prompt = `
      Generate an optimized academic search query based on the user's question.
      Focus on extracting key concepts, relevant academic terminology, and search keywords.
      If the user's query is vague, identify the most likely academic interpretation.
      Return only the search query without any explanations.
      
      User Input: ${input}
      Search Query:`;
      
    const result = await retryWithExponentialBackoff(() => model.generateContent(prompt));
    return (await result.response.text()).trim();
  });
};

// Generate clarification response when user input is ambiguous
export const generateClarificationRequest = async (
  input: string,
  conversationHistory: string[]
): Promise<string> => {
  return apiLimiter.schedule(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig, safetySettings });
    
    const processedHistory = processConversationHistory(conversationHistory);
    
    const prompt = `
      The user's query is ambiguous or lacks specificity. 
      Generate a friendly response asking for clarification.
      Include 2-3 specific follow-up questions that would help narrow down what the user is looking for.
      If possible, suggest some potential topics they might be interested in based on the conversation history.
      
      Format your response in HTML with appropriate paragraphs.
      
      User Input: ${input}
      Conversation History: ${processedHistory}
      
      Clarification Request:`;
      
    const result = await retryWithExponentialBackoff(() => model.generateContent(prompt));
    return await result.response.text();
  });
};

// Generate out-of-scope response
export const generateOutOfScopeResponse = async (input: string): Promise<string> => {
  return apiLimiter.schedule(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig, safetySettings });
    
    const prompt = `
      The user's query is outside the scope of an academic research assistant.
      Generate a friendly response explaining this limitation.
      Suggest how the query could be reformulated to fit within the academic research domain.
      Provide 1-2 examples of related academic topics that could be searched instead.
      
      Format your response in HTML with appropriate paragraphs.
      
      User Input: ${input}
      Out-of-Scope Response:`;
      
    const result = await retryWithExponentialBackoff(() => model.generateContent(prompt));
    return await result.response.text();
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
    
    const processedHistory = processConversationHistory(conversationHistory);
    
    // Filter out papers without abstracts to improve response quality
    const validPapers = papers.results.filter(p => p.abstract && p.abstract.trim() !== '');
    
    // Handle case where no valid papers are found
    if (validPapers.length === 0) {
      const noPapersHTML = `
        <div>
          <p>I couldn't find papers with sufficient information matching your query. Here are some suggestions:</p>
          <ul>
            <li>Try using different keywords or more specific terminology</li>
            <li>Broaden your search to include related concepts</li>
            <li>Check if your topic has alternative names in the academic literature</li>
          </ul>
          <p>Would you like to try a different search query?</p>
        </div>
      `;
      
      return {
        text: "I couldn't find papers with sufficient information matching your query.",
        papers: [],
        html: noPapersHTML
      };
    }
    
    const prompt = `
      Generate a helpful and informative response to the user's query using the provided papers.
      Format the response in clear, well-structured HTML.
      
      For search results:
      1. A brief introduction summarizing the key findings or trends in the results (1-2 sentences)
      2. A numbered list of the 5-7 most relevant papers with titles as clickable links using data-paper-id attributes also in href provide proper downloadURL and always use target="_blank"
      3. For each paper, include a 1-2 sentence description highlighting its specific relevance to the query
      
      For specific paper details:
      - Title (as heading)
      - Authors and publication year
      - A concise summary of the paper's key contributions (3-5 sentences)
      - Important methodology details if relevant
      - Key findings and their significance
      - Link to full paper also in href provide proper downloadURL and always use target="_blank
      
      For explanations or follow-up questions:
      - Provide a clear, direct answer based on the available papers
      - Reference specific papers when making claims (using "According to [Paper Title]...")
      - Use a conversational, scholarly tone
      - Acknowledge limitations or areas of uncertainty when appropriate
      
      Always maintain academic integrity and accuracy in your responses.
      
      User Input: ${input}
      Conversation History: ${processedHistory}
      Papers: ${JSON.stringify(validPapers.map(p => ({
        id: p.id,
        title: p.title,
        abstract: p.abstract?.substring(0, 500) + (p.abstract && p.abstract.length > 500 ? '...' : ''),
        authors: p.authors?.map(a => a.name).join(', '),
        publishedDate: p.publishedDate,
        downloadUrl: p.downloadUrl || p.fullTextUrl
      })).slice(0, 10))}
      
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
    
    const processedHistory = processConversationHistory(conversationHistory);
    
    const prompt = `
      Generate a comprehensive yet concise summary of the following academic paper.
      Format your response in HTML with appropriate headings and paragraphs.
      
      Paper Details:
      Title: ${paper.title}
      Authors: ${paper.authors?.map(a => a.name).join(', ') || 'Unknown'}
      Publication Date: ${paper.publishedDate || 'Unknown'}
      Abstract: ${paper.abstract || 'No abstract available'}
      
      Your summary should include:
      1. The paper's main research question or objective
      2. Key methodology and approach
      3. Main findings or results
      4. Significant contributions to the field
      5. Potential applications or implications
      6. How this research connects to the user's interests (based on conversation history)
      
      Conversation History:
      ${processedHistory}
      
      Paper Summary:`;
      
    const result = await retryWithExponentialBackoff(() => model.generateContent(prompt));
    return await result.response.text();
  });
};

// Generate comparison between papers
export const generatePaperComparison = async (
  papers: ResearchPaper[],
  input: string,
  conversationHistory: string[]
): Promise<string> => {
  return apiLimiter.schedule(async () => {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig, safetySettings });
    
    const processedHistory = processConversationHistory(conversationHistory);
    
    const prompt = `
      Generate a detailed comparison of the following papers based on the user's query.
      Format your response in HTML with appropriate headings and paragraphs.
      
      Papers to compare:
      ${papers.map((p, idx) => `
        Paper ${idx + 1}: ${p.title}
        Abstract: ${p.abstract || 'No abstract available'}
      `).join('\n')}
      
      Your comparison should include:
      1. Common themes or approaches between the papers
      2. Key differences in methodology, findings, or conclusions
      3. Relative strengths and limitations of each paper
      4. How each paper contributes to addressing the user's specific query
      
      User Query: ${input}
      Conversation History: ${processedHistory}
      
      Paper Comparison:`;
      
    const result = await retryWithExponentialBackoff(() => model.generateContent(prompt));
    return await result.response.text();
  });
};