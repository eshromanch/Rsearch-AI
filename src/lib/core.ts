// // // // src/lib/core.ts
// local
// import { CoreApiResponse, CorePaperResponse } from '@/types/core';
// import axios from 'axios';

// export const searchPapers = async (query: string): Promise<CoreApiResponse> => {
//   try {
//     const response = await axios.post(
//       'https://api.core.ac.uk/v3/search/works',
//       { q: query, limit: 15, fields: ['id', 'title', 'abstract', 'downloadUrl'] },
//       { headers: { Authorization: `Bearer 3YdmtVuXJHSFiG2zPlKkIL1cb9yvaO8A` } }
//     );
//     return response.data as CoreApiResponse;
//   } catch (error) {
//     console.error('Core API error:', error);
//     throw new Error('Failed to search papers');
//   }
// };

// export const fetchSpecificPaper = async (paperId: string): Promise<CorePaperResponse> => {
//   try {
//     const response = await axios.get<CorePaperResponse>(
//       `https://api.core.ac.uk/v3/works/${paperId}`,
//       {
//         headers: { Authorization: `Bearer 3YdmtVuXJHSFiG2zPlKkIL1cb9yvaO8A` },
//       }
//     );

//     const paper = response.data;
//     return {
//       id: paper.id,
//       title: paper.title,
//       abstract: paper.abstract,
//       downloadUrl: paper.downloadUrl,
//       authors: paper.authors?.map((author: any) => author.name) || [],
//       publishedDate: paper.publishedDate,
//       citations: paper.citations,
//       fullTextUrl: paper.fullTextUrl,
//     };
//   } catch (error) {
//     console.error('Error fetching specific paper:', error);
//     throw new Error('Failed to fetch detailed paper information');
//   }
// };

// production

import { CoreApiResponse, CorePaperResponse } from '@/types/core';
import axios from 'axios';

export const searchPapers = async (query: string): Promise<CoreApiResponse> => {
  try {
    // Use the Edge Function endpoint with the query parameter
    const response = await axios.get(
      `/api/core-api?query=${encodeURIComponent(query)}`
    );
    return response.data as CoreApiResponse;
  } catch (error) {
    console.error('Core API error:', error);
    throw new Error('Failed to search papers');
  }
};

export const fetchSpecificPaper = async (paperId: string): Promise<CorePaperResponse> => {
  try {
    // Use the Edge Function endpoint with the paperId parameter
    const response = await axios.get<CorePaperResponse>(
      `/api/core-api?query=${encodeURIComponent(paperId)}`
    );

    const paper = response.data;
    return {
      id: paper.id,
      title: paper.title,
      abstract: paper.abstract,
      downloadUrl: paper.downloadUrl,
      authors: paper.authors?.map((author: any) => author.name) || [],
      publishedDate: paper.publishedDate,
      citations: paper.citations,
      fullTextUrl: paper.fullTextUrl,
    };
  } catch (error) {
    console.error('Error fetching specific paper:', error);
    throw new Error('Failed to fetch detailed paper information');
  }
};