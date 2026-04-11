import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/features/workspace/context";

export function NotificationBell() {
  const navigate = useNavigate();
  const { pendingInvites, setSelectedProjectId, setSelectedOrganizationId } = useWorkspace();
  const acceptProjectInvite = useMutation(api.workspaces.acceptProjectInvite);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-10 w-10 border border-white/5 bg-black/20 text-slate-400 hover:text-white"
        >
          <Bell className="size-5" />
          {pendingInvites.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-neon-magenta text-[8px] font-bold text-white shadow-neon-magenta-sm ring-2 ring-background">
              {pendingInvites.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 border border-white/10 bg-zinc-950 p-2 shadow-2xl backdrop-blur-xl"
      >
        <DropdownMenuLabel className="flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
          Inbound Deployments
          <span className="rounded-md bg-neon-magenta/10 px-1.5 py-0.5 text-neon-magenta text-[8px]">
            Live Status
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/5" />
        <div className="max-h-80 overflow-y-auto pt-2">
          {pendingInvites.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs font-medium uppercase tracking-widest text-slate-600">
                No pending authorizations
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {pendingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="group relative flex flex-col gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:border-neon-magenta/30"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-white">{invite.projectName}</p>
                      <p className="truncate text-[9px] uppercase tracking-wider text-slate-500">
                        {invite.organizationName}
                      </p>
                    </div>
                    <div className="rounded-lg border border-neon-magenta/20 bg-neon-magenta/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-neon-magenta">
                      {invite.role}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="h-8 w-full bg-neon-magenta text-[9px] font-bold uppercase tracking-widest text-white hover:bg-neon-magenta/90"
                    onClick={async () => {
                      await acceptProjectInvite({ inviteId: invite.id });
                      setSelectedProjectId(invite.projectId);
                      setSelectedOrganizationId(invite.organizationId);
                      navigate("/project");
                    }}
                  >
                    Accept Authorization
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
