/**
 * formula-bar.tsx — The formula input bar for the sheet-metal editor.
 *
 * Replaces the legacy "Select Preset" dropdown with a text input that
 * shows/syncs the current formula DSL string. Changes are debounced and
 * parsed in real-time.
 *
 * Features:
 * - Real-time formula parsing with error highlighting
 * - Copy-to-clipboard button
 * - Recent formulas dropdown (persisted to localStorage)
 * - Mod+K keyboard shortcut to focus the bar
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { type ParseError } from "@/features/sheet-metal/formula/grammar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FormulaBarProps = {
  /** The current formula string */
  formula: string;
  /** Parse errors (empty if valid) */
  errors: ParseError[];
  /** Called when the user types in the bar */
  onFormulaChange: (formula: string) => void;
  /** Called when user selects a recent formula */
  onSelectPreset?: (formula: string) => void;
  /** Optional ref to be focused via Mod+K */
  inputRef?: React.RefObject<HTMLInputElement | null>;
};

// ---------------------------------------------------------------------------
// localStorage helpers for recent formulas
// ---------------------------------------------------------------------------

const STORAGE_KEY = "alugamma-recent-formulas";
const MAX_RECENT = 10;

function loadRecentFormulas(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecentFormula(formula: string) {
  if (!formula.trim()) return;
  const recent = loadRecentFormulas().filter((f) => f !== formula);
  recent.unshift(formula);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FormulaBar({
  formula,
  errors,
  onFormulaChange,
  onSelectPreset,
  inputRef: externalRef,
}: FormulaBarProps) {
  const internalRef = useRef<HTMLInputElement>(null);
  // Use a callback ref that bridges both the external and internal ref
  const setInputRef = useCallback((el: HTMLInputElement | null) => {
    (internalRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
    if (externalRef && "current" in externalRef) {
      (externalRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
    }
  }, [externalRef]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [recentFormulas, setRecentFormulas] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  // Load recent formulas on mount
  useEffect(() => {
    setRecentFormulas(loadRecentFormulas());
  }, []);

  // Persist formula on blur (only if valid)
  const handleBlur = useCallback(() => {
    if (errors.length === 0 && formula.trim()) {
      saveRecentFormula(formula.trim());
      setRecentFormulas(loadRecentFormulas());
    }
    // Close dropdown after a tiny delay so click events can fire
    setTimeout(() => setShowDropdown(false), 150);
  }, [errors, formula]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(formula).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [formula]);

  const handleErrorTokenIndex = (tokenIndex: number): number => {
    // Map token index to approximate character position in the formula string
    const tokens = formula.split(/\s+/);
    let pos = 0;
    for (let i = 0; i < tokenIndex && i < tokens.length; i++) {
      pos += tokens[i].length + 1; // +1 for the space
    }
    return pos;
  };

  const hasErrors = errors.length > 0;
  const firstError = errors[0];

  return (
    <div className="relative flex items-center gap-1.5">
      {/* Formula input */}
      <div className="relative flex-1">
        <input
          ref={setInputRef}
          type="text"
          value={formula}
          onChange={(e) => onFormulaChange(e.target.value)}
          onFocus={() => {
            setShowDropdown(true);
            setRecentFormulas(loadRecentFormulas());
          }}
          onBlur={handleBlur}
          placeholder="500x500 WF25 Q E"
          spellCheck={false}
          autoComplete="off"
          className={`w-full rounded-md border bg-black/40 px-3 py-1.5 font-mono text-xs text-foreground shadow-sm transition-all placeholder:text-slate-600 focus-visible:outline-none ${
            hasErrors
              ? "border-amber-500/50 focus-visible:border-amber-500/70 focus-visible:ring-1 focus-visible:ring-amber-500/30"
              : "border-white/10 focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/20"
          }`}
          style={{
            // Highlight the error token's position in the input if possible
            ...(firstError ? { caretColor: "#f59e0b" } : {}),
          }}
        />

        {/* Error tooltip */}
        {hasErrors && firstError && (
          <div className="absolute left-0 top-full mt-1 z-50 max-w-xs rounded-md border border-amber-500/30 bg-amber-950/90 px-2 py-1 text-[10px] text-amber-300 shadow-lg">
            Token {firstError.tokenIndex + 1}: {firstError.message}
          </div>
        )}
      </div>

      {/* Recent formulas dropdown toggle */}
      {recentFormulas.length > 0 && (
        <button
          type="button"
          onClick={() => setShowDropdown((v) => !v)}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-[10px] text-muted-foreground/60 transition-colors hover:bg-white/[0.06] hover:text-muted-foreground"
          title="Recent formulas"
        >
          ▼
        </button>
      )}

      {/* Copy button */}
      <button
        type="button"
        onClick={handleCopy}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-[10px] text-muted-foreground/60 transition-colors hover:bg-white/[0.06] hover:text-muted-foreground"
        title="Copy formula"
      >
        {copied ? "✓" : "⎘"}
      </button>

      {/* Recent formulas dropdown */}
      {showDropdown && recentFormulas.length > 0 && (
        <div className="absolute left-0 top-full mt-1 z-50 max-h-48 w-full overflow-y-auto rounded-md border border-white/10 bg-card/95 py-1 shadow-xl backdrop-blur-sm">
          <div className="px-2 py-1 text-[9px] uppercase tracking-widest text-muted-foreground/50">
            Recent formulas
          </div>
          {recentFormulas.map((recent, i) => (
            <button
              key={`${recent}-${i}`}
              type="button"
              className="w-full px-2 py-1 text-left font-mono text-[10px] text-foreground/80 hover:bg-white/[0.06]"
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur
                onFormulaChange(recent);
                onSelectPreset?.(recent);
                setShowDropdown(false);
              }}
            >
              {recent}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}