"use client";

import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import { SuggestionCard } from "@/components/studio/SuggestionCard";
import type { Suggestion } from "@/lib/types";

interface SuggestionsSidebarProps {
  suggestions: Suggestion[];
  status: "idle" | "loading" | "error" | "ready";
  errorMessage?: string;
  activeId: string | null;
  onSelect: (id: string) => void;
  onApply: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function SuggestionsSidebar({
  suggestions,
  status,
  errorMessage,
  activeId,
  onSelect,
  onApply,
  onDismiss,
}: SuggestionsSidebarProps) {
  return (
    <aside className="w-[360px] shrink-0 bg-gray-50/40 border-l border-gray-200 flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-gray-500" />
        <h2 className="text-[13px] font-semibold text-gray-900">
          GEO Suggestions
        </h2>
        <span className="ml-auto text-[11px] text-gray-500">
          {suggestions.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {status === "loading" && suggestions.length === 0 && (
          <Empty icon={Loader2} label="Analyzing your draft…" spinning />
        )}

        {status === "error" && (
          <ErrorBlock message={errorMessage ?? "Couldn't load suggestions."} />
        )}

        {status === "idle" && suggestions.length === 0 && (
          <Empty
            icon={Sparkles}
            label="Start typing — suggestions appear as you write."
          />
        )}

        {status === "ready" && suggestions.length === 0 && (
          <Empty
            icon={Sparkles}
            label="No suggestions yet. Add more content for richer feedback."
          />
        )}

        {suggestions.map((s) => (
          <SuggestionCard
            key={s.id}
            suggestion={s}
            active={activeId === s.id}
            onSelect={() => onSelect(s.id)}
            onApply={() => onApply(s.id)}
            onDismiss={() => onDismiss(s.id)}
          />
        ))}
      </div>
    </aside>
  );
}

function Empty({
  icon: Icon,
  label,
  spinning,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  spinning?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon
        className={`w-5 h-5 text-gray-400 ${spinning ? "animate-spin" : ""}`}
      />
      <p className="mt-2 text-[12px] text-gray-500 px-6">{label}</p>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 flex gap-2">
      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
      <div className="text-[12px] text-red-800 leading-relaxed">
        <p className="font-medium">Suggestions failed</p>
        <p className="mt-1 text-red-700 break-words">{message}</p>
      </div>
    </div>
  );
}
