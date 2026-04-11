import React from "react";

interface AuthFieldProps {
  label: string;
  children: React.ReactNode;
}

export function AuthField({ label, children }: AuthFieldProps) {
  return (
    <label className="block space-y-2">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 opacity-80">
        {label}
      </span>
      {children}
    </label>
  );
}
