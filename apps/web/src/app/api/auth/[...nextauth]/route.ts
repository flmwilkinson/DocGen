import NextAuth, { type NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GitHubProvider from 'next-auth/providers/github';

// Demo user for local development
const DEMO_USER = {
  id: '1',
  email: 'demo@docgen.ai',
  name: 'Demo User',
  password: 'demo123',
};

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

        // In production, validate against database
        // For now, use demo credentials
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

        // TODO: Implement actual database authentication
        // const user = await prisma.user.findUnique({
        //   where: { email: credentials.email },
        // });
        // if (user && await bcrypt.compare(credentials.password, user.password)) {
        //   return user;
        // }

        return null;
      },
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      authorization: {
        params: {
          scope: 'read:user user:email repo', // Request repo access for private repos
        },
      },
      // Only enable if credentials are configured
      ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET ? {} : {
        // If not configured, this provider will be disabled
        // We'll show an error message in the UI instead
      }),
    }),
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
    async jwt({ token, user, account }) {
      // Store GitHub access token in JWT
      if (account?.provider === 'github' && account.access_token) {
        token.githubAccessToken = account.access_token;
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
  },
  // Reduce unnecessary debug logging
  debug: false,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };

