interface NavNumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

export function NavNumberField({ label, value, onChange }: NavNumberFieldProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value === 0 ? "" : value.toString()}
          onChange={(event) => {
            const raw = event.target.value.replace(/[^0-9]/g, "");
            onChange(raw === "" ? 0 : Number(raw));
          }}
          className="h-8 w-[80px] rounded-md border border-white/10 bg-black/20 px-2 pr-6 font-mono text-xs text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
        />
        <span className="absolute right-2 top-1.5 text-[10px] font-medium text-muted-foreground">mm</span>
      </div>
    </div>
  );
}
