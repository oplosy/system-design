import { parseAllDocuments } from 'yaml';
import type { BoundaryKind, ComponentType, Design } from './schema.ts';
import * as m from './mutations.ts';

// Reads a docker-compose file or Kubernetes manifests into parts, lines and boundaries.
// Lines come from depends_on/links, Ingress backends and environment values that name another part's host.

type Part = { key: string; label: string; image?: string; type: ComponentType; tech?: string; group?: string; code?: string };
type Link = { from: string; to: string; label?: string };
type Group = { key: string; label: string; kind: BoundaryKind };
type Doc = Record<string, any>;

const obj = (x: unknown): Doc => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Doc) : {});
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

// Variable names whose value is an address, e.g. DB_HOST, API_URL, KAFKA_BOOTSTRAP_SERVERS.
const ADDRESS_KEY = /(host|hosts|url|urls|uri|addr|address|endpoint|server|servers|dsn|broker|brokers|upstream)$/i;

/**
 * Hosts an environment variable names. A value counts when it reads as an address (a URL, host:port, a cluster
 * DNS name) or the variable's name says it is one, so MODE=api does not link to a service called api.
 */
function hosts([key, value]: [string, unknown]) {
  return String(value ?? '')
    .split(/[\s,;]+/)
    .flatMap((v) => {
      const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(v);
      const authority = v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]*@/, '').split(/[/?#]/)[0];
      const host = authority.replace(/:\d+$/, '');
      const address = url || host !== authority || /\.svc(\.|$)/.test(host) || ADDRESS_KEY.test(key);
      return address && /^[a-z0-9][a-z0-9.-]*$/i.test(host) ? [host] : [];
    });
}

function envEntries(env: unknown): [string, unknown][] {
  if (Array.isArray(env)) return env.map((e) => (typeof e === 'string' ? [e.split('=')[0], e.split('=').slice(1).join('=')] : [String(obj(e).name ?? ''), obj(e).value]));
  return Object.entries(obj(env));
}

export function readInfra(text: string) {
  if (/^\s*(resource|module|provider)\s+"/m.test(text)) throw new Error('This looks like Terraform source. Run "terraform show -json" (or on a saved plan) and paste its output.');
  if (/\{\{.*\}\}/.test(text)) throw new Error('This looks like a Helm template. Render it with "helm template <chart>" and paste the output.');
  const docs = Array.from(parseAllDocuments(text));
  for (const doc of docs) if (doc.errors.length) throw new Error(`YAML: ${doc.errors[0].message}`);
  const values = docs.map((doc) => obj(doc.toJS())).flatMap((v) => (v.kind === 'List' ? list(v.items).map(obj) : [v]));
  if (values.length === 1 && values[0].format_version && (values[0].values || values[0].planned_values)) return terraform(values[0]);
  if (values.length === 1 && Object.keys(obj(values[0].services)).length) return compose(values[0]);
  if (values.some((v) => typeof v.kind === 'string')) return kube(values);
  throw new Error('Paste a docker-compose file (with services:), Kubernetes manifests (with kind:) or "terraform show -json" output.');
}

/** Terraform resource types that draw as a part: [type, tech]. Everything else (IAM, security groups, routes…) is left out. */
const TF_TYPES: Record<string, [ComponentType, string]> = {
  aws_instance: ['vm', 'EC2'],
  aws_lambda_function: ['function', 'Lambda'],
  aws_ecs_service: ['service', 'ECS'],
  aws_apprunner_service: ['service', 'App Runner'],
  aws_eks_cluster: ['kubernetes', 'EKS'],
  aws_db_instance: ['sql-db', 'RDS'],
  aws_rds_cluster: ['sql-db', 'Aurora'],
  aws_dynamodb_table: ['nosql-db', 'DynamoDB'],
  aws_elasticache_cluster: ['cache', 'ElastiCache'],
  aws_elasticache_replication_group: ['cache', 'ElastiCache'],
  aws_s3_bucket: ['object-storage', 'S3'],
  aws_sqs_queue: ['queue', 'SQS'],
  aws_sns_topic: ['pubsub', 'SNS'],
  aws_kinesis_stream: ['stream', 'Kinesis'],
  aws_msk_cluster: ['stream', 'MSK'],
  aws_cloudwatch_event_bus: ['event-bus', 'EventBridge'],
  aws_sfn_state_machine: ['workflow', 'Step Functions'],
  aws_lb: ['load-balancer', 'ALB/NLB'],
  aws_alb: ['load-balancer', 'ALB'],
  aws_elb: ['load-balancer', 'ELB'],
  aws_api_gateway_rest_api: ['api-gateway', 'API Gateway'],
  aws_apigatewayv2_api: ['api-gateway', 'API Gateway'],
  aws_cloudfront_distribution: ['cdn', 'CloudFront'],
  aws_route53_zone: ['dns', 'Route 53'],
  aws_wafv2_web_acl: ['waf', 'WAF'],
  aws_cognito_user_pool: ['identity', 'Cognito'],
  aws_secretsmanager_secret: ['secrets', 'Secrets Manager'],
  aws_opensearch_domain: ['search', 'OpenSearch'],
  aws_elasticsearch_domain: ['search', 'Elasticsearch'],
  aws_redshift_cluster: ['warehouse', 'Redshift'],
  aws_ecr_repository: ['registry', 'ECR'],
  aws_nat_gateway: ['nat-gateway', 'NAT Gateway'],
  google_compute_instance: ['vm', 'Compute Engine'],
  google_cloudfunctions_function: ['function', 'Cloud Functions'],
  google_cloudfunctions2_function: ['function', 'Cloud Functions'],
  google_cloud_run_service: ['service', 'Cloud Run'],
  google_cloud_run_v2_service: ['service', 'Cloud Run'],
  google_container_cluster: ['kubernetes', 'GKE'],
  google_sql_database_instance: ['sql-db', 'Cloud SQL'],
  google_firestore_database: ['nosql-db', 'Firestore'],
  google_redis_instance: ['cache', 'Memorystore'],
  google_storage_bucket: ['object-storage', 'Cloud Storage'],
  google_pubsub_topic: ['pubsub', 'Pub/Sub'],
  google_bigquery_dataset: ['warehouse', 'BigQuery'],
  google_dns_managed_zone: ['dns', 'Cloud DNS'],
  google_secret_manager_secret: ['secrets', 'Secret Manager'],
  google_artifact_registry_repository: ['registry', 'Artifact Registry'],
  azurerm_linux_virtual_machine: ['vm', 'Azure VM'],
  azurerm_windows_virtual_machine: ['vm', 'Azure VM'],
  azurerm_linux_function_app: ['function', 'Azure Functions'],
  azurerm_windows_function_app: ['function', 'Azure Functions'],
  azurerm_container_app: ['service', 'Container Apps'],
  azurerm_linux_web_app: ['service', 'App Service'],
  azurerm_kubernetes_cluster: ['kubernetes', 'AKS'],
  azurerm_postgresql_flexible_server: ['sql-db', 'Azure PostgreSQL'],
  azurerm_mysql_flexible_server: ['sql-db', 'Azure MySQL'],
  azurerm_mssql_server: ['sql-db', 'Azure SQL'],
  azurerm_cosmosdb_account: ['nosql-db', 'Cosmos DB'],
  azurerm_redis_cache: ['cache', 'Azure Cache for Redis'],
  azurerm_storage_account: ['object-storage', 'Azure Storage'],
  azurerm_servicebus_queue: ['queue', 'Service Bus'],
  azurerm_servicebus_topic: ['pubsub', 'Service Bus'],
  azurerm_eventhub: ['stream', 'Event Hubs'],
  azurerm_lb: ['load-balancer', 'Azure LB'],
  azurerm_application_gateway: ['load-balancer', 'Application Gateway'],
  azurerm_api_management: ['api-gateway', 'API Management'],
  azurerm_cdn_frontdoor_profile: ['cdn', 'Front Door'],
  azurerm_dns_zone: ['dns', 'Azure DNS'],
  azurerm_key_vault: ['secrets', 'Key Vault'],
  azurerm_container_registry: ['registry', 'ACR'],
  docker_container: ['service', 'Docker'],
  kubernetes_deployment: ['service', 'Kubernetes'],
};

/** "module.api.aws_lb.main[0]" → "module.api.aws_lb.main": instances of one resource share its links. */
const base = (address: string) => address.replace(/\[[^\]]*\]/g, '');

/**
 * Reads `terraform show -json` output, of state or of a saved plan. Lines come from depends_on and, in a plan,
 * from the references in each resource's configuration.
 */
function terraform(file: Doc) {
  // shortcut: only direct links between drawn resources; a link through a skipped one (service → target group → LB) is lost. Follow skipped resources if imports look too sparse.
  const resources: Doc[] = [];
  const walk = (mod: Doc) => {
    resources.push(...list(mod.resources).map(obj).filter((r) => r.mode !== 'data'));
    for (const c of list(mod.child_modules)) walk(obj(c));
  };
  walk(obj(obj(file.values ?? file.planned_values).root_module));
  const module = (r: Doc) => base(String(r.address ?? '')).match(/^(.*?)\.?[^.]+\.[^.]+$/)?.[1] ?? '';
  const parts: Part[] = [];
  const skipped = new Map<string, number>();
  for (const r of resources) {
    const t = TF_TYPES[r.type];
    if (!t) {
      skipped.set(r.type, (skipped.get(r.type) ?? 0) + 1);
      continue;
    }
    const v = obj(r.values);
    const named = [v.name, v.identifier, v.function_name, v.bucket, v.cluster_identifier, v.replication_group_id].find((x) => typeof x === 'string' && x);
    const index = r.index === undefined ? '' : `-${r.index}`;
    const engine = typeof v.engine === 'string' ? ` ${v.engine}` : '';
    parts.push({ key: String(r.address), label: String(named ?? `${r.name}${index}`), type: t[0], tech: `${t[1]}${engine}`, group: module(r) || 'root' });
  }
  const byBase = new Map<string, string[]>();
  for (const p of parts) byBase.set(base(p.key), [...(byBase.get(base(p.key)) ?? []), p.key]);
  // A reference names a resource and maybe an attribute: "aws_db_instance.main.address" → "aws_db_instance.main".
  const target = (ref: string, prefix: string) => {
    const segs = base(`${prefix}${ref}`).split('.');
    for (let n = segs.length; n >= 2; n--) {
      const hit = byBase.get(segs.slice(0, n).join('.'));
      if (hit) return hit;
    }
    return [];
  };
  const links: Link[] = [];
  const seen = new Set<string>();
  const add = (from: string, refs: string[], prefix = '') => {
    for (const f of byBase.get(base(from)) ?? []) {
      for (const to of refs.flatMap((ref) => target(ref, prefix))) {
        if (to === f || seen.has(`${f} ${to}`)) continue;
        seen.add(`${f} ${to}`);
        links.push({ from: f, to });
      }
    }
  };
  for (const r of resources) add(String(r.address), list(r.depends_on).map(String));
  // Plans carry configuration with each expression's references, per module; addresses there are module-relative.
  const refs = (x: unknown): string[] => (Array.isArray(x) ? x.flatMap(refs) : x && typeof x === 'object' ? Object.entries(x).flatMap(([k, v]) => (k === 'references' ? list(v).map(String) : refs(v))) : []);
  const config = (mod: Doc, prefix: string) => {
    for (const r of list(mod.resources).map(obj)) add(`${prefix}${r.address}`, [...refs(r.expressions), ...list(r.depends_on).map(String)], prefix);
    for (const [name, call] of Object.entries(obj(mod.module_calls))) config(obj(obj(call).module), `${prefix}module.${name}.`);
  };
  config(obj(obj(file.configuration).root_module), '');
  const many = new Set(parts.map((p) => p.group)).size > 1;
  for (const p of parts) if (!many) p.group = undefined;
  const groups: Group[] = many ? [...new Set(parts.map((p) => p.group!))].map((n) => ({ key: n, label: n, kind: 'group' })) : [];
  return { parts, links, groups, skipped: [...skipped].map(([type, n]) => (n > 1 ? `${type} ×${n}` : type)) };
}

function compose(file: Doc) {
  const services = obj(file.services);
  const names = Object.keys(services);
  const nets = (s: Doc) => (Array.isArray(s.networks) ? s.networks.map(String) : Object.keys(obj(s.networks)));
  const used = new Set(names.flatMap((n) => nets(obj(services[n])).slice(0, 1)));
  const links: Link[] = [];
  const parts: Part[] = names.map((key) => {
    const s = obj(services[key]);
    const deps = Array.isArray(s.depends_on) ? s.depends_on.map(String) : Object.keys(obj(s.depends_on));
    for (const to of [...deps, ...list(s.links).map((l) => String(l).split(':')[0])]) links.push({ from: key, to });
    for (const to of envEntries(s.environment).flatMap(hosts)) if (names.includes(to)) links.push({ from: key, to });
    const image = typeof s.image === 'string' ? s.image : undefined;
    // build is a context path, or { context } in the long form.
    const build = typeof s.build === 'string' ? s.build : obj(s.build).context;
    const code = typeof build === 'string' ? build : undefined;
    return { key, label: key, image, type: 'service', group: used.size > 1 ? nets(s)[0] : undefined, code };
  });
  const groups: Group[] = used.size > 1 ? [...used].map((n) => ({ key: n, label: n, kind: 'subnet' })) : [];
  return { parts, links, groups, skipped: [] as string[] };
}

/** Where each workload kind keeps its pod template ({ metadata, spec }), and the part type it gets when its image says nothing. */
const WORKLOADS: Record<string, [(d: Doc) => Doc, ComponentType]> = {
  Pod: [(d) => d, 'service'],
  Deployment: [(d) => obj(obj(d.spec).template), 'service'],
  StatefulSet: [(d) => obj(obj(d.spec).template), 'service'],
  DaemonSet: [(d) => obj(obj(d.spec).template), 'service'],
  ReplicaSet: [(d) => obj(obj(d.spec).template), 'service'],
  Job: [(d) => obj(obj(d.spec).template), 'worker'],
  CronJob: [(d) => obj(obj(obj(obj(d.spec).jobTemplate).spec).template), 'cron'],
};

function kube(docs: Doc[]) {
  const ns = (d: Doc) => String(obj(d.metadata).namespace ?? 'default');
  const name = (d: Doc) => String(obj(d.metadata).name ?? '');
  const parts: Part[] = [];
  const pods: { key: string; ns: string; labels: Doc; containers: Doc[] }[] = [];
  for (const d of docs) {
    const w = WORKLOADS[d.kind];
    if (!w || !name(d)) continue;
    const template = w[0](d);
    const containers = list(obj(template.spec).containers).map(obj);
    const key = `${ns(d)}/${d.kind}/${name(d)}`;
    const image = containers.map((c) => c.image).find((i) => typeof i === 'string');
    parts.push({ key, label: name(d), image, type: w[1], group: ns(d) });
    pods.push({ key, ns: ns(d), labels: obj(obj(template.metadata).labels), containers });
  }
  // A Service is not a part of its own: it names the workloads its selector picks.
  const services = docs
    .filter((d) => d.kind === 'Service' && name(d))
    .map((d) => {
      const selector = Object.entries(obj(obj(d.spec).selector));
      const targets = pods.filter((p) => p.ns === ns(d) && selector.length && selector.every(([k, v]) => p.labels[k] === v)).map((p) => p.key);
      return { name: name(d), ns: ns(d), targets };
    });
  const namespaces = new Set(docs.map(ns));
  const resolve = (host: string, from: string) => {
    const [svc, hint] = host.split('.');
    const at = hint && namespaces.has(hint) ? hint : from;
    const found = services.filter((s) => s.name === svc);
    return (found.find((s) => s.ns === at) ?? found[0])?.targets ?? [];
  };
  const links: Link[] = [];
  for (const p of pods) {
    for (const host of p.containers.flatMap((c) => envEntries(c.env)).flatMap(hosts)) {
      for (const to of resolve(host, p.ns)) if (to !== p.key) links.push({ from: p.key, to });
    }
  }
  for (const d of docs.filter((x) => x.kind === 'Ingress' && name(x))) {
    const key = `${ns(d)}/Ingress/${name(d)}`;
    parts.push({ key, label: name(d), type: 'load-balancer', tech: 'Ingress', group: ns(d) });
    const spec = obj(d.spec);
    const backend = (b: unknown) => String(obj(obj(b).service).name ?? obj(b).serviceName ?? '');
    const routes = [
      { svc: backend(spec.defaultBackend ?? spec.backend), label: undefined as string | undefined },
      ...list(spec.rules).flatMap((r) =>
        list(obj(obj(r).http).paths).map((p) => ({ svc: backend(obj(p).backend), label: `${obj(r).host ?? ''}${obj(p).path ?? ''}` || undefined })),
      ),
    ];
    for (const r of routes) if (r.svc) for (const to of resolve(r.svc, ns(d))) links.push({ from: key, to, label: r.label });
  }
  const many = new Set(parts.map((p) => p.group)).size > 1;
  for (const p of parts) if (!many) p.group = undefined;
  const groups: Group[] = many ? [...new Set(parts.map((p) => p.group!))].map((n) => ({ key: n, label: n, kind: 'group' })) : [];
  // Everything that drew nothing, so the reader knows what was left out. Services show through their workloads.
  const skipped = docs.filter((d) => !WORKLOADS[d.kind] && !['Service', 'Ingress', 'Namespace'].includes(d.kind)).map((d) => `${d.kind ?? 'unknown kind'} ${name(d)}`.trim());
  return { parts, links, groups, skipped };
}

/**
 * Adds a compose file, manifests or Terraform JSON to `step` of a design. `guess` may pick a type from a part's image
 * and name (e.g. "postgres:16" → SQL DB) for parts that would otherwise be plain services. With `sync`, parts and
 * boundaries the design already has (same id or label) are reused and lines it already draws, either way, are kept,
 * so only what the design lacks is added. Returns what was added.
 */
export function importInfra(d: Design, text: string, { step, guess, sync }: { step?: string; guess?: (words: string) => ComponentType | undefined; sync?: boolean } = {}) {
  const { parts, links, groups } = readInfra(text);
  if (!parts.length) throw new Error('No services or workloads found.');
  const at = { step, reopen: false };
  // shortcut: matches by id or label only, so a part renamed on one side shows up as new; store the source address on parts if that gets noisy.
  const existing = (label: string, items: { id: string; label: string }[]) => (sync ? items.find((x) => x.id === m.slugify(label) || m.slugify(x.label) === m.slugify(label))?.id : undefined);
  const added = { components: [] as string[], connections: [] as string[], boundaries: [] as string[] };
  const boundaryIds = new Map(
    groups.map((g) => {
      const found = existing(g.label, d.boundaries);
      if (found) return [g.key, found];
      added.boundaries.push(g.label);
      return [g.key, m.addBoundary(d, { kind: g.kind, label: g.label, id: g.key, ...at })];
    }),
  );
  const ids = new Map<string, string>();
  for (const p of parts) {
    const found = existing(p.label, d.components);
    if (found) {
      ids.set(p.key, found);
      continue;
    }
    // "registry.io/team/postgres:16@sha256:…" → "postgres:16"
    const tech = p.tech ?? p.image?.split('@')[0].split('/').pop();
    // A part with a known tech (Terraform resource, Ingress) already has its type; only image-based parts need a guess.
    const type = (p.type === 'service' && !p.tech && guess?.(`${tech?.split(':')[0] ?? ''} ${p.label}`)) || p.type;
    ids.set(p.key, m.addComponent(d, { id: p.label, type, label: p.label, tech, code: p.code, boundary: p.group && boundaryIds.get(p.group), ...at }));
    added.components.push(p.label);
  }
  const label = (id: string) => d.components.find((c) => c.id === id)?.label ?? id;
  for (const l of links) {
    const from = ids.get(l.from);
    const to = ids.get(l.to);
    if (!from || !to || from === to || d.connections.some((c) => (c.from === from && c.to === to) || (c.from === to && c.to === from))) continue;
    m.connect(d, { from, to, label: l.label, ...at });
    added.connections.push(`${label(from)} → ${label(to)}`);
  }
  return added;
}

/** What `text` has that design `d` lacks (parts, lines, boundaries), without changing `d`. */
export function infraDrift(d: Design, text: string, guess?: (words: string) => ComponentType | undefined) {
  const added = importInfra(structuredClone(d), text, { sync: true, guess });
  return { ...added, drifted: added.components.length + added.connections.length + added.boundaries.length > 0 };
}

/** Adds what `text` has and `d` lacks as one new, unseen step for review. Returns the step id, or undefined when nothing is missing. */
export function syncInfra(d: Design, text: string, title: string, guess?: (words: string) => ComponentType | undefined) {
  const drift = infraDrift(d, text, guess);
  if (!drift.drifted) return undefined;
  const summary = `Found in the infrastructure but not in the design: ${[...drift.components, ...drift.connections, ...drift.boundaries].join(', ')}.`;
  const step = m.addStep(d, { title, summary });
  importInfra(d, text, { step, sync: true, guess });
  return step;
}
