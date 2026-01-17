/**
 * Notification system for document generation
 * Tracks running generations and notifies when complete
 */

export interface GenerationNotification {
  runId: string;
  projectId: string;
  projectName: string;
  templateName: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  createdAt: Date;
}

class NotificationService {
  private runningGenerations: Map<string, GenerationNotification> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private notificationPermission: NotificationPermission = 'default';

  constructor() {
    if (typeof window !== 'undefined') {
      // Request notification permission
      if ('Notification' in window) {
        this.requestPermission();
      }
    }
  }

  async requestPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      this.notificationPermission = await Notification.requestPermission();
    } else if ('Notification' in window) {
      this.notificationPermission = Notification.permission;
    }
  }

  startTracking(runId: string, projectId: string, projectName: string, templateName: string) {
    this.runningGenerations.set(runId, {
      runId,
      projectId,
      projectName,
      templateName,
      status: 'RUNNING',
      createdAt: new Date(),
    });

    // Start checking if not already running
    if (!this.checkInterval) {
      this.startPolling();
    }
  }

  stopTracking(runId: string) {
    this.runningGenerations.delete(runId);
    
    // Stop polling if no more running generations
    if (this.runningGenerations.size === 0 && this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private startPolling() {
    // Check every 2 seconds for status updates
    this.checkInterval = setInterval(() => {
      this.checkStatus();
    }, 2000);
  }

  private checkStatus() {
    if (this.runningGenerations.size === 0) return;

    // Get store state - this will be called from the hook which has access to the store
    const storeState = (window as any).__getProjectsStoreState?.();
    if (!storeState) return;

    for (const [runId, notification] of this.runningGenerations.entries()) {
      const run = storeState.getRun(runId);
      
      if (!run) {
        // Run was deleted, stop tracking
        this.stopTracking(runId);
        continue;
      }

      // Check if status changed
      if (run.status !== notification.status) {
        const oldStatus = notification.status;
        notification.status = run.status;

        if (run.status === 'COMPLETED' && oldStatus === 'RUNNING') {
          this.showCompletionNotification(notification, run);
          this.stopTracking(runId);
        } else if (run.status === 'FAILED' && oldStatus === 'RUNNING') {
          this.showFailureNotification(notification);
          this.stopTracking(runId);
        }
      }
    }
  }

  private showCompletionNotification(notification: GenerationNotification, run: any) {
    const title = 'Document Generation Complete!';
    const body = `${notification.templateName} for ${notification.projectName} is ready to view.`;

    // Show browser notification
    if ('Notification' in window && this.notificationPermission === 'granted') {
      const browserNotification = new Notification(title, {
        body,
        icon: '/favicon.ico',
        tag: notification.runId,
        requireInteraction: false,
      });

      browserNotification.onclick = () => {
        window.focus();
        window.location.href = `/projects/${notification.projectId}/runs/${notification.runId}`;
        browserNotification.close();
      };
    }

    // Show toast notification (will be handled by the component)
    if (typeof window !== 'undefined' && (window as any).__showGenerationNotification) {
      (window as any).__showGenerationNotification({
        type: 'success',
        title,
        body,
        runId: notification.runId,
        projectId: notification.projectId,
      });
    }
  }

  private showFailureNotification(notification: GenerationNotification) {
    const title = 'Document Generation Failed';
    const body = `Failed to generate ${notification.templateName} for ${notification.projectName}.`;

    // Show browser notification
    if ('Notification' in window && this.notificationPermission === 'granted') {
      const browserNotification = new Notification(title, {
        body,
        icon: '/favicon.ico',
        tag: notification.runId,
        requireInteraction: false,
      });

      browserNotification.onclick = () => {
        window.focus();
        window.location.href = `/projects/${notification.projectId}`;
        browserNotification.close();
      };
    }

    // Show toast notification
    if (typeof window !== 'undefined' && (window as any).__showGenerationNotification) {
      (window as any).__showGenerationNotification({
        type: 'error',
        title,
        body,
        runId: notification.runId,
        projectId: notification.projectId,
      });
    }
  }

  getRunningCount(): number {
    return this.runningGenerations.size;
  }

  hasRunningGenerations(): boolean {
    return this.runningGenerations.size > 0;
  }
}

// Singleton instance
export const notificationService = new NotificationService();

