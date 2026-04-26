interface StatItem {
  label: string;
  value: number | string;
}

interface StatsRowProps {
  items: StatItem[];
}

export function StatsRow({ items }: StatsRowProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 border border-gray-200 rounded-lg overflow-hidden bg-white">
      {items.map((item, idx) => (
        <div
          key={item.label}
          className={
            idx > 0
              ? "px-4 py-3.5 border-l border-gray-200"
              : "px-4 py-3.5"
          }
        >
          <p className="text-[11px] text-gray-500 mb-1">{item.label}</p>
          <p className="text-[22px] font-semibold text-gray-900 leading-none">
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}
