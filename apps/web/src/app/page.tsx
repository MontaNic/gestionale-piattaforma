'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { isAuthenticated } from '@/lib/auth';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated()) {
      router.replace('/dashboard');
    } else {
      router.replace('/login');
    }
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Reindirizzamento...</p>
    </main>
  );
}
