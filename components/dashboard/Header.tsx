import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: string;
  href?: string;
}

interface HeaderProps {
  breadcrumbs?: Crumb[];
  right?: React.ReactNode;
}

export function Header({ breadcrumbs, right }: HeaderProps) {
  return (
    <header className="h-12 shrink-0 bg-white border-b border-gray-200 px-5 flex items-center justify-between">
      <nav className="flex items-center text-[13px] text-gray-500 min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          breadcrumbs.map((crumb, idx) => {
            const last = idx === breadcrumbs.length - 1;
            return (
              <div key={idx} className="flex items-center min-w-0">
                {idx > 0 && (
                  <ChevronRight className="w-3.5 h-3.5 mx-1.5 text-gray-300 shrink-0" />
                )}
                {crumb.href && !last ? (
                  <a
                    href={crumb.href}
                    className="hover:text-gray-900 transition-colors truncate"
                  >
                    {crumb.label}
                  </a>
                ) : (
                  <span
                    className={
                      last
                        ? "text-gray-900 font-medium truncate"
                        : "text-gray-500 truncate"
                    }
                  >
                    {crumb.label}
                  </span>
                )}
              </div>
            );
          })
        ) : null}
      </nav>
      <div className="flex items-center gap-2 shrink-0">{right}</div>
    </header>
  );
}
