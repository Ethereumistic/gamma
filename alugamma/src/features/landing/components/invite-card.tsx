import { User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { PendingInviteSummary } from "@/features/workspace/context";

interface InviteCardProps {
  invite: PendingInviteSummary;
  disabled: boolean;
  onAccept: (inviteId: Id<"projectInvites">, projectId: Id<"projects">, organizationId: Id<"organizations">) => void;
  onDecline: (inviteId: Id<"projectInvites">) => void;
}

export function InviteCard({ invite, disabled, onAccept, onDecline }: InviteCardProps) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-neon-magenta/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/5 border border-white/10 text-lg">
            {invite.organizationIcon || "🏢"}
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">ORGANIZATION</p>
            <h4 className="font-display text-xs font-black text-white truncate">{invite.organizationName}</h4>
          </div>
        </div>
        <div className="rounded-md border border-neon-magenta/20 bg-neon-magenta/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-neon-magenta">
          {invite.role}
        </div>
      </div>

      <div className="space-y-1 py-2 border-y border-white/5">
        <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-widest">
          <span className="text-slate-500">PROJECT</span>
          <span className="text-white">{invite.projectName}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] p-2 border border-white/5">
        <div className="flex size-6 items-center justify-center rounded-full bg-neon-magenta/10 text-neon-magenta">
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
          className="flex-1 h-8 text-[8px] font-bold uppercase tracking-[0.2em]"
          onClick={() => onAccept(invite.id, invite.projectId, invite.organizationId)}
          disabled={disabled}
        >
          ACCEPT
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
