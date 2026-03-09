import { NextResponse } from 'next/server';

/**
 * Check if GitHub OAuth is configured and enabled
 */
export async function GET() {
  const authMode = process.env.AUTH_MODE || 'local';
  const authModeAllowsGitHub = authMode === 'github' || authMode === 'both';
  const hasClientId = !!process.env.GITHUB_CLIENT_ID;
  const hasClientSecret = !!process.env.GITHUB_CLIENT_SECRET;
  const isConfigured = authModeAllowsGitHub && hasClientId && hasClientSecret;

  let message = 'GitHub OAuth is configured';
  if (!authModeAllowsGitHub) {
    message = `GitHub OAuth disabled. AUTH_MODE is "${authMode}" but must be "github" or "both"`;
  } else if (!hasClientId || !hasClientSecret) {
    message = 'GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env.local';
  }

  return NextResponse.json({
    configured: isConfigured,
    authMode,
    hasClientId,
    hasClientSecret,
    message,
  });
}

