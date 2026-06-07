import type { Metadata } from "next";
import { getAddress } from "viem";
import {
  getCachedSwapPool,
  getPublicPoolMetadata,
} from "~/server/api/public-fetchers";
import { PoolClientPage } from "./pool-client-page";

export const revalidate = 60;

type Props = {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const pool_address = getAddress(params.address);

  if (process.env.NEXT_PUBLIC_MOCK_MODE === "true") {
    const { MOCK_POOLS } = await import("~/mock/data");
    const p = MOCK_POOLS.find(
      (x) => x.contract_address.toLowerCase() === pool_address.toLowerCase()
    );
    return {
      title: p?.pool_name ?? "Pool",
      description: p?.swap_pool_description ?? "",
    };
  }

  const [poolDetails, poolData] = await Promise.all([
    getCachedSwapPool(pool_address),
    getPublicPoolMetadata(pool_address),
  ]);

  return {
    title: poolDetails?.name,
    description: poolData?.swap_pool_description ?? "",
    openGraph: {
      title: poolDetails?.name,
      description: poolData?.swap_pool_description ?? "",
      url: `https://sarafu.network/pools/${pool_address}`,
      images: poolData?.banner_url ? [poolData.banner_url] : [],
    },
  };
}

export default async function PoolPage(props: {
  params: Promise<{ address: string }>;
}) {
  const params = await props.params;
  const pool_address = getAddress(params.address);

  // In mock mode skip the real swap-pool/DB fetchers (they hit Celo + Postgres
  // and throw). The client component refetches via the mock tRPC router and the
  // mock-aware useSwapPool hook, so undefined initial data is fine.
  if (process.env.NEXT_PUBLIC_MOCK_MODE === "true") {
    return <PoolClientPage address={pool_address} />;
  }

  const [initialPool, initialMetadata] = await Promise.all([
    getCachedSwapPool(pool_address),
    getPublicPoolMetadata(pool_address),
  ]);

  return (
    <PoolClientPage
      address={pool_address}
      initialPool={initialPool}
      initialMetadata={initialMetadata}
    />
  );
}
