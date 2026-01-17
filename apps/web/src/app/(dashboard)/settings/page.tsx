'use client';

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useSession, signIn, signOut } from 'next-auth/react';
import { Key, Palette, Moon, Sun, Check, AlertCircle, Loader2, Github, CheckCircle2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getGitHubTokenFromSession } from '@/lib/github-auth';

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { data: session } = useSession();
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  
  // Check if user has GitHub OAuth token
  const githubToken = getGitHubTokenFromSession(session);
  const isGitHubConnected = !!githubToken;

  // Handle theme toggle
  useEffect(() => {
    setMounted(true);
  }, []);

  const [isMasked, setIsMasked] = useState(false);

  // Load API key from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedKey = localStorage.getItem('openai_api_key') || '';
      if (storedKey) {
        // Show masked version
        setApiKey('•'.repeat(Math.min(storedKey.length, 20)));
        setIsMasked(true);
      }
    }
  }, []);

  const handleSaveApiKey = async () => {
    if (!apiKey.trim() || isMasked) {
      toast.error('Please enter a valid API key');
      return;
    }

    if (!apiKey.startsWith('sk-')) {
      toast.error('Invalid API key format. OpenAI keys start with "sk-"');
      return;
    }

    setIsSaving(true);
    try {
      // Store in localStorage (in production, this should be encrypted and stored server-side)
      localStorage.setItem('openai_api_key', apiKey);
      toast.success('API key saved successfully');
      // Mask the key in the input
      setApiKey('•'.repeat(Math.min(apiKey.length, 20)));
      setIsMasked(true);
    } catch (error) {
      toast.error('Failed to save API key');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApiKeyChange = (value: string) => {
    // If clicking on masked key, clear it
    if (isMasked && value.length < apiKey.length) {
      setApiKey('');
      setIsMasked(false);
      return;
    }
    // Only allow changes if it's not masked
    if (!isMasked) {
      setApiKey(value);
    }
  };

  const handleApiKeyFocus = () => {
    // Clear masked key when focused
    if (isMasked) {
      setApiKey('');
      setIsMasked(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden p-6">
      {/* Header */}
      <div className="shrink-0 mb-6">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your application preferences
        </p>
      </div>

      {/* Settings Sections - Scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="space-y-6 pb-4">
          {/* Appearance Settings */}
          <div className="glass-panel p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-orange/10">
                <Palette className="h-5 w-5 text-brand-orange" />
              </div>
              <div>
                <h2 className="text-lg font-medium">Appearance</h2>
                <p className="text-sm text-muted-foreground">
                  Choose your preferred theme
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setTheme('light')}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg border transition-all",
                  theme === 'light'
                    ? "border-brand-orange bg-brand-orange/10 text-brand-orange"
                    : "border-glass-border hover:border-brand-orange/50"
                )}
              >
                <Sun className="h-4 w-4" />
                Light
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg border transition-all",
                  theme === 'dark'
                    ? "border-brand-orange bg-brand-orange/10 text-brand-orange"
                    : "border-glass-border hover:border-brand-orange/50"
                )}
              >
                <Moon className="h-4 w-4" />
                Dark
              </button>
              {mounted && theme === 'system' && (
                <button
                  onClick={() => setTheme('system')}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-brand-orange bg-brand-orange/10 text-brand-orange"
                >
                  System
                </button>
              )}
            </div>
          </div>

          {/* API Key Configuration */}
          <div className="glass-panel p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-orange/10">
                <Key className="h-5 w-5 text-brand-orange" />
              </div>
              <div>
                <h2 className="text-lg font-medium">OpenAI API Key</h2>
                <p className="text-sm text-muted-foreground">
                  Required for document generation. Your key is stored locally in your browser.
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex gap-4">
                <input
                  type={isMasked ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  onFocus={handleApiKeyFocus}
                  placeholder="sk-..."
                  className="input-glass flex-1"
                />
                <button
                  onClick={handleSaveApiKey}
                  disabled={isSaving || !apiKey.trim() || isMasked}
                  className="btn-primary disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Save
                    </>
                  )}
                </button>
              </div>
              <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
                <p className="text-xs text-yellow-200/90">
                  <strong>Note:</strong> For production use, API keys should be stored securely on the server. 
                  This is a demo implementation that stores keys in browser localStorage.
                </p>
              </div>
            </div>
          </div>

          {/* GitHub Connection */}
          <div className="glass-panel p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-orange/10">
                <Github className="h-5 w-5 text-brand-orange" />
              </div>
              <div>
                <h2 className="text-lg font-medium">GitHub Connection</h2>
                <p className="text-sm text-muted-foreground">
                  Connect your GitHub account to access your repositories
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {isGitHubConnected ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                    <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-green-400">GitHub Connected</p>
                      <p className="text-xs text-muted-foreground">
                        You can access all your GitHub repositories (public and private)
                      </p>
                    </div>
                  </div>
                  {session?.user?.image && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-glass-bg border border-glass-border">
                      <img 
                        src={session.user.image} 
                        alt={session.user.name || 'GitHub'} 
                        className="h-8 w-8 rounded-full"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{session.user.name}</p>
                        <p className="text-xs text-muted-foreground">{session.user.email}</p>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => signOut({ callbackUrl: '/settings' })}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-red-500/30 hover:border-red-500/50 transition-all bg-red-500/10 hover:bg-red-500/20 text-red-400"
                  >
                    <LogOut className="h-4 w-4" />
                    Disconnect GitHub
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                    <AlertCircle className="h-5 w-5 text-yellow-400 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-yellow-400">GitHub Not Connected</p>
                      <p className="text-xs text-muted-foreground">
                        Connect your GitHub account to access private repositories and generate documentation
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => signIn('github', { callbackUrl: '/settings' })}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-glass-border hover:border-brand-orange/50 transition-all bg-glass-bg hover:bg-glass-bg/80"
                  >
                    <Github className="h-5 w-5" />
                    Connect GitHub Account
                  </button>
                  <div className="p-3 rounded-lg bg-glass-bg border border-glass-border">
                    <p className="text-xs font-medium mb-2">Why connect?</p>
                    <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                      <li>Access your private repositories</li>
                      <li>Generate documentation for any repo you own or have access to</li>
                      <li>No need to set up tokens manually - works automatically</li>
                      <li>Secure OAuth authentication - we never see your password</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

