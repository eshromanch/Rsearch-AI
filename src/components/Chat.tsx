import { useState, useEffect, useRef } from 'react';
import { Box, Button, Flex, Text, Textarea, Spinner } from '@chakra-ui/react';
import { Avatar } from "@/components/ui/avatar";
import { signOut } from "firebase/auth";
import dynamic from "next/dynamic";
import { auth, db } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp, query, where, orderBy, limit, getDocs, Timestamp } from "firebase/firestore";
import { fetchSpecificPaper, searchPapers } from "@/lib/core";
import { 
  detectIntent, 
  extractPaperNumber,
  generateResponse, 
  generateSearchQuery, 
  generatePaperSummary,
  generateClarificationRequest,
  generateOutOfScopeResponse,
  generatePaperComparison,
  extractSection,
  extractSectionName
} from "@/lib/gemini";
import { useAuth } from "@/hooks/useAuth";
import DOMPurify from 'dompurify';
import { toaster } from "./ui/toaster";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog";

// Types
interface ResearchPaper {
  id: string;
  title: string;
  pdfUrl: string;
  abstract?: string;
}

interface Message {
  id: string;
  text: string;
  isBot: boolean;
  papers?: ResearchPaper[];
  html?: string;
  timestamp?: Timestamp | Date;
}


// Dynamically import PDF viewer
const PdfViewer = dynamic(
  () => import('@/components/PdfViewer'),
  { ssr: false, loading: () => <Flex justify="center" align="center" p={10}><Spinner size="xl" /></Flex> }
);

export const Chat = () => {
  const { user } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [selectedPaper, setSelectedPaper] = useState<ResearchPaper | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [cachedPapers, setCachedPapers] = useState<ResearchPaper[]>([]);
  const [currentPaperIdx, setCurrentPaperIdx] = useState<number | null>(null);
  const [currentPaper, setCurrentPaper] = useState<ResearchPaper | null>(null); // Track the currently selected paper
  // const [errorCount, setErrorCount] = useState(0);

  // Auto-scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load previous chat if available
  useEffect(() => {
    const loadPreviousChat = async () => {
      if (user && messages.length === 0) {
        try {
          const chatQuery = query(
            collection(db, 'chats'),
            where('userId', '==', user.uid),
            orderBy('timestamp', 'desc'),
            limit(1)
          );
          
          const querySnapshot = await getDocs(chatQuery);
          if (!querySnapshot.empty) {
            const chatDoc = querySnapshot.docs[0];
            const chatData = chatDoc.data();
            
            if (chatData.messages && chatData.messages.length > 0) {
              const formattedMessages = chatData.messages.map((msg: Message) => ({
                // id: `prev-${index}`,
                ...msg,
                timestamp: msg.timestamp instanceof Timestamp ? msg.timestamp.toDate() : new Date()
              }));
              
              setMessages(formattedMessages);
              
              // Restore cached papers if available
              if (chatData.papers && chatData.papers.length > 0) {
                setCachedPapers(chatData.papers);
              }
              
              return; // Don't set welcome message if we loaded previous chat
            }
          }
        } catch (error) {
          console.error("Error loading previous chat:", error);
          // Continue to set welcome message on error
        }
        
        // Set welcome message if no previous chat
        setMessages([
          {
            id: 'welcome',
            text: "Welcome to the Research Assistant! I can help you find academic papers, provide summaries, and answer your research questions. What would you like to explore today?",
            isBot: true,
            html: "<div><p>Welcome to the Research Assistant! I can help you find academic papers, provide summaries, and answer your research questions. What would you like to explore today?</p><p>For example, you can ask:</p><ul><li>Find papers on climate change adaptation strategies</li><li>Summarize recent research on quantum computing</li><li>What are the latest developments in natural language processing?</li></ul></div>",
            timestamp: new Date()
          }
        ]);
      }
    };
    
    loadPreviousChat();
  }, [user, messages.length]);

  // Add event listener for paper links
  useEffect(() => {
    const handlePaperLinkClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.classList.contains('paper-link') || target.closest('.paper-link')) {
        event.preventDefault();
        const paperLink = target.closest('[data-paper-id]');
        if (paperLink) {
          const paperId = paperLink.getAttribute('data-paper-id');
          if (paperId) {
            const paper = cachedPapers.find(p => p.id === paperId);
            if (paper) {
              setSelectedPaper(paper);
            }
          }
        }
      }
    };

    document.addEventListener('click', handlePaperLinkClick);
    return () => {
      document.removeEventListener('click', handlePaperLinkClick);
    };
  }, [cachedPapers]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !user) return;
  
    setIsLoading(true);
    const messageId = `user-${Date.now()}`;
    const userMessage: Message = { 
      id: messageId, 
      text: inputMessage, 
      isBot: false,
      timestamp: new Date()
    };
  
    try {
      // Add user message to chat
      setMessages(prev => [...prev, userMessage]);
      setInputMessage('');
  
      // Get conversation history for context
      const conversationHistory = messages.map(msg => `${msg.isBot ? 'Bot' : 'User'}: ${msg.text}`);
      
      // Detect user intent
      const intent = await detectIntent(inputMessage, conversationHistory, cachedPapers);
      console.log('Detected intent:', intent);
  
      let botMessage: Message = { 
        id: `bot-${Date.now()}`, 
        text: '', 
        isBot: true,
        timestamp: new Date()
      };
  
      switch (intent) {
        case 'search':
          // Search for papers
          const searchQuery = await generateSearchQuery(inputMessage);
          console.log('Generated search query:', searchQuery);
          
          const loadingMessage: Message = {
            id: `loading-${Date.now()}`,
            text: `Searching for papers on: "${searchQuery}"...`,
            isBot: true,
            html: `<div><p>Searching for papers on: <strong>"${searchQuery}"</strong>...</p></div>`,
            timestamp: new Date()
          };
          
          setMessages(prev => [...prev, loadingMessage]);
          
          const papersResponse = await searchPapers(searchQuery);
  
          // Remove loading message
          setMessages(prev => prev.filter(msg => msg.id !== loadingMessage.id));
          
          if (!papersResponse.results.length) {
            throw new Error(`No papers found for "${searchQuery}". Please try a different search term or topic.`);
          }
  
          // Cache papers for future reference
          const mappedPapers = papersResponse.results.map(paper => ({
            id: paper.id,
            title: paper.title,
            pdfUrl: paper.downloadUrl || '',
            abstract: paper.abstract
          }));
          setCachedPapers(mappedPapers);
          
          // Generate response with papers
          const { text, papers: citedPapers, html } = await generateResponse(
            inputMessage,
            papersResponse,
            conversationHistory
          );
          
          botMessage = {
            id: `bot-${Date.now()}`,
            text,
            isBot: true,
            papers: citedPapers,
            html: DOMPurify.sanitize(html, {
              ALLOWED_TAGS: ['div', 'h2', 'h3', 'ul', 'li', 'ol', 'span', 'p', 'a', 'strong', 'em', 'b', 'i'],
              ALLOWED_ATTR: ['class', 'data-paper-id', 'href', 'style'],
            }),
            timestamp: new Date()
          };
          break;
          
        case 'paper_number_reference':
          // Handle references like "tell me more about paper 2"
          const paperIdx = extractPaperNumber(inputMessage);
          
          if (paperIdx !== null && cachedPapers[paperIdx]) {
            const paper = cachedPapers[paperIdx];
            setCurrentPaper(paper); // Update the currently selected paper
            setCurrentPaperIdx(paperIdx);
            
            // Loading message
            const loadingMessage: Message = {
              id: `loading-${Date.now()}`,
              text: `Retrieving details for "${paper.title}"...`,
              isBot: true,
              html: `<div><p>Retrieving details for <strong>"${paper.title}"</strong>...</p></div>`,
              timestamp: new Date()
            };
            
            setMessages(prev => [...prev, loadingMessage]);
            
            try {
              // Fetch full paper details
              const paperDetails = await fetchSpecificPaper(paper.id);
              
              // Remove loading message
              setMessages(prev => prev.filter(msg => msg.id !== loadingMessage.id));
              
              // Generate detailed summary
              const summary = await generatePaperSummary(paperDetails, conversationHistory);
              
              botMessage = {
                id: `bot-${Date.now()}`,
                text: summary,
                isBot: true,
                papers: [paper],
                html: DOMPurify.sanitize(
                  `<div class="paper-info">
                    <h3>${paperDetails.title}</h3>
                    <p><strong>Authors:</strong> ${paperDetails.authors?.join(', ') || 'Unknown'}</p>
                    <p><strong>Publication Date:</strong> ${paperDetails.publishedDate || 'Unknown'}</p>
                    <p><strong>Abstract:</strong> ${paperDetails.abstract || 'No abstract available'}</p>
                    ${summary}
                    <p><a class="paper-link" data-paper-id="${paper.id}" href="#view-paper">View Full Paper</a></p>
                  </div>`,
                  {
                    ALLOWED_TAGS: ['div', 'h3', 'p', 'a', 'strong', 'em', 'ul', 'li', 'ol', 'h4', 'span'],
                    ALLOWED_ATTR: ['href', 'class', 'data-paper-id'],
                  }
                ),
                timestamp: new Date()
              };
            } catch (error) {
              // Remove loading message
              setMessages(prev => prev.filter(msg => msg.id !== loadingMessage.id));
              
              // Fallback if API fails
              console.error(error);
              botMessage = {
                id: `bot-${Date.now()}`,
                text: `Here's information about "${paper.title}". Would you like to view the full paper?`,
                isBot: true,
                papers: [paper],
                html: DOMPurify.sanitize(
                  `<div class="paper-info">
                    <h3>${paper.title}</h3>
                    <p>${paper.abstract || 'No abstract available'}</p>
                    <p><a class="paper-link" data-paper-id="${paper.id}" href="#view-paper">View Full Paper</a></p>
                  </div>`,
                  {
                    ALLOWED_TAGS: ['div', 'h3', 'p', 'a'],
                    ALLOWED_ATTR: ['href', 'class', 'data-paper-id'],
                  }
                ),
                timestamp: new Date()
              };
            }
          } else {
            throw new Error('I could not find the paper you\'re referring to. Please specify a valid paper number or try searching for papers first.');
          }
          break;
          
        case 'full_paper':
          // Show the full paper if a paper is currently in context
          if (currentPaperIdx !== null && cachedPapers[currentPaperIdx]) {
            const paper = cachedPapers[currentPaperIdx];
            setSelectedPaper(paper);
            
            botMessage = {
              id: `bot-${Date.now()}`,
              text: `Opening "${paper.title}" for you.`,
              isBot: true,
              html: DOMPurify.sanitize(
                `<div>Opening the full paper: <strong>${paper.title}</strong></div>`,
                {
                  ALLOWED_TAGS: ['div', 'strong'],
                  ALLOWED_ATTR: [],
                }
              ),
              timestamp: new Date()
            };
          } else if (cachedPapers.length > 0) {
            // If we have papers but no specific one selected, ask which one
            botMessage = {
              id: `bot-${Date.now()}`,
              text: `Which paper would you like to view? Please specify by number (1-${cachedPapers.length}).`,
              isBot: true,
              html: DOMPurify.sanitize(
                `<div>
                  <p>Which paper would you like to view? Please specify by number:</p>
                  <ol>
                    ${cachedPapers.map((p, idx) => 
                      `<li key="${idx}"><span class="paper-link" data-paper-id="${p.id}">${p.title}</span></li>`
                    ).join('')}
                  </ol>
                </div>`,
                {
                  ALLOWED_TAGS: ['div', 'p', 'ol', 'li', 'span'],
                  ALLOWED_ATTR: ['class', 'data-paper-id'],
                }
              ),
              timestamp: new Date()
            };
          } else {
            throw new Error('No papers are available. Please search for papers first.');
          }
          break;
          
        case 'explain':
        case 'follow-up':
          // Handle explanations and follow-up questions
          if (intent === 'follow-up' && !cachedPapers.length) {
            throw new Error('I don\'t have enough context to answer your follow-up question. Could you provide more details or start with a search query?');
          }
          
          const validPapers = cachedPapers.map(paper => ({
            id: paper.id,
            title: paper.title,
            downloadUrl: paper.pdfUrl || '',
            abstract: paper.abstract
          }));
          
          const response = await generateResponse(
            inputMessage, 
            { results: validPapers }, 
            conversationHistory
          );
          
          botMessage = {
            id: `bot-${Date.now()}`,
            text: response.text,
            isBot: true,
            papers: response.papers,
            html: DOMPurify.sanitize(response.html, {
              ALLOWED_TAGS: ['div', 'h2', 'h3', 'ul', 'li', 'ol', 'span', 'p', 'a', 'strong', 'em', 'b', 'i'],
              ALLOWED_ATTR: ['class', 'data-paper-id', 'href', 'style'],
            }),
            timestamp: new Date()
          };
          break;
          
        case 'clarification_needed':
          const clarification = await generateClarificationRequest(inputMessage, conversationHistory);
          botMessage = {
            id: `bot-${Date.now()}`,
            text: clarification,
            isBot: true,
            html: DOMPurify.sanitize(clarification, {
              ALLOWED_TAGS: ['div', 'p', 'ul', 'li', 'a'],
              ALLOWED_ATTR: ['class'],
            }),
            timestamp: new Date()
          };
          break;
          
        case 'out_of_scope':
          const outOfScopeResponse = await generateOutOfScopeResponse(inputMessage);
          botMessage = {
            id: `bot-${Date.now()}`,
            text: outOfScopeResponse,
            isBot: true,
            html: DOMPurify.sanitize(outOfScopeResponse, {
              ALLOWED_TAGS: ['div', 'p', 'ul', 'li', 'a'],
              ALLOWED_ATTR: ['class'],
            }),
            timestamp: new Date()
          };
          break;
          
        case 'comparison':
          if (cachedPapers.length >= 2) {
            const comparison = await generatePaperComparison(cachedPapers, inputMessage, conversationHistory);
            botMessage = {
              id: `bot-${Date.now()}`,
              text: comparison,
              isBot: true,
              html: DOMPurify.sanitize(comparison, {
                ALLOWED_TAGS: ['div', 'h3', 'p', 'ul', 'li', 'a'],
                ALLOWED_ATTR: ['class'],
              }),
              timestamp: new Date()
            };
          } else {
            throw new Error('Please provide at least two papers to compare.');
          }
          break;

        case 'specific_sections':
          if (!currentPaper) {
            throw new Error('No paper is currently selected. Please specify a paper number or search for papers first.');
          }

          const sectionName = extractSectionName(inputMessage);
          if (!sectionName) {
            throw new Error('Please specify a valid section (e.g., methodology, results, conclusion).');
          }

          const paperDetails = await fetchSpecificPaper(currentPaper.id);
          if (paperDetails.fullTextUrl) {
            const sectionContent = await extractSection(currentPaper.id, paperDetails.fullTextUrl, sectionName, cachedPapers);
            if (sectionContent) {
              botMessage = {
                id: `bot-${Date.now()}`,
                text: `Here's the ${sectionName} section of "${currentPaper.title}":\n\n${sectionContent}`,
                isBot: true,
                html: DOMPurify.sanitize(
                  `<div class="paper-info">
                    <h3>${sectionName.charAt(0).toUpperCase() + sectionName.slice(1)} Section of "${currentPaper.title}"</h3>
                    <p>${sectionContent}</p>
                    <p><a class="paper-link" data-paper-id="${currentPaper.id}" href="#view-paper">View Full Paper</a></p>
                  </div>`,
                  {
                    ALLOWED_TAGS: ['div', 'h3', 'p', 'a'],
                    ALLOWED_ATTR: ['href', 'class', 'data-paper-id'],
                  }
                ),
                timestamp: new Date()
              };
            } else {
              botMessage = {
                id: `bot-${Date.now()}`,
                text: `I couldn't find the ${sectionName} section in the paper. Here's a summary instead: ${paperDetails.abstract}`,
                isBot: true,
                html: DOMPurify.sanitize(
                  `<div class="paper-info">
                    <h3>Summary of "${currentPaper.title}"</h3>
                    <p>${paperDetails.abstract || 'No abstract available'}</p>
                    <p><a class="paper-link" data-paper-id="${currentPaper.id}" href="#view-paper">View Full Paper</a></p>
                  </div>`,
                  {
                    ALLOWED_TAGS: ['div', 'h3', 'p', 'a'],
                    ALLOWED_ATTR: ['href', 'class', 'data-paper-id'],
                  }
                ),
                timestamp: new Date()
              };
            }
          } else {
            botMessage = {
              id: `bot-${Date.now()}`,
              text: `I don't have access to the full text of this paper, but you can view it here: ${currentPaper.pdfUrl}`,
              isBot: true,
              html: DOMPurify.sanitize(
                `<div class="paper-info">
                  <p>I don't have access to the full text of this paper, but you can view it here: <a href="${currentPaper.pdfUrl}" target="_blank">${currentPaper.title}</a>.</p>
                </div>`,
                {
                  ALLOWED_TAGS: ['div', 'p', 'a'],
                  ALLOWED_ATTR: ['href', 'target'],
                }
              ),
              timestamp: new Date()
            };
          }
          break;

        default:
          throw new Error('I\'m not sure how to help with that. Could you try rephrasing your question?');
      }
  
      // Add bot message to chat
      setMessages(prev => [...prev, botMessage]);
      
      // Save to Firestore
      await addDoc(collection(db, 'chats'), {
        messages: [userMessage, botMessage],
        userId: user.uid,
        timestamp: serverTimestamp(),
        papers: botMessage.papers || []
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
      toaster.create({
        title: 'Error',
        description: message,
        duration: 5000,
      });

      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        text: message,
        isBot: true,
        html: DOMPurify.sanitize(`<div class="error-message">${message}</div>`, {
          ALLOWED_TAGS: ['div'],
          ALLOWED_ATTR: ['class'],
        }),
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Flex direction="column" h="100vh">
      <Flex p={4} boxShadow="sm" align="center" justify="space-between" bg="blue.800">
        <Text fontSize="xl" fontWeight="bold" color="white">Research Assistant</Text>
        <Button 
          colorScheme="red" 
          onClick={() => signOut(auth)}
          size="sm"
          variant="outline"
          color="white"
          _hover={{ bg: "red.700" }}
        >
          Sign Out
        </Button>
      </Flex>

      <Box flex={1} overflowY="auto" p={4} bg="gray.900">
        {messages.map((msg, idx) => (
          <Flex key={msg.id || idx} mb={4} align="flex-start" gap={3}>
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
                  className="bot-message"
                  css={{
                    '& div': { bg: 'gray.700', p: 3, borderRadius: 'md', boxShadow: 'sm', mb: 3 },
                    '& h2, & h3, & h4': { fontWeight: 'semibold', color: 'white', mb: 2 },
                    '& ul, & ol': { pl: 6, mb: 3 },
                    '& li': { mb: 1 },
                    '& p': { mb: 2, lineHeight: 1.6 },
                    '& a, & .paper-link': { color: 'blue.300', textDecoration: 'underline', cursor: 'pointer', _hover: { color: 'blue.200' } },
                    '& strong, & b': { fontWeight: 'bold', color: 'white' },
                    '& .error-message': { color: 'red.300' },
                  }}
                />
              ) : (
                <Box bg="blue.600" p={3} borderRadius="md" boxShadow="sm">
                  <Text color="white">{msg.text}</Text>
                </Box>
              )}
            </Box>
          </Flex>
        ))}
        <div ref={messagesEndRef} />
      </Box>

      {/* PDF Viewer Dialog */}
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

      {/* Message input */}
      <Flex p={4} gap={2} boxShadow="md" bg="gray.800">
        <Textarea
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder="Ask about research papers..."
          rows={2}
          resize="none"
          disabled={isLoading}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
          bg="gray.700"
          color="white"
          _placeholder={{ color: 'gray.400' }}
          borderColor="gray.600"
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