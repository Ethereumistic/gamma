import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { Link, Navigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type AuthMode = "signIn" | "signUp";

export default function AuthPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-12">
        <Card className="w-full max-w-xl border-white/10 bg-card/80">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Preparing authentication...</CardContent>
        </Card>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      const result = await signIn("password", {
        flow: mode,
        email,
        password,
        ...(mode === "signUp" && name.trim().length > 0 ? { name: name.trim() } : {}),
      });

      if (result.redirect) {
        window.location.href = result.redirect.toString();
        return;
      }

      setMessage(mode === "signUp" ? "Account created. Signing you in..." : "Signing you in...");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12 lg:px-8">
      <div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.2fr),420px]">
        <section className="overflow-hidden rounded-[2rem] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(58,196,143,0.16),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-8 shadow-2xl lg:p-12">
          <div className="max-w-2xl space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200">
              Convex Workspace Access
            </div>
            <h1 className="font-display text-4xl font-semibold tracking-tight text-white lg:text-6xl">
              Persist every DXF as a reusable production design.
            </h1>
            <p className="max-w-xl text-base leading-7 text-slate-300">
              Sign in to create organizations, group projects, invite teammates by email, and reopen any saved sheet model
              for editing or re-exporting.
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <ValueCard
                icon={<LockKeyhole className="h-5 w-5 text-emerald-300" />}
                title="Password auth"
                description="Convex Auth keeps sessions in sync with the database."
              />
              <ValueCard
                icon={<UserRound className="h-5 w-5 text-sky-300" />}
                title="Team access"
                description="Organizations, projects, roles, and pending invites are first-class records."
              />
              <ValueCard
                icon={<ArrowRight className="h-5 w-5 text-amber-300" />}
                title="Re-export anytime"
                description="Design data is stored, so a DXF can always be regenerated later."
              />
            </div>
          </div>
        </section>

        <Card className="border-white/10 bg-card/85 shadow-2xl backdrop-blur">
          <CardHeader className="space-y-4 border-b border-white/6 bg-white/[0.02]">
            <div className="inline-flex rounded-full border border-white/10 bg-black/20 p-1">
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  mode === "signIn" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-white"
                }`}
                onClick={() => setMode("signIn")}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  mode === "signUp" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-white"
                }`}
                onClick={() => setMode("signUp")}
              >
                Create account
              </button>
            </div>
            <div>
              <CardTitle>{mode === "signIn" ? "Welcome back" : "Create your workspace account"}</CardTitle>
              <CardDescription>
                {mode === "signIn"
                  ? "Use the same email that was invited to a project."
                  : "New accounts can create organizations and accept invites immediately."}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <form className="space-y-4" onSubmit={handleSubmit}>
              {mode === "signUp" && (
                <Field label="Full name">
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Ahmad Saab" />
                </Field>
              )}
              <Field label="Email">
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@company.com"
                  autoComplete="email"
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Minimum 8 characters"
                  autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                />
              </Field>

              {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
              {message && <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">{message}</p>}

              <Button className="h-11 w-full" disabled={submitting}>
                {submitting ? "Working..." : mode === "signIn" ? "Sign in" : "Create account"}
              </Button>
            </form>

            <div className="mt-6 flex items-center justify-between border-t border-white/6 pt-4 text-sm text-muted-foreground">
              <span>Need the main workspace dashboard first?</span>
              <Button asChild variant="link" className="h-auto px-0">
                <Link to="/">Open overview</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2 text-sm">
      <span className="font-medium text-slate-200">{label}</span>
      {children}
    </label>
  );
}

function ValueCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/8 bg-black/20 p-5">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
        {icon}
      </div>
      <h3 className="font-display text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
    </div>
  );
}
