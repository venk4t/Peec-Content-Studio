"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Bookmark,
  Bug,
  FolderClosed,
  Globe,
  Inbox,
  Key,
  LayoutGrid,
  Link as LinkIcon,
  MessageSquare,
  PenLine,
  Rocket,
  Search,
  Settings,
  Sparkles,
  Tag,
  Target,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SwitchProjectMenu } from "@/components/dashboard/SwitchProjectMenu";

type SidebarItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  meta?: string;
  dot?: "green" | "red";
  isNew?: boolean;
  match?: (pathname: string, search: URLSearchParams) => boolean;
};

type SidebarSection = {
  title: string;
  beta?: boolean;
  items: SidebarItem[];
};

const sections: SidebarSection[] = [
  {
    title: "General",
    items: [
      { label: "Overview", href: "/", icon: LayoutGrid },
      { label: "Prompts", href: "/prompts", icon: MessageSquare },
    ],
  },
  {
    title: "Sources",
    items: [
      { label: "Domains", href: "/domains", icon: Globe },
      { label: "URLs", href: "/urls", icon: LinkIcon },
    ],
  },
  {
    title: "Actions",
    beta: true,
    items: [
      {
        label: "Earned",
        href: "/actions?tab=earned",
        icon: Inbox,
        meta: "Off-page",
        match: (p, s) => p === "/actions" && (s.get("tab") ?? "earned") === "earned",
      },
      {
        label: "Owned",
        href: "/actions?tab=owned",
        icon: PenLine,
        meta: "On-page",
        match: (p, s) => p === "/actions" && s.get("tab") === "owned",
      },
      { label: "Impact", href: "/impact", icon: Target },
      {
        label: "Content Studio",
        href: "/studio",
        icon: Sparkles,
        isNew: true,
      },
    ],
  },
  {
    title: "Agent analytics",
    beta: true,
    items: [
      { label: "Crawl insights", href: "/crawl-insights", icon: Search },
      { label: "Crawlability", href: "/crawlability", icon: Bug },
    ],
  },
  {
    title: "Project",
    items: [
      { label: "Profile", href: "/project/profile", icon: User, dot: "green" },
      { label: "Brands", href: "/project/brands", icon: Bookmark },
      { label: "Tags", href: "/project/tags", icon: Tag },
    ],
  },
  {
    title: "Company",
    items: [
      { label: "Settings", href: "/settings", icon: Settings },
      { label: "Projects", href: "/projects", icon: FolderClosed },
      { label: "API Keys", href: "/api-keys", icon: Key },
    ],
  },
];

function ItemRow({
  item,
  active,
}: {
  item: SidebarItem;
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "group flex items-center gap-2 px-2.5 h-7 rounded-md text-[13px] transition-colors",
        active
          ? "bg-gray-100 text-gray-900"
          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
      )}
    >
      <Icon className="w-[14px] h-[14px] shrink-0" />
      <span className="truncate">{item.label}</span>
      {item.dot === "green" && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500" />
      )}
      {item.dot === "red" && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-red-500" />
      )}
      {item.meta && !item.dot && !item.isNew && (
        <span className="ml-auto text-[11px] text-gray-400">{item.meta}</span>
      )}
      {item.isNew && (
        <span className="ml-auto text-[9px] font-medium uppercase tracking-wide text-emerald-700 bg-emerald-50 rounded px-1 py-px">
          New
        </span>
      )}
    </Link>
  );
}

interface SidebarProps {
  projectName?: string;
  projectId?: string | null;
}

export function Sidebar({
  projectName = "",
  projectId = null,
}: SidebarProps = {}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <aside className="w-[208px] shrink-0 bg-gray-50/60 border-r border-gray-200 flex flex-col h-screen">
      <SwitchProjectMenu projectName={projectName} projectId={projectId} />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4 space-y-4">
        {sections.map((section) => (
          <div key={section.title}>
            <div className="flex items-center gap-1.5 px-2.5 mb-1">
              <h3 className="text-[11px] font-medium text-gray-500">
                {section.title}
              </h3>
              {section.beta && (
                <span className="text-[9px] font-medium uppercase tracking-wide text-gray-400 bg-gray-100 rounded px-1 py-px">
                  Beta
                </span>
              )}
            </div>
            <div className="space-y-px">
              {section.items.map((item) => {
                const active = item.match
                  ? item.match(pathname, searchParams)
                  : pathname === item.href ||
                    (item.href !== "/" && pathname.startsWith(item.href));
                return <ItemRow key={item.label} item={item} active={active} />;
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-2 py-2 border-t border-gray-200">
        <Link
          href="/refer"
          className="flex items-center gap-2 px-2.5 h-7 rounded-md text-[13px] text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          <Rocket className="w-[14px] h-[14px]" />
          <span>Refer & Earn</span>
        </Link>
      </div>
    </aside>
  );
}
