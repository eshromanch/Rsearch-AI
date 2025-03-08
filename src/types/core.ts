export interface CoreApiResponse {
    results: ResearchPaper[];
    totalHits?: number;
  }
  
  export interface ResearchPaper {
    downloadUrl?: string;
    id: string;
    title: string;
    paper?: string;
    pdfUrl?: string;
    abstract?: string;
    doi?: string;
    year?: number;
    authors?: Array<{ name: string }>;
    publishedDate?: string;
    citations?: number;
    fullTextUrl?: string;
  }
 

 export interface CorePaperResponse {
    id: string;
    title: string;
    abstract?: string;
    downloadUrl?: string;
    authors?: Array<{ name: string }>;
    publishedDate?: string;
    citations?: number;
    fullTextUrl?: string;
  }