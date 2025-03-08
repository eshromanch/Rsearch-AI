'use client';

import { Auth } from '@/components/Auth';
import { Chat } from '@/components/Chat';

export default function Home() {
  return (
    <Auth>
      <Chat />
    </Auth>
  );
}