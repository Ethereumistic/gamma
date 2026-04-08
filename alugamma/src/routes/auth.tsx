import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { Link, Navigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/logo";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion, AnimatePresence } from "motion/react";

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
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-background px-4 py-12 lg:px-8">
      {/* Background decoration */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.1] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_100%)]">
          <div className="panel-grid h-full w-full" />
        </div>
        <div className="absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-neon-green/5 blur-[120px]" />
        <div className="absolute -right-32 bottom-1/4 h-96 w-96 rounded-full bg-neon-magenta/5 blur-[120px]" />
      </div>

      <div className="relative z-10 grid w-full max-w-6xl gap-12 lg:grid-cols-[minmax(0,1.2fr),420px]">
        <motion.section 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex flex-col justify-center overflow-hidden rounded-[2.5rem] border border-white/5 bg-card/20 p-8 shadow-2xl backdrop-blur-md lg:p-12 transition-all hover:border-white/10"
        >
          <div className="max-w-2xl space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-neon-green/20 bg-neon-green/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.28em] text-neon-green text-glow-green-sm">
              Control Center Access
            </div>
            
            <div className="space-y-4">
              <h1 className="font-display text-4xl font-black tracking-tight text-white lg:text-7xl">
                Precision <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-neon-green via-white to-neon-magenta">
                  Forged
                </span>
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-slate-400">
                Enter the ecosystem where every DXF profile becomes a living production asset. 
                Full traceability from design to CNC code.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <ValueCard
                icon={<LockKeyhole className="h-5 w-5" />}
                title="Secure Vault"
                description="AES-256 session integrity via Convex &Omega; Engine."
              />
              <ValueCard
                icon={<UserRound className="h-5 w-5 text-neon-magenta" />}
                title="Role Matrix"
                description="Granular permissions for designers and production ops."
              />
              <ValueCard
                icon={<ArrowRight className="h-5 w-5" />}
                title="Live Sync"
                description="Real-time geometry state across your entire team."
              />
            </div>
          </div>
        </motion.section>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="overflow-hidden border-white/10 bg-card/40 shadow-2xl backdrop-blur-xl">
            <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
              <CardHeader className="space-y-6 border-b border-white/5 bg-white/[0.01] p-8">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="signIn">Sign In</TabsTrigger>
                  <TabsTrigger value="signUp">Sign Up</TabsTrigger>
                </TabsList>
                <div>
                  <CardTitle className="font-display text-2xl font-bold tracking-tight text-white">
                    {mode === "signIn" ? "Authorize Access" : "Initialize Identity"}
                  </CardTitle>
                  <CardDescription className="text-slate-400 mt-2">
                    {mode === "signIn"
                      ? "Use your corporate credentials to resume work."
                      : "Create a new professional seat in the Forge environment."}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-8">
                <form className="space-y-5" onSubmit={handleSubmit}>
                  <AnimatePresence mode="wait">
                    {mode === "signUp" && (
                      <motion.div
                        key="name"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                      >
                        <Field label="Full name">
                          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Ahmad Saab" />
                        </Field>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  
                  <Field label="Identity (Email)">
                    <Input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@company.com"
                      autoComplete="email"
                    />
                  </Field>
                  
                  <Field label="Key (Password)">
                    <Input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Secret passcode"
                      autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                    />
                  </Field>

                  {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs font-bold uppercase tracking-widest text-destructive animate-pulse">{error}</p>}
                  {message && <p className="rounded-xl border border-neon-green/30 bg-neon-green/10 px-4 py-3 text-xs font-bold uppercase tracking-widest text-neon-green">{message}</p>}

                  <Button variant="neon" className="h-12 w-full group" disabled={submitting}>
                    {submitting ? "Processing..." : mode === "signIn" ? "Authorize" : "Initialize Account"}
                    {!submitting && <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />}
                  </Button>
                </form>

                <div className="mt-8 flex flex-col items-center gap-4 border-t border-white/5 pt-6 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  <span className="text-center italic opacity-60">Omega Forge Industrial Protocol &Omega;-01</span>
                  <Button asChild variant="link" className="h-auto px-0 text-neon-green/60 hover:text-neon-green transition-colors">
                    <Link to="/">Exit to Overview</Link>
                  </Button>
                </div>
              </CardContent>
            </Tabs>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 opacity-80">{label}</span>
      {children}
    </label>
  );
}

function ValueCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/5 bg-black/40 p-5 transition-all hover:bg-black/60 hover:border-white/10 group">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 group-hover:border-neon-green/30 group-hover:bg-neon-green/5 transition-all text-neon-green">
        {icon}
      </div>
      <h3 className="font-display text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
    </div>
  );
}
