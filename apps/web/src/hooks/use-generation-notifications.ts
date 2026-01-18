/**
 * Hook to monitor generation runs and show notifications
 * This runs globally to track all running generations
 * 
 * OPTIMIZED: Uses store subscription with selector to minimize re-renders
 */

import { useEffect, useRef } from 'react';
import { useProjectsStore } from '@/store/projects';
import { notificationService } from '@/lib/notifications';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

export function useGenerationNotifications() {
  const router = useRouter();
  const initializedRef = useRef(false);
  
  // Only subscribe to run status changes, not the full runs array
  // This returns a stable string that only changes when run statuses change
  const runStatusKey = useProjectsStore((state) => 
    state.runs.map(r => `${r.id}:${r.status}`).join(',')
  );

  useEffect(() => {
    // Only initialize once
    if (initializedRef.current) return;
    initializedRef.current = true;
    
    // Expose store state to notification service
    if (typeof window !== 'undefined') {
      (window as any).__getProjectsStoreState = () => useProjectsStore.getState();
      
      // Set up global notification handler
      (window as any).__showGenerationNotification = (notification: {
        type: 'success' | 'error';
        title: string;
        body: string;
        runId: string;
        projectId: string;
      }) => {
        if (notification.type === 'success') {
          toast.success(notification.title, {
            description: notification.body,
            action: {
              label: 'View',
              onClick: () => {
                router.push(`/projects/${notification.projectId}/runs/${notification.runId}`);
              },
            },
            duration: 10000,
          });
        } else {
          toast.error(notification.title, {
            description: notification.body,
            action: {
              label: 'Go to Project',
              onClick: () => {
                router.push(`/projects/${notification.projectId}`);
              },
            },
            duration: 10000,
          });
        }
      };
    }

    // Check for any running generations on mount and start tracking them
    const store = useProjectsStore.getState();
    const runningRuns = store.runs.filter(r => r.status === 'RUNNING');
    runningRuns.forEach(run => {
      const project = store.getProject(run.projectId);
      if (project) {
        notificationService.startTracking(
          run.id,
          run.projectId,
          project.name,
          run.templateName
        );
      }
    });

    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).__showGenerationNotification;
        delete (window as any).__getProjectsStoreState;
      }
    };
  }, [router]);

  // Monitor runs for status changes - only triggers when runStatusKey changes
  useEffect(() => {
    const store = useProjectsStore.getState();
    store.runs.forEach(run => {
      if (run.status === 'COMPLETED' || run.status === 'FAILED') {
        notificationService.stopTracking(run.id);
      } else if (run.status === 'RUNNING') {
        const project = store.getProject(run.projectId);
        if (project) {
          notificationService.startTracking(
            run.id,
            run.projectId,
            project.name,
            run.templateName
          );
        }
      }
    });
  }, [runStatusKey]);
}

