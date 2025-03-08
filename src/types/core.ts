export interface CoreApiResponse {
    results: ResearchPaper[];
    totalHits?: number;
  }
  
  export interface ResearchPaper {
    downloadUrl: string;
    id: string;
    title: string;
    paper?: string;
    pdfUrl?: string;
    abstract?: string;
    doi?: string;
    year?: number;
  }
 