export default async (request, context) => {
    // Handle preflight OPTIONS request for CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400'
        }
      });
    }
  
    // Parse the query parameter from the URL
    const url = new URL(request.url);
    const query = url.searchParams.get('query');
    
    if (!query) {
      return new Response(JSON.stringify({ error: 'Query parameter is required' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    try {
      // Call the Core API with the query
      const response = await fetch('https://api.core.ac.uk/v3/search/works', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer 3YdmtVuXJHSFiG2zPlKkIL1cb9yvaO8A',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          q: query,
          limit: 15,
          fields: ['id', 'title', 'abstract', 'downloadUrl']
        })
      });
      
      // Get the API response
      const data = await response.json();
      
      // Return the response with CORS headers
      return new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch (error) {
      // Handle errors
      return new Response(JSON.stringify({ 
        error: 'Failed to search papers',
        details: error.message 
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }