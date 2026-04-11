import { Link } from "react-router-dom";
import { SidebarHeader } from "@/components/ui/sidebar";
import { Logo } from "@/components/logo";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { useWorkspace } from "@/features/workspace/context";

export function SidebarHeaderSection() {
  const { authenticated } = useWorkspace();

  return (
    <SidebarHeader className="border-b border-white/5 px-4 py-4">
      <Link to="/" className="flex items-center justify-center py-1.5 group">
        <Logo size="lg" variant="short" showGlow={true} className="text-white" />
      </Link>

      {authenticated && (
        <div className="mt-4">
          <WorkspaceSwitcher />
        </div>
      )}
    </SidebarHeader>
  );
}
