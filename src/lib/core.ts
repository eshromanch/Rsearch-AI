// // // // src/lib/core.ts
// local
// import { CoreApiResponse } from '@/types/core';
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

// production

import { CoreApiResponse } from '@/types/core';
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