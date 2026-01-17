import { NextResponse } from 'next/server';
import { getGitHubToken } from '@/lib/github-auth';

function parseRepoUrl(repoUrl: string) {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    return null;
  }
  const [, owner, repo] = match;
  return { owner, repo: repo.replace(/\.git$/, '') };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const repoUrl = searchParams.get('repoUrl') || '';

  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    return NextResponse.json(
      { ok: false, error: 'Invalid GitHub repository URL' },
      { status: 400 }
    );
  }

  const token = await getGitHubToken();
  const headers: HeadersInit = { Accept: 'application/vnd.github.v3+json' };
  if (token) {
    headers.Authorization = `token ${token}`;
  }

  const result: Record<string, any> = {
    ok: true,
    hasToken: !!token,
    repoUrl,
    repo: `${parsed.owner}/${parsed.repo}`,
  };

  try {
    const userRes = await fetch('https://api.github.com/user', { headers });
    result.userStatus = userRes.status;
    result.userScopes = userRes.headers.get('x-oauth-scopes') || '';
    result.userAcceptedScopes = userRes.headers.get('x-accepted-oauth-scopes') || '';
    result.userRateLimitRemaining = userRes.headers.get('x-ratelimit-remaining') || '';
    result.userRateLimitReset = userRes.headers.get('x-ratelimit-reset') || '';

    if (userRes.ok) {
      const user = await userRes.json();
      result.userLogin = user?.login || null;
    } else {
      result.userError = await userRes.text();
      result.userAuthHeader = userRes.headers.get('www-authenticate') || '';
    }
  } catch (error: any) {
    result.userError = error?.message || 'Failed to call /user';
  }

  try {
    const repoRes = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
      { headers }
    );
    result.repoStatus = repoRes.status;
    result.repoScopes = repoRes.headers.get('x-oauth-scopes') || '';
    result.repoAcceptedScopes = repoRes.headers.get('x-accepted-oauth-scopes') || '';
    result.repoRateLimitRemaining = repoRes.headers.get('x-ratelimit-remaining') || '';
    result.repoRateLimitReset = repoRes.headers.get('x-ratelimit-reset') || '';

    if (repoRes.ok) {
      const repo = await repoRes.json();
      result.repoPrivate = repo?.private ?? null;
      result.repoDefaultBranch = repo?.default_branch || null;
    } else {
      result.repoError = await repoRes.text();
      result.repoAuthHeader = repoRes.headers.get('www-authenticate') || '';
    }
  } catch (error: any) {
    result.repoError = error?.message || 'Failed to call /repos/{owner}/{repo}';
  }

  return NextResponse.json(result);
}

