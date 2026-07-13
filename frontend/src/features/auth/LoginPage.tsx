import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/auth";
import type { ApiError } from "@/types";

import { useLogin } from "./api";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
type FormValues = z.infer<typeof schema>;

/** The wordmark is set in monospace and paired with a blinking block caret — the
 *  brand reads like a receipt printer / POS terminal, the product's own world. */
function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={"font-mono text-xl font-bold tracking-tight " + className}>
      ShopM
      <span className="caret-blink ml-0.5 inline-block h-4 w-[0.55rem] translate-y-0.5 bg-accent" />
    </span>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const isAuthed = useAuthStore((s) => Boolean(s.access));
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), mode: "onBlur" });

  if (isAuthed) return <Navigate to="/" replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login.mutateAsync(values);
      navigate("/", { replace: true });
    } catch (err) {
      const detail = (err as AxiosError<ApiError>).response?.data?.detail;
      setFormError(detail ?? "We couldn't sign you in. Check your email and password.");
    }
  });

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* --- Brand panel: the offline-POS thesis, told through a receipt --- */}
      <aside
        className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex xl:p-14"
        style={{
          backgroundImage:
            "radial-gradient(hsl(var(--sidebar-foreground) / 0.06) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      >
        <Wordmark />

        <div className="relative flex flex-1 items-center">
          <ReceiptStrip />
        </div>

        <div>
          <h1 className="max-w-md text-2xl font-semibold leading-snug">
            Keep selling — even when the internet drops.
          </h1>
          <p className="mt-2 max-w-md text-sm text-sidebar-foreground/60">
            Point of sale, inventory, and reports for every shop you run.
          </p>
          <p className="mt-6 font-mono text-xs uppercase tracking-widest text-sidebar-foreground/40">
            Offline-ready POS · Multi-shop · Live reports
          </p>
        </div>
      </aside>

      {/* --- Sign-in --- */}
      <main className="flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Wordmark />
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome back. Enter your details to continue.
          </p>

          <form onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
            {formError && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {formError}
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                aria-invalid={Boolean(errors.email)}
                {...register("email")}
              />
              {errors.email && (
                <p role="alert" className="text-xs text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                {...register("password")}
              />
              {errors.password && (
                <p role="alert" className="text-xs text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </Button>
          </form>

          {import.meta.env.DEV && (
            <div className="mt-6 rounded-md border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Demo</span> — sign in with{" "}
              <span className="font-mono">owner@shopm.local</span> ·{" "}
              <span className="font-mono">password123</span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/** The signature element: a torn thermal receipt whose final line — a green
 *  "SYNCED" stamp — is the whole product promise in one glance. Figures use the
 *  seeded catalogue so it reads as a real sale, not lorem filler. */
function ReceiptStrip() {
  const items = [
    { q: 2, name: "Coca-Cola 300ml", amt: "Br50.00" },
    { q: 1, name: "Dabo Bread", amt: "Br15.00" },
    { q: 1, name: "Ambo Water 1L", amt: "Br30.00" },
  ];
  const totals = [
    { label: "SUBTOTAL", amt: "Br95.00" },
    { label: "CASH", amt: "Br100.00" },
    { label: "CHANGE", amt: "Br5.00" },
  ];
  return (
    <div className="w-full max-w-[300px] -rotate-1">
      <div className="rounded-sm bg-[#FAFAF7] p-5 font-mono text-[13px] leading-relaxed text-slate-800 shadow-2xl shadow-black/40">
        <div className="text-center">
          <p className="font-semibold uppercase tracking-wide">Bole Mini-Mart</p>
          <p className="text-[11px] text-slate-500">Tue 14:32</p>
        </div>
        <Dashed />
        {items.map((i) => (
          <div key={i.name} className="flex justify-between">
            <span>
              {i.q} × {i.name}
            </span>
            <span className="tabular-nums">{i.amt}</span>
          </div>
        ))}
        <Dashed />
        {totals.map((t) => (
          <div key={t.label} className="flex justify-between">
            <span className="text-slate-500">{t.label}</span>
            <span className="tabular-nums">{t.amt}</span>
          </div>
        ))}
        <Dashed />
        <div className="flex items-center gap-2 font-semibold text-accent">
          <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-accent text-white">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          SYNCED
        </div>
        <p className="mt-1 text-[11px] text-slate-400">Recorded offline · synced on reconnect</p>
      </div>
    </div>
  );
}

function Dashed() {
  return <div className="my-2 border-t border-dashed border-slate-300" />;
}
