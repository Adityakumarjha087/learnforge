"use client";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { authApi } from "@/lib/auth";

function MagicInner() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) return setError("Missing token");
    authApi
      .verifyMagic(token)
      .then(async () => {
        await qc.invalidateQueries({ queryKey: ["session"] });
        router.replace("/dashboard");
      })
      .catch((e: Error) => setError(e.message));
  }, [token, router, qc]);
  return (
    <div className="mx-auto max-w-md p-10">
      {error ? (
        <div className="space-y-3"><ErrorState message={error} /><Link className="text-primary underline" href="/login">Back to sign in</Link></div>
      ) : (
        <LoadingState label="Signing you in…" rows={1} />
      )}
    </div>
  );
}

export default function MagicPage() {
  return (
    <Suspense>
      <MagicInner />
    </Suspense>
  );
}
