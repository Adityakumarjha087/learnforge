"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useTRPC } from "@/lib/trpc";

const PLANS = [
  { name: "Free", price: "$0", features: ["10 AI generations / month", "40 tutor messages / day", "FSRS flashcards & battles"] },
  { name: "Pro", price: "$12/mo", features: ["500 AI generations / month", "Unlimited Socratic tutoring", "Priority generation"] },
];

export default function BillingPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const status = useQuery(trpc.billing.status.queryOptions());
  const usage = useQuery(trpc.me.usage.queryOptions());
  const refresh = () => qc.invalidateQueries();
  const checkout = useMutation(trpc.billing.checkout.mutationOptions({ onSuccess: (r) => (window.location.href = r.url), onError: (e) => toast.error(e.message) }));
  const cancel = useMutation(trpc.billing.cancel.mutationOptions({ onSuccess: () => { toast.success("Subscription will cancel at period end"); void refresh(); } }));
  const mock = useMutation(trpc.billing.mock.mutationOptions({ onSuccess: () => void refresh(), onError: (e) => toast.error(e.message) }));

  if (status.isLoading) return <LoadingState />;
  if (status.error) return <ErrorState message={status.error.message} />;
  const s = status.data!;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Billing" description={s.mode === "mock" ? "Mock billing mode - no real payments; exercises the same subscription state machine as Stripe." : "Manage your subscription via Stripe."} />
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-5">
          <div><p className="text-sm text-muted-foreground">Status</p><p className="text-xl font-semibold" data-testid="sub-status">{s.status}</p></div>
          <Badge tone={s.pro ? "primary" : "muted"}>{s.pro ? "PRO" : "FREE"}</Badge>
          {s.currentPeriodEnd && <p className="text-sm text-muted-foreground">{s.cancelAtPeriodEnd ? "Ends" : "Renews"} {new Date(s.currentPeriodEnd).toLocaleDateString()}</p>}
          {usage.data && (
            <div className="min-w-48 flex-1"><p className="text-xs text-muted-foreground">{usage.data.generations.used}/{usage.data.generations.limit} generations this month</p><Progress value={(usage.data.generations.used / Math.max(1, usage.data.generations.limit)) * 100} label="Usage" /></div>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {PLANS.map((p) => {
          const current = (p.name === "Pro") === s.pro;
          return (
            <Card key={p.name} className={current ? "border-primary" : undefined}>
              <CardHeader><CardTitle className="flex items-center justify-between">{p.name}{current && <Badge tone="primary">Current</Badge>}</CardTitle><CardDescription className="text-2xl font-bold text-foreground">{p.price}</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm">{p.features.map((f) => <li key={f} className="flex gap-2"><Check className="h-4 w-4 text-success" aria-hidden />{f}</li>)}</ul>
                {p.name === "Pro" && !s.pro && <Button className="w-full" onClick={() => checkout.mutate()} loading={checkout.isPending}>Upgrade to Pro</Button>}
                {p.name === "Pro" && s.pro && !s.cancelAtPeriodEnd && <Button variant="outline" className="w-full" onClick={() => cancel.mutate()} loading={cancel.isPending}>Cancel subscription</Button>}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {s.mode === "mock" && s.status !== "NONE" && (
        <Card>
          <CardHeader><CardTitle>Simulate billing events</CardTitle><CardDescription>Fire the same signals a Stripe webhook would deliver.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(["payment_failed", "payment_succeeded", "resume", "delete"] as const).map((a) => <Button key={a} size="sm" variant="outline" onClick={() => mock.mutate({ action: a })}>{a.replace("_", " ")}</Button>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
