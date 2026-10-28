import type { ComponentType } from './schema.ts';

// Reads recorded traces (OTLP JSON, as the OpenTelemetry collector's file exporter writes it, or a Jaeger JSON
// download) into parts, lines and flows. Services become parts; calls between services, and client spans to
// databases, queues and outside hosts, become lines carrying the observed rate and latency; each kind of request
// (root span) becomes a flow, walked from one sample trace.

type Doc = Record<string, any>;
type Kind = 'server' | 'client' | 'producer' | 'consumer' | 'internal';
type Span = { trace: string; id: string; parent?: string; service: string; name: string; kind: Kind; start: number; dur: number; attrs: Record<string, unknown> };

export type TracePart = { key: string; label: string; type: ComponentType; tech?: string };
export type TraceLink = { from: string; to: string; label?: string; qps?: number; latency?: number; async?: boolean };
export type TraceFlow = { title: string; path: string[] };

const obj = (x: unknown): Doc => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Doc) : {});
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const KINDS: Kind[] = ['internal', 'internal', 'server', 'client', 'producer', 'consumer'];

/** OTLP attributes are [{ key, value: { stringValue | intValue | … } }]. */
function otlpAttrs(x: unknown) {
  const out: Record<string, unknown> = {};
  for (const a of list(x).map(obj)) out[String(a.key)] = Object.values(obj(a.value))[0];
  return out;
}

function otlp(docs: Doc[]): Span[] {
  const spans: Span[] = [];
  for (const doc of docs) {
    for (const rs of list(doc.resourceSpans).map(obj)) {
      const service = String(otlpAttrs(obj(rs.resource).attributes)['service.name'] ?? 'unknown');
      for (const ss of [...list(rs.scopeSpans), ...list(rs.instrumentationLibrarySpans)].map(obj)) {
        for (const s of list(ss.spans).map(obj)) {
          const kind = typeof s.kind === 'number' ? KINDS[s.kind] : (String(s.kind ?? '').replace('SPAN_KIND_', '').toLowerCase() as Kind);
          // Nanosecond timestamps outgrow a double's exact range, which is fine at millisecond precision.
          const start = Number(s.startTimeUnixNano) / 1e6;
          spans.push({ trace: String(s.traceId), id: String(s.spanId), parent: s.parentSpanId || undefined, service, name: String(s.name ?? ''), kind: KINDS.includes(kind) ? kind : 'internal', start, dur: Number(s.endTimeUnixNano) / 1e6 - start, attrs: otlpAttrs(s.attributes) });
        }
      }
    }
  }
  return spans;
}

function jaeger(doc: Doc): Span[] {
  return list(doc.data).map(obj).flatMap((t) => {
    const processes = obj(t.processes);
    return list(t.spans).map(obj).map((s): Span => {
      const attrs = Object.fromEntries(list(s.tags).map(obj).map((x) => [String(x.key), x.value]));
      const parent = list(s.references).map(obj).find((r) => r.refType === 'CHILD_OF')?.spanID;
      const kind = String(attrs['span.kind'] ?? 'internal') as Kind;
      return { trace: String(s.traceID), id: String(s.spanID), parent, service: String(obj(processes[s.processID]).serviceName ?? 'unknown'), name: String(s.operationName ?? ''), kind: KINDS.includes(kind) ? kind : 'internal', start: Number(s.startTime) / 1000, dur: Number(s.duration) / 1000, attrs };
    });
  });
}

/** Trace spans in `text`, or undefined when it is not a trace file. Accepts one JSON document or JSON lines. */
export function readSpans(text: string): Span[] | undefined {
  const t = text.trim();
  if (!t.startsWith('{')) return undefined;
  let docs: Doc[];
  try {
    docs = [JSON.parse(t)];
  } catch {
    try {
      docs = t.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    } catch {
      return undefined;
    }
  }
  if (docs.some((d) => Array.isArray(d.resourceSpans))) return otlp(docs);
  if (docs.length === 1 && Array.isArray(docs[0].data) && list(docs[0].data).some((x) => Array.isArray(obj(x).spans))) return jaeger(docs[0]);
  return undefined;
}

const DB_TYPES: Record<string, ComponentType> = {
  postgresql: 'sql-db', mysql: 'sql-db', mariadb: 'sql-db', mssql: 'sql-db', oracle: 'sql-db', sqlite: 'sql-db', db2: 'sql-db',
  redis: 'cache', memcached: 'cache', mongodb: 'nosql-db', cassandra: 'nosql-db', dynamodb: 'nosql-db', couchdb: 'nosql-db', cosmosdb: 'nosql-db',
  elasticsearch: 'search', opensearch: 'search', neo4j: 'graph-db', influxdb: 'time-series', clickhouse: 'olap',
};
const MQ_TYPES: Record<string, ComponentType> = { kafka: 'stream', kinesis: 'stream', rabbitmq: 'queue', sqs: 'queue', activemq: 'queue', sns: 'pubsub', gcp_pubsub: 'pubsub', servicebus: 'queue', eventhubs: 'stream' };
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

export function readTraces(spans: Span[]) {
  if (!spans.length) throw new Error('The trace file has no spans.');
  const parts = new Map<string, TracePart>();
  const part = (p: TracePart) => (parts.has(p.key) ? p.key : (parts.set(p.key, p), p.key));
  const svc = (s: Span) => part({ key: `svc:${s.service}`, label: s.service, type: 'service' });
  const byId = new Map(spans.map((s) => [`${s.trace}/${s.id}`, s]));
  const children = new Map<string, Span[]>();
  for (const s of spans) if (s.parent && byId.has(`${s.trace}/${s.parent}`)) children.set(`${s.trace}/${s.parent}`, [...(children.get(`${s.trace}/${s.parent}`) ?? []), s]);
  for (const c of children.values()) c.sort((a, b) => a.start - b.start);

  /** Where a span leads outside its own service, if anywhere: [part key, duration seen by the caller, async]. */
  const target = (s: Span): [string, number, boolean] | undefined => {
    const a = s.attrs;
    const dest = str(a['messaging.destination.name']) ?? str(a['messaging.destination']);
    const mq = str(a['messaging.system']);
    if (s.kind === 'producer' && mq) return [part({ key: `mq:${mq}:${dest ?? ''}`, label: dest ?? mq, type: MQ_TYPES[mq] ?? 'queue', tech: mq }), s.dur, true];
    if (s.kind !== 'client') return undefined;
    // A call another traced service answered is drawn from that service's span instead.
    if ((children.get(`${s.trace}/${s.id}`) ?? []).some((c) => c.service !== s.service)) return undefined;
    const db = str(a['db.system']);
    const host = str(a['server.address']) ?? str(a['net.peer.name']) ?? str(a['http.host']) ?? (str(a['url.full']) ?? str(a['http.url']))?.match(/^\w+:\/\/([^/:?#]+)/)?.[1];
    if (db) {
      const name = str(a['db.namespace']) ?? str(a['db.name']) ?? host;
      return [part({ key: `db:${db}:${name ?? ''}`, label: name ?? db, type: DB_TYPES[db] ?? 'sql-db', tech: db }), s.dur, false];
    }
    if (host) return [part({ key: `ext:${host}`, label: host, type: 'external' }), s.dur, false];
    return undefined;
  };

  const calls = new Map<string, { from: string; to: string; durs: number[]; async: boolean }>();
  const call = (from: string, to: string, dur: number, async: boolean) => {
    if (from === to) return;
    const c = calls.get(`${from} ${to}`) ?? { from, to, durs: [], async };
    c.durs.push(dur);
    calls.set(`${from} ${to}`, c);
  };
  for (const s of spans) {
    const parent = s.parent ? byId.get(`${s.trace}/${s.parent}`) : undefined;
    const t = target(s);
    if (t) call(svc(s), t[0], t[1], t[2]);
    const mq = str(s.attrs['messaging.system']);
    if (s.kind === 'consumer' && mq) {
      // A consumer reads from its destination; the producer → consumer hop goes through the queue.
      const dest = str(s.attrs['messaging.destination.name']) ?? str(s.attrs['messaging.destination']);
      call(part({ key: `mq:${mq}:${dest ?? ''}`, label: dest ?? mq, type: MQ_TYPES[mq] ?? 'queue', tech: mq }), svc(s), s.dur, true);
    } else if (parent && parent.service !== s.service) {
      // The caller's client span includes the network both ways; the callee's server span does not.
      call(svc(parent), svc(s), parent.kind === 'client' ? parent.dur : s.dur, false);
    } else svc(s);
  }

  const times = spans.flatMap((s) => [s.start, s.start + s.dur]);
  const seconds = Math.max(1, (Math.max(...times) - Math.min(...times)) / 1000);
  // A line's latency is one way, and a flow counts the reply again, so half the round trip the caller saw.
  const links: TraceLink[] = [...calls.values()].map((c) => ({ from: c.from, to: c.to, qps: round(c.durs.length / seconds), latency: c.async ? undefined : round(median(c.durs) / 2), async: c.async || undefined }));

  // One flow per kind of request, from its most common root, walked through one sample trace.
  const roots = spans.filter((s) => !s.parent || !byId.has(`${s.trace}/${s.parent}`));
  const kinds = new Map<string, Span[]>();
  for (const r of roots) kinds.set(`${r.service} ${r.name}`, [...(kinds.get(`${r.service} ${r.name}`) ?? []), r]);
  const names = new Map<string, number>();
  for (const r of roots) names.set(r.name, (names.get(r.name) ?? 0) + 1);
  const flows: TraceFlow[] = [];
  for (const [, rs] of [...kinds].sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
    const root = rs[0];
    const path = [svc(root)];
    const walk = (s: Span, at: string) => {
      for (const c of children.get(`${s.trace}/${s.id}`) ?? []) {
        const t = target(c);
        if (t) {
          // Into the database, queue or outside host and back; a queue's consumers carry on from the queue.
          path.push(t[0]);
          walk(c, t[0]);
          path.push(at);
          continue;
        }
        const here = c.service === s.service ? at : svc(c);
        if (here !== at) path.push(here);
        walk(c, here);
        if (here !== at) path.push(at);
      }
    };
    walk(root, path[0]);
    // Collapse repeats and drop the replies that close the request.
    const steps = path.filter((p, i) => p !== path[i - 1]);
    while (steps.length > 1 && steps.indexOf(steps[steps.length - 1]) < steps.length - 1) steps.pop();
    if (steps.length < 2) continue;
    const title = (names.get(root.name) ?? 0) > rs.length ? `${root.service}: ${root.name}` : root.name;
    flows.push({ title: title || root.service, path: steps });
  }
  return { parts: [...parts.values()], links, flows };
}
