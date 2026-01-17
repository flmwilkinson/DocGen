/**
 * Hook to monitor generation runs and show notifications
 * This runs globally to track all running generations
 */

import { useEffect } from 'react';
import { useProjectsStore } from '@/store/projects';
import { notificationService } from '@/lib/notifications';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

export function useGenerationNotifications() {
  const router = useRouter();
  const runs = useProjectsStore((state) => state.runs);
  const store = useProjectsStore.getState();

  useEffect(() => {
    // Expose store state to notification service
    if (typeof window !== 'undefined') {
      (window as any).__getProjectsStoreState = () => store;
      
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
    const runningRuns = runs.filter(r => r.status === 'RUNNING');
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
  }, []); // Only run on mount

  // Monitor runs for status changes
  useEffect(() => {
    runs.forEach(run => {
      if (run.status === 'COMPLETED' || run.status === 'FAILED') {
        // Stop tracking completed/failed runs
        notificationService.stopTracking(run.id);
      } else if (run.status === 'RUNNING') {
        // Start tracking if not already tracked
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
  }, [runs, store]);
}

