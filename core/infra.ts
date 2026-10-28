import { parseAllDocuments } from 'yaml';
import type { BoundaryKind, ComponentType, Design } from './schema.ts';
import * as m from './mutations.ts';
import { readSpans, readTraces, type TraceFlow } from './traces.ts';
import { asyncapi, backstage, isBackstage, openapi } from './specs.ts';

// Reads a docker-compose file or Kubernetes manifests into parts, lines and boundaries.
// Lines come from depends_on/links, Ingress backends and environment values that name another part's host.

export type Part = { key: string; label: string; image?: string; type: ComponentType; tech?: string; description?: string; group?: string; code?: string };
export type Link = { from: string; to: string; label?: string; qps?: number; latency?: number; async?: boolean };
export type Group = { key: string; label: string; kind: BoundaryKind };
export type Doc = Record<string, any>;

const obj = (x: unknown): Doc => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Doc) : {});
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown) => (typeof x === 'string' && x ? x : undefined);

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
  const spans = readSpans(text);
  if (spans) {
    const { parts, links, flows }: { parts: Part[]; links: Link[]; flows: TraceFlow[] } = readTraces(spans);
    return { format: 'otel', parts, links, flows, groups: [] as Group[], skipped: [] as string[] };
  }
  if (/\{\{.*\}\}/.test(text)) throw new Error('This looks like a Helm template. Render it with "helm template <chart>" and paste the output.');
  const docs = Array.from(parseAllDocuments(text, { customTags: CFN_TAGS }));
  for (const doc of docs) if (doc.errors.length) throw new Error(`YAML: ${doc.errors[0].message}`);
  const values = docs.map((doc) => obj(doc.toJS())).flatMap((v) => (v.kind === 'List' ? list(v.items).map(obj) : [v]));
  if (values.length === 1 && values[0].format_version && (values[0].values || values[0].planned_values)) return { format: 'terraform', ...terraform(values[0]) };
  if (values.length === 1 && Object.values(obj(values[0].Resources)).some((r) => /^AWS::/.test(String(obj(r).Type)))) return { format: 'cloudformation', ...cloudformation(values[0]) };
  if (values.length === 1 && Array.isArray(obj(values[0].deployment).resources)) return { format: 'pulumi', ...pulumi(values[0]) };
  if (values.length === 1 && (typeof values[0].openapi === 'string' || values[0].swagger)) return { format: 'openapi', ...openapi(values[0]) };
  if (values.length === 1 && values[0].asyncapi) return { format: 'asyncapi', ...asyncapi(values[0]) };
  if (values.length === 1 && Object.keys(obj(values[0].services)).length) return { format: 'compose', ...compose(values[0]) };
  // Backstage entities have a kind: too, so they go before Kubernetes.
  if (isBackstage(values)) return { format: 'backstage', ...backstage(values) };
  if (values.some((v) => typeof v.kind === 'string')) return { format: 'kubernetes', ...kube(values) };
  throw new Error(
    'Paste a docker-compose file (with services:), Kubernetes manifests (with kind:), "terraform show -json" output, a CloudFormation or CDK template, a Pulumi stack export, a Backstage catalog, an OpenAPI or AsyncAPI document, or OpenTelemetry (OTLP JSON) or Jaeger traces.',
  );
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

/** Resources that only wire two others together; the parts on either end get a line. */
const TF_BRIDGE =
  /^(aws_(lb|alb)_(listener|listener_rule|target_group|target_group_attachment)|aws_api_gateway_(integration|resource|method)|aws_apigatewayv2_(integration|route)|aws_lambda_event_source_mapping|aws_lambda_permission|aws_sns_topic_subscription|aws_cloudwatch_event_(rule|target)|google_pubsub_subscription|google_compute_(backend_service|url_map|target_https?_proxy))$/;
/** Shared plumbing that would link everything to everything: never walked through. */
const TF_PLUMBING =
  /^(aws_(security_group|vpc|subnet|route|internet_gateway|eip|network_|default_|db_subnet_group|elasticache_subnet_group|iam_|kms_)|google_(compute_(network|subnetwork|firewall)|project_iam|service_account)|azurerm_(resource_group|virtual_network|subnet|network_|role_))/;
/** Which end of a wiring resource calls the other: lower calls higher, equal ranks don't link. */
const TF_FRONT: Partial<Record<ComponentType, number>> = { cdn: 0, 'api-gateway': 1, 'load-balancer': 2, 'event-bus': 3, pubsub: 4, stream: 5, queue: 6 };

/** "module.api.aws_lb.main[0]" → "module.api.aws_lb.main": instances of one resource share its links. */
const base = (address: string) => address.replace(/\[[^\]]*\]/g, '');

/**
 * Reads `terraform show -json` output, of state or of a saved plan. Lines come from depends_on and, in a plan,
 * from the references in each resource's configuration, followed through resources that are not drawn.
 */
function terraform(file: Doc) {
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
  const typeOf = new Map(resources.map((r) => [base(String(r.address)), String(r.type)]));
  const partsAt = new Map<string, string[]>();
  for (const p of parts) partsAt.set(base(p.key), [...(partsAt.get(base(p.key)) ?? []), p.key]);
  // A reference names a resource and maybe an attribute: "aws_db_instance.main.address" → "aws_db_instance.main".
  const target = (ref: string, prefix: string) => {
    const segs = base(`${prefix}${ref}`).split('.');
    for (let n = segs.length; n >= 2; n--) if (typeOf.has(segs.slice(0, n).join('.'))) return segs.slice(0, n).join('.');
    return undefined;
  };
  // Every resource's references to other resources, drawn or not, by base address.
  const out = new Map<string, Set<string>>();
  const add = (from: string, refs: string[], prefix = '') => {
    const f = base(from);
    for (const t of refs.map((ref) => target(ref, prefix))) if (t && t !== f) out.set(f, (out.get(f) ?? new Set()).add(t));
  };
  for (const r of resources) add(String(r.address), list(r.depends_on).map(String));
  // Plans carry configuration with each expression's references, per module; addresses there are module-relative.
  const refs = (x: unknown): string[] => (Array.isArray(x) ? x.flatMap(refs) : x && typeof x === 'object' ? Object.entries(x).flatMap(([k, v]) => (k === 'references' ? list(v).map(String) : refs(v))) : []);
  const config = (mod: Doc, prefix: string) => {
    for (const r of list(mod.resources).map(obj)) add(`${prefix}${r.address}`, [...refs(r.expressions), ...list(r.depends_on).map(String)], prefix);
    for (const [name, call] of Object.entries(obj(mod.module_calls))) config(obj(obj(call).module), `${prefix}module.${name}.`);
  };
  config(obj(obj(file.configuration).root_module), '');

  const links: Link[] = [];
  const seen = new Set<string>();
  const link = (from: string, to: string) => {
    for (const f of partsAt.get(from) ?? []) {
      for (const t of partsAt.get(to) ?? []) {
        if (f === t || seen.has(`${f} ${t}`)) continue;
        seen.add(`${f} ${t}`);
        links.push({ from: f, to: t });
      }
    }
  };
  const kind = (a: string) => (partsAt.has(a) ? 'part' : TF_BRIDGE.test(typeOf.get(a)!) ? 'bridge' : TF_PLUMBING.test(typeOf.get(a)!) ? 'plumbing' : 'hop');
  // A part reaches the parts it references, also through undrawn resources in between (service → task definition → DB).
  for (const a of partsAt.keys()) {
    const visited = new Set([a]);
    let frontier = [a];
    for (let depth = 0; depth < 3 && frontier.length; depth++) {
      const next: string[] = [];
      for (const x of frontier) {
        for (const y of out.get(x) ?? []) {
          if (visited.has(y)) continue;
          visited.add(y);
          if (kind(y) === 'part') link(a, y);
          else if (kind(y) === 'hop') next.push(y);
        }
      }
      frontier = next;
    }
  }
  // Wiring resources (listeners, target groups, subscriptions, event source mappings…) point at both ends, so the
  // direction comes from the ends: a balancer, gateway, topic or queue calls what sits behind it.
  const near = new Map<string, Set<string>>();
  for (const [f, ts] of out) {
    for (const t of ts) {
      near.set(f, (near.get(f) ?? new Set()).add(t));
      near.set(t, (near.get(t) ?? new Set()).add(f));
    }
  }
  const rank = (a: string) => TF_FRONT[TF_TYPES[typeOf.get(a)!][0]] ?? 9;
  const grouped = new Set<string>();
  for (const a of typeOf.keys()) {
    if (kind(a) !== 'bridge' || grouped.has(a)) continue;
    const cluster = [a];
    const ends = new Set<string>();
    grouped.add(a);
    for (const x of cluster) {
      for (const y of near.get(x) ?? []) {
        if (kind(y) === 'part') ends.add(y);
        else if (kind(y) === 'bridge' && !grouped.has(y)) {
          grouped.add(y);
          cluster.push(y);
        }
      }
    }
    for (const f of ends) for (const t of ends) if (rank(f) < rank(t)) link(f, t);
  }
  const many = new Set(parts.map((p) => p.group)).size > 1;
  for (const p of parts) if (!many) p.group = undefined;
  const groups: Group[] = many ? [...new Set(parts.map((p) => p.group!))].map((n) => ({ key: n, label: n, kind: 'group' })) : [];
  return { parts, links, groups, skipped: [...skipped].map(([type, n]) => (n > 1 ? `${type} ×${n}` : type)) };
}

/** CloudFormation's short-form functions (!Ref, !GetAtt, !Sub…) read as their long form, so references survive. */
const CFN_TAGS = ['Ref', 'Condition', ...['GetAtt', 'Sub', 'Join', 'Select', 'Split', 'If', 'Equals', 'Not', 'And', 'Or', 'FindInMap', 'Base64', 'Cidr', 'GetAZs', 'ImportValue'].map((f) => `Fn::${f}`)].flatMap(
  (name) => {
    const tag = `!${name.replace('Fn::', '')}`;
    return [
      { tag, resolve: (v: string) => ({ [name]: v }) },
      { tag, collection: 'seq' as const, resolve: (v: { toJSON(): unknown }) => ({ [name]: v.toJSON() }) },
      { tag, collection: 'map' as const, resolve: (v: { toJSON(): unknown }) => ({ [name]: v.toJSON() }) },
    ];
  },
);

/** CloudFormation services whose Terraform resources are named differently: AWS::<service>::<Resource> → aws_<service>_<resource>. */
const CFN_SERVICES: Record<string, string> = { ec2: '', apigateway: 'api_gateway', elasticloadbalancingv2: 'lb', events: 'cloudwatch_event', stepfunctions: 'sfn', opensearchservice: 'opensearch', logs: 'cloudwatch_log' };
const CFN_RESOURCES: Record<string, string> = {
  'AWS::RDS::DBInstance': 'aws_db_instance',
  'AWS::RDS::DBCluster': 'aws_rds_cluster',
  'AWS::ElastiCache::CacheCluster': 'aws_elasticache_cluster',
  'AWS::ElasticLoadBalancingV2::LoadBalancer': 'aws_lb',
  'AWS::ElasticLoadBalancing::LoadBalancer': 'aws_elb',
  'AWS::Events::EventBus': 'aws_cloudwatch_event_bus',
  'AWS::Route53::HostedZone': 'aws_route53_zone',
  'AWS::SNS::Subscription': 'aws_sns_topic_subscription',
};
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase();

/** A resource's references to others: Ref, GetAtt and the ${Name} in Sub strings. */
function cfnRefs(x: unknown): string[] {
  if (Array.isArray(x)) return x.flatMap(cfnRefs);
  return Object.entries(obj(x)).flatMap(([k, v]) => {
    if (k === 'Ref') return typeof v === 'string' ? [v] : [];
    if (k === 'Fn::GetAtt') return [String(Array.isArray(v) ? v[0] : String(v).split('.')[0])];
    if (k === 'Fn::Sub') return [...String(Array.isArray(v) ? v[0] : v).matchAll(/\$\{([^}!.]+)/g)].map((m) => m[1]).concat(Array.isArray(v) ? cfnRefs(v[1]) : []);
    return cfnRefs(v);
  });
}

/**
 * Reads a CloudFormation template (YAML or JSON, so also `cdk synth` output) by handing it to the Terraform reader:
 * each type maps to its Terraform resource and references become depends_on, so types, wiring and plumbing match.
 */
function cloudformation(file: Doc) {
  const resources = Object.entries(obj(file.Resources)).filter(([, r]) => obj(r).Type !== 'AWS::CDK::Metadata');
  const types = new Map<string, string>();
  const tfType = (t: string) => {
    const [, service = '', resource = ''] = t.split('::');
    const svc = service.toLowerCase();
    const tf = CFN_RESOURCES[t] ?? ['aws', CFN_SERVICES[svc] ?? svc, snake(resource)].filter(Boolean).join('_');
    types.set(tf, t);
    return tf;
  };
  const address = new Map(resources.map(([id, r]) => [id, `${tfType(String(obj(r).Type))}.${id}`]));
  const tf = terraform({
    values: {
      root_module: {
        resources: resources.map(([id, r]) => {
          const props = obj(obj(r).Properties);
          // CDK logical ids carry a hash ("OrdersTable1A2B3C4D"); its construct path has the name it was given.
          const path = str(obj(obj(r).Metadata)['aws:cdk:path'])?.split('/').filter((s) => s !== 'Resource' && s !== 'Default');
          const deps = [...cfnRefs(props), ...[obj(r).DependsOn].flat().filter((x): x is string => typeof x === 'string')];
          return { address: address.get(id), type: address.get(id)!.split('.')[0], name: id, values: { name: path?.at(-1) ?? id, engine: props.Engine }, depends_on: deps.map((x) => address.get(x)).filter(Boolean) };
        }),
      },
    },
  });
  return { ...tf, skipped: tf.skipped.map((s) => s.replace(/^\S+/, (t) => types.get(t) ?? t)) };
}

/** Pulumi type modules whose Terraform names differ, and types that would otherwise land on the wrong resource. */
const PULUMI_PROVIDERS: Record<string, string> = { gcp: 'google', azure: 'azurerm' };
const PULUMI_MODULES: Record<string, string> = { apigateway: 'api_gateway', cloudrun: 'cloud_run', cloudrunv2: 'cloud_run_v2' };
const PULUMI_TYPES: Record<string, string> = { 'aws:rds/instance:Instance': 'aws_db_instance' };

/**
 * Reads `pulumi stack export` output through the Terraform reader: Pulumi's AWS, Google Cloud and Azure (classic)
 * providers are bridged from Terraform's, so "aws:lambda/function:Function" is aws_lambda_function, and each
 * resource's dependencies become depends_on.
 */
function pulumi(file: Doc) {
  // shortcut: components (awsx, your own) are not drawn and azure-native types are not mapped; their resources still are.
  const resources = list(obj(file.deployment).resources).map(obj).filter((r) => r.custom && str(r.urn) && !String(r.type).startsWith('pulumi:'));
  const known = (t: string) => t in TF_TYPES || TF_BRIDGE.test(t) || TF_PLUMBING.test(t);
  const types = new Map<string, string>();
  const tfType = (t: string) => {
    const [pkg = '', path = '', resource = ''] = t.split(':');
    const p = PULUMI_PROVIDERS[pkg] ?? pkg;
    const mod = PULUMI_MODULES[path.split('/')[0].toLowerCase()] ?? path.split('/')[0].toLowerCase();
    const res = snake(resource).replace(/_?v2$/, '');
    const tries = [PULUMI_TYPES[t], `${p}_${mod}_${res}`, `${p}_${res}`, `${p}_${mod}`].filter((x): x is string => !!x);
    const tf = tries.find(known) ?? tries[0];
    types.set(tf, t);
    return tf;
  };
  // urn:pulumi:stack::project::parent$type::name → name
  const name = (r: Doc) => String(r.urn).split('::').pop()!;
  const address = new Map(resources.map((r) => [String(r.urn), `${tfType(String(r.type))}.${name(r).replace(/[^\w-]/g, '_')}`]));
  const tf = terraform({
    values: {
      root_module: {
        resources: resources.map((r) => ({
          address: address.get(r.urn),
          type: address.get(r.urn)!.split('.')[0],
          name: name(r),
          values: { name: name(r), engine: obj(r.outputs).engine ?? obj(r.inputs).engine },
          depends_on: list(r.dependencies).map((u) => address.get(String(u))).filter(Boolean),
        })),
      },
    },
  });
  return { ...tf, skipped: tf.skipped.map((s) => s.replace(/^\S+/, (t) => types.get(t) ?? t)) };
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
 * and name (e.g. "postgres:16" → SQL DB) for parts that would otherwise be plain services. Each part it adds keeps
 * where it came from (`source`). With `sync`, parts the design already has are reused (same source, else same id or
 * label, which then gets the source), lines it already draws either way are kept, and parts once imported from this
 * format that the infrastructure no longer has are removed, so the design comes to match. Returns what changed.
 */
export function importInfra(d: Design, text: string, { step, guess, sync }: { step?: string; guess?: (words: string) => ComponentType | undefined; sync?: boolean } = {}) {
  const read = readInfra(text);
  const { format, parts, links, groups } = read;
  const flows: TraceFlow[] = ('flows' in read && read.flows) || [];
  if (!parts.length) throw new Error('No services or workloads found.');
  const at = { step, reopen: false };
  const byName = <T extends { id: string; label: string }>(label: string, items: T[]) => items.find((x) => x.id === m.slugify(label) || m.slugify(x.label) === m.slugify(label));
  const added = { components: [] as string[], connections: [] as string[], boundaries: [] as string[], removed: [] as string[], updated: [] as string[], flows: [] as string[] };
  const boundaryIds = new Map(
    groups.map((g) => {
      const found = sync && byName(g.label, d.boundaries)?.id;
      if (found) return [g.key, found];
      added.boundaries.push(g.label);
      return [g.key, m.addBoundary(d, { kind: g.kind, label: g.label, id: g.key, ...at })];
    }),
  );
  const ids = new Map<string, string>();
  for (const p of parts) {
    const source = `${format}:${p.key}`;
    // A part that came from somewhere else is a different thing, even with the same name.
    const found = sync ? (d.components.find((c) => c.source === source) ?? byName(p.label, d.components.filter((c) => !c.source))) : undefined;
    if (found) {
      found.source = source;
      ids.set(p.key, found.id);
      continue;
    }
    // "registry.io/team/postgres:16@sha256:…" → "postgres:16"
    const tech = p.tech ?? p.image?.split('@')[0].split('/').pop();
    // A part with a known tech (Terraform resource, Ingress) already has its type; only image-based parts need a guess.
    const type = (p.type === 'service' && !p.tech && guess?.(`${tech?.split(':')[0] ?? ''} ${p.label}`)) || p.type;
    ids.set(p.key, m.addComponent(d, { id: p.label, type, label: p.label, tech, description: p.description, code: p.code, source, boundary: p.group && boundaryIds.get(p.group), ...at }));
    added.components.push(p.label);
  }
  const label = (id: string) => d.components.find((c) => c.id === id)?.label ?? id;
  // Measured load and latency (from traces) replace what a line says only when it is missing or off by more than a quarter.
  const off = (was: number | undefined, now: number | undefined) => now !== undefined && (was === undefined || Math.abs(now - was) > 0.25 * Math.max(was, 1));
  for (const l of links) {
    const from = ids.get(l.from);
    const to = ids.get(l.to);
    if (!from || !to || from === to) continue;
    const drawn = d.connections.find((c) => c.from === from && c.to === to) ?? d.connections.find((c) => c.from === to && c.to === from);
    if (!drawn) {
      m.connect(d, { from, to, label: l.label, qps: l.qps, latency: l.latency, async: l.async, ...at });
      added.connections.push(`${label(from)} → ${label(to)}`);
    } else if (drawn.from === from && (off(drawn.qps, l.qps) || off(drawn.latency, l.latency))) {
      m.updateTracked(d, drawn.id, { qps: off(drawn.qps, l.qps) ? l.qps : drawn.qps, latency: off(drawn.latency, l.latency) ? l.latency : drawn.latency }, step, false);
      added.updated.push(`${label(from)} → ${label(to)}: ${[l.qps !== undefined && `${l.qps} req/s`, l.latency !== undefined && `${l.latency} ms`].filter(Boolean).join(', ')}`);
    }
  }
  for (const f of flows) {
    const path = f.path.map((k) => ids.get(k)!);
    // A hop the traces imply but no line carries (a consumer reached without a producer span) would break the flow; leave it out.
    if (d.flows.some((x) => x.title === f.title) || !path.every((p, i) => i === 0 || m.hopConnection(d, path[i - 1], p))) continue;
    m.addFlow(d, { title: f.title, path, ...at });
    added.flows.push(f.title);
  }
  // Traces are a sample: a service missing from them has not necessarily gone.
  if (sync && format !== 'otel') {
    // Only parts this format put there: a hand-drawn part, or one from another file type, is not the infrastructure's to remove.
    const keys = new Set(parts.map((p) => `${format}:${p.key}`));
    for (const c of d.components.filter((x) => x.source?.startsWith(`${format}:`) && !keys.has(x.source))) {
      added.removed.push(c.label);
      if (step) m.removeTracked(d, c.id, step);
      else m.removeItem(d, c.id);
    }
  }
  return added;
}

/** What `text` has that design `d` lacks, and the imported parts it no longer has, without changing `d`. */
export function infraDrift(d: Design, text: string, guess?: (words: string) => ComponentType | undefined) {
  const added = importInfra(structuredClone(d), text, { sync: true, guess });
  return { ...added, drifted: Object.values(added).some((x) => x.length > 0) };
}

/** Brings `d` in line with `text` as one new, unseen step for review. Returns the step id, or undefined when nothing differs. */
export function syncInfra(d: Design, text: string, title: string, guess?: (words: string) => ComponentType | undefined) {
  const drift = infraDrift(d, text, guess);
  if (!drift.drifted) return undefined;
  const found = [...drift.components, ...drift.connections, ...drift.boundaries];
  const summary = [
    found.length && `Found in the infrastructure but not in the design: ${found.join(', ')}.`,
    drift.removed.length && `No longer in the infrastructure: ${drift.removed.join(', ')}.`,
    drift.updated.length && `Measured load and latency: ${drift.updated.join('; ')}.`,
    drift.flows.length && `Flows seen in traces: ${drift.flows.join(', ')}.`,
  ]
    .filter(Boolean)
    .join(' ');
  const step = m.addStep(d, { title, summary });
  importInfra(d, text, { step, sync: true, guess });
  return step;
}
