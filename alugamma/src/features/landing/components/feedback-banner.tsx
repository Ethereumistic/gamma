interface FeedbackBannerProps {
  error: string | null;
  feedback: string | null;
}

export function FeedbackBanner({ error, feedback }: FeedbackBannerProps) {
  if (!error && !feedback) return null;

  return (
    <div
      className={`rounded-2xl border p-4 text-[10px] font-bold uppercase tracking-[0.2em] text-center ${
        error
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-neon-green/30 bg-neon-green/5 text-neon-green shadow-neon-green-sm"
      }`}
    >
      {error ?? feedback}
    </div>
  );
}
