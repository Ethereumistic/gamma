import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { ArrowRight, Building2, FolderKanban, ScissorsLineDashed, Cpu } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Logo } from "@/components/logo";
import { AuthField } from "./auth-field";
import { FeaturePill } from "./feature-pill";

export function LandingHero() {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();

  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isAuthenticated) {
    return null;
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
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-background px-4 py-8 lg:px-8">
      {/* Background Layer */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.15] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_100%)]">
          <div className="panel-grid h-full w-full" />
        </div>

        {/* Decorative Orbs */}
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.05, 0.08, 0.05] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -left-32 top-1/4 h-[500px] w-[500px] rounded-full bg-neon-green/10 blur-[120px]"
        />
        <motion.div
          animate={{ scale: [1.2, 1, 1.2], opacity: [0.04, 0.07, 0.04] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -right-32 bottom-1/4 h-[500px] w-[500px] rounded-full bg-neon-magenta/10 blur-[120px]"
        />
      </div>

      <div className="relative z-10 grid w-full max-w-[1240px] gap-12 lg:grid-cols-[1fr,440px] lg:gap-20">
        {/* LEFT COLUMN: Hero content */}
        <motion.section
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="flex flex-col justify-center space-y-12"
        >
          <div className="space-y-8">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Logo
                variant="full"
                size="xl"
                className="brightness-110 drop-shadow-[0_0_15px_rgba(57,255,20,0.3)]"
              />
            </motion.div>

            <div className="space-y-4">
              <motion.h2
                initial={{ opacity: 0, letterSpacing: "0.2em" }}
                animate={{ opacity: 1, letterSpacing: "0.45em" }}
                transition={{ duration: 1, delay: 0.4 }}
                className="font-mono text-xs font-bold uppercase text-neon-magenta text-glow-magenta-sm lg:text-sm"
              >
                Precision Forged to &Omega;
              </motion.h2>
            </div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="max-w-xl text-lg leading-relaxed text-slate-400 lg:text-xl"
            >
              The advanced fenestration ecosystem. From DXF profile engineering to
              <span className="text-white"> automated CNC manufacturing</span>&mdash;all powered
              by a high-precision geometry engine.
            </motion.p>

            {/* Feature display */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1, duration: 0.6 }}
              className="grid gap-4 sm:grid-cols-2 lg:flex lg:flex-wrap"
            >
              <FeaturePill icon={<ScissorsLineDashed />} label="DXF Editor" delay={1.1} />
              <FeaturePill icon={<Building2 />} label="Assembly Engine" delay={1.2} />
              <FeaturePill icon={<Cpu />} label="CNC Pipeline" delay={1.3} />
              <FeaturePill icon={<FolderKanban />} label="PDR Management" delay={1.4} />
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5 }}
            className="flex items-center gap-6"
          >
            <div className="h-[1px] w-12 bg-neon-green/30" />
            <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-slate-500">
              Trusted by modern envelope fabricators
            </p>
          </motion.div>
        </motion.section>

        {/* RIGHT COLUMN: Auth Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, x: 20 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="relative"
        >
          {/* Decorative halo around card */}
          <div className="absolute -inset-1 rounded-[2rem] bg-gradient-to-br from-neon-green/20 via-transparent to-neon-magenta/20 blur-xl transition-opacity group-hover:opacity-100" />

          <Card className="relative overflow-hidden border-white/10 bg-card/40 shadow-2xl backdrop-blur-xl transition-all hover:border-neon-green/30 hover:shadow-neon-green/5 rounded-md">
            {/* Top scanning line effect */}
            <motion.div
              animate={{ top: ["0%", "100%", "0%"] }}
              transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
              className="absolute left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-neon-green/20 to-transparent"
            />

            <Tabs value={mode} onValueChange={(v) => setMode(v as "signIn" | "signUp")} className="w-full">
              <CardHeader className="space-y-6 border-b border-white/5 bg-white/[0.02] p-8">
                <div className="flex flex-col gap-6">
                  <TabsList className="grid w-full grid-cols-2 rounded-sm h-12">
                    <TabsTrigger value="signIn" className="rounded-sm">Sign In</TabsTrigger>
                    <TabsTrigger value="signUp" className="rounded-sm">Sign Up</TabsTrigger>
                  </TabsList>

                  <div>
                    <CardTitle className="font-display text-2xl font-bold tracking-tight text-white">
                      {mode === "signIn" ? "Welcome Back" : "Initialize Account"}
                    </CardTitle>
                    <CardDescription className="mt-2 font-body text-sm text-slate-400">
                      {mode === "signIn"
                        ? "Enter your credentials to access the Forge control center."
                        : "Create your workspace and start designing at scale."}
                    </CardDescription>
                  </div>
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
                        transition={{ duration: 0.3 }}
                      >
                        <AuthField label="Full name">
                          <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ahmad Saab"
                          />
                        </AuthField>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AuthField label="Email address">
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      autoComplete="email"
                    />
                  </AuthField>

                  <AuthField label="Security Key">
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                    />
                  </AuthField>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs font-semibold text-destructive uppercase tracking-widest"
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
                      {error}
                    </motion.div>
                  )}

                  {message && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 rounded-xl border border-neon-green/30 bg-neon-green/5 px-4 py-3 text-xs font-semibold text-neon-green uppercase tracking-widest"
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                      {message}
                    </motion.div>
                  )}

                  <Button variant="default" className="h-12 w-full group" disabled={submitting}>
                    <span className="flex items-center justify-center gap-2">
                      {submitting ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
                      ) : (
                        <>
                          {mode === "signIn" ? "Authorize" : "Initialize"}
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </>
                      )}
                    </span>
                  </Button>

                  <p className="text-center text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    Secured by Convex &Omega; Engine
                  </p>
                </form>
              </CardContent>
            </Tabs>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
