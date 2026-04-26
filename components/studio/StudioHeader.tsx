"use client";

import Link from "next/link";
import { ArrowLeft, Check, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SaveStatus } from "@/lib/store/editor";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StudioHeaderProps {
  title: string;
  saveStatus: SaveStatus;
  onRunSimulator: () => void;
  simulatorDisabled?: boolean;
  simulatorDisabledReason?: string;
}

function parseMarkdownLinks(text: string) {
  const parts = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <a
        key={match.index}
        href={match[2]}
        target="_blank"
        rel="noreferrer"
        className="text-blue-600 underline decoration-blue-200 underline-offset-2 font-medium hover:text-blue-800 transition-colors"
      >
        {match[1]}
      </a>
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

export function StudioHeader({
  title,
  saveStatus,
  onRunSimulator,
  simulatorDisabled,
  simulatorDisabledReason,
}: StudioHeaderProps) {
  const button = (
    <button
      type="button"
      onClick={onRunSimulator}
      disabled={simulatorDisabled}
      className={cn(
        "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium transition-colors shrink-0",
        simulatorDisabled
          ? "bg-gray-100 text-gray-400 cursor-not-allowed"
          : "bg-gray-900 text-white hover:bg-gray-800",
      )}
    >
      <Sparkles className="w-3.5 h-3.5" />
      Run GEO Simulator
    </button>
  );

  return (
    <header className="min-h-[48px] h-auto shrink-0 bg-white border-b border-gray-200 px-4 flex items-center gap-3 py-2">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 h-7 px-2 -ml-1 rounded-md text-[13px] text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors shrink-0"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back</span>
      </Link>

      <span className="h-4 w-px bg-gray-200 shrink-0" />

      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-[13px] text-gray-700 leading-snug">
          {title ? parseMarkdownLinks(title) : "Untitled article"}
        </span>
        <SaveBadge status={saveStatus} />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {simulatorDisabled && simulatorDisabledReason ? (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              {/* Wrap in a span so Radix gets a non-disabled element to attach pointer events to. */}
              <TooltipTrigger asChild>
                <span tabIndex={0}>{button}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[280px]">
                {simulatorDisabledReason}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          button
        )}
      </div>
    </header>
  );
}

function SaveBadge({ status }: { status: SaveStatus }) {
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
        <Loader2 className="w-3 h-3 animate-spin" />
        Saving
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
        <Check className="w-3 h-3" />
        Saved
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-red-600">
        <AlertCircle className="w-3 h-3" />
        Error
      </span>
    );
  }
  if (status === "dirty") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
        Unsaved
      </span>
    );
  }
  return null;
}
