"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
} from "recharts";
import {
  ChevronDown,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ScoredPrompt } from "@/lib/simulator-types";

const OWN_COLOR = "#10b981"; // emerald-500 — own brand
// Stable competitor palette assigned by name so the same competitor gets the
// same color across rows.
const COMPETITOR_COLORS: Record<string, string> = {
  Apple: "#3b82f6", // blue-500
  Samsung: "#a855f7", // purple-500
  Google: "#f59e0b", // amber-500
  Pixel: "#f59e0b", // amber-500 (Pixel/Google share family — same hue)
  Sony: "#ec4899", // pink-500
  Bose: "#6366f1", // indigo-500
  Xiaomi: "#ef4444", // red-500
  OnePlus: "#14b8a6", // teal-500
};
const FALLBACK_COMP_COLOR = "#9ca3af"; // gray-400

const PROMPT_MAX = 80;

interface SimulatorResultsProps {
  topPrompts: ScoredPrompt[];
  totalMs?: number;
  brandName: string;
}

export function SimulatorResults({ topPrompts, totalMs, brandName }: SimulatorResultsProps) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 px-1 pb-2 border-b border-gray-200">
        <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
        <h3 className="text-[13px] font-semibold text-gray-900">
          Top {topPrompts.length} prompts where this article should rank
        </h3>
        {typeof totalMs === "number" && (
          <span className="ml-auto text-[11px] text-gray-400 tabular-nums">
            {(totalMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {topPrompts.map((p, i) => (
        <ResultRow key={i} prompt={p} index={i + 1} brandName={brandName} />
      ))}
    </div>
  );
}

function ResultRow({ 
  prompt: p, 
  index, 
  brandName 
}: { 
  prompt: ScoredPrompt; 
  index: number;
  brandName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const truncated =
    p.prompt.length > PROMPT_MAX
      ? p.prompt.slice(0, PROMPT_MAX).trimEnd() + "…"
      : p.prompt;

  // Build chart data: own brand row first, then competitors in input order.
  const data = [
    { name: brandName, value: p.ownLikelihood, color: OWN_COLOR, isOwn: true },
    ...p.competitors.map((c) => ({
      name: c.name,
      value: c.likelihood,
      color: COMPETITOR_COLORS[c.name] ?? FALLBACK_COMP_COLOR,
      isOwn: false,
    })),
  ];

  // 28px row height per series + small top/bottom padding.
  const chartHeight = data.length * 28 + 8;

  return (
    <article
      className={cn(
        "rounded-md border bg-white transition-colors cursor-pointer",
        expanded ? "border-gray-300" : "border-gray-200 hover:border-gray-300",
      )}
      onClick={() => setExpanded((v) => !v)}
    >
      {/* Header — prompt text + index + expand chevron */}
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <span className="shrink-0 mt-0.5 text-[10px] font-medium text-gray-400 tabular-nums w-4">
          {index}
        </span>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="flex-1 text-[12.5px] text-gray-900 leading-snug font-medium">
                {truncated}
              </p>
            </TooltipTrigger>
            {p.prompt.length > PROMPT_MAX && (
              <TooltipContent side="top" className="max-w-[420px]">
                {p.prompt}
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
        <ConfidenceBadge confidence={p.confidence} />
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </div>

      {/* Bar chart */}
      <div className="px-3 py-2">
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 0, right: 36, left: 0, bottom: 0 }}
          >
            <XAxis
              type="number"
              domain={[0, 100]}
              hide
            />
            <YAxis
              dataKey="name"
              type="category"
              width={70}
              tick={{ fontSize: 11, fill: "#374151" }}
              tickLine={false}
              axisLine={false}
            />
            <RechartsTooltip
              cursor={{ fill: "rgba(0,0,0,0.03)" }}
              contentStyle={{
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                background: "white",
              }}
              formatter={(value) => [`${value}%`, "likelihood"]}
            />
            <Bar dataKey="value" radius={[2, 2, 2, 2]} barSize={14}>
              {data.map((d, idx) => (
                <Cell key={idx} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Reasoning */}
      <div className="px-3 pb-3">
        <p
          className={cn(
            "text-[11.5px] text-gray-600 leading-relaxed",
            !expanded && "line-clamp-2",
          )}
        >
          {p.reasoning}
        </p>
      </div>
    </article>
  );
}

function ConfidenceBadge({ confidence }: { confidence: ScoredPrompt["confidence"] }) {
  const styles =
    confidence === "high"
      ? "text-emerald-700 bg-emerald-50 border-emerald-100"
      : confidence === "medium"
        ? "text-blue-700 bg-blue-50 border-blue-100"
        : "text-amber-700 bg-amber-50 border-amber-100";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 h-4 px-1.5 rounded border text-[9px] font-medium uppercase tracking-wide shrink-0",
        styles,
      )}
    >
      {confidence === "low" && <TriangleAlert className="w-2.5 h-2.5" />}
      {confidence}
    </span>
  );
}
