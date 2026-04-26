"use client";

import { useState } from "react";
import {
  ChevronDown,
  CornerDownRight,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Suggestion, Severity, SuggestionType } from "@/lib/types";

const severityDot: Record<Severity, string> = {
  high: "bg-emerald-500",
  medium: "bg-blue-500",
  low: "bg-gray-400",
};

const severityText: Record<Severity, string> = {
  high: "text-emerald-700",
  medium: "text-blue-700",
  low: "text-gray-600",
};

const typeLabel: Record<SuggestionType, string> = {
  add_entity: "Add entity",
  strengthen_claim: "Strengthen claim",
  add_citation: "Add citation",
  reframe: "Reframe",
  competitor_gap: "Competitor gap",
};

interface SuggestionCardProps {
  suggestion: Suggestion;
  active: boolean;
  onSelect: () => void;
  onApply: () => void;
  onDismiss: () => void;
}

export function SuggestionCard({
  suggestion,
  active,
  onSelect,
  onApply,
  onDismiss,
}: SuggestionCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <article
      onClick={onSelect}
      className={cn(
        "rounded-lg border bg-white p-3 transition-colors cursor-pointer",
        active
          ? "border-amber-300 ring-1 ring-amber-200"
          : "border-gray-200 hover:border-gray-300",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 h-5 px-1.5 rounded border border-gray-200 bg-white text-[11px] font-medium",
            severityText[suggestion.severity],
          )}
        >
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              severityDot[suggestion.severity],
            )}
          />
          {suggestion.severity[0].toUpperCase() + suggestion.severity.slice(1)}
        </span>
        <span className="text-[11px] text-gray-500">
          {typeLabel[suggestion.type]}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="ml-auto -mr-1 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Dismiss suggestion"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="mt-2 text-[13px] text-gray-800 leading-relaxed">
        {suggestion.layman}
      </p>

      {suggestion.suggestedEdit && (
        <div className="mt-2.5 p-2 rounded-md bg-gray-50 border border-gray-200">
          <div className="flex items-start gap-1.5 text-[12px] text-gray-700">
            <CornerDownRight className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" />
            <span className="italic">&ldquo;{suggestion.suggestedEdit}&rdquo;</span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onApply();
            }}
            className="mt-2 inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium bg-gray-900 text-white hover:bg-gray-800 transition-colors"
          >
            <Wand2 className="w-3 h-3" />
            Apply edit
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="mt-3 w-full flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-900 transition-colors"
      >
        <ChevronDown
          className={cn(
            "w-3 h-3 transition-transform",
            open && "rotate-180",
          )}
        />
        Technical Why?
      </button>
      {open && (
        <p className="mt-1.5 text-[12px] text-gray-600 leading-relaxed">
          {suggestion.technicalWhy}
        </p>
      )}
    </article>
  );
}

export type { LucideIcon };
