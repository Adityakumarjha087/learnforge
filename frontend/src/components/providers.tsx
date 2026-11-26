"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "sonner";
import { makeTrpcClient, TRPCProvider } from "@/lib/trpc";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: (count, err) => count < 2 && !/UNAUTHORIZED|FORBIDDEN|NOT_FOUND/.test(String((err as { data?: { code?: string } })?.data?.code ?? "")), refetchOnWindowFocus: false },
        },
      }),
  );
  const [trpcClient] = useState(makeTrpcClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          {children}
          <Toaster richColors position="top-right" closeButton />
        </TRPCProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
