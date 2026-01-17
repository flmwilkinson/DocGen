import { NextResponse } from 'next/server';

/**
 * Check if GitHub OAuth is configured
 */
export async function GET() {
  const hasClientId = !!process.env.GITHUB_CLIENT_ID;
  const hasClientSecret = !!process.env.GITHUB_CLIENT_SECRET;
  const isConfigured = hasClientId && hasClientSecret;

  return NextResponse.json({
    configured: isConfigured,
    hasClientId,
    hasClientSecret,
    message: isConfigured 
      ? 'GitHub OAuth is configured'
      : 'GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in your .env.local file',
  });
}

