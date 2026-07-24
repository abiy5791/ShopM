import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";

import { Logo } from "@/components/logo";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/lib/auth";
import type { ApiError } from "@/types";

import { useLogin } from "./api";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
type FormValues = z.infer<typeof schema>;

/** Filled, borderless fields — the page is quiet, so the fields carry the look. */
const fieldClass = "h-11 rounded-xl border-transparent bg-muted px-4 shadow-none";

export default function LoginPage() {
  const navigate = useNavigate();
  const isAuthed = useAuthStore((s) => Boolean(s.access));
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);

  // Validate on submit only: onBlur flags "required" while people (or the
  // browser's autofill) are still filling the form.
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), mode: "onSubmit" });

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
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        {/* Brand mark. Edit src/components/logo.tsx to change the artwork. */}
        <Logo className="h-11 w-11 text-foreground" />

        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          Log in to <span className="font-mono">ShopM</span>
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Point of sale, inventory, and reports for every shop you run.
        </p>

        <form onSubmit={onSubmit} noValidate className="mt-8 space-y-3">
          {formError && (
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <div>
            <label htmlFor="email" className="sr-only">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="Email"
              autoComplete="email"
              autoFocus
              aria-invalid={Boolean(errors.email)}
              className={fieldClass}
              {...register("email")}
            />
            {errors.email && (
              <p role="alert" className="mt-1.5 px-1 text-xs text-destructive">
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <PasswordInput
              id="password"
              placeholder="Password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.password)}
              className={fieldClass}
              {...register("password")}
            />
            {errors.password && (
              <p role="alert" className="mt-1.5 px-1 text-xs text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          <Button type="submit" className="h-11 w-full rounded-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Log in
          </Button>
        </form>

        {/* No self-signup: accounts are created by the shop owner (plan §8). */}
        <p className="mt-5 text-sm text-muted-foreground">
          Don&apos;t have an account? Ask your shop owner to add you.
        </p>
      </div>
    </main>
  );
}
