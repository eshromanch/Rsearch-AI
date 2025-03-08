import { ResearchPaper } from "./core";

export interface ConversationContext {
    previousQueries: string[];
    citedPapers: ResearchPaper[];
    currentFocus?: 'methodology' | 'results' | 'recommendations' | 'comparison';
  }