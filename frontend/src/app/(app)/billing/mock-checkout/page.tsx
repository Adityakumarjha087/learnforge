"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTRPC } from "@/lib/trpc";

function MockCheckout() {
  const session = useSearchParams().get("session");
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const pay = useMutation(trpc.billing.mock.mutationOptions({ onSuccess: async () => { await qc.invalidateQueries(); router.replace("/billing?status=success"); } }));
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> Mock checkout</CardTitle>
        <CardDescription>Session {session}. This simulates Stripe Checkout - no card is charged.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg bg-muted p-4 text-sm"><p className="font-medium">LearnForge Pro</p><p className="text-muted-foreground">$12.00 / month</p></div>
        <Button className="w-full" onClick={() => pay.mutate({ action: "checkout" })} loading={pay.isPending}>Pay $12.00 (simulated)</Button>
        <Button variant="ghost" className="w-full" onClick={() => router.replace("/billing?status=cancelled")}>Cancel</Button>
      </CardContent>
    </Card>
  );
}

export default function MockCheckoutPage() {
  return (
    <Suspense>
      <MockCheckout />
    </Suspense>
  );
}
