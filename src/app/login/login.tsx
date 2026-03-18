"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnectors } from "wagmi";

import { Button } from "~/components/ui/button";
import { useAuth } from "~/hooks/useAuth";
import { useIsMounted } from "~/hooks/useIsMounted";
import { PaperWallet } from "~/utils/paper-wallet";

interface LoginProps {
  redirectPath?: string;
}

// ─── Mock persona picker (shown only in NEXT_PUBLIC_MOCK_MODE=true) ──────

const PERSONAS = [
  {
    key: "alice",
    name: "Alice Wanjiku",
    role: "Admin",
    location: "Kibera, Nairobi",
    description: "Has 4 vouchers, admin access",
  },
  {
    key: "bob",
    name: "Bob Kamau",
    role: "User",
    location: "Mathare, Nairobi",
    description: "Has 2 vouchers, regular user",
  },
  {
    key: "carol",
    name: "Carol Achieng",
    role: "User",
    location: "Korogocho, Nairobi",
    description: "New user, no gas yet",
  },
] as const;

function MockLoginPanel({ redirectPath }: { redirectPath: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (personaKey: string) => {
    setLoading(personaKey);
    setError(null);
    try {
      const res = await fetch("/api/auth/mock-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaKey }),
      });
      if (!res.ok) throw new Error("Login failed");
      router.push(redirectPath);
      router.refresh();
    } catch (err) {
      setError(String(err));
      setLoading(null);
    }
  };

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Banner */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center">
          <p className="text-sm font-medium text-amber-800">Prototype Mode</p>
          <p className="mt-0.5 text-xs text-amber-700">
            Log in as a mock persona to explore the app with sample data
          </p>
        </div>

        {/* Persona cards */}
        <div className="space-y-3">
          {PERSONAS.map((persona) => (
            <button
              key={persona.key}
              onClick={() => void handleLogin(persona.key)}
              disabled={loading !== null}
              className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-green-400 hover:bg-green-50 disabled:opacity-60"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm text-gray-900">{persona.name}</p>
                  <p className="text-xs text-gray-500">{persona.location}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      persona.role === "Admin"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {persona.role}
                  </span>
                  {loading === persona.key && (
                    <span className="text-[10px] text-green-600">Signing in…</span>
                  )}
                </div>
              </div>
              <p className="mt-1 text-[11px] text-gray-400">{persona.description}</p>
            </button>
          ))}
        </div>

        {error && <p className="text-center text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}

// ─── Real Login (wallet connect) ─────────────────────────────────────────

export function Login({ redirectPath = "/wallet" }: LoginProps) {
  // If mock mode is on, render the persona picker instead
  if (process.env.NEXT_PUBLIC_MOCK_MODE === "true") {
    return <MockLoginPanel redirectPath={redirectPath} />;
  }

  return <RealLogin redirectPath={redirectPath} />;
}

function RealLogin({ redirectPath = "/wallet" }: LoginProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isConnecting, setIsConnecting] = useState(true);
  const isConnectingRef = useRef(false);
  const { openConnectModal } = useConnectModal();
  const connectors = useConnectors();
  const paperConnector = connectors.find(
    (connector) => connector.id === "paperConnector"
  );

  const user = useAuth();
  const isMounted = useIsMounted();

  const handleWalletParam = useCallback(
    async (wParam: string) => {
      if (isConnectingRef.current || !wParam) return;
      isConnectingRef.current = true;
      setIsConnecting(true);
      try {
        const paperWallet = new PaperWallet(wParam, sessionStorage);
        paperWallet.saveToStorage();

        if (!paperConnector) {
          console.error("Paper connector not found");
          return false;
        }

        await paperConnector.connect();
        const params = new URLSearchParams(Array.from(searchParams.entries()));
        params.delete("w");
        const newUrl = params.toString()
          ? `${pathname}?${params.toString()}`
          : pathname;
        router.replace(newUrl);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        openConnectModal?.();
      } catch (error) {
        console.error("Failed to process wallet parameter:", error);
      } finally {
        setIsConnecting(false);
      }
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    const wParam = searchParams.get("w");
    if (wParam) void handleWalletParam(wParam);
  }, [searchParams, handleWalletParam]);

  useEffect(() => {
    if (user) router.push(redirectPath);
  }, [user, router, redirectPath]);

  const handleClick = useCallback(() => {
    if (user) router.push(redirectPath);
    else openConnectModal?.();
  }, [user, router, redirectPath, openConnectModal]);

  if (!isMounted) return null;

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center space-y-6 px-4 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Connecting Wallet
        </h1>
        <p className="text-muted-foreground">
          Please wait while we establish a secure connection
        </p>
      </div>

      <div className="flex flex-col items-center space-y-4">
        {isConnecting ? (
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        ) : (
          <Button variant="outline" onClick={handleClick} className="mt-4">
            {user ? "Go to Wallet" : "Connect"}
          </Button>
        )}
      </div>
    </div>
  );
}
