import { Ratelimit } from "@upstash/ratelimit";
import { TRPCError } from "@trpc/server";
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

export const otpRequestRateLimit = isMock
  ? mockRatelimit
  : new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, "60 s"),
      prefix: "rl:otp:request",
    });

export const otpVerifyRateLimit = isMock
  ? mockRatelimit
  : new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "60 s"),
      prefix: "rl:otp:verify",
    });

export const onrampTriggerRateLimit = isMock
  ? mockRatelimit
  : new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, "300 s"),
      prefix: "rl:onramp:trigger",
    });

/**
 * tRPC-flavoured rate-limit check. Hits `limiter.limit(key)` for each key in
 * `identifiers`; the first refusal throws `TOO_MANY_REQUESTS`. Fails open if
 * Redis is unreachable (matches `checkRateLimit` behaviour for HTTP routes).
 */
export async function assertRateOk(
  limiter: Ratelimit,
  ...identifiers: string[]
): Promise<void> {
  for (const id of identifiers) {
    if (!id) continue;
    try {
      const { success, reset } = await limiter.limit(id);
      if (!success) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Try again in ${Math.max(1, Math.ceil((reset - Date.now()) / 1000))}s.`,
        });
      }
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      // Fail open on Redis errors.
    }
  }
}
