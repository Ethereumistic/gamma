import { cn } from "@/lib/utils";

type LogoVariant = "full" | "short" | "mark";

interface LogoProps {
  variant?: LogoVariant;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showGlow?: boolean;
}

const sizeMap: Record<LogoVariant, Record<string, string>> = {
  full: {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-4xl",
    xl: "text-6xl",
  },
  short: {
    sm: "text-base",
    md: "text-xl",
    lg: "text-3xl",
    xl: "text-5xl",
  },
  mark: {
    sm: "text-sm",
    md: "text-lg",
    lg: "text-2xl",
    xl: "text-4xl",
  },
};

export function Logo({ variant = "full", className, size = "md", showGlow = true }: LogoProps) {
  if (variant === "mark") {
    return (
      <span
        className={cn(
          "font-logotype font-extrabold tracking-tight",
          sizeMap.mark[size],
          className
        )}
      >
        <span
          className={cn(
            "text-primary",
            showGlow && "text-glow-green"
          )}
        >
          {"\u03A9"}
        </span>
        <span className="text-foreground">F</span>
      </span>
    );
  }

  if (variant === "short") {
    return (
      <span
        className={cn(
          "font-logotype font-extrabold tracking-tight",
          sizeMap.short[size],
          className
        )}
      >
        <span
          className={cn(
            "text-neon-green mr-2",
            showGlow && "text-glow-green"
          )}
        >
          {"\u03A9"}
        </span>
        <span className={cn(
          "text-foreground text-neon-magenta",
          showGlow && "text-glow-magenta"
        )}>Forge</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "font-logotype font-extrabold tracking-tight",
        sizeMap.full[size],
        className
      )}
    >
      <span
        className={cn(
          "text-neon-green",
          showGlow && "text-glow-green"
        )}
      >
        {"\u03A9"}mega
      </span>{" "}
      <span className=" text-glow-magenta">Forge</span>
    </span>
  );
}

export function LogoFull(props: Omit<LogoProps, "variant">) {
  return <Logo variant="full" {...props} />;
}

export function LogoShort(props: Omit<LogoProps, "variant">) {
  return <Logo variant="short" {...props} />;
}

export function LogoMark(props: Omit<LogoProps, "variant">) {
  return <Logo variant="mark" {...props} />;
}
