import { NextResponse } from 'next/server';
import { getGitHubToken } from '@/lib/github-auth';

/**
 * API route to get GitHub token (server-side only)
 * This allows client components to access the token without exposing it
 */
export async function GET() {
  try {
    const token = await getGitHubToken();
    
    if (!token) {
      return NextResponse.json(
        { 
          hasToken: false,
          message: 'No GitHub authentication found. Set GITHUB_TOKEN env var or use GitHub CLI (gh auth login)' 
        },
        { status: 200 }
      );
    }

    // Return that we have a token, but don't expose it
    // The token will be used server-side in API calls
    return NextResponse.json({ 
      hasToken: true,
      message: 'GitHub authentication available'
    });
  } catch (error) {
    console.error('[GitHub Token API] Error:', error);
    return NextResponse.json(
      { hasToken: false, error: 'Failed to check GitHub authentication' },
      { status: 500 }
    );
  }
}

