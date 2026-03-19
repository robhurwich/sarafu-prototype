/**
 * Mock tRPC router — returns fixture data for all procedures.
 * Used when NEXT_PUBLIC_MOCK_MODE=true.
 *
 * Procedures match the same input/output signatures as the real routers
 * so all UI components work without modification.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  authenticatedProcedure,
  publicProcedure,
  router,
} from "~/server/api/trpc";
import { addressSchema } from "~/utils/zod";
import {
  MOCK_PERSONAS,
  MOCK_POOLS,
  MOCK_PRODUCTS,
  MOCK_STATS,
  MOCK_TRANSACTIONS,
  MOCK_VOUCHERS,
  type PersonaKey,
} from "./data";

// ─── Voucher Router ───────────────────────────────────────────────────────

const mockVoucherRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          sortBy: z.enum(["transactions", "name", "created"]).default("transactions"),
          sortDirection: z.enum(["asc", "desc"]).default("desc"),
        })
        .optional()
    )
    .query(({ input }) => {
      const sortBy = input?.sortBy ?? "transactions";
      const sortDir = input?.sortDirection ?? "desc";
      const vouchers = [...MOCK_VOUCHERS];
      vouchers.sort((a, b) => {
        const mul = sortDir === "asc" ? 1 : -1;
        if (sortBy === "transactions") return (a.transaction_count - b.transaction_count) * mul;
        if (sortBy === "name") return a.voucher_name.localeCompare(b.voucher_name) * mul;
        return (a.created_at.getTime() - b.created_at.getTime()) * mul;
      });
      return vouchers;
    }),

  count: publicProcedure.query(() => MOCK_VOUCHERS.length),

  byAddress: publicProcedure
    .input(z.object({ voucherAddress: z.string() }))
    .query(({ input }) =>
      MOCK_VOUCHERS.find(
        (v) => v.voucher_address.toLowerCase() === input.voucherAddress.toLowerCase()
      ) ?? null
    ),

  holders: publicProcedure
    .input(z.object({ voucherAddress: z.string() }))
    .query(() => [
      { address: MOCK_PERSONAS.alice.address },
      { address: MOCK_PERSONAS.bob.address },
      { address: MOCK_PERSONAS.carol.address },
    ]),

  pools: publicProcedure
    .input(z.object({ voucherAddress: z.string() }))
    .query(({ input }) =>
      MOCK_POOLS.filter(
        (p) => p.default_voucher.toLowerCase() === input.voucherAddress.toLowerCase()
      ).map((p) => ({ pool_address: p.contract_address }))
    ),

  vouchersByAddress: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(({ input }) => {
      const persona = Object.values(MOCK_PERSONAS).find(
        (p) => p.address.toLowerCase() === input.address.toLowerCase()
      );
      if (!persona) return [];
      return MOCK_VOUCHERS.slice(0, 3).map((v) => ({
        voucher_address: v.voucher_address,
        symbol: v.symbol,
        voucher_name: v.voucher_name,
        icon_url: v.icon_url,
        voucher_type: v.voucher_type,
      }));
    }),

  commodities: publicProcedure
    .input(z.object({ voucherAddress: z.string() }))
    .query(({ input }) =>
      MOCK_PRODUCTS.filter(
        (p) => p.voucher_address.toLowerCase() === input.voucherAddress.toLowerCase()
      )
    ),

  remove: authenticatedProcedure
    .input(z.object({ voucherAddress: z.string() }))
    .mutation(() => true),

  update: authenticatedProcedure
    .input(z.object({ voucherAddress: z.string() }).passthrough())
    .mutation(({ input }) =>
      MOCK_VOUCHERS.find(
        (v) => v.voucher_address.toLowerCase() === input.voucherAddress.toLowerCase()
      ) ?? null
    ),

  deploy: authenticatedProcedure
    .input(z.any())
    .mutation(async function* () {
      yield { message: "1/5 - Preparing your voucher...", status: "loading" as const };
      await new Promise((r) => setTimeout(r, 800));
      yield { message: "2/5 - Setting up community pool...", status: "loading" as const };
      await new Promise((r) => setTimeout(r, 800));
      yield { message: "3/5 - Recording on network...", status: "loading" as const };
      await new Promise((r) => setTimeout(r, 600));
      yield { message: "4/5 - Confirming registration...", status: "loading" as const };
      await new Promise((r) => setTimeout(r, 400));
      yield {
        message: "5/5 - Voucher created successfully!",
        status: "success" as const,
        address: "0x9999999999999999999999999999999999999999" as `0x${string}`,
        txHash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as `0x${string}`,
      };
    }),
});

// ─── Pool Router ──────────────────────────────────────────────────────────

const mockPoolRouter = router({
  list: publicProcedure
    .input(
      z.object({
        sortBy: z.enum(["swaps", "name", "vouchers"]).default("swaps"),
        sortDirection: z.enum(["asc", "desc"]).default("desc"),
      })
    )
    .query(({ input }) => {
      const pools = [...MOCK_POOLS];
      const mul = input.sortDirection === "asc" ? 1 : -1;
      pools.sort((a, b) => {
        if (input.sortBy === "swaps") return (a.swap_count - b.swap_count) * mul;
        if (input.sortBy === "vouchers") return (a.voucher_count - b.voucher_count) * mul;
        return (a.pool_name ?? "").localeCompare(b.pool_name ?? "") * mul;
      });
      return pools;
    }),

  get: publicProcedure
    .input(addressSchema)
    .query(({ input }) =>
      MOCK_POOLS.find(
        (p) => p.contract_address.toLowerCase() === input.toLowerCase()
      ) ?? null
    ),

  featuredPools: publicProcedure.query(() => MOCK_POOLS.slice(0, 3)),

  swaps: publicProcedure
    .input(z.object({ poolAddress: z.string() }).passthrough())
    .query(() => []),

  deposits: publicProcedure
    .input(z.object({ poolAddress: z.string() }).passthrough())
    .query(() => []),

  transactions: publicProcedure
    .input(z.object({ poolAddress: z.string() }).passthrough())
    .query(() => MOCK_TRANSACTIONS.slice(0, 5)),

  statistics: publicProcedure
    .input(z.object({ poolAddress: z.string() }).passthrough())
    .query(() => ({
      totalSwaps: 321,
      totalVouchers: 3,
      totalMembers: 42,
    })),

  swapVolumeOverTime: publicProcedure
    .input(z.any())
    .query(() => MOCK_STATS.txsPerDay),

  depositVolumeOverTime: publicProcedure
    .input(z.any())
    .query(() => MOCK_STATS.txsPerDay.map((d) => ({ ...d, y: d.y / BigInt(2) }))),

  swapPairsData: publicProcedure
    .input(z.any())
    .query(() => []),

  remove: authenticatedProcedure
    .input(z.object({ poolAddress: z.string() }))
    .mutation(() => true),

  update: authenticatedProcedure
    .input(z.object({ poolAddress: z.string() }).passthrough())
    .mutation(() => true),

  create: authenticatedProcedure
    .input(z.any())
    .mutation(async function* () {
      yield { message: "1/4 - Deploying contracts...", status: "loading" as const };
      await new Promise((r) => setTimeout(r, 1000));
      yield { message: "2/4 - Waiting for confirmation...", status: "loading" as const };
      await new Promise((r) => setTimeout(r, 800));
      yield { message: "3/4 - Saving pool to database...", status: "loading" as const };
      await new Promise((r) => setTimeout(r, 500));
      yield {
        message: "4/4 - Pool successfully deployed!",
        status: "success" as const,
        address: "0xdddddddddddddddddddddddddddddddddddddddd" as `0x${string}`,
        txHash: "0xcafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe" as `0x${string}`,
      };
    }),
});

// ─── Me Router ───────────────────────────────────────────────────────────

const mockMeRouter = router({
  get: authenticatedProcedure.query(({ ctx }) => {
    const address = ctx.session.address;
    const persona = Object.values(MOCK_PERSONAS).find(
      (p) => p.address.toLowerCase() === address.toLowerCase()
    );
    if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
    return {
      given_names: persona.given_names,
      family_name: persona.family_name,
      gender: persona.gender,
      year_of_birth: persona.year_of_birth,
      location_name: persona.location_name,
      geo: persona.geo,
      role: persona.role,
      default_voucher: persona.default_voucher,
    };
  }),

  update: authenticatedProcedure
    .input(z.any())
    .mutation(() => true),

  updatePrimary: authenticatedProcedure
    .input(z.any())
    .mutation(() => true),

  vouchers: authenticatedProcedure.query(({ ctx }) => {
    const address = ctx.session.address;
    const persona = Object.values(MOCK_PERSONAS).find(
      (p) => p.address.toLowerCase() === address.toLowerCase()
    );
    return MOCK_VOUCHERS.slice(0, persona?.role === "ADMIN" ? 4 : 2).map((v) => ({
      voucher_address: v.voucher_address as `0x${string}`,
      symbol: v.symbol,
      voucher_name: v.voucher_name,
      icon_url: v.icon_url,
      voucher_type: v.voucher_type,
      balance: BigInt(Math.floor(Math.random() * 500 + 50)),
    }));
  }),

  events: authenticatedProcedure
    .input(z.any().optional())
    .query(() =>
      MOCK_TRANSACTIONS.slice(0, 10).map((tx) => ({
        ...tx,
        event_type: tx.type,
        tx_type: tx.type,
      }))
    ),

  gasStatus: authenticatedProcedure.query(({ ctx }) => {
    const address = ctx.session.address;
    const persona = Object.values(MOCK_PERSONAS).find(
      (p) => p.address.toLowerCase() === address.toLowerCase()
    );
    return persona?.gas_status ?? "NONE";
  }),

  requestGas: authenticatedProcedure.mutation(() => true),
});

// ─── User Router ──────────────────────────────────────────────────────────

const mockUserRouter = router({
  count: publicProcedure.query(() => MOCK_STATS.totalUsers),

  byAddress: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(({ input }) => {
      const persona = Object.values(MOCK_PERSONAS).find(
        (p) => p.address.toLowerCase() === input.address.toLowerCase()
      );
      return persona
        ? {
            id: persona.id,
            given_names: persona.given_names,
            family_name: persona.family_name,
            gender: persona.gender,
            year_of_birth: persona.year_of_birth,
            location_name: persona.location_name,
            geo: persona.geo,
            role: persona.role,
          }
        : null;
    }),

  search: publicProcedure
    .input(z.object({ query: z.string() }).passthrough())
    .query(() => Object.values(MOCK_PERSONAS).slice(0, 3)),
});

// ─── Stats Router ─────────────────────────────────────────────────────────

const mockStatsRouter = router({
  txsPerDay: publicProcedure
    .input(z.any().optional())
    .query(() => MOCK_STATS.txsPerDay),

  statsPerVoucher: publicProcedure
    .input(z.any())
    .query(() => []),

  userCountPerDay: publicProcedure
    .input(z.any().optional())
    .query(() =>
      MOCK_STATS.txsPerDay.map((d) => ({ x: d.x, y: d.y / BigInt(5) }))
    ),

  newVouchersPerDay: publicProcedure
    .input(z.any().optional())
    .query(() => []),

  poolStats: publicProcedure
    .input(z.any().optional())
    .query(() => ({
      totalPools: MOCK_STATS.totalPools,
      totalSwaps: 2091,
      totalVouchers: MOCK_STATS.totalVouchers,
    })),

  totalStats: publicProcedure.query(() => ({
    totalVouchers: MOCK_STATS.totalVouchers,
    totalUsers: MOCK_STATS.totalUsers,
    totalTransactions: MOCK_STATS.totalTransactions,
    totalPools: MOCK_STATS.totalPools,
  })),

  voucherStats: publicProcedure
    .input(z.any().optional())
    .query(() =>
      MOCK_VOUCHERS.slice(0, 5).map((v) => ({
        voucher_address: v.voucher_address,
        symbol: v.symbol,
        voucher_name: v.voucher_name,
        transaction_count: v.transaction_count,
        user_count: Math.floor(Math.random() * 50 + 10),
      }))
    ),
});

// ─── Transaction Router ───────────────────────────────────────────────────

const mockTransactionRouter = router({
  userStats: publicProcedure
    .input(z.any().optional())
    .query(() => ({
      totalSent: 847,
      totalReceived: 1203,
      totalSwaps: 42,
    })),

  list: publicProcedure
    .input(z.any().optional())
    .query(() => MOCK_TRANSACTIONS),

  byAddress: publicProcedure
    .input(z.object({ address: z.string() }).passthrough())
    .query(() => MOCK_TRANSACTIONS.slice(0, 10)),
});

// ─── Products Router ──────────────────────────────────────────────────────

const mockProductsRouter = router({
  list: publicProcedure.input(z.any().optional()).query(() => MOCK_PRODUCTS),
  listAll: publicProcedure.input(z.any().optional()).query(() => MOCK_PRODUCTS),

  listByVoucher: publicProcedure
    .input(z.object({ voucherAddress: z.string() }))
    .query(({ input }) =>
      MOCK_PRODUCTS.filter(
        (p) => p.voucher_address.toLowerCase() === input.voucherAddress.toLowerCase()
      )
    ),

  nearbyOffers: publicProcedure
    .input(z.any().optional())
    .query(() => MOCK_PRODUCTS.slice(0, 4)),

  create: authenticatedProcedure.input(z.any()).mutation(() => ({ id: 99 })),
  update: authenticatedProcedure.input(z.any()).mutation(() => true),
  delete: authenticatedProcedure.input(z.any()).mutation(() => true),
});

// ─── Profile Router ───────────────────────────────────────────────────────

const mockProfileRouter = router({
  get: authenticatedProcedure.query(({ ctx }) => {
    const persona = Object.values(MOCK_PERSONAS).find(
      (p) => p.address.toLowerCase() === ctx.session.address.toLowerCase()
    );
    return persona ?? null;
  }),
  update: authenticatedProcedure.input(z.any()).mutation(() => true),
});

// ─── Tags Router ──────────────────────────────────────────────────────────

const mockTagsRouter = router({
  list: publicProcedure.query(() => [
    { id: 1, tag: "food" },
    { id: 2, tag: "water" },
    { id: 3, tag: "education" },
    { id: 4, tag: "repairs" },
    { id: 5, tag: "technology" },
    { id: 6, tag: "clothing" },
  ]),
});

// ─── Gas Router ───────────────────────────────────────────────────────────

const mockGasRouter = router({
  status: authenticatedProcedure.query(() => "APPROVED"),
  request: authenticatedProcedure.mutation(() => true),
});

// ─── Report Router ────────────────────────────────────────────────────────

const mockReportRouter = router({
  list: publicProcedure.input(z.any().optional()).query(() => ({
    items: [],
    nextCursor: undefined,
  })),
  findById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(() => null),
  create: authenticatedProcedure.input(z.any()).mutation(() => ({ id: 1 })),
  update: authenticatedProcedure.input(z.any()).mutation(() => true),
});

// ─── ENS Router ───────────────────────────────────────────────────────────

const mockEnsRouter = router({
  getENS: publicProcedure
    .input(z.any().optional())
    .query(() => null),
});

// ─── Stub Routers (pass-through stubs for unused features) ───────────────

const stubRouter = router({});

// ─── Combined Mock App Router ─────────────────────────────────────────────

export const mockAppRouter = router({
  voucher: mockVoucherRouter,
  pool: mockPoolRouter,
  me: mockMeRouter,
  user: mockUserRouter,
  stats: mockStatsRouter,
  transaction: mockTransactionRouter,
  products: mockProductsRouter,
  profile: mockProfileRouter,
  tags: mockTagsRouter,
  gas: mockGasRouter,
  report: mockReportRouter,
  ens: mockEnsRouter,
  // stubs for features not needed in prototype
  checkout: stubRouter,
  staff: stubRouter,
  safe: stubRouter,
});

export type MockAppRouter = typeof mockAppRouter;

// ─── Mock Persona resolution helper ──────────────────────────────────────

export function getMockPersonaByAddress(address: string) {
  return (
    Object.entries(MOCK_PERSONAS).find(
      ([, p]) => p.address.toLowerCase() === address.toLowerCase()
    )?.[1] ?? null
  );
}

export function getMockPersonaKey(address: string): PersonaKey | null {
  return (
    (Object.entries(MOCK_PERSONAS).find(
      ([, p]) => p.address.toLowerCase() === address.toLowerCase()
    )?.[0] as PersonaKey) ?? null
  );
}
