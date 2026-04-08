import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const COMMON_EMOJIS = [
  "🏢", "🏪", "🏫", "🏭", "🏠", "🏡", "🏥", "🏦",
  "🏗️", "📐", "🔨", "🛠️", "🔧", "⚙️", "🔦", "💎",
];

interface EmojiPickerProps {
  value: string;
  onChange: (value: string) => void;
}

export function EmojiPicker({ value, onChange }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-14 w-full text-2xl bg-black/40 border-white/10 hover:bg-white/5 hover:border-white/20 transition-all"
        >
          {value || "🏢"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[340px] border-white/10 bg-zinc-950 text-white rounded-md">
        <DialogHeader>
          <DialogTitle className="text-xs font-bold uppercase tracking-[0.3em] text-slate-500 text-center">
            Select Identity Icon
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-3 pt-4">
          {COMMON_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onChange(emoji);
                setOpen(false);
              }}
              className="flex items-center justify-center h-14 rounded-md bg-white/5 hover:bg-white/10 text-2xl border border-white/5 hover:border-white/10 transition-all font-emoji"
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="pt-6 space-y-3">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, 3))}
            placeholder="Custom Label (ABC)"
            className="h-12 bg-black/40 border-white/10 text-center text-sm font-bold uppercase tracking-widest"
            maxLength={3}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
