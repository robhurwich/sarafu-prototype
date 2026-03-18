/**
 * Mock login endpoint — only active in NEXT_PUBLIC_MOCK_MODE=true.
 * Sets an iron-session cookie with a mock persona's address so the
 * rest of the auth system works exactly as in production.
 */
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { MOCK_PERSONAS, type PersonaKey } from "~/mock/data";
import { type SessionData, sessionOptions } from "~/server/auth/session";

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_MOCK_MODE !== "true") {
    return NextResponse.json(
      { ok: false, error: "Mock mode is not enabled" },
      { status: 403 }
    );
  }

  const { personaKey } = (await req.json()) as { personaKey: PersonaKey };
  const persona = MOCK_PERSONAS[personaKey];

  if (!persona) {
    return NextResponse.json(
      { ok: false, error: "Unknown persona" },
      { status: 400 }
    );
  }

  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

  session.address = persona.address;
  session.chainId = 42220; // Celo mainnet
  delete session.nonce;
  delete session.nonceCreatedAt;
  await session.save();

  return NextResponse.json({ ok: true, address: persona.address });
}

export async function DELETE() {
  if (process.env.NEXT_PUBLIC_MOCK_MODE !== "true") {
    return NextResponse.json({ ok: false, error: "Mock mode is not enabled" }, { status: 403 });
  }

  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  session.destroy();
  await session.save();

  return NextResponse.json({ ok: true });
}
