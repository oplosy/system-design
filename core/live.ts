import type { Design } from './schema.ts';
import { slugify } from './mutations.ts';

// Live load on a design's lines from Prometheus, using the service graph metrics that the OpenTelemetry collector's
// servicegraph connector and Grafana Tempo write: one series per calling (client) and called (server) service.

export type Sample = { client: string; server: string; value: number };
export type Live = { qps?: number; latency?: number; errors?: number };

const QUERIES = {
  qps: 'sum by (client, server) (rate(traces_service_graph_request_total[5m]))',
  failed: 'sum by (client, server) (rate(traces_service_graph_request_failed_total[5m]))',
  // One-way time, as the trace import measures it: half the caller's median round trip.
  latency: 'histogram_quantile(0.5, sum by (client, server, le) (rate(traces_service_graph_request_client_seconds_bucket[5m])))',
};

/** Runs the three queries against a Prometheus-compatible API (Prometheus, Mimir, Thanos, VictoriaMetrics). */
export async function queryPrometheus(base: string): Promise<Record<keyof typeof QUERIES, Sample[]>> {
  if (!/^https?:\/\//i.test(base)) throw new Error('PROMETHEUS_URL must be an http(s) address');
  const one = async (query: string) => {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/v1/query?query=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(8000) });
    const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string; data?: { result?: { metric: Record<string, string>; value: [number, string] }[] } };
    if (!res.ok || body.status !== 'success') throw new Error(`Prometheus: ${body.error ?? res.status}`);
    return (body.data?.result ?? [])
      .map((r) => ({ client: r.metric.client ?? '', server: r.metric.server ?? '', value: Number(r.value[1]) }))
      .filter((s) => s.client && s.server && Number.isFinite(s.value));
  };
  const [qps, failed, latency] = await Promise.all([one(QUERIES.qps), one(QUERIES.failed), one(QUERIES.latency)]);
  return { qps, failed, latency };
}

const round = (x: number) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10);

/**
 * Puts the samples on the design's lines. A service matches the part imported from its traces (source otel:<name>),
 * else the part with its name; a line matches its two ends either way round. Returns per line id, and the service
 * pairs that matched no line.
 */
export function liveLines(d: Design, s: Record<'qps' | 'failed' | 'latency', Sample[]>) {
  const part = (name: string) => (d.components.find((c) => c.source === `otel:${name}`) ?? d.components.find((c) => c.id === slugify(name) || slugify(c.label) === slugify(name)))?.id;
  const line = (x: Sample) => {
    const [a, b] = [part(x.client), part(x.server)];
    return a && b ? d.connections.find((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a))?.id : undefined;
  };
  const lines: Record<string, Live> = {};
  const unmatched = new Set<string>();
  const at = (x: Sample) => {
    const id = line(x);
    if (!id) unmatched.add(`${x.client} → ${x.server}`);
    return id ? (lines[id] ??= {}) : undefined;
  };
  for (const x of s.qps) {
    const l = at(x);
    if (l) l.qps = round((l.qps ?? 0) + x.value);
  }
  for (const x of s.latency) {
    const l = at(x);
    if (l && x.value > 0) l.latency = round((x.value * 1000) / 2);
  }
  for (const x of s.failed) {
    const l = at(x);
    // Share of calls that failed, in percent of the same line's rate.
    if (l?.qps && x.value > 0) l.errors = round((100 * x.value) / l.qps);
  }
  return { lines, unmatched: [...unmatched] };
}
