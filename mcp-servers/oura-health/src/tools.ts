import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { NotConnectedError } from "./ouraAuth.js";
import { OuraApiError, type OuraClient } from "./ouraClient.js";

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const MAX_DAILY_RANGE_DAYS = 90;
const MAX_SAMPLE_RANGE_DAYS = 14;
const MAX_HR_RANGE_HOURS = 7 * 24;
const MAX_RAW_HR_RANGE_HOURS = 24;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "Not a real calendar date");

const dateRangeShape = {
  start_date: isoDate.optional().describe("First day to include (YYYY-MM-DD). Defaults to 6 days before end_date."),
  end_date: isoDate.optional().describe("Last day to include (YYYY-MM-DD, inclusive). Defaults to today (UTC)."),
};

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export class InputError extends Error {}

function toDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function resolveDateRange(
  start: string | undefined,
  end: string | undefined,
  maxDays: number,
  now = Date.now(),
): { start: string; end: string } {
  const endDay = end ?? toDay(now);
  const endMs = Date.parse(`${endDay}T00:00:00Z`);
  const startDay = start ?? toDay(endMs - 6 * DAY_MS);
  const startMs = Date.parse(`${startDay}T00:00:00Z`);
  if (startMs > endMs) throw new InputError("start_date must be on or before end_date.");
  const days = Math.round((endMs - startMs) / DAY_MS) + 1;
  if (days > maxDays) throw new InputError(`Date range is ${days} days; the maximum is ${maxDays}. Split it into smaller requests.`);
  return { start: startDay, end: endDay };
}

/**
 * Oura's daily endpoints treat end_date inconsistently across collections, so
 * we ask for one extra day and then filter on each record's `day` ourselves.
 * The result is always exactly [start, end] inclusive.
 */
async function fetchDaily(
  client: OuraClient,
  collection: string,
  range: { start: string; end: string },
): Promise<Record<string, unknown>[]> {
  const queryEnd = toDay(Date.parse(`${range.end}T00:00:00Z`) + DAY_MS);
  const rows = await client.list(collection, { start_date: range.start, end_date: queryEnd });
  return rows.filter((r) => {
    const day = typeof r.day === "string" ? r.day : undefined;
    return day === undefined || (day >= range.start && day <= range.end);
  });
}

function omit<T extends Record<string, unknown>>(obj: T, keys: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

// ---------------------------------------------------------------------------
// Pure transforms (exported for tests)
// ---------------------------------------------------------------------------

interface SampleSeries {
  interval?: number;
  items?: (number | null)[];
  timestamp?: string;
}

export function expandSeries(series: SampleSeries | undefined | null): { timestamp: string; value: number }[] {
  if (!series?.items || !series.timestamp || !series.interval) return [];
  const t0 = Date.parse(series.timestamp);
  const out: { timestamp: string; value: number }[] = [];
  series.items.forEach((v, i) => {
    if (typeof v === "number") out.push({ timestamp: new Date(t0 + i * series.interval! * 1000).toISOString(), value: v });
  });
  return out;
}

function stats(values: number[]): { count: number; min: number | null; max: number | null; mean: number | null } {
  if (values.length === 0) return { count: 0, min: null, max: null, mean: null };
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: Math.round((sum / values.length) * 10) / 10,
  };
}

export function summarizeHrv(
  sessions: Record<string, unknown>[],
  readiness: Record<string, unknown>[],
  includeSamples: boolean,
) {
  const hrvBalanceByDay = new Map<string, unknown>();
  for (const r of readiness) {
    const contributors = r.contributors as Record<string, unknown> | undefined;
    if (typeof r.day === "string") hrvBalanceByDay.set(r.day, contributors?.hrv_balance ?? null);
  }

  const nights = sessions.map((s) => ({
    day: s.day,
    type: s.type,
    bedtime_start: s.bedtime_start,
    bedtime_end: s.bedtime_end,
    average_hrv_ms: s.average_hrv ?? null,
    average_heart_rate_bpm: s.average_heart_rate ?? null,
    lowest_heart_rate_bpm: s.lowest_heart_rate ?? null,
    readiness_hrv_balance_score: typeof s.day === "string" ? hrvBalanceByDay.get(s.day) ?? null : null,
    ...(includeSamples ? { hrv_samples_ms: expandSeries(s.hrv as SampleSeries) } : {}),
  }));

  const mainSleep = nights.filter((n) => n.type === "long_sleep");
  const basis = mainSleep.length > 0 ? mainSleep : nights;
  const values = basis.map((n) => n.average_hrv_ms).filter((v): v is number => typeof v === "number");

  return {
    unit: "ms (RMSSD, measured during sleep)",
    summary: { basis: mainSleep.length > 0 ? "main sleep periods (long_sleep)" : "all sleep periods", ...stats(values) },
    nights,
  };
}

type Resolution = "raw" | "5min" | "hourly" | "daily";

export function bucketHeartRate(
  samples: { bpm: number; source?: string; timestamp: string }[],
  resolution: Resolution,
) {
  if (resolution === "raw") return samples.map((s) => ({ timestamp: s.timestamp, bpm: s.bpm, source: s.source }));
  const size = resolution === "5min" ? 5 * 60_000 : resolution === "hourly" ? 3_600_000 : DAY_MS;
  const buckets = new Map<number, { values: number[]; sources: Set<string> }>();
  for (const s of samples) {
    const t = Date.parse(s.timestamp);
    if (Number.isNaN(t) || typeof s.bpm !== "number") continue;
    const key = Math.floor(t / size) * size;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { values: [], sources: new Set() }));
    b.values.push(s.bpm);
    if (s.source) b.sources.add(s.source);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, b]) => {
      const st = stats(b.values);
      return {
        period_start_utc: new Date(key).toISOString(),
        samples: st.count,
        min_bpm: st.min,
        avg_bpm: st.mean,
        max_bpm: st.max,
        sources: [...b.sources].sort(),
      };
    });
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Wrap a handler so errors become safe, readable tool errors (never stack traces). */
function guarded<A>(handler: (args: A) => Promise<unknown>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return ok(await handler(args));
    } catch (err) {
      if (err instanceof InputError || err instanceof NotConnectedError || err instanceof OuraApiError) {
        return fail(err.message);
      }
      // Log only the error type/message — never request or response bodies.
      console.error("[oura-health] tool error:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown");
      return fail("Unexpected error while contacting Oura. Please try again later.");
    }
  };
}

export function registerTools(server: McpServer, client: OuraClient): void {
  server.registerTool(
    "get_daily_sleep",
    {
      title: "Daily sleep scores",
      description:
        "Oura daily sleep summary per day: sleep score (0-100) and contributor scores (deep sleep, efficiency, latency, REM, restfulness, timing, total sleep).",
      inputSchema: dateRangeShape,
      annotations: READ_ONLY,
    },
    guarded(async ({ start_date, end_date }) => {
      const range = resolveDateRange(start_date, end_date, MAX_DAILY_RANGE_DAYS);
      return { range, days: await fetchDaily(client, "daily_sleep", range) };
    }),
  );

  server.registerTool(
    "get_sleep_sessions",
    {
      title: "Detailed sleep sessions",
      description:
        "Each Oura sleep period (main sleep and naps): bedtime, durations of deep/light/REM/awake (seconds), efficiency, latency, average and lowest heart rate, average HRV, breathing rate. Set include_samples for 5-minute HRV/heart-rate series and sleep-phase strings (max 14 days).",
      inputSchema: {
        ...dateRangeShape,
        include_samples: z.boolean().default(false).describe("Include 5-minute time series (larger response)."),
      },
      annotations: READ_ONLY,
    },
    guarded(async ({ start_date, end_date, include_samples }) => {
      const range = resolveDateRange(start_date, end_date, include_samples ? MAX_SAMPLE_RANGE_DAYS : MAX_DAILY_RANGE_DAYS);
      const sessions = await fetchDaily(client, "sleep", range);
      return {
        range,
        sessions: include_samples
          ? sessions
          : sessions.map((s) => omit(s, ["hrv", "heart_rate", "movement_30_sec", "sleep_phase_5_min", "sleep_phase_30_sec"])),
      };
    }),
  );

  server.registerTool(
    "get_daily_readiness",
    {
      title: "Daily readiness",
      description:
        "Oura readiness per day: readiness score (0-100), temperature deviation, and contributors (activity balance, body temperature, HRV balance, previous day activity, previous night, recovery index, resting heart rate, sleep balance).",
      inputSchema: dateRangeShape,
      annotations: READ_ONLY,
    },
    guarded(async ({ start_date, end_date }) => {
      const range = resolveDateRange(start_date, end_date, MAX_DAILY_RANGE_DAYS);
      return { range, days: await fetchDaily(client, "daily_readiness", range) };
    }),
  );

  server.registerTool(
    "get_daily_activity",
    {
      title: "Daily activity",
      description:
        "Oura activity per day: activity score, steps, active/total calories, equivalent walking distance, time in high/medium/low activity and inactivity (seconds), and contributors. Set include_samples for 5-minute activity class and MET series (max 14 days).",
      inputSchema: {
        ...dateRangeShape,
        include_samples: z.boolean().default(false).describe("Include 5-minute activity/MET series (larger response)."),
      },
      annotations: READ_ONLY,
    },
    guarded(async ({ start_date, end_date, include_samples }) => {
      const range = resolveDateRange(start_date, end_date, include_samples ? MAX_SAMPLE_RANGE_DAYS : MAX_DAILY_RANGE_DAYS);
      const days = await fetchDaily(client, "daily_activity", range);
      return { range, days: include_samples ? days : days.map((d) => omit(d, ["class_5_min", "met"])) };
    }),
  );

  server.registerTool(
    "get_hrv",
    {
      title: "Heart rate variability (HRV)",
      description:
        "Overnight heart rate variability from Oura (RMSSD in milliseconds, measured during sleep): per-night average HRV, resting heart rate, the readiness HRV-balance score, and a summary (mean/min/max) across main sleep periods. Set include_samples for 5-minute HRV readings (max 14 days).",
      inputSchema: {
        ...dateRangeShape,
        include_samples: z.boolean().default(false).describe("Include 5-minute HRV samples for each night."),
      },
      annotations: READ_ONLY,
    },
    guarded(async ({ start_date, end_date, include_samples }) => {
      const range = resolveDateRange(start_date, end_date, include_samples ? MAX_SAMPLE_RANGE_DAYS : MAX_DAILY_RANGE_DAYS);
      const [sessions, readiness] = await Promise.all([
        fetchDaily(client, "sleep", range),
        fetchDaily(client, "daily_readiness", range),
      ]);
      return { range, ...summarizeHrv(sessions, readiness, include_samples) };
    }),
  );

  server.registerTool(
    "get_heart_rate",
    {
      title: "Heart rate",
      description:
        "Oura heart rate readings (bpm) between two timestamps, aggregated into buckets (min/avg/max per bucket, bucket times in UTC). Defaults to the last 24 hours at hourly resolution. Max range 7 days; 'raw' resolution allowed for up to 24 hours.",
      inputSchema: {
        start_datetime: z.iso
          .datetime({ offset: true })
          .optional()
          .describe("ISO 8601 start, e.g. 2026-11-10T00:00:00-08:00. Defaults to 24 hours before end_datetime."),
        end_datetime: z.iso.datetime({ offset: true }).optional().describe("ISO 8601 end. Defaults to now."),
        resolution: z.enum(["raw", "5min", "hourly", "daily"]).default("hourly"),
      },
      annotations: READ_ONLY,
    },
    guarded(async ({ start_datetime, end_datetime, resolution }) => {
      const endMs = end_datetime ? Date.parse(end_datetime) : Date.now();
      const startMs = start_datetime ? Date.parse(start_datetime) : endMs - DAY_MS;
      if (startMs >= endMs) throw new InputError("start_datetime must be before end_datetime.");
      const hours = (endMs - startMs) / 3_600_000;
      if (hours > MAX_HR_RANGE_HOURS) throw new InputError("Heart rate range is limited to 7 days per request.");
      if (resolution === "raw" && hours > MAX_RAW_HR_RANGE_HOURS) {
        throw new InputError("'raw' resolution is limited to 24 hours; use '5min', 'hourly' or 'daily' for longer ranges.");
      }
      const start = new Date(startMs).toISOString();
      const end = new Date(endMs).toISOString();
      const samples = await client.list<{ bpm: number; source?: string; timestamp: string }>("heartrate", {
        start_datetime: start,
        end_datetime: end,
      });
      return {
        range: { start_datetime: start, end_datetime: end },
        resolution,
        unit: "bpm",
        total_samples: samples.length,
        data: bucketHeartRate(samples, resolution),
      };
    }),
  );
}
