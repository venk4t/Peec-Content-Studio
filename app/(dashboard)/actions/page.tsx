import { Header } from "@/components/dashboard/Header";
import { ActionCard, type Severity } from "@/components/dashboard/ActionCard";
import { ActionsSecondaryNav } from "@/components/dashboard/ActionsSecondaryNav";
import { FilterChip } from "@/components/dashboard/FilterChip";
import { StatsRow } from "@/components/dashboard/StatsRow";
import {
  getCompetitorGapUrls,
  getTopPromptsCited,
  getOwnBrandName,
} from "@/lib/peec";
import { ensureProjectSelected } from "@/lib/peec-server";
import { RefreshFromPeecButton } from "@/components/dashboard/RefreshFromPeecButton";
import { FileText } from "lucide-react";

type Tab = "earned" | "owned";

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function severityFromCitations(n: number): Severity {
  if (n >= 12) return "high";
  if (n >= 6) return "medium";
  return "low";
}

function severityFromVisibility(v: number): Severity {
  if (v >= 0.7) return "high";
  if (v >= 0.4) return "medium";
  return "low";
}

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; cat?: string }>;
}) {
  const sp = await searchParams;
  const project = await ensureProjectSelected();
  const tab: Tab = sp.tab === "owned" ? "owned" : "earned";
  const selectedCategory = sp.cat;
  const brandName = getOwnBrandName();

  const earnedRaw = getCompetitorGapUrls();
  const ownedRaw = getTopPromptsCited();

  const earnedCards = earnedRaw.slice(0, 9).map((gap) => {
    const domain = domainFromUrl(gap.url);
    const competitorCount = gap.competitor_brand_ids_present.length;
    return {
      id: gap.url.split("/").filter(Boolean).pop() || gap.url,
      severity: severityFromCitations(gap.citation_count),
      typeLabel: domain,
      typeFavicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
      body: (
        <>
          Get {brandName} featured in{" "}
          <a
            className="text-gray-900 underline decoration-gray-300 underline-offset-2"
            href={gap.url}
            target="_blank"
            rel="noreferrer"
          >
            {gap.title || domain}
          </a>
          . {competitorCount} competitor
          {competitorCount === 1 ? " is" : "s are"} already cited there (
          {gap.citation_count} citations,{" "}
          {(gap.citation_rate * 100).toFixed(0)}% citation rate).
        </>
      ),
    };
  });

  const ownedCards = ownedRaw.slice(0, 9).map((p) => ({
    id: p.prompt_id,
    severity: severityFromVisibility(p.visibility),
    typeLabel: "Article",
    typeIcon: FileText,
    body: (
      <>
        Strengthen{" "}
        <span className="text-gray-900 font-medium">
          &ldquo;{p.prompt_text}&rdquo;
        </span>
        . You&rsquo;re cited at avg position {p.avg_position.toFixed(1)} with{" "}
        {(p.visibility * 100).toFixed(0)}% visibility. Add cited claims and
        competitive comparisons to deepen your share of voice.
      </>
    ),
  }));

  const cards = tab === "earned" ? earnedCards : ownedCards;

  const stats = {
    all: cards.length,
    done: 0,
    skipped: 0,
    todo: Math.min(2, cards.length),
  };

  const tabLabel = tab === "earned" ? "Earned" : "Owned";

  return (
    <>
      <Header
        breadcrumbs={[{ label: "Actions" }, { label: tabLabel }]}
        right={<RefreshFromPeecButton projectId={project.projectId} />}
      />

      <div className="flex-1 flex overflow-hidden">
        <ActionsSecondaryNav tab={tab} selectedCategory={selectedCategory} />

        <main className="flex-1 overflow-y-auto bg-white">
          {/* Filter chips */}
          <div className="px-6 pt-4 pb-3 border-b border-gray-200 flex items-center gap-2">
            <FilterChip label="All Tags" />
            <FilterChip label="All Models" />
            <FilterChip label="All Topics" />
          </div>

          <div className="px-6 py-5 max-w-[1100px]">
            <div className="mb-5">
              <p className="text-[12px] text-gray-500 mb-1">Overview</p>
              <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">
                Address all suggestions and fill gaps in your {tab} content
              </h1>
            </div>

            <StatsRow
              items={[
                { label: `All ${tab} actions`, value: stats.all },
                { label: "Done actions", value: stats.done },
                { label: "Skipped actions", value: stats.skipped },
                { label: "Todo actions", value: stats.todo },
              ]}
            />

            <div className="mt-7">
              <h2 className="text-[14px] font-semibold text-gray-900">
                All recommendations
              </h2>
              <p className="text-[12px] text-gray-500 mt-1">
                Act on these suggestions to increase your AI search visibility.
              </p>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {cards.map((card) => (
                  <ActionCard key={card.id} {...card} />
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
