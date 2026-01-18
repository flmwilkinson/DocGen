'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { Loader2 } from 'lucide-react';
import { useGenerationNotifications } from '@/hooks/use-generation-notifications';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use cached session immediately, don't block on loading
  const { data: session, status } = useSession({ required: false });
  const router = useRouter();
  
  // Initialize generation notifications (non-blocking)
  useGenerationNotifications();

  // Redirect only if definitely unauthenticated (not during loading)
  useEffect(() => {
    // Only redirect if we're certain the user is not authenticated
    // Don't block navigation during the initial session check
    if (status === 'unauthenticated' && session === null) {
      router.push('/login');
    }
  }, [status, session, router]);

  // Show loading only on initial mount, not on navigation
  const isInitialLoad = useMemo(() => {
    if (typeof window === 'undefined') return true;
    return !(window as any).__sessionInitialized;
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__sessionInitialized = true;
    }
  }, []);

  // Only show loading spinner on very first load
  if (isInitialLoad && status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-orange" />
      </div>
    );
  }

  // If no session after initial load, show nothing (will redirect)
  if (!session && status === 'unauthenticated') {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col pl-64 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

