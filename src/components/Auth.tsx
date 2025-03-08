'use client';

import { Button, Flex, Text } from '@chakra-ui/react';
import { auth, GoogleAuthProvider, signInWithPopup } from '@/lib/firebase';
import { useEffect, useState } from 'react';
import { User } from 'firebase/auth';

export const Auth = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setUser(user);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  if (loading) {
    return (
      <Flex justify="center" align="center" h="100vh">
        <Text>Loading...</Text>
      </Flex>
    );
  }

  if (!user) {
    return (
      <Flex justify="center" align="center" h="100vh" direction="column" gap={4}>
        <Text fontSize="xl">Please sign in to access the research chatbot</Text>
        <Button 
          colorScheme="blue" 
          onClick={handleSignIn}
          size="lg"
        >
          Sign in with Google
        </Button>
      </Flex>
    );
  }

  return <>{children}</>;
};