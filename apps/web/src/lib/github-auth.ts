/**
 * GitHub Authentication Helper
 * 
 * Scalable OAuth-based authentication for multi-user access.
 * 
 * Priority order:
 * 1. NextAuth OAuth session token (primary - works for all users)
 * 2. Environment variables (fallback for local dev)
 * 3. GitHub CLI (fallback for local dev)
 */

import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

/**
 * Get GitHub token from various sources (server-side)
 * Priority: 1) OAuth session token (scalable), 2) Env vars (dev), 3) GitHub CLI (dev)
 */
export async function getGitHubToken(): Promise<string | null> {
  // 1. PRIMARY: Check NextAuth OAuth session (scalable - works for any user)
  // This is the production approach - each user authenticates with their own GitHub account
  try {
    const session = await getServerSession(authOptions);
    const sessionToken = (session as any)?.githubAccessToken;
    if (sessionToken) {
      console.log('[GitHub Auth] Using OAuth session token');
      return sessionToken;
    }
  } catch (error) {
    console.warn('[GitHub Auth] Session check failed:', error);
  }

  // 2. FALLBACK: Environment variables (for local development/testing)
  const envToken = process.env.GITHUB_TOKEN || 
                   process.env.GITHUB_PAT || 
                   process.env.NEXT_PUBLIC_GITHUB_TOKEN;
  if (envToken) {
    console.log('[GitHub Auth] Using environment variable token');
    return envToken;
  }

  // 3. FALLBACK: GitHub CLI (for local development)
  // This works if user has `gh` CLI installed and authenticated
  try {
    const { execSync } = require('child_process');
    const token = execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (token) {
      console.log('[GitHub Auth] Using GitHub CLI token');
      return token;
    }
  } catch (error) {
    // GitHub CLI not installed or not authenticated
  }

  console.warn('[GitHub Auth] No GitHub token found - will only work for public repos');
  return null;
}

/**
 * Get GitHub token from session (client-side)
 * For client components that need to check if user is authenticated
 */
export function getGitHubTokenFromSession(session: any): string | null {
  // Check OAuth session token
  const sessionToken = session?.githubAccessToken;
  if (sessionToken) {
    return sessionToken;
  }

  // Note: We don't check env vars here because:
  // 1. Client-side env vars (NEXT_PUBLIC_*) are shared across all users (not scalable)
  // 2. Server-side env vars aren't accessible in the browser
  // For scalability, users should authenticate via OAuth

  return null;
}

/**
 * Check if GitHub authentication is available
 */
export async function hasGitHubAuth(): Promise<boolean> {
  const token = await getGitHubToken();
  return token !== null;
}
