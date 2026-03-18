import * as Sentry from "@sentry/nextjs";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { cache } from "react";
import { publicClient } from "~/config/viem.config.server";
import { EthFaucet } from "~/contracts/eth-faucet";
import { UserModel } from "~/server/api/models/user";
import { graphDB } from "~/server/db";
import { GasGiftStatus } from "~/server/enums";
import { cacheWithExpiry } from "~/utils/cache/cache";
import { type SessionData, sessionOptions } from "./session";
import { type AppSession } from "./types";

// ─── Mock session path ────────────────────────────────────────────────────
// When NEXT_PUBLIC_MOCK_MODE=true, resolve session from fixture data
// without hitting the database or blockchain.

async function getMockSession(
  address: `0x${string}`,
  chainId: number
): Promise<AppSession | null> {
  try {
    const { getMockPersonaByAddress } = await import("~/mock/router");
    const persona = getMockPersonaByAddress(address);
    if (!persona) return null;
    return {
      address,
      chainId,
      user: {
        id: persona.id,
        account_id: persona.account_id,
        given_names: persona.given_names,
        family_name: persona.family_name,
        gender: persona.gender,
        year_of_birth: persona.year_of_birth,
        location_name: persona.location_name,
        geo: persona.geo,
        role: persona.role,
        default_voucher: persona.default_voucher,
      },
    };
  } catch {
    return null;
  }
}

// ─── Real session path ────────────────────────────────────────────────────

async function _getSession(): Promise<AppSession | null> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(
    cookieStore,
    sessionOptions
  );

  if (!session.address || !session.chainId) {
    return null;
  }

  const { address, chainId } = session;

  // Mock mode: skip DB and blockchain
  if (process.env.NEXT_PUBLIC_MOCK_MODE === "true") {
    return getMockSession(address, chainId);
  }

  try {
    return await cacheWithExpiry<AppSession>(
      `auth:session:${address}`,
      60,
      async () => {
        const userModel = new UserModel(graphDB);
        const userCheck = await userModel.findUserByAddress(address);
        let userId = userCheck?.id;
        if (!userId) {
          userId = await userModel.createUser(address);
        }

        const info = await userModel.getUserInfo(userId);

        // Gas faucet check (idempotent - canRequest returns false after gas is given)
        if (info.gas_status === GasGiftStatus.APPROVED) {
          const ethFaucet = new EthFaucet(publicClient);
          const [canRequest, reasons] =
            await ethFaucet.canRequest(address);
          if (canRequest) {
            try {
              await ethFaucet.giveTo(address);
            } catch (error) {
              Sentry.captureException(error, {
                tags: { component: "auth", action: "gas-faucet" },
                extra: { address, reasons },
              });
              console.error("Failed to give gas:", error, reasons);
            }
          }
        }

        return {
          address,
          chainId,
          user: {
            id: info.id,
            default_voucher: info.default_voucher,
            family_name: info.family_name,
            gender: info.gender,
            geo: info.geo,
            given_names: info.given_names,
            location_name: info.location_name,
            year_of_birth: info.year_of_birth,
            role: info.role,
            account_id: info.account_id,
          },
        };
      }
    );
  } catch (error) {
    Sentry.captureException(error, {
      tags: { component: "auth", action: "session-enrichment" },
    });
    console.error("Error in session enrichment:", error);
    return null;
  }
}

export const auth = cache(_getSession);
