import Link from "next/link";
import { Header } from "@/components/dashboard/Header";
import { ActionCard, type Severity } from "@/components/dashboard/ActionCard";
import { StatsRow } from "@/components/dashboard/StatsRow";
import { getActionsStatus } from "@/lib/peec";
import { ensureProjectSelected } from "@/lib/peec-server";
import { RefreshFromPeecButton } from "@/components/dashboard/RefreshFromPeecButton";
import { cn } from "@/lib/utils";

function severityFromScore(score: number): Severity {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
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
        className="text-gray-900 underline decoration-gray-300 underline-offset-2 font-medium"
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

/** Map MCP url_classification slugs to human-readable card labels. */
function classificationLabel(cls?: string): string {
  if (!cls) return "Action";
  const map: Record<string, string> = {
    article:          "Article",
    how_to_guide:     "How-To Guide",
    product_page:     "Product Page",
    category_page:    "Category Page",
    comparison:       "Comparison",
    alternatives_to:  "Alternatives",
    listicle:         "Listicle",
    landing_page:     "Landing Page",
    documentation:    "Documentation",
    reference:        "Reference",
  };
  return map[cls.toLowerCase()] ?? cls.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const sp = await searchParams;
  const filter = sp.filter === "article" ? "article" : "all";
  const project = await ensureProjectSelected();

  const { items: actions = [] } = getActionsStatus(project.projectId);

  // All actions from the fetcher are owned (earned types are excluded at fetch time).
  const allCards = actions.map((action) => {
    const label = classificationLabel(action.url_classification);
    return {
      id: action.id,
      severity: severityFromScore(action.opportunity_score),
      typeLabel: label,
      draftState: label === "Article" ? "enabled" as const : "disabled" as const,
      body: <>{parseMarkdownLinks(action.text)}</>,
    };
  });

  const cards = filter === "article"
    ? allCards.filter((c) => c.typeLabel === "Article")
    : allCards;

  const stats = {
    all: cards.length,
    done: 0,
    skipped: 0,
    todo: Math.min(2, cards.length),
  };

  return (
    <>
      <Header
        projectName={project.projectName}
        projectId={project.projectId}
        right={<RefreshFromPeecButton projectId={project.projectId} />}
      />

      <main className="flex-1 flex flex-col bg-white overflow-hidden">
        {/* Scrollable, vertically centered content area */}
        <div className="flex-1 overflow-y-auto">
          <div className="min-h-full flex flex-col justify-center py-10">
            <div className="px-6 w-full max-w-[1100px] mx-auto">
              <div className="mb-5">
                <p className="text-[12px] text-gray-500 mb-1">Overview</p>
                <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">
                  Address all suggestions and fill gaps in your content
                </h1>
              </div>

              <StatsRow
                items={[
                  { label: "All actions", value: stats.all },
                  { label: "Done actions", value: stats.done },
                  { label: "Skipped actions", value: stats.skipped },
                  { label: "Todo actions", value: stats.todo },
                ]}
              />

              <div className="mt-7">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-[14px] font-semibold text-gray-900">
                      All recommendations
                    </h2>
                    <p className="text-[12px] text-gray-500 mt-1">
                      Act on these suggestions to increase your AI search visibility.
                    </p>
                  </div>

                  <div className="flex items-center bg-gray-100 p-0.5 rounded-lg border border-gray-200/60">
                    <Link
                      href={filter === "all" ? "#" : "?filter=all"}
                      className={cn(
                        "px-3 py-1 text-[12px] font-medium rounded-md transition-colors",
                        filter === "all"
                          ? "bg-white text-gray-900 shadow-sm"
                          : "text-gray-500 hover:text-gray-900"
                      )}
                    >
                      All
                    </Link>
                    <Link
                      href={filter === "article" ? "#" : "?filter=article"}
                      className={cn(
                        "px-3 py-1 text-[12px] font-medium rounded-md transition-colors",
                        filter === "article"
                          ? "bg-white text-gray-900 shadow-sm"
                          : "text-gray-500 hover:text-gray-900"
                      )}
                    >
                      Articles
                    </Link>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {cards.map((card) => (
                    <ActionCard key={card.id} {...card} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
