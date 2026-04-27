"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useConfig, usePublicClient } from "wagmi";
import {
  addVoucherToPool,
  getContractIndex,
  getDecimals,
  getMultipleSwapDetails,
  getSwapPool,
  getVoucherDetails,
  removePoolVoucher,
  updatePoolVoucherExchangeRate,
  updatePoolVoucherLimit,
} from "./contract-functions";
import { type SwapPool } from "./types";

export const useMultipleSwapDetails = (
  addresses: `0x${string}`[],
  quoterAddress?: `0x${string}`,
  swapPoolAddress?: `0x${string}`,
  limiterAddress?: `0x${string}`
) => {
  const { address: accountAddress } = useAccount();
  const client = usePublicClient();

  return useQuery({
    queryKey: [
      "multipleSwapDetails",
      addresses,
      quoterAddress,
      swapPoolAddress,
      limiterAddress,
      accountAddress,
    ],
    queryFn: () => {
      if (!client) throw new Error("Client not available");
      return getMultipleSwapDetails(
        client,
        addresses,
        quoterAddress,
        swapPoolAddress,
        limiterAddress,
        accountAddress
      );
    },
    enabled: !!accountAddress && !!client,
  });
};

export const useContractIndex = (address?: `0x${string}`) => {
  const config = useConfig();
  const client = usePublicClient({ config });
  const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE === "true";

  return useQuery({
    queryKey: ["contractIndex", address],
    queryFn: () => {
      if (isMockMode) {
        // Return mock pool addresses so dashboard pools tab renders
        return {
          contractAddresses: [
            "0xd4c2c1028b21e2777c09bfb1f4cc89b3c5576f9e",
            "0xe5d3d2139c22e3857c0bfa2d09b4c7a6587e2a1f",
            "0xf6e4e3240d33f4968d1cba3e0a5b8d7b698f3b20",
          ] as `0x${string}`[],
          entryCount: BigInt(3),
        };
      }
      if (!client) throw new Error("Client not available");
      return getContractIndex(client, address!);
    },
    enabled: isMockMode || (!!address && !!client),
    staleTime: 60_000,
  });
};

export const useSwapPool = (
  swapPoolAddress: `0x${string}` | undefined,
  initialData?: SwapPool
) => {
  const { address: accountAddress } = useAccount();
  const config = useConfig();
  const client = usePublicClient({ config });
  const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE === "true";

  return useQuery({
    queryKey: ["swapPool", swapPoolAddress, accountAddress],
    queryFn: async () => {
      if (isMockMode) {
        const { MOCK_POOLS, MOCK_VOUCHERS } = await import("~/mock/data");
        const pool = MOCK_POOLS.find(
          (p) => p.contract_address.toLowerCase() === swapPoolAddress?.toLowerCase()
        );
        if (!pool) throw new Error("Mock pool not found");
        const vouchers = pool.voucher_addresses as `0x${string}`[];
        const voucherDetails = vouchers.map((addr) => {
          const v = MOCK_VOUCHERS.find(
            (mv) => mv.voucher_address.toLowerCase() === addr.toLowerCase()
          );
          return {
            address: addr,
            symbol: v?.symbol,
            name: v?.voucher_name,
            decimals: 6,
            allowance: undefined,
            userBalance: undefined,
            poolBalance: undefined,
            limitOf: undefined,
            swapLimit: undefined,
            priceIndex: 10000n,
          };
        });
        return {
          address: swapPoolAddress!,
          tokenIndex: { contractAddresses: vouchers, entryCount: BigInt(vouchers.length) },
          owner: pool.sink_address as `0x${string}`,
          name: pool.pool_name,
          quoter: undefined,
          feePercentage: 0,
          feeAddress: undefined,
          feePpm: undefined,
          tokenLimiter: undefined,
          tokenRegistry: undefined,
          vouchers,
          voucherDetails,
        };
      }
      if (!client) throw new Error("Client not available");
      return getSwapPool(client, swapPoolAddress!, accountAddress);
    },
    initialData: initialData,
    enabled: !!swapPoolAddress && (isMockMode || !!client),
    staleTime: 60_000,
  });
};

export const useAddPoolVoucher = () => {
  const queryClient = useQueryClient();
  const { address: accountAddress } = useAccount();
  const config = useConfig();
  return useMutation({
    onSuccess(data, variables) {
      // 10 second timeout
      setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: ["swapPool", variables.swapPoolAddress, accountAddress],
        });
      }, 5000);
    },
    mutationFn: ({
      swapPoolAddress,
      voucherAddress,
      limit,
      exchangeRate,
    }: {
      swapPoolAddress: `0x${string}`;
      voucherAddress: `0x${string}`;
      limit: bigint;
      exchangeRate: bigint;
    }) =>
      addVoucherToPool(
        config,
        accountAddress as `0x${string}`,
        voucherAddress,
        swapPoolAddress,
        limit,
        exchangeRate
      ),
  });
};
export const useRemovePoolVoucher = () => {
  const queryClient = useQueryClient();
  const { address: accountAddress } = useAccount();
  const config = useConfig();

  return useMutation({
    onSuccess(data, variables) {
      // 10 second timeout
      setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: ["swapPool", variables.swapPoolAddress, accountAddress],
        });
      }, 10000);
    },
    mutationFn: async ({
      swapPoolAddress,
      voucherAddress,
    }: {
      swapPoolAddress: `0x${string}`;
      voucherAddress: `0x${string}`;
    }) =>
      removePoolVoucher(
        config,
        accountAddress as `0x${string}`,
        voucherAddress,
        swapPoolAddress
      ),
  });
};

export const useUpdatePoolVoucherLimit = () => {
  const queryClient = useQueryClient();
  const config = useConfig();

  const { address: accountAddress } = useAccount();
  return useMutation({
    onSuccess(data, variables) {
      // 10 second timeout
      setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: ["swapPool", variables.swapPoolAddress, accountAddress],
        });
      }, 5000);
    },
    mutationFn: ({
      swapPoolAddress,
      voucherAddress,
      limit,
    }: {
      swapPoolAddress: `0x${string}`;
      voucherAddress: `0x${string}`;
      limit: bigint;
    }) =>
      updatePoolVoucherLimit(
        config,
        accountAddress as `0x${string}`,
        voucherAddress,
        swapPoolAddress,
        limit
      ),
  });
};

export const useDecimals = (voucherAddress?: `0x${string}`) => {
  const config = useConfig();
  const client = usePublicClient({ config });

  return useQuery({
    queryKey: ["decimals", voucherAddress],
    queryFn: () => {
      if (!client) throw new Error("Client not available");
      if (!voucherAddress) return null;
      return getDecimals(client, voucherAddress);
    },
    enabled: !!voucherAddress && !!client,
    staleTime: Infinity,
    gcTime: Infinity,
  });
};
export const useUpdatePoolVoucherExchangeRate = () => {
  const queryClient = useQueryClient();
  const config = useConfig();

  const { address: accountAddress } = useAccount();
  return useMutation({
    onSuccess(data, variables) {
      // 10 second timeout
      setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: ["swapPool", variables.swapPoolAddress, accountAddress],
        });
      }, 5000);
    },
    mutationFn: ({
      swapPoolAddress,
      voucherAddress,
      exchangeRate,
    }: {
      swapPoolAddress: `0x${string}`;
      voucherAddress: `0x${string}`;
      exchangeRate: bigint;
    }) =>
      updatePoolVoucherExchangeRate(
        config,
        accountAddress as `0x${string}`,
        voucherAddress,
        swapPoolAddress,
        exchangeRate
      ),
  });
};
export const useVoucherDetails = (voucherAddress?: `0x${string}`) => {
  const config = useConfig();
  const client = usePublicClient({ config });

  return useQuery({
    queryKey: ["voucherDetails", voucherAddress],
    queryFn: () => {
      if (!client) throw new Error("Client not available");
      if (!voucherAddress) return null;
      return getVoucherDetails(client, voucherAddress);
    },
    enabled: !!voucherAddress && !!client,
    staleTime: Infinity,
    gcTime: Infinity,
  });
};
