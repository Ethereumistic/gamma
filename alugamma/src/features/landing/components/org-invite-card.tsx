import { User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { PendingOrgInviteSummary } from "@/features/workspace/context";

interface OrgInviteCardProps {
  invite: PendingOrgInviteSummary;
  disabled: boolean;
  onAccept: (inviteId: Id<"organizationInvites">, organizationId: Id<"organizations">) => void;
  onDecline: (inviteId: Id<"organizationInvites">) => void;
}

export function OrgInviteCard({ invite, disabled, onAccept, onDecline }: OrgInviteCardProps) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-cyan-500/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/5 border border-white/10 text-lg">
            🏢
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">ORGANIZATION</p>
            <h4 className="font-display text-xs font-black text-white truncate">{invite.organizationName}</h4>
          </div>
        </div>
        <div className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-cyan-500">
          {invite.role}
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] p-2 border border-white/5">
        <div className="flex size-6 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-500">
          <User className="size-3" />
        </div>
        <div className="min-w-0">
          <p className="text-[8px] font-bold text-white truncate">{invite.invitedBy?.name || "Oracle"}</p>
          <p className="text-[7px] font-medium text-slate-500 truncate">{invite.invitedBy?.email}</p>
        </div>
      </div>

      <div className="flex gap-2 mt-1">
        <Button
          variant="default"
          className="flex-1 h-8 text-[8px] font-bold uppercase tracking-[0.2em] bg-cyan-600 hover:bg-cyan-500"
          onClick={() => onAccept(invite.id, invite.organizationId)}
          disabled={disabled}
        >
          JOIN
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onDecline(invite.id)}
          disabled={disabled}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
