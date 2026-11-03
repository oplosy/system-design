import type { ComponentType } from './schema.ts';
import type { Doc, Group, Link, Part } from './infra.ts';

// Reads what cloud tools say is deployed: Terraform state or plan JSON, a CloudFormation or CDK template, a Pulumi stack export.
// Each draws its resources as parts, the wiring between them as lines, and modules or stacks as boundaries.

const obj = (x: unknown): Doc => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Doc) : {});
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown) => (typeof x === 'string' && x ? x : undefined);

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
  aws_ec2_transit_gateway: ['transit-gateway', 'Transit Gateway'],
  aws_vpc_endpoint: ['private-link', 'VPC Endpoint'],
  aws_glue_registry: ['schema-registry', 'Glue Schema Registry'],
  aws_autoscaling_group: ['autoscaler', 'Auto Scaling'],
  aws_verifiedpermissions_policy_store: ['policy-engine', 'Verified Permissions'],
  aws_inspector2_enabler: ['vulnerability-scanner', 'Inspector'],
  aws_glue_catalog_database: ['data-catalog', 'Glue Data Catalog'],
  aws_bedrock_guardrail: ['llm-gateway', 'Bedrock Guardrails'],
  aws_bedrockagentcore_gateway: ['mcp-server', 'AgentCore Gateway'],
  betteruptime_status_page: ['status-page', 'Better Stack'],
  statuspage_component_group: ['status-page', 'Statuspage'],
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
  google_compute_service_attachment: ['private-link', 'Private Service Connect'],
  google_data_catalog_entry_group: ['data-catalog', 'Data Catalog'],
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
  azurerm_private_endpoint: ['private-link', 'Private Endpoint'],
  azurerm_virtual_wan: ['transit-gateway', 'Virtual WAN'],
  azurerm_purview_account: ['data-catalog', 'Purview'],
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
const TF_FRONT: Partial<Record<ComponentType, number>> = { cdn: 0, 'api-gateway': 1, 'load-balancer': 2, 'event-bus': 3, pubsub: 4, stream: 5, queue: 6, 'dead-letter-queue': 6 };

/** "module.api.aws_lb.main[0]" → "module.api.aws_lb.main": instances of one resource share its links. */
const base = (address: string) => address.replace(/\[[^\]]*\]/g, '');

/**
 * Reads `terraform show -json` output, of state or of a saved plan. Lines come from depends_on and, in a plan,
 * from the references in each resource's configuration, followed through resources that are not drawn.
 */
export function terraform(file: Doc) {
  const resources: Doc[] = [];
  const walk = (mod: Doc) => {
    resources.push(...list(mod.resources).map(obj).filter((r) => r.mode !== 'data'));
    for (const c of list(mod.child_modules)) walk(obj(c));
  };
  walk(obj(obj(file.values ?? file.planned_values).root_module));
  const module = (r: Doc) => base(String(r.address ?? '')).match(/^(.*?)\.?[^.]+\.[^.]+$/)?.[1] ?? '';
  const parts: Part[] = [];
  const skipped = new Map<string, number>();
  // A queue is a dead-letter queue when another queue's redrive policy names it, or its name says so.
  const deadLetterArns = new Set(resources.map((r) => { try { return JSON.parse(String(obj(r.values).redrive_policy)).deadLetterTargetArn; } catch { return undefined; } }).filter(Boolean));
  for (const r of resources) {
    let t = TF_TYPES[r.type];
    if (!t) {
      skipped.set(r.type, (skipped.get(r.type) ?? 0) + 1);
      continue;
    }
    const v = obj(r.values);
    if (t[0] === 'queue' && (deadLetterArns.has(v.arn) || /dlq|dead[-_ ]?letter/i.test(String(v.name ?? r.name)))) t = ['dead-letter-queue', t[1]];
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
export const CFN_TAGS = ['Ref', 'Condition', ...['GetAtt', 'Sub', 'Join', 'Select', 'Split', 'If', 'Equals', 'Not', 'And', 'Or', 'FindInMap', 'Base64', 'Cidr', 'GetAZs', 'ImportValue'].map((f) => `Fn::${f}`)].flatMap(
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
  'AWS::EC2::TransitGateway': 'aws_ec2_transit_gateway',
  'AWS::AutoScaling::AutoScalingGroup': 'aws_autoscaling_group',
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
export function cloudformation(file: Doc) {
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
const PULUMI_PROVIDERS: Record<string, string> = { gcp: 'google', azure: 'azurerm', 'azure-native': 'azurerm' };
const PULUMI_MODULES: Record<string, string> = { apigateway: 'api_gateway', cloudrun: 'cloud_run', cloudrunv2: 'cloud_run_v2' };
const PULUMI_TYPES: Record<string, string> = {
  'aws:rds/instance:Instance': 'aws_db_instance',
  'aws:ec2transitgateway/transitGateway:TransitGateway': 'aws_ec2_transit_gateway',
  // azure-native follows Azure's resource names, not Terraform's.
  'azure-native:containerservice:ManagedCluster': 'azurerm_kubernetes_cluster',
  'azure-native:web:WebApp': 'azurerm_linux_web_app',
  'azure-native:sql:Server': 'azurerm_mssql_server',
  'azure-native:dbforpostgresql:Server': 'azurerm_postgresql_flexible_server',
  'azure-native:dbforpostgresql:FlexibleServer': 'azurerm_postgresql_flexible_server',
  'azure-native:dbformysql:Server': 'azurerm_mysql_flexible_server',
  'azure-native:dbformysql:FlexibleServer': 'azurerm_mysql_flexible_server',
  'azure-native:documentdb:DatabaseAccount': 'azurerm_cosmosdb_account',
  'azure-native:cache:Redis': 'azurerm_redis_cache',
  'azure-native:eventhub:EventHub': 'azurerm_eventhub',
  'azure-native:network:LoadBalancer': 'azurerm_lb',
  'azure-native:apimanagement:ApiManagementService': 'azurerm_api_management',
  'azure-native:keyvault:Vault': 'azurerm_key_vault',
  'azure-native:containerregistry:Registry': 'azurerm_container_registry',
  'azure-native:compute:VirtualMachine': 'azurerm_linux_virtual_machine',
  'azure-native:network:DnsZone': 'azurerm_dns_zone',
  'azure-native:cdn:Profile': 'azurerm_cdn_frontdoor_profile',
};

/**
 * Reads `pulumi stack export` output through the Terraform reader: Pulumi's AWS, Google Cloud and Azure (classic)
 * providers are bridged from Terraform's, so "aws:lambda/function:Function" is aws_lambda_function, and each
 * resource's dependencies become depends_on. Component resources (awsx, your own) become boundaries around what they hold.
 */
export function pulumi(file: Doc) {
  const all = list(obj(file.deployment).resources).map(obj).filter((r) => str(r.urn) && !String(r.type).startsWith('pulumi:'));
  const resources = all.filter((r) => r.custom);
  const components = new Map(all.filter((r) => !r.custom).map((r) => [String(r.urn), r]));
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
  const safe = (s: string) => s.replace(/[^\w-]/g, '_');
  // The innermost component a resource sits in, by its parent chain; it becomes a Terraform module, so a boundary.
  const byUrn = new Map(all.map((r) => [String(r.urn), r]));
  const component = (r: Doc) => {
    for (let p = byUrn.get(String(r.parent)), n = 0; p && n < 50; p = byUrn.get(String(p.parent)), n++) if (components.has(String(p.urn))) return p;
    return undefined;
  };
  const names = new Map<string, string>();
  const path = (c: Doc | undefined, n = 0): string => {
    if (!c || n > 50) return '';
    const at = `${path(component(c), n + 1)}module.${safe(name(c))}`;
    names.set(at, name(c));
    return `${at}.`;
  };
  const address = new Map<string, string>();
  const taken = new Set<string>();
  for (const r of resources) {
    // Pulumi names need only be unique per type and parent type, so two "bucket"s can share one address; number the rest.
    const at = `${path(component(r))}${tfType(String(r.type))}.${safe(name(r))}`;
    let unique = at;
    for (let i = 2; taken.has(unique); i++) unique = `${at}_${i}`;
    taken.add(unique);
    address.set(String(r.urn), unique);
  }
  const tf = terraform({
    values: {
      root_module: {
        resources: resources.map((r) => ({
          address: address.get(r.urn),
          type: base(address.get(r.urn)!).split('.').at(-2),
          name: name(r),
          values: { name: name(r), engine: obj(r.outputs).engine ?? obj(r.inputs).engine },
          depends_on: list(r.dependencies).map((u) => address.get(String(u))).filter(Boolean),
        })),
      },
    },
  });
  // Components become boxes named after them, nested as they are; resources outside any stay unboxed.
  const key = (k: string) => k.replace(/^module\./, '').replace(/\.module\./g, '/');
  const groups: Group[] = [];
  const add = (k: string) => {
    if (k === 'root' || groups.some((g) => g.key === key(k))) return;
    const parent = k.replace(/\.?module\.[^.]+$/, '');
    if (parent) add(parent);
    groups.push({ key: key(k), label: names.get(k) ?? k, kind: 'group', parent: parent ? key(parent) : undefined });
  };
  for (const g of tf.groups) add(g.key);
  const parts = tf.parts.map((p) => ({ ...p, group: p.group && p.group !== 'root' ? key(p.group) : undefined }));
  return { ...tf, parts, groups, skipped: tf.skipped.map((s) => s.replace(/^\S+/, (t) => types.get(t) ?? t)) };
}
