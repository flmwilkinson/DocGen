'use client';

import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FileText, Mail, Lock, Loader2, Github, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGitHubLoading, setIsGitHubLoading] = useState(false);
  const [error, setError] = useState('');
  const [githubOAuthConfigured, setGithubOAuthConfigured] = useState<boolean | null>(null);

  // Check if GitHub OAuth is configured
  useEffect(() => {
    fetch('/api/auth/check-github-oauth')
      .then(res => res.json())
      .then(data => {
        setGithubOAuthConfigured(data.configured);
        if (!data.configured) {
          console.warn('[GitHub OAuth] Not configured:', data.message);
        }
      })
      .catch(() => setGithubOAuthConfigured(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid email or password');
      } else {
        router.push('/projects');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGitHubSignIn = async () => {
    if (!githubOAuthConfigured) {
      setError('GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in your .env.local file and restart the server.');
      return;
    }

    setIsGitHubLoading(true);
    setError('');

    try {
      const result = await signIn('github', { 
        callbackUrl: '/projects',
        redirect: true 
      });
      
      // If redirect is true, this won't execute, but if it does, check for errors
      if (result?.error) {
        setError(`GitHub sign-in failed: ${result.error}`);
        setIsGitHubLoading(false);
      }
    } catch (err: any) {
      setError(`Failed to sign in with GitHub: ${err.message || 'Unknown error'}`);
      setIsGitHubLoading(false);
    }
  };

  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-orange">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-semibold">DocGen.AI</span>
          </Link>
        </div>

        {/* Login Card */}
        <div className="glass-card">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold">Welcome Back</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to continue to DocGen.AI
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="input-glass pl-10"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-glass pl-10"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-glass-border"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-glass-bg px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          {githubOAuthConfigured === false && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
              <div className="text-xs text-yellow-200/90">
                <p className="font-medium mb-1">GitHub OAuth Not Configured</p>
                <p>To enable GitHub sign-in, add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to your .env.local file and restart the server.</p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleGitHubSignIn}
            disabled={isLoading || isGitHubLoading || githubOAuthConfigured === false}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-glass-border hover:border-brand-orange/50 transition-all bg-glass-bg hover:bg-glass-bg/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGitHubLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Connecting to GitHub...
              </>
            ) : (
              <>
                <Github className="h-5 w-5" />
                Sign in with GitHub
              </>
            )}
          </button>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            <p>
              Demo credentials:{' '}
              <code className="rounded bg-glass-bg px-1">demo@docgen.ai</code> /{' '}
              <code className="rounded bg-glass-bg px-1">demo123</code>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/help" className="text-brand-orange hover:underline">
            Contact us
          </Link>
        </p>
      </div>
    </main>
  );
}

