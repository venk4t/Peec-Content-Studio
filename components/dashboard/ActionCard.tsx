import Link from "next/link";
import { BarChart3, Check, Pencil, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type Severity = "high" | "medium" | "low";

interface ActionCardProps {
  id: string;
  severity: Severity;
  typeLabel: string;
  typeIcon?: React.ComponentType<{ className?: string }>;
  typeFavicon?: string;
  body: React.ReactNode;
}

const severityDotColor: Record<Severity, string> = {
  high: "bg-emerald-500",
  medium: "bg-blue-500",
  low: "bg-gray-400",
};

const severityTextColor: Record<Severity, string> = {
  high: "text-emerald-700",
  medium: "text-blue-700",
  low: "text-gray-600",
};

export function ActionCard({
  id,
  severity,
  typeLabel,
  typeIcon: TypeIcon,
  typeFavicon,
  body,
}: ActionCardProps) {
  return (
    <article className="bg-white border border-gray-200 rounded-lg p-3.5 flex flex-col hover:border-gray-300 transition-colors">
      {/* Top badges */}
      <div className="flex items-center gap-2 mb-2.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 h-5 px-1.5 rounded border border-gray-200 bg-white text-[11px] font-medium",
            severityTextColor[severity],
          )}
        >
          <BarChart3 className="w-3 h-3" />
          {severity[0].toUpperCase() + severity.slice(1)}
          <span className={cn("w-1.5 h-1.5 rounded-full", severityDotColor[severity])} />
        </span>

        <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded border border-gray-200 bg-white text-[11px] font-medium text-gray-700">
          {TypeIcon ? (
            <TypeIcon className="w-3 h-3 text-gray-500" />
          ) : typeFavicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={typeFavicon} alt="" className="w-3 h-3 rounded-sm" />
          ) : null}
          {typeLabel}
        </span>
      </div>

      {/* Body */}
      <div className="text-[13px] text-gray-800 leading-relaxed flex-1">{body}</div>

      {/* Footer actions */}
      <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center gap-3">
        <Link
          href={`/studio/${id}`}
          className="inline-flex items-center gap-1 h-7 px-2 -ml-1 rounded text-[12px] font-medium text-gray-900 hover:bg-gray-100 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
          Draft
        </Link>
        <span className="h-3.5 w-px bg-gray-200" />
        <FooterButton icon={Check} label="Done" />
        <FooterButton icon={X} label="Decline" />
        <FooterButton icon={Square} label="Todo" />
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
      className="inline-flex items-center gap-1 h-7 px-1 -mx-1 rounded text-[12px] text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors"
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
