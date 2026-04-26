"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Loader2,
  LogOut,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface SwitchProjectMenuProps {
  projectName: string;
  /** When null, the dashboard is rendering with the static fallback snapshot. */
  projectId: string | null;
}

/**
 * Sidebar header — shows the current project name + a dropdown with
 * "Switch project" (clears the cookie and routes to /setup; the on-disk
 * JSON cache stays so switching back is instant).
 */
export function SwitchProjectMenu({
  projectName,
  projectId,
}: SwitchProjectMenuProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const handleSwitch = () => {
    startTransition(async () => {
      try {
        await fetch("/api/peec/current", { method: "DELETE" });
      } catch {
        /* keep going — even if cookie clear fails, /setup will let the user re-pick */
      }
      router.push("/setup");
    });
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 px-2.5 h-8 rounded-md transition-colors text-left",
            open ? "bg-gray-100" : "hover:bg-gray-100",
          )}
        >
          <span className="w-4 h-4 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 shrink-0" />
          <span className="text-[13px] font-medium text-gray-900 truncate flex-1">
            {projectName || "No project"}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="bottom"
        align="start"
        className="w-[200px]"
      >
        <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
          Current
        </DropdownMenuLabel>
        <div className="px-2 py-1 text-[13px] text-gray-900 truncate">
          {projectName || "—"}
        </div>
        {projectId === null && (
          <div className="px-2 pb-1 text-[10px] text-amber-700">
            Demo data (no project selected)
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSwitch}
          disabled={pending}
          className="text-[13px] cursor-pointer"
        >
          {pending ? (
            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
          ) : (
            <LogOut className="w-3.5 h-3.5 mr-2" />
          )}
          Switch project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
