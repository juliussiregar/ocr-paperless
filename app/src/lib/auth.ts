import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

/** Remember me ON: 30 days. OFF: 8 hours. */
const SESSION_MAX_AGE_REMEMBER = 30 * 24 * 60 * 60;
const SESSION_MAX_AGE_SHORT = 8 * 60 * 60;

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        remember: { label: "Remember me", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: String(credentials.email) },
        });

        if (!user) return null;

        const valid = await bcrypt.compare(
          String(credentials.password),
          user.passwordHash
        );

        if (!valid) return null;

        // Default ON when omitted (e.g. older clients)
        const rememberRaw = credentials.remember;
        const remember =
          rememberRaw === undefined ||
          rememberRaw === null ||
          rememberRaw === "" ||
          String(rememberRaw) === "true";

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          rememberMe: remember,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.roleCheckedAt = Date.now();
        const rememberMe = user.rememberMe !== false;
        token.rememberMe = rememberMe;
        const maxAge = rememberMe
          ? SESSION_MAX_AGE_REMEMBER
          : SESSION_MAX_AGE_SHORT;
        token.sessionEndsAt = Math.floor(Date.now() / 1000) + maxAge;
      }

      const endsAt = token.sessionEndsAt as number | undefined;
      if (endsAt && Math.floor(Date.now() / 1000) > endsAt) {
        return {};
      }

      // Refresh role from DB every 5 minutes (or on update)
      const checkedAt = (token.roleCheckedAt as number) ?? 0;
      const needsRefresh =
        trigger === "update" || Date.now() - checkedAt > 5 * 60 * 1000;

      if (needsRefresh && token.id && process.env.NEXT_RUNTIME !== "edge") {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { role: true, email: true, name: true },
          });
          if (!dbUser) {
            return {};
          }
          token.role = dbUser.role;
          token.email = dbUser.email;
          token.name = dbUser.name;
          token.roleCheckedAt = Date.now();
        } catch {
          // keep existing token on DB blip
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (!token.id) {
          session.user.id = "";
          session.user.role = "";
        } else {
          session.user.id = token.id as string;
          session.user.role = token.role as string;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    // Cookie/JWT ceiling = remember duration; short sessions enforced via sessionEndsAt
    maxAge: SESSION_MAX_AGE_REMEMBER,
  },
});
