// src/hooks/useChat.ts
import { useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

export const useChat = (userId: string) => {
  // const [messages, setMessages] = useState<any[]>([]);
  const [messages, setMessages] = useState<{ id: string; text: string }[]>([]);


  useEffect(() => {
    if (!userId) return;
    
    const unsubscribe = onSnapshot(doc(db, 'chats', userId), (doc) => {
      if (doc.exists()) {
        setMessages(doc.data().messages);
      }
    });

    return () => unsubscribe();
  }, [userId]);

  return messages;
};