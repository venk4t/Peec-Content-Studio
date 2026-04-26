"use client";

import Link from "next/link";
import {
  ChevronRight,
  Compass,
  FileText,
  FolderOpen,
  GitCompare,
  Inbox,
  List,
  MessageCircle,
  Package,
  PenLine,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "earned" | "owned";

type CategoryGroup = {
  title?: string;
  items: { label: string; key: string; icon?: React.ComponentType<{ className?: string }>; favicon?: string }[];
};

const earnedGroups: CategoryGroup[] = [
  {
    title: "Editorial",
    items: [
      { label: "Listicle", key: "listicle", icon: List },
      { label: "Article", key: "article", icon: FileText },
      { label: "Comparison", key: "comparison", icon: GitCompare },
      { label: "How-To Guide", key: "how-to-guide", icon: Compass },
      { label: "Category Page", key: "category-page", icon: FolderOpen },
      { label: "Discussion", key: "discussion", icon: MessageCircle },
    ],
  },
  {
    title: "UGC",
    items: [
      { label: "youtube.com", key: "youtube", favicon: "https://www.google.com/s2/favicons?domain=youtube.com&sz=32" },
      { label: "reddit.com", key: "reddit", favicon: "https://www.google.com/s2/favicons?domain=reddit.com&sz=32" },
      { label: "medium.com", key: "medium", favicon: "https://www.google.com/s2/favicons?domain=medium.com&sz=32" },
      { label: "instagram.com", key: "instagram", favicon: "https://www.google.com/s2/favicons?domain=instagram.com&sz=32" },
      { label: "facebook.com", key: "facebook", favicon: "https://www.google.com/s2/favicons?domain=facebook.com&sz=32" },
      { label: "linkedin.com", key: "linkedin", favicon: "https://www.google.com/s2/favicons?domain=linkedin.com&sz=32" },
      { label: "quora.com", key: "quora", favicon: "https://www.google.com/s2/favicons?domain=quora.com&sz=32" },
    ],
  },
  {
    title: "Reference",
    items: [
      { label: "wikipedia.org", key: "wikipedia", favicon: "https://www.google.com/s2/favicons?domain=wikipedia.org&sz=32" },
      { label: "statista.com", key: "statista", favicon: "https://www.google.com/s2/favicons?domain=statista.com&sz=32" },
    ],
  },
];

const ownedGroups: CategoryGroup[] = [
  {
    items: [
      { label: "Article", key: "article", icon: FileText },
      { label: "Product Page", key: "product-page", icon: Package },
      { label: "Category Page", key: "category-page", icon: FolderOpen },
      { label: "Listicle", key: "listicle", icon: List },
      { label: "Discussion", key: "discussion", icon: MessageCircle },
      { label: "How-To Guide", key: "how-to-guide", icon: Compass },
    ],
  },
];

interface ActionsSecondaryNavProps {
  tab: Tab;
  selectedCategory?: string;
}

export function ActionsSecondaryNav({ tab, selectedCategory }: ActionsSecondaryNavProps) {
  const groups = tab === "earned" ? earnedGroups : ownedGroups;
  const tabLabel = tab === "earned" ? "Earned" : "Owned";

  return (
    <aside className="w-[200px] shrink-0 bg-white border-r border-gray-200 flex flex-col h-full overflow-hidden">
      {/* Tab toggle */}
      <div className="px-3 pt-3 pb-2 space-y-px">
        <Link
          href="/actions?tab=earned"
          className={cn(
            "flex items-center gap-2 px-2.5 h-7 rounded-md text-[13px] transition-colors",
            tab === "earned"
              ? "bg-gray-100 text-gray-900 font-medium"
              : "text-gray-600 hover:bg-gray-50",
          )}
        >
          <Inbox className="w-[14px] h-[14px]" />
          <span>Earned</span>
        </Link>
        <Link
          href="/actions?tab=owned"
          className={cn(
            "flex items-center gap-2 px-2.5 h-7 rounded-md text-[13px] transition-colors",
            tab === "owned"
              ? "bg-gray-100 text-gray-900 font-medium"
              : "text-gray-600 hover:bg-gray-50",
          )}
        >
          <PenLine className="w-[14px] h-[14px]" />
          <span>Owned</span>
        </Link>
      </div>

      {/* Tree */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        <Link
          href={`/actions?tab=${tab}`}
          className={cn(
            "flex items-center gap-2 px-2.5 h-7 rounded-md text-[13px] transition-colors",
            !selectedCategory
              ? "bg-gray-100 text-gray-900 font-medium"
              : "text-gray-600 hover:bg-gray-50",
          )}
        >
          <ChevronRight className="w-3 h-3 text-gray-400" />
          <span>Overview</span>
        </Link>

        {groups.map((group, gIdx) => (
          <div key={group.title ?? gIdx}>
            {group.title && (
              <h4 className="px-2.5 mb-1 text-[11px] font-medium text-gray-500">
                {group.title}
              </h4>
            )}
            <div className="space-y-px">
              {group.items.map((item) => {
                const active = selectedCategory === item.key;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.key}
                    href={`/actions?tab=${tab}&cat=${item.key}`}
                    className={cn(
                      "flex items-center gap-2 px-2.5 h-7 rounded-md text-[13px] transition-colors",
                      active
                        ? "bg-gray-100 text-gray-900 font-medium"
                        : "text-gray-600 hover:bg-gray-50",
                    )}
                  >
                    {Icon ? (
                      <Icon className="w-[14px] h-[14px] text-gray-500" />
                    ) : item.favicon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.favicon}
                        alt=""
                        className="w-[14px] h-[14px] rounded-sm"
                      />
                    ) : null}
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer label */}
      <div className="px-3 pt-2 pb-3 border-t border-gray-200">
        <p className="px-2.5 text-[11px] text-gray-400">{tabLabel} actions</p>
      </div>
    </aside>
  );
}
