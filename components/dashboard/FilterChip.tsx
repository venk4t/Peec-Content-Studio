import { ChevronDown, Tag } from "lucide-react";

interface FilterChipProps {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export function FilterChip({ label, icon: Icon = Tag }: FilterChipProps) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-gray-200 bg-white text-[12px] text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
    >
      <Icon className="w-3.5 h-3.5 text-gray-500" />
      <span>{label}</span>
      <ChevronDown className="w-3 h-3 text-gray-400" />
    </button>
  );
}
