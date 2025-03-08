// // // src/lib/core.ts

// import axios from 'axios';
// import { CoreApiResponse } from '@/types/core';

// export const searchPapers = async (
//   query: string
// ): Promise<CoreApiResponse> => {
//   try {
//     const response = await axios.post(
//       'https://api.core.ac.uk/v3/search/works',
//       {
//         q: query,
//         limit: 15,
//         fields: ['id', 'title', 'abstract', 'downloadUrl', 'fullText']
//       },
//       {
//         headers: { 
//           Authorization: `Bearer 3YdmtVuXJHSFiG2zPlKkIL1cb9yvaO8A`,
//           'Content-Type': 'application/json'
//         }
//       }
//     );
    
//     return response.data as any;
//   } catch (error) {
//     console.error('Core API error:', error);
//     throw new Error('Failed to search papers');
//   }
// };

import { CoreApiResponse } from '@/types/core';
import axios from 'axios';

export const searchPapers = async (query: string): Promise<CoreApiResponse> => {
  try {
    const response = await axios.post(
      'https://api.core.ac.uk/v3/search/works',
      { q: query, limit: 15, fields: ['id', 'title', 'abstract', 'downloadUrl'] },
      { headers: { Authorization: `Bearer 3YdmtVuXJHSFiG2zPlKkIL1cb9yvaO8A` } }
    );
    return response.data as CoreApiResponse;
  } catch (error) {
    console.error('Core API error:', error);
    throw new Error('Failed to search papers');
  }
};