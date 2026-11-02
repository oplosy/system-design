import type { ComponentType } from '../../core/schema.ts';
import { NOTE_COLOR, type Spec, gen, roundRect, cylinder, line, box, glyph, cloud, waves } from './base.ts';

/** Parts of a system architecture, in palette order within each group. */
export const system = {
  // Clients / users
  user: {
    name: 'User',
    group: 'client',
    keywords: 'actor person customer human end user admin employee',
    kits: ['system', 'network', 'software'],
    w: 80,
    h: 88,
    labelY: 80,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.circle(c, 12, 18, o), gen.line(c, 21, c, 46, l), gen.line(c - 15, 30, c + 15, 30, l), gen.linearPath([[c - 12, 64], [c, 46], [c + 12, 64]], l)];
    },
  },
  client: {
    name: 'Client',
    group: 'client',
    keywords: 'web browser desktop frontend spa react app',
    kits: ['system', 'software'],
    w: 140,
    h: 72,
    labelY: 30,
    draw: (o, w, h) => [gen.rectangle(4, 4, w - 8, h - 22, o), gen.line(w / 2, h - 18, w / 2, h - 7, line(o)), gen.line(w / 2 - 24, h - 6, w / 2 + 24, h - 6, line(o))],
  },
  mobile: {
    name: 'Mobile app',
    group: 'client',
    keywords: 'ios android phone smartphone tablet app react native flutter',
    kits: ['system', 'network', 'software'],
    w: 100,
    h: 92,
    labelY: 82,
    draw: (o, w) => [gen.path(roundRect(w / 2 - 20, 2, 40, 64, 7), o), gen.line(w / 2 - 5, 8, w / 2 + 5, 8, line(o)), gen.line(w / 2 - 6, 58, w / 2 + 6, 58, line(o))],
  },
  iot: {
    name: 'IoT device',
    group: 'client',
    keywords: 'sensor device embedded hardware mqtt edge smart device',
    kits: ['system', 'network'],
    w: 100,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const pins = [0, 1, 2].flatMap((i) => {
        const x = c - 12 + 12 * i, y = 16 + 12 * i;
        return [gen.line(x, 2, x, 8, l), gen.line(x, 48, x, 54, l), gen.line(c - 26, y, c - 20, y, l), gen.line(c + 20, y, c + 26, y, l)];
      });
      return [gen.rectangle(c - 20, 8, 40, 40, o), gen.rectangle(c - 8, 20, 16, 16, l), ...pins];
    },
  },

  // Edge / security
  dns: {
    name: 'DNS',
    group: 'edge',
    keywords: 'route 53 cloudflare domain name resolver bind dns server',
    kits: ['system', 'network'],
    w: 110,
    h: 86,
    labelY: 76,
    draw: (o, w) => [gen.circle(w / 2, 30, 54, o), gen.ellipse(w / 2, 30, 22, 54, line(o)), gen.line(w / 2 - 27, 30, w / 2 + 27, 30, line(o))],
  },
  cdn: {
    name: 'CDN',
    group: 'edge',
    keywords: 'cloudfront cloudflare akamai fastly edge cache static assets',
    w: 150,
    h: 76,
    labelY: 52,
    draw: (o, w, h) => [cloud(o, w, h)],
  },
  waf: {
    name: 'WAF',
    group: 'edge',
    keywords: 'web application firewall ddos bot protection shield cloudflare',
    w: 100,
    h: 84,
    labelY: 42,
    draw: (o, w, h) => [gen.path(`M${w / 2} 2 L${w - 8} 14 L${w - 8} 38 Q${w - 8} ${h - 20} ${w / 2} ${h - 2} Q8 ${h - 20} 8 38 L8 14 Z`, o)],
  },
  firewall: {
    name: 'Firewall',
    group: 'edge',
    keywords: 'security group network acl nacl iptables perimeter fortinet fortigate palo alto pfsense utm ngfw',
    kits: ['system', 'network'],
    w: 130,
    h: 72,
    labelY: 62,
    draw: (o, w) => {
      const l = line(o), bw = w - 8, rh = 40 / 3;
      const rows = [1, 2].map((r) => gen.line(4, 4 + rh * r, w - 4, 4 + rh * r, l));
      const joints = [0, 1, 2].flatMap((r) =>
        (r === 1 ? [0.5, 1.5, 2.5, 3.5] : [1, 2, 3]).map((k) => gen.line(4 + (bw * k) / 4, 4 + rh * r, 4 + (bw * k) / 4, 4 + rh * (r + 1), l)),
      );
      return [gen.rectangle(4, 4, bw, 40, o), ...rows, ...joints];
    },
  },
  identity: {
    name: 'Identity',
    group: 'edge',
    keywords: 'auth oauth oidc sso login identity provider idp jwt cognito auth0 keycloak okta session active directory ad ldap domain controller radius',
    kits: ['system', 'network'],
    w: 160,
    h: 56,
    labelX: 90,
    labelY: 28,
    draw: (o, w, h) => [box(o, w, h), ...glyph.key(o, 24, h / 2)],
  },
  secrets: {
    name: 'Secrets',
    group: 'edge',
    keywords: 'vault kms secret manager key encryption certificate tls hsm',
    w: 100,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.path(`M${c - 14} 30 V18 A14 14 0 0 1 ${c + 14} 18 V30`, l), gen.rectangle(c - 22, 28, 44, 34, o), gen.circle(c, 41, 8, l), gen.line(c, 45, c, 53, l)];
    },
  },
  'rate-limiter': {
    name: 'Rate limiter',
    group: 'edge',
    keywords: 'throttle throttling quota token bucket leaky bucket',
    w: 100,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.polygon([[c - 22, 4], [c + 22, 4], [c + 3, 32], [c + 22, 60], [c - 22, 60], [c - 3, 32]], o), gen.line(c - 26, 3, c + 26, 3, l), gen.line(c - 26, 61, c + 26, 61, l)];
    },
  },

  ids: {
    name: 'Intrusion detection',
    group: 'edge',
    keywords: 'intrusion detection prevention snort suricata siem security monitoring ids ips',
    kits: ['system', 'network'],
    w: 140,
    h: 56,
    labelX: 80,
    labelY: 28,
    draw: (o, w, h) => [gen.path(roundRect(3, 3, w - 6, h - 6, 4), o), ...glyph.eye(o, 24, h / 2)],
  },


  // Network
  'load-balancer': {
    name: 'Load balancer',
    group: 'network',
    keywords: 'lb alb nlb elb haproxy round robin l4 l7 f5 adc',
    kits: ['system', 'network'],
    w: 130,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.circle(c, 30, 56, o), gen.line(c - 16, 30, c + 2, 30, l), gen.line(c + 2, 30, c + 16, 17, l), gen.line(c + 2, 30, c + 17, 30, l), gen.line(c + 2, 30, c + 16, 43, l)];
    },
  },
  'api-gateway': {
    name: 'API gateway',
    group: 'network',
    keywords: 'kong apigee aws api gateway routing bff graphql gateway',
    w: 164,
    h: 56,
    labelY: 28,
    draw: (o, w, h) => [gen.polygon([[3, h / 2], [20, 3], [w - 20, 3], [w - 3, h / 2], [w - 20, h - 3], [20, h - 3]], o)],
  },
  'reverse-proxy': {
    name: 'Reverse proxy',
    group: 'network',
    keywords: 'nginx envoy haproxy traefik caddy proxy ingress controller',
    w: 160,
    h: 56,
    labelY: 28,
    draw: (o, w, h) => [gen.polygon([[20, 3], [w - 3, 3], [w - 20, h - 3], [3, h - 3]], o)],
  },
  'service-mesh': {
    name: 'Service mesh',
    group: 'network',
    keywords: 'istio linkerd sidecar envoy consul connect mtls',
    w: 110,
    h: 90,
    labelY: 80,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const corners: [number, number][] = [[c - 26, 10], [c + 26, 10], [c + 26, 58], [c - 26, 58]];
      const edges = corners.flatMap(([x, y], i) => {
        const [nx, ny] = corners[(i + 1) % 4];
        return [gen.line(x, y, nx, ny, l), gen.line(x, y, c, 34, l)];
      });
      return [...edges, ...corners.map(([x, y]) => gen.circle(x, y, 14, o)), gen.circle(c, 34, 16, o)];
    },
  },
  realtime: {
    name: 'Realtime gateway',
    group: 'network',
    keywords: 'websocket socket.io sse server sent events long polling push pusher ably',
    w: 170,
    h: 56,
    labelX: 96,
    labelY: 28,
    draw: (o, w, h) => [box(o, w, h), ...glyph.arrows(o, 24, h / 2)],
  },
  vpn: {
    name: 'VPN',
    group: 'network',
    keywords: 'vpn bastion private link peering tunnel wireguard ipsec vpc site to site openvpn concentrator',
    kits: ['system', 'network'],
    w: 170,
    h: 72,
    labelY: 62,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.rectangle(14, 4, w - 28, 40, o),
        gen.ellipse(14, 24, 16, 40, o),
        gen.ellipse(w - 14, 24, 16, 40, o),
        gen.rectangle(c - 7, 22, 14, 11, l),
        gen.path(`M${c - 4} 22 V18 A4 4 0 0 1 ${c + 4} 18 V22`, l),
      ];
    },
  },

  // Compute
  service: {
    name: 'Service',
    group: 'compute',
    keywords: 'microservice backend api server app monolith rest grpc',
    kits: ['system', 'software'],
    w: 150,
    h: 56,
    labelY: 28,
    draw: (o, w, h) => [box(o, w, h)],
  },
  worker: {
    name: 'Worker',
    group: 'compute',
    keywords: 'background job consumer async processor sidekiq celery',
    w: 156,
    h: 64,
    labelX: 72,
    labelY: 37,
    draw: (o, w, h) => [gen.path(roundRect(12, 3, w - 15, h - 14, 12), o), gen.path(roundRect(3, 11, w - 15, h - 14, 12), o)],
  },
  function: {
    name: 'Serverless function',
    group: 'compute',
    keywords: 'lambda faas cloud functions edge functions cloudflare workers vercel',
    w: 180,
    h: 56,
    labelX: 100,
    labelY: 28,
    draw: (o, w, h) => [box(o, w, h), ...glyph.lambda(o, 24, h / 2)],
  },
  container: {
    name: 'Container',
    group: 'compute',
    keywords: 'docker pod oci ecs fargate cloud run image',
    w: 140,
    h: 70,
    labelY: 60,
    draw: (o, w) => {
      const l = line(o), ribs = Math.floor((w - 8) / 11);
      return [gen.rectangle(4, 4, w - 8, 36, o), ...Array.from({ length: ribs - 1 }, (_, k) => gen.line(4 + 11 * (k + 1), 9, 4 + 11 * (k + 1), 35, l))];
    },
  },
  kubernetes: {
    name: 'Kubernetes cluster',
    group: 'compute',
    keywords: 'k8s eks gke aks cluster orchestration pods nodes helm',
    w: 150,
    h: 100,
    labelY: 50,
    draw: (o, w, h) => {
      const pts = Array.from({ length: 7 }, (_, k): [number, number] => {
        const a = -Math.PI / 2 + (k * 2 * Math.PI) / 7;
        return [w / 2 + 72 * Math.cos(a), h / 2 + 2 + 48 * Math.sin(a)];
      });
      return [gen.polygon(pts, o)];
    },
  },
  vm: {
    name: 'Virtual machine',
    group: 'compute',
    keywords: 'ec2 vm virtual machine host bare metal instance compute engine droplet server dhcp file server mail server hypervisor esxi',
    kits: ['system', 'network'],
    w: 110,
    h: 92,
    labelY: 82,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [0, 30].flatMap((y) => [gen.rectangle(c - 34, 4 + y, 68, 26, o), gen.line(c - 26, 17 + y, c + 8, 17 + y, l), gen.circle(c + 22, 17 + y, 6, l)]);
    },
  },
  cron: {
    name: 'Scheduler',
    group: 'compute',
    keywords: 'cron scheduled job timer periodic quartz eventbridge scheduler',
    w: 110,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = { ...line(o), strokeWidth: 2 };
      return [gen.circle(c, 30, 56, o), gen.line(c, 30, c, 11, l), gen.line(c, 30, c + 13, 37, l)];
    },
  },
  workflow: {
    name: 'Workflow engine',
    group: 'compute',
    keywords: 'temporal step functions airflow orchestrator saga cadence conductor state machine',
    w: 170,
    h: 84,
    labelY: 42,
    draw: (o, w, h) => [gen.polygon([[w / 2, 3], [w - 3, h / 2], [w / 2, h - 3], [3, h / 2]], o)],
  },

  // Data
  'sql-db': { name: 'SQL DB', group: 'data', kits: ['system', 'software'], keywords: 'postgres postgresql mysql aurora rds sql server oracle relational replica', w: 130, h: 76, labelY: 46, draw: cylinder },
  'nosql-db': {
    name: 'NoSQL DB',
    group: 'data',
    keywords: 'mongodb cassandra dynamodb scylla couchbase firestore document wide column',
    w: 130,
    h: 80,
    labelY: 54,
    draw: (o, w, h) => [...cylinder(o, w, h), gen.path(`M4 22 A${w / 2 - 4} 8 0 0 0 ${w - 4} 22`, line(o)), gen.path(`M4 33 A${w / 2 - 4} 8 0 0 0 ${w - 4} 33`, line(o))],
  },
  'key-value': {
    name: 'Key-value store',
    group: 'data',
    keywords: 'redis dynamodb etcd riak foundationdb kv',
    w: 150,
    h: 76,
    labelX: 86,
    labelY: 46,
    draw: (o, w, h) => [...cylinder(o, w, h), ...glyph.key(o, 26, 46)],
  },
  cache: {
    name: 'Cache',
    group: 'data',
    keywords: 'redis memcached in-memory valkey elasticache',
    kits: ['system', 'software'],
    w: 130,
    h: 76,
    labelX: 74,
    labelY: 46,
    draw: (o, w, h) => [...cylinder(o, w, h), gen.linearPath([[26, 26], [17, 44], [28, 44], [19, 62]], { ...line(o), stroke: NOTE_COLOR, strokeWidth: 2 })],
  },
  'graph-db': {
    name: 'Graph DB',
    group: 'data',
    keywords: 'neo4j neptune dgraph graph relationships social graph',
    w: 110,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const n: [number, number][] = [[c, 10], [c - 28, 52], [c + 28, 52]];
      return [gen.line(...n[0], ...n[1], l), gen.line(...n[1], ...n[2], l), gen.line(...n[2], ...n[0], l), ...n.map(([x, y]) => gen.circle(x, y, 18, o))];
    },
  },
  'time-series': {
    name: 'Time-series DB',
    group: 'data',
    keywords: 'influxdb timescaledb prometheus tsdb metrics questdb',
    w: 130,
    h: 92,
    labelY: 82,
    draw: (o, w) => [...cylinder(o, w, 66), gen.linearPath([[16, 50], [32, 38], [46, 48], [62, 32], [78, 44], [94, 30], [112, 40]], line(o))],
  },
  'vector-db': {
    name: 'Vector DB',
    group: 'data',
    keywords: 'pinecone pgvector weaviate milvus qdrant chroma embeddings similarity ann rag',
    w: 130,
    h: 92,
    labelY: 82,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [...cylinder(o, w, 66), gen.line(c - 20, 54, c + 16, 30, l), gen.line(c - 20, 54, c + 26, 46, l), gen.line(c - 20, 54, c - 4, 28, l)];
    },
  },
  search: {
    name: 'Search',
    group: 'data',
    keywords: 'elasticsearch opensearch solr algolia meilisearch typesense full text index',
    w: 120,
    h: 88,
    labelY: 78,
    draw: (o, w) => [gen.circle(w / 2 - 6, 28, 46, o), gen.line(w / 2 + 11, 45, w / 2 + 26, 60, { ...line(o), strokeWidth: 3 })],
  },
  'object-storage': {
    name: 'Object storage',
    group: 'data',
    keywords: 's3 gcs blob azure blob r2 minio bucket files media',
    w: 120,
    h: 80,
    labelY: 48,
    draw: (o, w, h) => [gen.path(`M4 12 L16 ${h - 10} Q${w / 2} ${h + 2} ${w - 16} ${h - 10} L${w - 4} 12`, o), gen.ellipse(w / 2, 12, w - 8, 18, o)],
  },
  'file-storage': {
    name: 'File storage',
    group: 'data',
    keywords: 'nfs efs ebs disk volume block filesystem shared drive',
    w: 160,
    h: 72,
    labelY: 42,
    draw: (o, w, h) => [gen.path(`M4 ${h - 4} V12 Q4 6 10 6 H44 L52 16 H${w - 4} V${h - 4} Z`, o)],
  },
  warehouse: {
    name: 'Data warehouse',
    group: 'data',
    keywords: 'snowflake bigquery redshift clickhouse olap analytics bi',
    w: 170,
    h: 80,
    labelY: 52,
    draw: (o, w, h) => [gen.polygon([[4, 26], [w / 2, 4], [w - 4, 26], [w - 4, h - 4], [4, h - 4]], o)],
  },
  'data-lake': {
    name: 'Data lake',
    group: 'data',
    keywords: 's3 hdfs delta lake iceberg hudi parquet raw lakehouse',
    w: 170,
    h: 74,
    labelY: 64,
    draw: (o, w) => {
      const l = line(o);
      return [gen.ellipse(w / 2, 24, w - 8, 44, o), gen.path(waves(30, 18, 6, 18), l), gen.path(waves(42, 30, 5, 18), l)];
    },
  },

  // Messaging / events
  queue: {
    name: 'Queue',
    group: 'messaging',
    keywords: 'sqs rabbitmq activemq message queue amqp job queue bullmq',
    kits: ['system', 'software'],
    w: 170,
    h: 72,
    labelY: 62,
    draw: (o, w) => {
      const x = 4, pw = w - 22, l = line(o);
      return [gen.rectangle(x, 4, pw, 40, o), gen.ellipse(x + pw, 24, 16, 40, o), ...[1, 2, 3].map((i) => gen.line(x + (i * pw) / 4, 4, x + (i * pw) / 4, 44, l))];
    },
  },
  pubsub: {
    name: 'Pub/Sub topic',
    group: 'messaging',
    keywords: 'sns google pub/sub topic fanout broadcast nats redis pubsub subscribe',
    w: 110,
    h: 86,
    labelY: 76,
    draw: (o) => {
      const cx = 30, cy = 32, l = line(o);
      const arc = (r: number) => gen.path(`M${cx + r * 0.707} ${cy - r * 0.707} A${r} ${r} 0 0 1 ${cx + r * 0.707} ${cy + r * 0.707}`, l);
      return [gen.circle(cx, cy, 22, o), arc(22), arc(34), arc(46)];
    },
  },
  stream: {
    name: 'Event stream',
    group: 'messaging',
    keywords: 'kafka kinesis pulsar redpanda event log stream partition topic append only',
    w: 190,
    h: 70,
    labelY: 60,
    draw: (o, w) => {
      const l = line(o);
      return [...Array.from({ length: 6 }, (_, i) => gen.rectangle(4 + 24 * i, 6, 24, 34, o)), gen.line(152, 23, w - 6, 23, l), gen.linearPath([[w - 12, 17], [w - 6, 23], [w - 12, 29]], l)];
    },
  },
  'event-bus': {
    name: 'Event bus',
    group: 'messaging',
    keywords: 'eventbridge event bus broker mediator event driven',
    kits: ['system', 'software'],
    w: 190,
    h: 72,
    labelY: 62,
    draw: (o, w) => {
      const l = line(o);
      return [gen.path(roundRect(3, 6, w - 6, 16, 8), o), ...[0.25, 0.5, 0.75].flatMap((f) => [gen.line(w * f, 22, w * f, 38, l), gen.circle(w * f, 41, 7, o)])];
    },
  },
  notification: {
    name: 'Push notifications',
    group: 'messaging',
    keywords: 'push apns fcm onesignal notification alert mobile push',
    w: 110,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.path(`M${c - 24} 52 Q${c - 18} 48 ${c - 18} 34 Q${c - 18} 10 ${c} 10 Q${c + 18} 10 ${c + 18} 34 Q${c + 18} 48 ${c + 24} 52 Z`, o),
        gen.circle(c, 57, 9, l),
        gen.line(c, 4, c, 10, l),
      ];
    },
  },
  email: {
    name: 'Email',
    group: 'messaging',
    keywords: 'smtp ses sendgrid mailgun postmark twilio sms text message',
    w: 110,
    h: 78,
    labelY: 68,
    draw: (o, w) => [gen.rectangle(w / 2 - 34, 6, 68, 44, o), gen.linearPath([[w / 2 - 34, 6], [w / 2, 30], [w / 2 + 34, 6]], line(o))],
  },

  // Observability / ops
  monitoring: {
    name: 'Monitoring',
    group: 'ops',
    keywords: 'prometheus grafana datadog cloudwatch new relic metrics dashboard monitoring slo nms snmp zabbix nagios prtg',
    kits: ['system', 'network'],
    w: 140,
    h: 80,
    labelY: 70,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.path(`M${c - 42} 52 A42 42 0 0 1 ${c + 42} 52 Z`, o), gen.line(c, 52, c + 20, 24, { ...line(o), strokeWidth: 2 })];
    },
  },
  logging: {
    name: 'Logging',
    group: 'ops',
    keywords: 'elk elasticsearch loki splunk logs logstash fluentd fluent bit cloudwatch logs',
    w: 100,
    h: 92,
    labelY: 82,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.path(`M${c - 24} 4 H${c + 12} L${c + 24} 16 V66 H${c - 24} Z`, o),
        gen.linearPath([[c + 12, 4], [c + 12, 16], [c + 24, 16]], l),
        ...[28, 38, 48].map((y) => gen.line(c - 15, y, c + 15, y, l)),
        gen.line(c - 15, 58, c + 4, 58, l),
      ];
    },
  },
  tracing: {
    name: 'Tracing',
    group: 'ops',
    keywords: 'jaeger zipkin opentelemetry otel tempo apm spans distributed tracing',
    w: 140,
    h: 72,
    labelY: 62,
    draw: (o) => [gen.rectangle(6, 4, 70, 11, o), gen.rectangle(30, 19, 60, 11, o), gen.rectangle(52, 34, 80, 11, o)],
  },
  alerting: {
    name: 'Alerting',
    group: 'ops',
    keywords: 'pagerduty opsgenie alertmanager alerts incident on call on-call',
    w: 130,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = { ...line(o), strokeWidth: 2.4 };
      return [gen.polygon([[c, 4], [c + 36, 62], [c - 36, 62]], o), gen.line(c, 24, c, 44, l), gen.line(c, 51, c, 54, l)];
    },
  },
  'ci-cd': {
    name: 'CI/CD pipeline',
    group: 'ops',
    keywords: 'github actions jenkins gitlab ci argo cd circleci deploy pipeline build release',
    w: 170,
    h: 68,
    labelY: 58,
    draw: (o) =>
      [0, 1, 2].map((i) => {
        const x = 4 + i * 52;
        return gen.polygon([[x, 4], [x + 40, 4], [x + 54, 24], [x + 40, 44], [x, 44], [x + 14, 24]], o);
      }),
  },
  registry: {
    name: 'Service registry',
    group: 'ops',
    keywords: 'consul etcd zookeeper eureka service discovery config configuration parameter store',
    w: 200,
    h: 56,
    labelX: 110,
    labelY: 28,
    draw: (o, w, h) => [box(o, w, h), ...glyph.list(o, 26, h / 2)],
  },
  'feature-flags': {
    name: 'Feature flags',
    group: 'ops',
    keywords: 'launchdarkly unleash growthbook toggles experiments a/b testing rollout',
    w: 110,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.line(c - 20, 4, c - 20, 64, { ...line(o), strokeWidth: 2 }), gen.path(`M${c - 20} 6 H${c + 24} L${c + 14} 20 L${c + 24} 34 H${c - 20} Z`, o)];
    },
  },

  // Analytics / AI
  'stream-processor': {
    name: 'Stream processor',
    group: 'analytics',
    keywords: 'flink spark streaming kafka streams beam dataflow ksqldb real time processing',
    w: 180,
    h: 56,
    labelX: 100,
    labelY: 28,
    draw: (o, w, h) => [box(o, w, h), ...glyph.gear(o, 26, h / 2)],
  },
  batch: {
    name: 'Batch processing',
    group: 'analytics',
    keywords: 'spark hadoop mapreduce emr dataproc databricks batch jobs',
    w: 170,
    h: 64,
    labelX: 79,
    labelY: 40,
    draw: (o, w, h) => [16, 10, 4].map((d) => gen.rectangle(d, 20 - d, w - 20, h - 20, o)),
  },
  etl: {
    name: 'ETL pipeline',
    group: 'analytics',
    keywords: 'etl elt airbyte fivetran dbt ingestion pipeline cdc debezium',
    w: 110,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.polygon([[c - 36, 4], [c + 36, 4], [c + 8, 34], [c + 8, 60], [c - 8, 60], [c - 8, 34]], o)];
    },
  },
  'ml-model': {
    name: 'ML model',
    group: 'analytics',
    keywords: 'inference sagemaker vertex model serving tensorflow pytorch recommendation ranking feed ranking classifier',
    w: 120,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const layers: [number, number][][] = [
        [[c - 34, 16], [c - 34, 44]],
        [[c, 8], [c, 30], [c, 52]],
        [[c + 34, 30]],
      ];
      const links = layers.slice(1).flatMap((to, i) => to.flatMap((b) => layers[i].map((a) => gen.line(...a, ...b, l))));
      return [...links, ...layers.flat().map(([x, y]) => gen.circle(x, y, 13, o))];
    },
  },
  llm: {
    name: 'LLM',
    group: 'analytics',
    keywords: 'ai agent openai anthropic claude gpt gemini llama chat completion rag genai',
    w: 140,
    h: 70,
    labelX: 78,
    labelY: 28,
    draw: (o, w) => [
      gen.path(`M17 3 H${w - 17} Q${w - 3} 3 ${w - 3} 17 V39 Q${w - 3} 53 ${w - 17} 53 H44 L26 66 L30 53 H17 Q3 53 3 39 V17 Q3 3 17 3 Z`, o),
      ...glyph.sparkle(o, 26, 28),
    ],
  },

  // Third party
  external: {
    name: 'External API',
    group: 'external',
    keywords: 'third party saas partner webhook vendor integration',
    kits: ['system', 'software'],
    w: 150,
    h: 56,
    labelY: 28,
    dashed: true,
    draw: (o, w, h) => [box(o, w, h)],
  },
  payment: {
    name: 'Payment provider',
    group: 'external',
    keywords: 'stripe paypal adyen braintree billing checkout card subscription',
    w: 160,
    h: 78,
    labelY: 50,
    dashed: true,
    draw: (o, w, h) => [gen.path(roundRect(3, 3, w - 6, h - 6, 8), o), gen.line(3, 18, w - 3, 18, { ...line(o), strokeWidth: 6 })],
  },
} satisfies Partial<Record<ComponentType, Spec>>;
