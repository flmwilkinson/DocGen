'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Bell, Search, Settings, LogOut, User, Moon, Sun, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useProjectsStore } from '@/store/projects';
import { notificationService } from '@/lib/notifications';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Header() {
  const { data: session } = useSession();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const runs = useProjectsStore((state) => state.runs);
  const getProject = useProjectsStore((state) => state.getProject);
  
  // Get running and recent completed runs
  const runningRuns = runs.filter(r => r.status === 'RUNNING');
  const recentCompleted = runs
    .filter(r => r.status === 'COMPLETED' && r.completedAt)
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())
    .slice(0, 5);
  
  const hasNotifications = runningRuns.length > 0 || recentCompleted.length > 0;

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      // TODO: Implement search - for now just show alert
      alert(`Search functionality coming soon! You searched for: "${searchQuery}"`);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-glass-border bg-background/50 px-6 backdrop-blur-xl supports-[backdrop-filter]:bg-background/30">
      {/* Search */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearch}
            placeholder="Search projects, templates, documents..."
            className="input-glass w-full pl-10"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4">
        {/* Theme Toggle */}
        <button 
          className="btn-ghost p-2"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>
        
        {/* Notifications */}
        <div className="relative">
          <button 
            className="btn-ghost p-2 relative"
            onClick={() => setShowNotifications(!showNotifications)}
            title="Generation notifications"
          >
            <Bell className="h-4 w-4" />
            {hasNotifications && (
              <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-brand-orange animate-pulse" />
            )}
          </button>
          
          {/* Notifications Dropdown */}
          {showNotifications && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setShowNotifications(false)}
              />
              <div className="absolute right-0 top-full mt-2 w-80 glass-panel z-50 shadow-2xl">
                <div className="p-4 border-b border-glass-border">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Generation Status</h3>
                    <button
                      onClick={() => setShowNotifications(false)}
                      className="p-1 hover:bg-glass-bg rounded"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                
                <div className="max-h-96 overflow-y-auto custom-scrollbar">
                  {/* Running Generations */}
                  {runningRuns.length > 0 && (
                    <div className="p-4 border-b border-glass-border">
                      <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                        Running ({runningRuns.length})
                      </p>
                      <div className="space-y-2">
                        {runningRuns.map((run) => {
                          const project = getProject(run.projectId);
                          return (
                            <div
                              key={run.id}
                              className="flex items-center gap-3 p-2 rounded-lg bg-glass-bg"
                            >
                              <Loader2 className="h-4 w-4 animate-spin text-brand-orange shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{run.templateName}</p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {project?.name || 'Unknown project'}
                                </p>
                                <div className="mt-1 w-full h-1 bg-glass-bg rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-brand-orange transition-all duration-300"
                                    style={{ width: `${run.progress}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  
                  {/* Recent Completed */}
                  {recentCompleted.length > 0 && (
                    <div className="p-4">
                      <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                        Recent ({recentCompleted.length})
                      </p>
                      <div className="space-y-2">
                        {recentCompleted.map((run) => {
                          const project = getProject(run.projectId);
                          return (
                            <button
                              key={run.id}
                              onClick={() => {
                                router.push(`/projects/${run.projectId}/runs/${run.id}`);
                                setShowNotifications(false);
                              }}
                              className="w-full flex items-center gap-3 p-2 rounded-lg bg-glass-bg hover:bg-glass-bg-light transition-colors text-left"
                            >
                              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{run.templateName}</p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {project?.name || 'Unknown project'}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  
                  {/* Empty State */}
                  {!hasNotifications && (
                    <div className="p-8 text-center">
                      <Bell className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No active generations</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg p-2 transition-colors hover:bg-glass-bg">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-orange/20 text-brand-orange">
                <User className="h-4 w-4" />
              </div>
              <span className="text-sm font-medium">
                {session?.user?.name || 'User'}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{session?.user?.name}</p>
              <p className="text-xs text-muted-foreground">
                {session?.user?.email}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push('/settings')}>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/settings')}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

