import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { isAddress } from "viem";
import VoucherPageClient from "~/components/voucher/voucher-page";
import { publicClient } from "~/config/viem.config.server";
import { getTokenDetails } from "~/server/api/models/token";
import { getPublicVoucher } from "~/server/api/public-fetchers";

export const revalidate = 60;

type Props = {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const address = params.address;

  if (process.env.NEXT_PUBLIC_MOCK_MODE === "true") {
    const { MOCK_VOUCHERS } = await import("~/mock/data");
    const v = MOCK_VOUCHERS.find(
      (x) => x.voucher_address.toLowerCase() === address.toLowerCase()
    );
    return {
      title: v?.voucher_name ?? "Voucher",
      description: v?.voucher_description ?? "",
    };
  }

  const voucherData = await getPublicVoucher(address);

  return {
    title: voucherData?.voucher_name ?? "Unknown Voucher",
    description: voucherData?.voucher_description ?? "",
    openGraph: {
      title: voucherData?.voucher_name ?? "Unknown Voucher",
      description: voucherData?.voucher_description ?? "",
      url: `https://sarafu.network/vouchers/${address}`,
      images: voucherData?.banner_url ? [voucherData.banner_url] : [],
    },
  };
}

export default async function VouchersPage(props: {
  params: Promise<{ address: string }>;
}) {
  const params = await props.params;
  const address = params.address;
  if (!address || !isAddress(address)) {
    return redirect("/vouchers");
  }

  let voucher_details;
  let voucher_metadata;
  if (process.env.NEXT_PUBLIC_MOCK_MODE === "true") {
    const { MOCK_TOKEN_DETAILS } = await import("~/mock/data");
    voucher_details = MOCK_TOKEN_DETAILS[address.toLowerCase()] ?? {
      name: "Unknown Voucher",
      symbol: "???",
      decimals: 6,
    };
  } else {
    [voucher_details, voucher_metadata] = await Promise.all([
      getTokenDetails(publicClient, { address }),
      getPublicVoucher(address),
    ]);
  }

  return (
    <VoucherPageClient
      address={address}
      details={voucher_details}
      initialVoucher={voucher_metadata}
    />
  );
}
