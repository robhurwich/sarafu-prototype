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

// ─── Dynamic voucher store ────────────────────────────────────────────────
// Vouchers created during this server session (cleared on restart).

type DynamicVoucher = (typeof MOCK_VOUCHERS)[0];
let dynamicVoucherCounter = 100;
const dynamicVouchers: DynamicVoucher[] = [];

function allVouchers(): DynamicVoucher[] {
  return [...MOCK_VOUCHERS, ...dynamicVouchers];
}

// ─── Balance store ────────────────────────────────────────────────────────
// Deterministic seed so balances don't change on re-render; overrideable after sends.

function deterministicBalance(voucherAddress: string, owned: boolean): bigint {
  const seed = parseInt(voucherAddress.slice(2, 6), 16) % 200;
  const base = owned ? 300 + seed : 10 + (seed % 70);
  return BigInt(base) * 1_000_000n; // scaled to 6-decimal token units
}

// "userAddr:voucherAddr" → current balance (updated by mockSend)
const balanceOverrides = new Map<string, bigint>();

function getBalance(userAddress: string, voucherAddress: string, owned: boolean): bigint {
  const key = `${userAddress.toLowerCase()}:${voucherAddress.toLowerCase()}`;
  return balanceOverrides.get(key) ?? deterministicBalance(voucherAddress, owned);
}

// ─── Pool balance store (mirrors the user balance store above) ───────────────
// Each pool holds a deterministic seed amount of every voucher, updated by swaps.
const SCALE = 1_000_000n; // 6-decimal token units
const POOL_LIMIT = 2000n * SCALE; // per-voucher credit limit in every pool

function poolSeedBalance(voucherAddress: string): bigint {
  const seed = parseInt(voucherAddress.slice(2, 6), 16) % 200;
  return BigInt(800 + seed) * SCALE;
}

const poolBalanceOverrides = new Map<string, bigint>();

function getPoolBalance(poolAddress: string, voucherAddress: string): bigint {
  const key = `${poolAddress.toLowerCase()}:${voucherAddress.toLowerCase()}`;
  return poolBalanceOverrides.get(key) ?? poolSeedBalance(voucherAddress);
}

function setPoolBalance(poolAddress: string, voucherAddress: string, value: bigint) {
  const key = `${poolAddress.toLowerCase()}:${voucherAddress.toLowerCase()}`;
  poolBalanceOverrides.set(key, value);
}

// Transactions recorded by mockSend (prepended to the events feed)
type DynamicTransaction = {
  id: number;
  tx_hash: `0x${string}`;
  date_block: Date;
  type: "TOKEN_TRANSFER";
  from_address: string;
  to_address: string;
  contract_address: string;
  voucher_name: string;
  voucher_symbol: string;
  amount: string;
  success: boolean;
};
let dynamicTxCounter = 1000;
const dynamicTransactions: DynamicTransaction[] = [];

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
      const vouchers = allVouchers();
      vouchers.sort((a, b) => {
        const mul = sortDir === "asc" ? 1 : -1;
        if (sortBy === "transactions") return (a.transaction_count - b.transaction_count) * mul;
        if (sortBy === "name") return a.voucher_name.localeCompare(b.voucher_name) * mul;
        return (a.created_at.getTime() - b.created_at.getTime()) * mul;
      });
      return vouchers;
    }),

  count: publicProcedure.query(() => allVouchers().length),

  byAddress: publicProcedure
    .input(z.object({ voucherAddress: z.string() }))
    .query(({ input }) =>
      allVouchers().find(
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
      MOCK_POOLS.filter((p) =>
        p.voucher_addresses.some(
          (a) => a.toLowerCase() === input.voucherAddress.toLowerCase()
        )
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
    .mutation(async function* ({ input, ctx }) {
      yield { message: "1/5 - Preparing your voucher...", status: "loading" as const };
      await new Promise((r) => setTimeout(r, 800));
      yield { message: "2/5 - Setting up community pool...", status: "loading" as const };
      await new Promise((r) => setTimeout(r, 800));
      yield { message: "3/5 - Recording on network...", status: "loading" as const };
      await new Promise((r) => setTimeout(r, 600));
      yield { message: "4/5 - Confirming registration...", status: "loading" as const };
      await new Promise((r) => setTimeout(r, 400));

      // Generate a unique address and add the voucher to the session store
      const id = ++dynamicVoucherCounter;
      const newAddress = `0x${"9".repeat(38)}${String(id).padStart(2, "0")}` as `0x${string}`;
      const inp = input as Record<string, unknown>;
      dynamicVouchers.push({
        id,
        voucher_address: newAddress,
        symbol: (inp.symbol as string | undefined) ?? "NEW",
        voucher_name: (inp.name as string | undefined) ?? "New Voucher",
        voucher_description: (inp.description as string | undefined) ?? "",
        voucher_type: "GIFTABLE",
        voucher_uoa: (inp.uoa as string | undefined) ?? "USD",
        voucher_value: (inp.value as number | undefined) ?? 1,
        location_name: (inp.location as string | undefined) ?? "",
        geo: (inp.geo as { x: number; y: number } | undefined) ?? { x: 0, y: 0 },
        voucher_email: (inp.email as string | undefined) ?? "",
        voucher_website: "",
        banner_url: `https://picsum.photos/seed/${id}/1200/400`,
        icon_url: `https://picsum.photos/seed/${id}/200/200`,
        redemption_address: ctx.session.address,
        created_at: new Date(),
        transaction_count: 0,
        internal: false,
        contract_version: "1.0",
      });

      yield {
        message: "5/5 - Voucher created successfully!",
        status: "success" as const,
        address: newAddress,
        // No txHash — triggers immediate success path without blockchain polling
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

  // Per-voucher balances for a pool + the logged-in user. Single source of
  // truth shared with the wallet via getBalance/balanceOverrides, so sends and
  // swaps reflect everywhere. Consumed by useSwapPool in mock mode.
  swapBalances: publicProcedure.input(addressSchema).query(({ ctx, input }) => {
    const userAddr = ctx.session?.address?.toLowerCase() ?? "";
    const pool = MOCK_POOLS.find(
      (p) => p.contract_address.toLowerCase() === input.toLowerCase()
    );
    const user: Record<string, bigint> = {};
    const poolBalances: Record<string, bigint> = {};
    if (pool) {
      for (const addr of pool.voucher_addresses) {
        const v = MOCK_VOUCHERS.find(
          (mv) => mv.voucher_address.toLowerCase() === addr.toLowerCase()
        );
        const owned = v?.redemption_address.toLowerCase() === userAddr;
        user[addr.toLowerCase()] = getBalance(userAddr, addr, owned);
        poolBalances[addr.toLowerCase()] = getPoolBalance(input, addr);
      }
    }
    return { user, pool: poolBalances, limit: POOL_LIMIT };
  }),

  // Execute a swap in mock mode: debit fromToken / credit toToken for the user
  // (1:1 price index, no fee) and mirror it in the pool's balances.
  mockSwap: authenticatedProcedure
    .input(
      z.object({
        poolAddress: z.string(),
        fromAddress: z.string(),
        toAddress: z.string(),
        amount: z.number().positive(),
      })
    )
    .mutation(({ ctx, input }) => {
      const userAddr = ctx.session.address.toLowerCase();
      const poolAddr = input.poolAddress.toLowerCase();
      const fromAddr = input.fromAddress.toLowerCase();
      const toAddr = input.toAddress.toLowerCase();
      const amountUnits = BigInt(Math.round(input.amount * 1_000_000));

      const fromV = MOCK_VOUCHERS.find(
        (v) => v.voucher_address.toLowerCase() === fromAddr
      );
      const toV = MOCK_VOUCHERS.find(
        (v) => v.voucher_address.toLowerCase() === toAddr
      );
      const userOwnsFrom = fromV?.redemption_address.toLowerCase() === userAddr;
      const userOwnsTo = toV?.redemption_address.toLowerCase() === userAddr;

      const userFrom = getBalance(userAddr, fromAddr, userOwnsFrom);
      if (userFrom < amountUnits) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Insufficient balance",
        });
      }
      // 1:1 price index and zero fee in mock mode
      const amountOut = amountUnits;

      // User: spend fromToken, receive toToken
      balanceOverrides.set(`${userAddr}:${fromAddr}`, userFrom - amountUnits);
      balanceOverrides.set(
        `${userAddr}:${toAddr}`,
        getBalance(userAddr, toAddr, userOwnsTo) + amountOut
      );
      // Pool: receives fromToken, gives out toToken
      setPoolBalance(poolAddr, fromAddr, getPoolBalance(poolAddr, fromAddr) + amountUnits);
      setPoolBalance(poolAddr, toAddr, getPoolBalance(poolAddr, toAddr) - amountOut);

      // Record the received toToken as a transfer in the events feed
      const id = ++dynamicTxCounter;
      const txHash: `0x${string}` = `0x${id.toString(16).padStart(64, "0")}`;
      dynamicTransactions.push({
        id,
        tx_hash: txHash,
        date_block: new Date(),
        type: "TOKEN_TRANSFER",
        from_address: poolAddr,
        to_address: userAddr,
        contract_address: toAddr,
        voucher_name: toV?.voucher_name ?? "",
        voucher_symbol: toV?.symbol ?? "",
        amount: input.amount.toString(),
        success: true,
      });

      return { success: true, txHash };
    }),

  swaps: publicProcedure
    .input(z.object({ poolAddress: z.string() }).passthrough())
    .query(() => []),

  deposits: publicProcedure
    .input(z.object({ poolAddress: z.string() }).passthrough())
    .query(() => []),

  transactions: publicProcedure
    .input(z.object({ address: z.string() }).passthrough())
    .query(() => ({
      items: MOCK_TRANSACTIONS.slice(0, 5),
      nextCursor: null,
    })),

  tokenDistribution: publicProcedure
    .input(z.any())
    .query(() =>
      MOCK_VOUCHERS.slice(0, 3).map((v) => ({
        token_address: v.voucher_address,
        token_name: v.voucher_name,
        symbol: v.symbol,
        balance: Math.floor(Math.random() * 10000 + 1000),
        percentage: Math.floor(Math.random() * 40 + 10),
      }))
    ),

  statistics: publicProcedure
    .input(
      z.object({
        addresses: z.array(z.string()).optional(),
        dateRange: z
          .object({ from: z.date(), to: z.date() })
          .optional(),
      }).passthrough()
    )
    .query(({ input }) => {
      // Dashboard calls with { addresses: [...], dateRange } — return per-pool stats array
      if (input.addresses) {
        return MOCK_POOLS.map((p) => ({
          pool_address: p.contract_address,
          total_swaps: p.swap_count,
          total_deposits: Math.floor(Math.random() * 50 + 10),
          unique_swappers: Math.floor(Math.random() * 30 + 5),
          unique_depositors: Math.floor(Math.random() * 15 + 3),
        }));
      }
      // Single pool detail calls
      return {
        totalSwaps: 321,
        totalVouchers: 3,
        totalMembers: 42,
      };
    }),

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
    const address = ctx.session.address.toLowerCase();
    const all = allVouchers();
    // Return vouchers the persona owns (redemption_address matches) plus a few they've received
    const owned = all.filter(
      (v) => v.redemption_address.toLowerCase() === address
    );
    // Also give them a couple of vouchers they've received via swaps
    const received = all.filter(
      (v) => v.redemption_address.toLowerCase() !== address
    ).slice(0, 3);
    return [...owned, ...received].map((v) => ({
      voucher_address: v.voucher_address,
      symbol: v.symbol,
      voucher_name: v.voucher_name,
      icon_url: v.icon_url,
      voucher_type: v.voucher_type,
      balance: getBalance(address, v.voucher_address, v.redemption_address.toLowerCase() === address),
    }));
  }),

  events: authenticatedProcedure
    .input(z.any().optional())
    .query(({ ctx }) => {
      const address = ctx.session.address.toLowerCase();
      const staticEvents = MOCK_TRANSACTIONS.filter(
        (tx) =>
          tx.from_address.toLowerCase() === address ||
          (tx.to_address?.toLowerCase() ?? "") === address
      ).map((tx) => ({ ...tx, event_type: tx.type, tx_type: tx.type }));
      const dynamicEvents = [...dynamicTransactions]
        .reverse()
        .filter(
          (tx) =>
            tx.from_address.toLowerCase() === address ||
            tx.to_address.toLowerCase() === address
        )
        .map((tx) => ({ ...tx, event_type: tx.type, tx_type: tx.type }));
      const events = [...dynamicEvents, ...staticEvents].slice(0, 50);
      return { events, nextCursor: undefined };
    }),

  gasStatus: authenticatedProcedure.query(({ ctx }) => {
    const address = ctx.session.address;
    const persona = Object.values(MOCK_PERSONAS).find(
      (p) => p.address.toLowerCase() === address.toLowerCase()
    );
    return persona?.gas_status ?? "NONE";
  }),

  requestGas: authenticatedProcedure.mutation(() => true),

  mockSend: authenticatedProcedure
    .input(
      z.object({
        voucherAddress: z.string(),
        recipientAddress: z.string(),
        amount: z.number().positive(),
      })
    )
    .mutation(({ input, ctx }) => {
      const senderAddr = ctx.session.address.toLowerCase();
      const recipientAddr = input.recipientAddress.toLowerCase();
      const voucherAddr = input.voucherAddress.toLowerCase();

      // Convert human-readable amount to 6-decimal token units
      const amountUnits = BigInt(Math.round(input.amount * 1_000_000));

      const voucher = allVouchers().find(
        (v) => v.voucher_address.toLowerCase() === voucherAddr
      );
      const senderOwns = voucher?.redemption_address.toLowerCase() === senderAddr;
      const recipientOwns = voucher?.redemption_address.toLowerCase() === recipientAddr;

      const senderBalance = getBalance(senderAddr, input.voucherAddress, senderOwns);
      if (senderBalance < amountUnits) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient balance" });
      }

      // Debit sender, credit recipient
      balanceOverrides.set(`${senderAddr}:${voucherAddr}`, senderBalance - amountUnits);
      balanceOverrides.set(
        `${recipientAddr}:${voucherAddr}`,
        getBalance(recipientAddr, input.voucherAddress, recipientOwns) + amountUnits
      );

      // Record the transaction for the events feed
      const id = ++dynamicTxCounter;
      dynamicTransactions.push({
        id,
        tx_hash: `0xdead${id.toString(16).padStart(60, "0")}` as `0x${string}`,
        date_block: new Date(),
        type: "TOKEN_TRANSFER",
        from_address: senderAddr,
        to_address: recipientAddr,
        contract_address: input.voucherAddress,
        voucher_name: voucher?.voucher_name ?? "",
        voucher_symbol: voucher?.symbol ?? "",
        amount: input.amount.toString(),
        success: true,
      });

      return { success: true, id };
    }),
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
    .query(() =>
      MOCK_VOUCHERS.map((v) => ({
        voucher_address: v.voucher_address,
        symbol: v.symbol,
        voucher_name: v.voucher_name,
        this_period_total: Math.floor(Math.random() * 200 + 20),
        last_period_total: Math.floor(Math.random() * 150 + 10),
        unique_accounts_this_period: Math.floor(Math.random() * 40 + 5),
        unique_accounts_last_period: Math.floor(Math.random() * 30 + 3),
        total_reports: Math.floor(Math.random() * 15),
      }))
    ),

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
    .query(() => ({
      accounts: {
        total: 3540,
        delta: 42,
      },
      transactions: {
        total: 271144,
        delta: 187,
      },
    })),
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
  marketplaceList: publicProcedure.query(() =>
    MOCK_PRODUCTS.map((p) => ({
      id: p.id,
      commodity_name: p.commodity_name,
      commodity_description: p.commodity_description,
      commodity_type: p.commodity_type,
      image_url: p.image_url,
      price: p.price,
      unit: null as string | null,
      location_name: p.location_name,
      voucher_geo: p.voucher_geo as { x: number; y: number } | null,
      voucher_address: p.voucher_address,
      voucher_name: p.voucher_name,
      voucher_symbol: p.voucher_symbol,
      voucher_icon: null as string | null,
      voucher_value: 1,
      voucher_uoa: "USD",
      tags: [] as string[],
    }))
  ),

  list: publicProcedure
    .input(z.object({ voucher_addresses: z.array(z.string()).optional() }).passthrough().optional())
    .query(({ input }) => {
      if (input?.voucher_addresses?.length) {
        return MOCK_PRODUCTS.filter((p) =>
          input.voucher_addresses!.some(
            (a) => a.toLowerCase() === p.voucher_address.toLowerCase()
          )
        );
      }
      return MOCK_PRODUCTS;
    }),
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

  byId: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(({ input }) => {
      const product = MOCK_PRODUCTS.find((p) => p.id === input.id);
      if (!product) return null;
      return { ...product, unit: null, categories: [] };
    }),

  create: authenticatedProcedure.input(z.any()).mutation(() => ({ id: 99 })),
  // "insert" is the name ProductManager uses (aliased from create)
  insert: authenticatedProcedure.input(z.any()).mutation(() => ({ id: 99 })),
  update: authenticatedProcedure.input(z.any()).mutation(() => true),
  delete: authenticatedProcedure.input(z.any()).mutation(() => true),
  // "remove" is the name ProductManager uses (aliased from delete)
  remove: authenticatedProcedure.input(z.any()).mutation(() => true),
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
  getUserOwnedVouchers: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(({ input }) => {
      const addr = input.address.toLowerCase();
      return allVouchers()
        .filter((v) => v.redemption_address.toLowerCase() === addr)
        .map((v) => ({
          voucher_address: v.voucher_address,
          symbol: v.symbol,
          voucher_name: v.voucher_name,
          icon_url: v.icon_url,
          voucher_type: v.voucher_type,
          indexed: true,
          balance: getBalance(addr, v.voucher_address, true),
        }));
    }),
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
  getStatsByTag: publicProcedure
    .input(z.any())
    .query(() => ({
      reportCount: 87,
      stats: [
        { tag: "food", count: 28 },
        { tag: "water", count: 19 },
        { tag: "education", count: 15 },
        { tag: "repairs", count: 12 },
        { tag: "technology", count: 8 },
        { tag: "clothing", count: 5 },
      ],
    })),
});

// ─── ENS Router ───────────────────────────────────────────────────────────

// ─── Mock ENS resolution ─────────────────────────────────────────────────
// Gives every persona and voucher a deterministic <slug>.sarafu.eth name so the
// UI can show owner ENS names and resolve them back to addresses for sending.
function ensSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const mockEnsByAddress = new Map<string, string>();
const mockEnsByName = new Map<string, string>();
(function buildMockEns() {
  for (const p of Object.values(MOCK_PERSONAS)) {
    const name = `${ensSlug(p.given_names)}.sarafu.eth`;
    mockEnsByAddress.set(p.address.toLowerCase(), name);
    mockEnsByName.set(name, p.address);
  }
  for (const v of MOCK_VOUCHERS) {
    const name = `${ensSlug(v.voucher_name)}.sarafu.eth`;
    if (!mockEnsByAddress.has(v.voucher_address.toLowerCase())) {
      mockEnsByAddress.set(v.voucher_address.toLowerCase(), name);
    }
    if (!mockEnsByName.has(name)) {
      mockEnsByName.set(name, v.voucher_address);
    }
  }
})();

const mockEnsRouter = router({
  getENS: publicProcedure
    .input(z.object({ address: z.string() }))
    .query(({ input }) => {
      const name = mockEnsByAddress.get(input.address.toLowerCase());
      return name ? { name } : null;
    }),
  getAddress: publicProcedure
    .input(z.object({ ensName: z.string() }))
    .query(({ input }) => {
      const address = mockEnsByName.get(input.ensName.toLowerCase());
      return address ? { address } : null;
    }),
  exists: publicProcedure
    .input(z.object({ ensName: z.string() }))
    .query(({ input }) => mockEnsByName.has(input.ensName.toLowerCase())),
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
  onramp: stubRouter,
  otp: stubRouter,
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
