import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { mockAppRouter } from "~/mock/router";
import { createContext } from "~/server/api/context";
import { appRouter } from "~/server/api/root";

export const maxDuration = 300;

const activeRouter =
  process.env.NEXT_PUBLIC_MOCK_MODE === "true" ? mockAppRouter : appRouter;

const handler = (req: Request) =>
  fetchRequestHandler({
    router: activeRouter,
    req,
    endpoint: "/api/trpc",
    createContext: createContext,
    onError({ error }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error("Something went wrong", error);
      }
    },
  });

export const GET = handler;
export const POST = handler;
