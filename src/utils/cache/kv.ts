import { Redis } from "@upstash/redis";

// In mock mode, return a no-op client that never connects to Upstash
const mockRedis = {
  // eslint-disable-next-line @typescript-eslint/require-await
  get: async (_key: string) => null,
  // eslint-disable-next-line @typescript-eslint/require-await
  set: async (_key: string, _value: unknown, _opts?: unknown) => null,
  // eslint-disable-next-line @typescript-eslint/require-await
  del: async (..._keys: string[]) => 0 as number,
  // eslint-disable-next-line @typescript-eslint/require-await
  smembers: async (_key: string): Promise<string[]> => [],
  // eslint-disable-next-line @typescript-eslint/require-await
  sadd: async (_key: string, ..._members: unknown[]) => 0 as number,
} as unknown as Redis;

export const redis =
  process.env.NEXT_PUBLIC_MOCK_MODE === "true" ? mockRedis : Redis.fromEnv();
