import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { whoopGet } from "./whoop-client.js";

const server = new McpServer({ name: "whoop-mcp", version: "1.0.0" });

const MAX_RECORDS = 100;
const PAGE_LIMIT = 25;

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
});

const fail = (err: unknown): ToolResult => {
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`Tool error: ${message}`);
  return { content: [{ type: "text", text: message }], isError: true };
};

async function fetchRecords(path: string, days: number): Promise<unknown[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const records: unknown[] = [];
  let nextToken: string | undefined;

  do {
    const page = (await whoopGet(path, {
      limit: PAGE_LIMIT,
      start: start.toISOString(),
      end: end.toISOString(),
      nextToken,
    })) as { records?: unknown[]; next_token?: string | null };

    records.push(...(page.records ?? []));
    nextToken = page.next_token || undefined;
  } while (nextToken && records.length < MAX_RECORDS);

  return records.slice(0, MAX_RECORDS);
}

const daysSchema = {
  days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(7)
    .describe("How many days back to fetch, from 1 to 30 (default 7)."),
};

server.tool("ping", "Returns pong", async () => ({
  content: [{ type: "text", text: "pong" }],
}));

server.tool(
  "get_profile",
  "Returns the user's basic Whoop profile (user id, name, email). Use it to identify whose data is being read.",
  async () => {
    try {
      return ok(await whoopGet("/user/profile/basic"));
    } catch (err) {
      return fail(err);
    }
  },
);

type Rec = Record<string, any>;
type Trimmed = Record<string, unknown>;

const round1 = (n: number) => Math.round(n * 10) / 10;
const hours = (ms: number) => round1(ms / 3_600_000);
const minutes = (ms: number) => round1(ms / 60_000);

// Local calendar date (YYYY-MM-DD), shifted by a "+05:30"-style offset when given.
function dateOf(iso: string, offset?: string): string {
  let shiftMs = 0;
  const m = offset?.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (m) shiftMs = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
  return new Date(new Date(iso).getTime() + shiftMs).toISOString().slice(0, 10);
}

interface Spec {
  name: string;
  path: string;
  description: string;
  metric: string; // key in the trimmed record used for the summary
  trim: (r: Rec) => Trimmed;
}

const specs: Spec[] = [
  {
    name: "get_recovery",
    path: "/recovery",
    metric: "recovery_score_pct",
    description:
      "Returns daily recovery records (recovery score, HRV, resting heart rate, SpO2, skin temperature) for the last N days. Use it to see how recovered the user is.\nrecovery_score_pct is 0-100% (0-33 red/low, 34-66 yellow/medium, 67-100 green/high).",
    trim: (r) => ({
      date: dateOf(r.created_at),
      recovery_score_pct: r.score.recovery_score,
      hrv_ms: round1(r.score.hrv_rmssd_milli),
      resting_hr_bpm: r.score.resting_heart_rate,
      spo2_pct: round1(r.score.spo2_percentage),
      skin_temp_c: round1(r.score.skin_temp_celsius),
    }),
  },
  {
    name: "get_sleep",
    path: "/activity/sleep",
    metric: "sleep_performance_pct",
    description:
      "Returns sleep records (performance, duration, efficiency, time in each stage) for the last N days, including naps. Use it to analyze sleep quality and habits.\nsleep_performance_pct is 0-100% (actual sleep vs. sleep needed); efficiency is the share of time in bed spent asleep. Summary stats exclude naps.",
    trim: (r) => {
      const s = r.score.stage_summary;
      const asleepMs =
        s.total_light_sleep_time_milli + s.total_slow_wave_sleep_time_milli + s.total_rem_sleep_time_milli;
      return {
        date: dateOf(r.end, r.timezone_offset),
        nap: r.nap,
        sleep_performance_pct: r.score.sleep_performance_percentage,
        sleep_hours: hours(asleepMs),
        in_bed_hours: hours(s.total_in_bed_time_milli),
        sleep_efficiency_pct: round1(r.score.sleep_efficiency_percentage),
        light_sleep_min: minutes(s.total_light_sleep_time_milli),
        deep_sleep_min: minutes(s.total_slow_wave_sleep_time_milli),
        rem_sleep_min: minutes(s.total_rem_sleep_time_milli),
        awake_min: minutes(s.total_awake_time_milli),
        disturbances: s.disturbance_count,
      };
    },
  },
  {
    name: "get_workouts",
    path: "/activity/workout",
    metric: "strain",
    description:
      "Returns workout records (sport, duration, strain, average and max heart rate) for the last N days. Use it to review training activity.\nstrain is 0-21 on Whoop's logarithmic scale (0-9 light, 10-13 moderate, 14-17 high, 18-21 all-out).",
    trim: (r) => ({
      date: dateOf(r.start, r.timezone_offset),
      sport: r.sport_name,
      duration_min: minutes(new Date(r.end).getTime() - new Date(r.start).getTime()),
      strain: round1(r.score.strain),
      avg_hr_bpm: r.score.average_heart_rate,
      max_hr_bpm: r.score.max_heart_rate,
    }),
  },
  {
    name: "get_cycles",
    path: "/cycle",
    metric: "strain",
    description:
      "Returns daily physiological cycles (day strain and average heart rate) for the last N days. Use it to see overall daily strain.\nstrain is 0-21 on Whoop's logarithmic scale (0-9 light, 10-13 moderate, 14-17 high, 18-21 all-out); the latest cycle may still be in progress.",
    trim: (r) => ({
      date: dateOf(r.start, r.timezone_offset),
      strain: round1(r.score.strain),
      avg_hr_bpm: r.score.average_heart_rate,
      max_hr_bpm: r.score.max_heart_rate,
    }),
  },
];

function summarize(metric: string, records: Trimmed[]) {
  const values = records.map((r) => r[metric]).filter((v): v is number => typeof v === "number");
  if (values.length === 0) return { metric, count: 0 };
  return {
    metric,
    count: values.length,
    average: round1(values.reduce((a, b) => a + b, 0) / values.length),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

for (const spec of specs) {
  server.tool(spec.name, spec.description, daysSchema, async ({ days }) => {
    try {
      const raw = (await fetchRecords(spec.path, days)) as Rec[];
      const scored = raw.filter((r) => r.score_state === "SCORED" && r.score);
      const records = scored.map(spec.trim);
      const forSummary = records.filter((r) => r.nap !== true);
      return ok({
        summary: { ...summarize(spec.metric, forSummary), days },
        skipped_unscored_records: raw.length - scored.length,
        records,
      });
    } catch (err) {
      return fail(err);
    }
  });
}

server.prompt(
  "weekly_review",
  "Fetches recent Whoop data and writes a short review of recovery, sleep, and workload.",
  {
    days: z
      .string()
      .regex(/^([1-9]|[12]\d|30)$/, "days must be an integer from 1 to 30")
      .optional()
      .describe("How many days to review, 1 to 30 (default 7)."),
  },
  ({ days }) => {
    const n = days ?? "7";
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Please do a Whoop review of my last ${n} days.`,
              `1. Call get_recovery, get_sleep, get_workouts and get_cycles, each with days=${n}.`,
              "2. Write a short review covering: (a) recovery trend, (b) sleep versus recovery, (c) workload versus recovery, and (d) one specific thing to change next week.",
              "Quote the actual numbers returned by those tool calls in this turn. Do not use numbers from earlier in the chat or from memory. If a tool call fails or returns no records, say so instead of guessing.",
            ].join("\n"),
          },
        },
      ],
    };
  },
);

server.resource(
  "profile-summary",
  "whoop://profile/summary",
  {
    description: "The user's basic Whoop profile (user id and name), fetched live. Contains no email address.",
    mimeType: "text/plain",
  },
  async (uri) => {
    const p = (await whoopGet("/user/profile/basic")) as Rec;
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "unknown";
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: `Whoop user ${p.user_id ?? "unknown"}: ${name}`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("whoop-mcp server running on stdio");
