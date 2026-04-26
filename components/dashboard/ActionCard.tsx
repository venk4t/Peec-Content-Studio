import Link from "next/link";
import { BarChart3, Check, X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type Severity = "high" | "medium" | "low";

interface ActionCardProps {
  id: string;
  severity: Severity;
  typeLabel: string;
  body: React.ReactNode;
  draftState?: "enabled" | "disabled" | "hidden";
}

function getTypeColor(label: string): string {
  const map: Record<string, string> = {
    "Article":       "bg-emerald-500",
    "How-To Guide":  "bg-cyan-500",
    "Product Page":  "bg-lime-500",
    "Category Page": "bg-amber-400",
    "Listicle":      "bg-emerald-500",
    "Comparison":    "bg-violet-500",
    "Alternatives":  "bg-purple-500",
    "Landing Page":  "bg-rose-400",
    "Documentation": "bg-sky-500",
    "Reference":     "bg-teal-500",
    "Action":        "bg-blue-500",
  };
  return map[label] || "bg-blue-500";
}

export function ActionCard({
  id,
  severity,
  typeLabel,
  body,
  draftState = "enabled",
}: ActionCardProps) {
  return (
    <article className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col hover:border-gray-300 transition-colors">
      {/* Top badges */}
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-gray-200 bg-white text-[12px] font-medium text-gray-700">
          <BarChart3 className="w-3.5 h-3.5 text-gray-400" />
          {severity[0].toUpperCase() + severity.slice(1)}
        </span>

        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-gray-200 bg-white text-[12px] font-medium text-gray-700">
          <span className={cn("w-2 h-2 rounded-full", getTypeColor(typeLabel))} />
          {typeLabel}
        </span>
      </div>

      {/* Body */}
      <div className="text-[14px] text-gray-900 leading-relaxed flex-1">
        {body}
      </div>

      {/* Footer actions */}
      <div className="mt-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FooterButton icon={Check} label="Done" />
          <FooterButton icon={X} label="Decline" />
        </div>
        {draftState === "enabled" && (
          <Link
            href={`/studio/${id}`}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] font-medium text-white shadow-sm transition-all hover:opacity-90 bg-gradient-to-r from-orange-400 to-amber-500 hover:from-orange-500 hover:to-amber-600"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Draft
          </Link>
        )}
        {draftState === "disabled" && (
          <button
            disabled
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] font-medium text-gray-400 bg-gray-50 border border-gray-200 cursor-not-allowed"
          >
            <Sparkles className="w-3.5 h-3.5 opacity-50" />
            Draft
          </button>
        )}
      </div>
    </article>
  );
}

function FooterButton({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-gray-200 bg-white text-[12px] font-medium text-gray-700 hover:bg-gray-50 transition-colors"
    >
      <Icon className="w-3.5 h-3.5 text-gray-500" />
      {label}
    </button>
  );
}
