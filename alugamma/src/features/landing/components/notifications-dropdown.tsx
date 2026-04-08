import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { PendingInviteSummary, PendingOrgInviteSummary } from "@/features/workspace/context";
import { InviteCard } from "./invite-card";
import { OrgInviteCard } from "./org-invite-card";

interface NotificationsDropdownProps {
  pendingInvites: PendingInviteSummary[];
  pendingOrgInvites: PendingOrgInviteSummary[];
  busyAction: string | null;
  onAcceptInvite: (inviteId: Id<"projectInvites">, projectId: Id<"projects">, organizationId: Id<"organizations">) => void;
  onDeclineInvite: (inviteId: Id<"projectInvites">) => void;
  onAcceptOrgInvite: (inviteId: Id<"organizationInvites">, organizationId: Id<"organizations">) => void;
  onDeclineOrgInvite: (inviteId: Id<"organizationInvites">) => void;
}

export function NotificationsDropdown({
  pendingInvites,
  pendingOrgInvites,
  busyAction,
  onAcceptInvite,
  onDeclineInvite,
  onAcceptOrgInvite,
  onDeclineOrgInvite,
}: NotificationsDropdownProps) {
  const totalCount = pendingInvites.length + pendingOrgInvites.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-10 w-10 border border-white/5 bg-black/20 text-slate-400 hover:text-white rounded-md transition-all"
        >
          <Bell className="size-5" />
          {totalCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-neon-magenta text-[8px] font-bold text-white shadow-neon-magenta-sm ring-2 ring-background animate-pulse">
              {totalCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[380px] border border-white/10 bg-zinc-950 p-3 shadow-2xl backdrop-blur-xl rounded-md"
      >
        <DropdownMenuLabel className="flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
          NOTIFICATIONS
          <span className="rounded-md bg-neon-magenta/10 px-1.5 py-0.5 text-neon-magenta text-[8px]">
            ACTIVE DEPLOYMENTS
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/5" />

        <div className="max-h-[500px] overflow-y-auto space-y-3 pt-3">
          {totalCount === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest italic">
                No pending system protocols
              </p>
            </div>
          ) : (
            <div className="space-y-3 p-1">
              {pendingInvites.map((invite) => (
                <InviteCard
                  key={invite.id}
                  invite={invite}
                  disabled={!!busyAction}
                  onAccept={onAcceptInvite}
                  onDecline={onDeclineInvite}
                />
              ))}

              {pendingOrgInvites.map((invite) => (
                <OrgInviteCard
                  key={invite.id}
                  invite={invite}
                  disabled={!!busyAction}
                  onAccept={onAcceptOrgInvite}
                  onDecline={onDeclineOrgInvite}
                />
              ))}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
