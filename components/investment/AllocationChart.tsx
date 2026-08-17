import type { Holding } from "@/lib/agents/investment/types";

const SERIES_VARS = [
  "--viz-series-1",
  "--viz-series-2",
  "--viz-series-3",
  "--viz-series-4",
  "--viz-series-5",
  "--viz-series-6",
  "--viz-series-7",
] as const;

const MAX_SEGMENTS = SERIES_VARS.length;

function formatCurrency(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function AllocationChart({
  holdings,
  totalValue,
}: {
  holdings: Holding[];
  totalValue: number;
}) {
  if (holdings.length === 0 || totalValue <= 0) {
    return (
      <p className="py-6 text-center text-sm text-neutral-500">
        Add holdings to see your allocation.
      </p>
    );
  }

  const sorted = [...holdings].sort((a, b) => b.costBasis - a.costBasis);
  const visible = sorted.slice(0, MAX_SEGMENTS);
  const rest = sorted.slice(MAX_SEGMENTS);
  const restValue = rest.reduce((sum, h) => sum + h.costBasis, 0);

  const segments = visible.map((holding, i) => ({
    key: holding.id,
    label: holding.ticker,
    value: holding.costBasis,
    share: (holding.costBasis / totalValue) * 100,
    colorVar: SERIES_VARS[i],
  }));

  if (restValue > 0) {
    segments.push({
      key: "other",
      label: "Other",
      value: restValue,
      share: (restValue / totalValue) * 100,
      colorVar: null as unknown as (typeof SERIES_VARS)[number],
    });
  }

  return (
    <div className="viz-root">
      <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded-md">
        {segments.map((segment, i) => (
          <div
            key={segment.key}
            className="flex items-center justify-center overflow-hidden"
            style={{
              width: `${segment.share}%`,
              backgroundColor: segment.colorVar
                ? `var(${segment.colorVar})`
                : "var(--viz-other)",
              borderTopLeftRadius: i === 0 ? 4 : 0,
              borderBottomLeftRadius: i === 0 ? 4 : 0,
              borderTopRightRadius: i === segments.length - 1 ? 4 : 0,
              borderBottomRightRadius: i === segments.length - 1 ? 4 : 0,
            }}
            title={`${segment.label} — ${segment.share.toFixed(1)}%`}
          >
            {segment.share >= 12 && (
              <span className="truncate px-1.5 text-[11px] font-medium text-white">
                {segment.label}
              </span>
            )}
          </div>
        ))}
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor: segment.colorVar
                  ? `var(${segment.colorVar})`
                  : "var(--viz-other)",
              }}
            />
            <span className="text-neutral-600 dark:text-neutral-300">
              {segment.label}
            </span>
            <span className="text-neutral-400">
              {segment.share.toFixed(1)}% · {formatCurrency(segment.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
