import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

type SidebarRenameDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => Promise<void> | void;
  confirmLabel: string;
  minLength?: number;
  canConfirm?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
};

export function SidebarRenameDialog({
  open,
  onOpenChange,
  title,
  description,
  value,
  onChange,
  onConfirm,
  confirmLabel,
  canConfirm = true,
  onKeyDown,
}: SidebarRenameDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-white/10 bg-[#090d16] text-white sm:max-w-[425px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-xl font-bold uppercase tracking-tight text-white">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400 font-body text-sm">
            {description}
          </AlertDialogDescription>
          <div className="py-4">
            <Input
              autoFocus
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="bg-black/40 border-white/10 text-white focus-visible:ring-primary/50"
              onKeyDown={onKeyDown}
            />
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="rounded-xl border-white/10 bg-transparent text-slate-400 hover:bg-white/5 hover:text-white transition-all">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className="rounded-xl bg-primary text-black font-bold uppercase tracking-widest hover:bg-primary/90 border-none shadow-neon-green-sm"
            disabled={!canConfirm}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
