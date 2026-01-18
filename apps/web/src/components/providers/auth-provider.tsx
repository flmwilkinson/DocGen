'use client';

import { SessionProvider } from 'next-auth/react';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      // Disable automatic refetching to prevent blocking navigation
      refetchInterval={0}
      refetchOnWindowFocus={false}
      // Use cached session immediately, don't wait for server check
      refetchWhenOffline={false}
    >
      {children}
    </SessionProvider>
  );
}

