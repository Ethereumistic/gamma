import { useWorkspace } from "@/features/workspace/context";
import { LandingHero } from "@/features/landing/components/landing-hero";
import { LandingDashboard } from "@/features/landing/components/landing-dashboard";
import { Card, CardContent } from "@/components/ui/card";

export default function LandingPage() {
  const { authenticated, isLoadingWorkspace } = useWorkspace();

  if (isLoadingWorkspace) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-12 lg:px-8">
        <Card className="w-full max-w-2xl border-white/10 bg-card/80">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading workspace...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!authenticated) {
    return <LandingHero />;
  }

  return <LandingDashboard />;
}
