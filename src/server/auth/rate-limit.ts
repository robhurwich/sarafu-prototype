import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "~/utils/cache/kv";

// In mock mode, use a no-op rate limiter that always allows requests
const mockRatelimit = {
  // eslint-disable-next-line @typescript-eslint/require-await
  limit: async (_id: string) => ({
    success: true as const,
    limit: 100,
    remaining: 99,
    reset: 0,
    pending: Promise.resolve(),
  }),
} as unknown as Ratelimit;

const isMock = process.env.NEXT_PUBLIC_MOCK_MODE === "true";

export const nonceRateLimit = isMock
  ? mockRatelimit
  : new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "60 s"),
      prefix: "rl:auth:nonce",
    });

export const verifyRateLimit = isMock
  ? mockRatelimit
  : new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "60 s"),
      prefix: "rl:auth:verify",
    });

export const sessionRateLimit = isMock
  ? mockRatelimit
  : new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, "60 s"),
      prefix: "rl:auth:session",
    });

export const signoutRateLimit = isMock
  ? mockRatelimit
  : new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "60 s"),
      prefix: "rl:auth:signout",
    });
