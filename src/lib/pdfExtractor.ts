// const jsdom = require("jsdom");
// const { JSDOM } = jsdom;
// import { Readability } from '@mozilla/readability';
// export const fetchAndParseHTML = async (url: string): Promise<string> => {
//     try {
//       const response = await axios.get(url);
//       const dom = new JSDOM(response.data, { url });
//       const reader = new Readability(dom.window.document);
//       const article = reader.parse();
//       return article?.textContent || '';
//     } catch (error) {
//       console.error('Error fetching or parsing HTML content:', error);
//       throw new Error('Failed to fetch or parse HTML content');
//     }
//   };



export const fetchAndParseHTML = async (url: string): Promise<string> => {
    try {
      const response = await axios.get(url);
      const html = response.data as string;
  
      // Use regex to extract text content (very basic example)
      const textContent = html.replace(/<[^>]+>/g, ''); // Remove all HTML tags
      return textContent || '';
    } catch (error) {
      console.error('Error fetching or parsing HTML content:', error);
      throw new Error('Failed to fetch or parse HTML content');
    }
  };