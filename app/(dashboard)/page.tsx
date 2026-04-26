import { Header } from "@/components/dashboard/Header";
import { StatsRow } from "@/components/dashboard/StatsRow";
import { RefreshFromPeecButton } from "@/components/dashboard/RefreshFromPeecButton";
import {
  getShareOfVoice,
  getOwnBrandName,
  getSnapshotDateRange,
} from "@/lib/peec";
import { ensureProjectSelected } from "@/lib/peec-server";

export default async function DashboardHomePage() {
  const project = await ensureProjectSelected();
  const sov = getShareOfVoice();
  const brandName = getOwnBrandName();
  const range = getSnapshotDateRange();

  const own = sov.ownBrand;
  const ranked = [own, ...sov.competitors]
    .slice()
    .sort((a, b) => b.share_of_voice - a.share_of_voice);

  return (
    <>
      <Header
        breadcrumbs={[{ label: "Overview" }]}
        right={<RefreshFromPeecButton projectId={project.projectId} />}
      />

      <main className="flex-1 overflow-y-auto bg-white">
        <div className="px-6 py-5 max-w-[1100px]">
          <div className="mb-5">
            <p className="text-[12px] text-gray-500 mb-1">{brandName}</p>
            <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">
              Track how LLMs cite your brand
            </h1>
            <p className="text-[12px] text-gray-500 mt-1">
              {range.start} — {range.end} · last 30 days
            </p>
          </div>

          <StatsRow
            items={[
              {
                label: "Share of Voice",
                value: `${(own.share_of_voice * 100).toFixed(0)}%`,
              },
              {
                label: "Visibility",
                value: `${(own.visibility * 100).toFixed(0)}%`,
              },
              { label: "Mentions", value: own.mention_count },
              { label: "Sentiment", value: own.sentiment },
            ]}
          />

          <section className="mt-7">
            <h2 className="text-[14px] font-semibold text-gray-900">
              Competitor landscape
            </h2>
            <p className="text-[12px] text-gray-500 mt-1">
              Share of voice across all tracked LLM prompts.
            </p>

            <div className="mt-3 border border-gray-200 rounded-lg bg-white overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/40 text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5">Brand</th>
                    <th className="text-right px-4 py-2.5">SoV</th>
                    <th className="text-right px-4 py-2.5">Visibility</th>
                    <th className="text-right px-4 py-2.5">Mentions</th>
                    <th className="text-right px-4 py-2.5">Sentiment</th>
                    <th className="text-right px-4 py-2.5">Avg position</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.slice(0, 8).map((row) => {
                    const isOwn = row.brand_id === own.brand_id;
                    return (
                      <tr
                        key={row.brand_id}
                        className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50"
                      >
                        <td className="px-4 py-2.5 text-gray-900">
                          <span className="inline-flex items-center gap-2">
                            {isOwn && (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            )}
                            <span className={isOwn ? "font-medium" : ""}>
                              {row.brand_name}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">
                          {(row.share_of_voice * 100).toFixed(1)}%
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">
                          {(row.visibility * 100).toFixed(0)}%
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">
                          {row.mention_count}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">
                          {row.sentiment}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">
                          {row.avg_position.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
