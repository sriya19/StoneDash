"use client";

import { RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import type { EventColorKey, EventKind } from "@/lib/validators/events";
import {
  ALL_COLOR_KEYS,
  EVENT_COLOR_CLASSES,
  KIND_DEFAULT_COLOR,
} from "@/lib/events/color";

type Props = {
  // Current stored value: an explicit palette key, or NULL meaning
  // "follow the kind default". The picker treats these two states
  // distinctly — the ring lands on the effective color either way,
  // but a small "(default)" label appears when NULL.
  value: EventColorKey | null;
  kind: EventKind;
  onChange: (next: EventColorKey | null) => void;
  disabled?: boolean;
};

// PLAN Q6 lock: 10 circles in a row, ring on the active pick, and a
// small "(default)" label + reset affordance to distinguish NULL
// (follow-the-kind-default) from an explicit selection.
//
// Dirty-flag semantics live in the CALLER (parent form): once the
// user has clicked an explicit color, the picker's kind default no
// longer follows kind changes. We just render whatever `value` we're
// given — the parent decides how to interpret kind changes.
export function EventColorPicker({ value, kind, onChange, disabled }: Props) {
  const kindDefault = KIND_DEFAULT_COLOR[kind] ?? "slate";
  const effective = value ?? kindDefault;
  const isDefault = value === null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">Color</span>
        {isDefault ? (
          <span className="text-[10px] text-muted-foreground">
            (default for {kind})
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            aria-label="Reset to kind default"
            disabled={disabled}
          >
            <RotateCcw className="h-2.5 w-2.5" />
            Use default
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {ALL_COLOR_KEYS.map((key) => {
          const isActive = effective === key;
          const classes = EVENT_COLOR_CLASSES[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-label={`Set color to ${key}`}
              aria-pressed={isActive}
              disabled={disabled}
              className={cn(
                "h-6 w-6 rounded-full border transition-all",
                isActive
                  ? cn(
                      "ring-2 ring-offset-1 ring-offset-background",
                      classes.ring,
                    )
                  : "hover:scale-110",
                disabled && "opacity-40",
              )}
              style={{ backgroundColor: classes.hex }}
            />
          );
        })}
      </div>
    </div>
  );
}
