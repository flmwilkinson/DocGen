import NextAuth, { type NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GitHubProvider from 'next-auth/providers/github';

// Auth mode: 'local' for credentials only, 'github' for GitHub OAuth, 'both' for both
const AUTH_MODE = process.env.AUTH_MODE || 'local';

// Demo user for local development (always available)
const DEMO_USER = {
  id: '1',
  email: 'demo@docgen.ai',
  name: 'Demo User',
  password: 'demo123',
};

// Additional local users (can be configured via environment)
// Format: email:password:name (separated by |)
const ADDITIONAL_USERS = process.env.LOCAL_USERS?.split('|').map(u => {
  const [email, password, name] = u.split(':');
  return { id: email, email, password, name: name || email.split('@')[0] };
}) || [];

// Stable secret for development - ensures sessions persist across restarts
const DEV_SECRET = 'docgen-development-secret-do-not-use-in-production-12345';

export const authOptions: NextAuthOptions = {
  // Use stable secret for dev, env var for production
  secret: process.env.NEXTAUTH_SECRET || DEV_SECRET,
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // Check demo user
        if (
          credentials.email === DEMO_USER.email &&
          credentials.password === DEMO_USER.password
        ) {
          return {
            id: DEMO_USER.id,
            email: DEMO_USER.email,
            name: DEMO_USER.name,
          };
        }

        // Check additional local users (from environment)
        const localUser = ADDITIONAL_USERS.find(
          u => u.email === credentials.email && u.password === credentials.password
        );
        if (localUser) {
          return {
            id: localUser.id,
            email: localUser.email,
            name: localUser.name,
          };
        }

        // TODO: Database authentication (when needed)
        // const user = await prisma.user.findUnique({
        //   where: { email: credentials.email },
        // });
        // if (user && await bcrypt.compare(credentials.password, user.password)) {
        //   return user;
        // }

        return null;
      },
    }),
    // Only include GitHub provider if AUTH_MODE is 'github' or 'both' AND credentials are configured
    ...((AUTH_MODE === 'github' || AUTH_MODE === 'both') &&
       process.env.GITHUB_CLIENT_ID &&
       process.env.GITHUB_CLIENT_SECRET
      ? [GitHubProvider({
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
          authorization: {
            params: {
              scope: 'read:user user:email repo', // Request repo access for private repos
            },
          },
        })]
      : []),
  ],
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    // Session lasts 30 days
    maxAge: 30 * 24 * 60 * 60,
    // Update session every 24 hours
    updateAge: 24 * 60 * 60,
  },
  jwt: {
    // JWT lasts 30 days
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      // Log sign-in attempts for debugging
      console.log('[NextAuth] Sign-in attempt:', {
        provider: account?.provider,
        userId: user?.id,
        email: user?.email,
        hasProfile: !!profile,
      });
      return true; // Allow sign-in
    },
    async jwt({ token, user, account }) {
      // Store GitHub access token in JWT
      if (account?.provider === 'github' && account.access_token) {
        token.githubAccessToken = account.access_token;
        console.log('[NextAuth] GitHub token stored in JWT');
      }
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id: string }).id = token.id as string;
      }
      // Include GitHub access token in session
      (session as any).githubAccessToken = token.githubAccessToken;
      return session;
    },
    async redirect({ url, baseUrl }) {
      // Log redirects for debugging
      console.log('[NextAuth] Redirect:', { url, baseUrl });
      // Allow relative URLs and URLs starting with base
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      if (url.startsWith(baseUrl)) return url;
      return baseUrl;
    },
  },
  // Enable debug mode temporarily to diagnose GitHub OAuth issue
  debug: process.env.NODE_ENV === 'development',
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };

