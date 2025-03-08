import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog";

import { useState, useEffect, useRef } from 'react';
import { Box, Button, Flex, Text, Textarea } from '@chakra-ui/react';
import { Avatar } from "@/components/ui/avatar";
import { signOut } from "firebase/auth";
import dynamic from "next/dynamic";
import { auth, db } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { searchPapers } from "@/lib/core";
import { generateResponse, generateSearchQuery, detectIntent } from "@/lib/gemini";
import { useAuth } from "@/hooks/useAuth";
import DOMPurify from 'dompurify';
import { toaster } from "./ui/toaster";

interface ResearchPaper {
  id: string;
  title: string;
  pdfUrl: string;
  abstract?: string;
}

interface Message {
  text: string;
  isBot: boolean;
  papers?: ResearchPaper[];
  html?: string;
}

const PdfViewer = dynamic(
  () => import('@/components/PdfViewer'),
  { ssr: false, loading: () => <Text>Loading PDF viewer...</Text> }
);

export const Chat = () => {
  const { user } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [selectedPaper, setSelectedPaper] = useState<ResearchPaper | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [cachedPapers, setCachedPapers] = useState<ResearchPaper[]>([]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !user) return;
  
    setIsLoading(true);
    const userMessage = { text: inputMessage, isBot: false };
  
    try {
      setMessages(prev => [...prev, userMessage]);
  
      // Detect user intent with conversation history
      const conversationHistory = messages.map(msg => `${msg.isBot ? 'Bot' : 'User'}: ${msg.text}`);
      const intent = await detectIntent(inputMessage, conversationHistory);
      console.log("Detected intent:", intent);
  
      let botMessage: Message;
      if (intent === 'search') {
        // Generate search query and fetch papers
        const searchQuery = await generateSearchQuery(inputMessage);
        const papersResponse = await searchPapers(searchQuery);
  
        if (!papersResponse.results.length) {
          throw new Error('No relevant papers found. Please refine your query.');
        }
  
        // Cache the fetched papers
        const mappedPapers = papersResponse.results.map(paper => ({
          id: paper.id,
          title: paper.title,
          pdfUrl: paper.downloadUrl || ''
        }));
        setCachedPapers(mappedPapers);
  
        // Generate response with papers
        const { text, papers: citedPapers } = await generateResponse(inputMessage, papersResponse, conversationHistory);
        const mappedCitedPapers = citedPapers.map(paper => ({
          id: paper.id,
          title: paper.title,
          pdfUrl: paper.pdfUrl || ''
        }));
        botMessage = {
          text,
          isBot: true,
          papers: mappedCitedPapers,
          html: DOMPurify.sanitize(text.replace(/```html|```/g, ''), {
            ALLOWED_TAGS: ['div', 'h2', 'h3', 'ul', 'li', 'span', 'p', 'a', 'style'],
            ALLOWED_ATTR: ['class', 'data-paper-id', 'href', 'style']
          })
        };
      } else if (intent === 'specific_paper') {
        // Use the entire input as the search query
        const paperTitle = inputMessage;
        console.log("Searching for paper:", paperTitle);
  
        const papersResponse = await searchPapers(paperTitle);
        console.log("Papers response:", papersResponse);
  
        if (!papersResponse.results.length) {
          botMessage = {
            text: "I couldn't find a paper with that title. Please try refining your query or provide more details.",
            isBot: true,
          };
        } else {
          const paper = papersResponse.results[0];
          botMessage = {
            text: `Here is the paper titled "${paper.title}":\n\nAbstract: ${paper.abstract || 'No abstract available'}`,
            isBot: true,
            papers: [{
              id: paper.id,
              title: paper.title,
              pdfUrl: paper.downloadUrl || ''
            }],
            html: DOMPurify.sanitize(`<div class="paper-info">
              <h3>${paper.title}</h3>
              <p>${paper.abstract || 'No abstract available'}</p>
            </div>`)
          };
        }
      } else if (intent === 'explain') {
        // Generate explanation using Gemini
        const { text } = await generateResponse(inputMessage, { results: [] }, conversationHistory);
        botMessage = {
          text,
          isBot: true,
          html: DOMPurify.sanitize(text.replace(/```html|```/g, ''), {
            ALLOWED_TAGS: ['div', 'h2', 'h3', 'ul', 'li', 'span', 'p', 'a', 'style'],
            ALLOWED_ATTR: ['class', 'data-paper-id', 'href', 'style']
          })
        };
      } else if (intent === 'follow-up') {
        // Handle follow-up questions using cached papers
        if (!cachedPapers.length) {
          throw new Error('No context available for follow-up question.');
        }
        const validCachedPapers = cachedPapers.map(paper => ({
          id: paper.id,
          title: paper.title,
          downloadUrl: paper.pdfUrl || '', // Ensure downloadUrl is included
        }));
  
        const { text } = await generateResponse(inputMessage, { results: validCachedPapers }, conversationHistory);
        botMessage = {
          text,
          isBot: true,
          papers: cachedPapers,
          html: DOMPurify.sanitize(text.replace(/```html|```/g, ''), {
            ALLOWED_TAGS: ['div', 'h2', 'h3', 'ul', 'li', 'span', 'p', 'a', 'style'],
            ALLOWED_ATTR: ['class', 'data-paper-id', 'href', 'style']
          })
        };
      } else {
        throw new Error('Unable to determine user intent.');
      }
  
      setMessages(prev => [...prev, botMessage]);
      await addDoc(collection(db, 'chats'), {
        messages: [userMessage, botMessage],
        userId: user.uid,
        timestamp: serverTimestamp(),
        papers: botMessage.papers || []
      });
  
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to process request.";
      toaster.create({
        title: 'Error',
        description: message,
        // status: 'error' as any,
        duration: 5000
      });
    } finally {
      setIsLoading(false);
      setInputMessage('');
    }
  };
  

  return (
    <Flex direction="column" h="100vh">
      <Flex p={4} boxShadow="sm" align="center" justify="space-between">
        <Text fontSize="xl" fontWeight="bold" color="blue.600">Research Assistant</Text>
        <Button 
          colorScheme="red" 
          onClick={() => signOut(auth)}
          size="sm"
          variant="outline"
        >
          Sign Out
        </Button>
      </Flex>

      <Box flex={1} overflowY="auto" p={4}>
        {messages.map((msg, idx) => (
          <Flex key={idx} mb={4} align="flex-start" gap={3}>
            <Avatar
              name={msg.isBot ? 'AI' : user?.displayName ?? ''}
              src={msg.isBot ? undefined : user?.photoURL || undefined}
              size="sm"
            />
            <Box flex={1}>
              <Text fontWeight="500" color="white" mb={1}>
                {msg.isBot ? 'Research Assistant' : user?.displayName || 'You'}
              </Text>
              {msg.isBot ? (
                 <Box
                 dangerouslySetInnerHTML={{ __html: msg.html || '' }}
                 css={{
                   '& div': {
                     backgroundColor: 'gray.700',
                     padding: '12px',
                     borderRadius: '8px',
                     boxShadow: 'sm',
                     marginBottom: '12px',
                   },
                   '& h2': {
                     fontSize: 'xl',
                     fontWeight: 'bold',
                     color: 'white',
                     marginBottom: '8px',
                   },
                   '& h3': {
                     fontSize: 'lg',
                     fontWeight: 'semibold',
                     color: 'white',
                     marginBottom: '8px',
                   },
                   '& ul': {
                     listStyleType: 'disc',
                     paddingLeft: '24px',
                     marginBottom: '12px',
                   },
                   '& li': {
                     marginBottom: '4px',
                     color: 'white',
                   },
                   '& p': {
                     color: 'white',
                     lineHeight: '1.6',
                     marginBottom: '12px',
                   },
                   '& a': {
                     color: 'blue.400',
                     textDecoration: 'underline',
                     _hover: {
                       color: 'blue.300',
                     },
                   },
                   '& span': {
                     color: 'yellow.200',
                     fontWeight: 'bold',
                   },
                 }}
               />
              ) : (
                <Box bg="white" p={3} borderRadius="md" boxShadow="sm">
                  <Text color="gray.800">{msg.text}</Text>
                </Box>
              )}
              {msg.papers?.map((paper, idx) => (
                <Button
                  key={idx}
                  mt={2}
                  size="sm"
                  variant="outline"
                  colorScheme="blue"
                  onClick={() => setSelectedPaper(paper)}
                >
                  View {paper.title}
                </Button>
              ))}
            </Box>
          </Flex>
        ))}
        <div ref={messagesEndRef} />
      </Box>

      <DialogRoot open={!!selectedPaper} onOpenChange={(open) => !open && setSelectedPaper(null)}>
        <DialogContent maxWidth="4xl" height="90vh">
          <DialogHeader>
            <DialogTitle>{selectedPaper?.title}</DialogTitle>
            <DialogCloseTrigger />
          </DialogHeader>
          <DialogBody>
            {selectedPaper && <PdfViewer url={selectedPaper.pdfUrl} />}
          </DialogBody>
          <DialogFooter>
            <DialogCloseTrigger asChild>
              <Button variant="ghost">Close</Button>
            </DialogCloseTrigger>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>

      <Flex p={4} gap={2} boxShadow="md">
        <Textarea
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder="Ask about research papers..."
          rows={2}
          resize="none"
          disabled={isLoading}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
        />
        <Button
          colorScheme="blue"
          onClick={handleSendMessage}
          loading={isLoading}
          loadingText="Processing..."
          px={6}
          h="full"
        >
          Send
        </Button>
      </Flex>
    </Flex>
  );
};