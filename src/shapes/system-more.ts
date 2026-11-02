import type { ComponentType } from '../../core/schema.ts';
import { type Spec, gen, roundRect, cylinder, line, box, glyph, tiled, cloud, arrow } from './base.ts';

/** Parts added after the first release. guessType ranks them last (see FALLBACK in shapes.ts). */
export const systemMore = {
  // Clients / users
  'desktop-app': {
    name: 'Desktop app',
    group: 'client',
    keywords: 'electron tauri native desktop windows macos linux app wpf qt winforms',
    kits: ['system', 'network'],
    w: 130,
    h: 80,
    labelY: 46,
    draw: (o, w, h) => [gen.rectangle(4, 4, w - 8, h - 8, o), gen.line(4, 18, w - 4, 18, line(o)), ...[0, 1, 2].map((i) => gen.circle(14 + i * 9, 11, 4, line(o)))],
  },
  console: {
    name: 'Console',
    group: 'client',
    keywords: 'smart tv game console playstation xbox nintendo switch set top box apple tv roku chromecast display digital signage projector screen',
    kits: ['system', 'network'],
    w: 130,
    h: 86,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 44, 4, 88, 52, o), gen.line(c - 12, 56, c - 16, 64, l), gen.line(c + 12, 56, c + 16, 64, l), gen.line(c - 24, 64, c + 24, 64, l)];
    },
  },
  admin: tiled('Admin / back office', 'client', 'admin panel back office backoffice internal tool retool dashboard staff console cms ui', glyph.list, 190),

  // Edge / security
  ddos: {
    name: 'DDoS protection',
    group: 'edge',
    keywords: 'ddos shield aws shield cloudflare magic transit scrubbing anti-ddos akamai prolexic volumetric',
    kits: ['system', 'network', 'security'],
    w: 100,
    h: 90,
    labelY: 80,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.path(`M${c} 2 L${w - 14} 12 L${w - 14} 32 Q${w - 14} 52 ${c} 64 Q14 52 14 32 L14 12 Z`, o), ...glyph.wave(o, c, 32)];
    },
  },
  certificate: {
    name: 'Certificates',
    group: 'edge',
    keywords: 'tls ssl certificate ca pki acm lets encrypt letsencrypt cert-manager mtls x509 signing',
    kits: ['system', 'network', 'security'],
    w: 100,
    h: 90,
    labelY: 80,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.rectangle(c - 28, 4, 56, 44, o),
        gen.line(c - 20, 14, c + 20, 14, l),
        gen.line(c - 20, 22, c + 6, 22, l),
        gen.circle(c + 12, 46, 16, o),
        gen.linearPath([[c + 6, 53], [c + 4, 66], [c + 12, 61], [c + 20, 66], [c + 18, 53]], l),
      ];
    },
  },

  // Network
  'nat-gateway': {
    name: 'NAT gateway',
    group: 'network',
    keywords: 'nat gateway internet gateway igw egress cloud nat snat masquerade outbound',
    kits: ['system', 'network'],
    w: 120,
    h: 86,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.circle(c, 30, 56, o), gen.line(c - 14, 18, c - 14, 42, l), ...arrow(l, c - 14, c + 16, 30)];
    },
  },
  'forward-proxy': {
    name: 'Forward proxy',
    group: 'network',
    keywords: 'squid forward proxy egress proxy web filter zscaler secure web gateway swg content filter outbound proxy',
    kits: ['system', 'network'],
    w: 160,
    h: 56,
    labelY: 28,
    draw: (o, w, h) => [gen.polygon([[3, 3], [w - 20, 3], [w - 3, h - 3], [20, h - 3]], o)],
  },
  'service-discovery': {
    name: 'Service discovery',
    group: 'network',
    keywords: 'consul eureka zookeeper etcd service registry dns-sd discovery nacos',
    w: 110,
    h: 90,
    labelY: 80,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const around: [number, number][] = [[c, 8], [c - 26, 50], [c + 26, 50]];
      return [...around.map(([x, y]) => gen.line(c, 34, x, y, l)), ...around.map(([x, y]) => gen.circle(x, y, 14, o)), gen.circle(c, 34, 20, o)];
    },
  },
  webrtc: tiled('WebRTC / media relay', 'network', 'webrtc turn stun sfu mcu media server janus mediasoup livekit agora voice video call conferencing', glyph.wave, 190),

  // Compute
  bff: tiled('GraphQL / BFF', 'compute', 'graphql apollo hasura bff backend for frontend federation schema stitching resolver', glyph.graph, 170),
  'game-server': tiled('Game server', 'compute', 'dedicated game server multiplayer authoritative tick netcode photon agones gamelift playfab matchmaking lobby relay', glyph.gamepad, 170),
  gpu: {
    name: 'GPU',
    group: 'compute',
    keywords: 'gpu cuda nvidia tpu inference accelerator a100 h100 gpu node triton vllm',
    w: 110,
    h: 88,
    labelY: 80,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const pins = [0, 1, 2, 3].flatMap((i) => {
        const x = c - 15 + i * 10, y = 17 + i * 10;
        return [gen.line(x, 0, x, 6, l), gen.line(x, 58, x, 64, l), gen.line(c - 32, y, c - 26, y, l), gen.line(c + 26, y, c + 32, y, l)];
      });
      return [gen.rectangle(c - 26, 6, 52, 52, o), gen.rectangle(c - 12, 20, 24, 24, l), ...pins];
    },
  },
  media: tiled('Media processing', 'compute', 'transcoding ffmpeg video audio image resize thumbnail encoder mediaconvert mux hls dash streaming vod', glyph.play, 180),
  mainframe: {
    name: 'Mainframe',
    group: 'compute',
    keywords: 'mainframe legacy cobol as400 ibm z erp on-prem monolith system of record',
    w: 110,
    h: 96,
    labelY: 88,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 30, 2, 60, 72, o), ...[0, 1, 2, 3, 4].map((i) => gen.line(c - 22, 12 + i * 10, c + 22, 12 + i * 10, l)), gen.circle(c + 18, 64, 5, l)];
    },
  },

  // Data
  olap: {
    name: 'OLAP',
    group: 'data',
    keywords: 'clickhouse druid pinot olap columnar duckdb starrocks analytics database cube',
    w: 150,
    h: 76,
    labelX: 88,
    labelY: 46,
    draw: (o, w, h) => [...cylinder(o, w, h), ...glyph.bars(o, 28, 44)],
  },
  'block-storage': {
    name: 'Block storage',
    group: 'data',
    keywords: 'ebs disk volume block storage persistent volume pv pvc ssd persistent disk iscsi',
    w: 120,
    h: 78,
    labelY: 70,
    draw: (o, w) =>
      [36, 22, 8].flatMap((y) => [gen.path(`M8 ${y} L8 ${y + 10} A${w / 2 - 8} 7 0 0 0 ${w - 8} ${y + 10} L${w - 8} ${y}`, o), gen.ellipse(w / 2, y, w - 16, 14, o)]),
  },
  'local-db': {
    name: 'On-device storage',
    group: 'data',
    keywords: 'sqlite indexeddb localstorage local storage realm core data room on device embedded database offline keychain',
    w: 110,
    h: 90,
    labelY: 82,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.path(roundRect(c - 24, 2, 48, 70, 8), line(o)), gen.path(`M${c - 14} 26 L${c - 14} 50 A14 5 0 0 0 ${c + 14} 50 L${c + 14} 26`, o), gen.ellipse(c, 26, 28, 10, o)];
    },
  },
  backup: {
    name: 'Backup',
    group: 'data',
    keywords: 'backup snapshot archive glacier cold storage restore disaster recovery dr velero veeam borg restic',
    kits: ['system', 'network'],
    w: 110,
    h: 78,
    labelY: 70,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.rectangle(c - 28, 20, 56, 38, o), gen.rectangle(c - 32, 6, 64, 14, o), gen.path(roundRect(c - 9, 28, 18, 7, 3), line(o))];
    },
  },
  ledger: {
    name: 'Ledger',
    group: 'data',
    keywords: 'blockchain ledger ethereum solana smart contract web3 immutable qldb chain crypto wallet',
    w: 150,
    h: 64,
    labelY: 56,
    draw: (o) => {
      const l = line(o);
      return [gen.line(40, 22, 60, 22, l), gen.line(90, 22, 110, 22, l), ...[10, 60, 110].map((x) => gen.rectangle(x, 7, 30, 30, o))];
    },
  },

  // Messaging / events
  webhook: tiled('Webhook', 'messaging', 'webhook callback http callback event delivery svix hookdeck outgoing webhooks', glyph.link, 150),
  cdc: {
    name: 'Change data capture',
    group: 'messaging',
    keywords: 'cdc debezium change data capture binlog wal outbox replication fivetran dms',
    w: 160,
    h: 72,
    labelY: 64,
    draw: (o, w) => {
      const l = line(o);
      return [
        gen.path('M4 12 L4 40 A25 7 0 0 0 54 40 L54 12', o),
        gen.ellipse(29, 12, 50, 14, o),
        ...arrow(l, 62, 98, 26),
        ...[16, 26, 36].map((y) => gen.line(108, y, w - 4, y, l)),
      ];
    },
  },
  mqtt: tiled('MQTT broker', 'messaging', 'mqtt broker mosquitto emqx hivemq aws iot core azure iot hub amqp coap telemetry', glyph.wifi, 160, {
    kits: ['system', 'network'],
    draw: (o, w, h) => [box(o, w, h), ...glyph.wifi(o, 26, 38)],
  }),

  // Observability / ops
  iac: tiled('Infrastructure as code', 'ops', 'terraform pulumi cloudformation cdk ansible crossplane bicep opentofu iac provisioning', glyph.doc, 210),
  git: tiled('Source control', 'ops', 'git github gitlab bitbucket repository repo source code version control monorepo pull request', glyph.branch, 170),
  config: tiled('Config / settings', 'ops', 'config server parameter store app config consul kv spring cloud config remote config env settings', glyph.gear, 170),

  // Analytics / AI
  agent: tiled('AI agent', 'analytics', 'ai agent autonomous agent tool use function calling mcp langchain langgraph crewai assistant copilot planner', glyph.robot, 150),
  bi: tiled('BI / dashboard', 'analytics', 'bi dashboard grafana metabase looker tableau power bi superset redash reporting kpi', glyph.bars, 170),
  'product-analytics': tiled('Product analytics', 'analytics', 'segment amplitude mixpanel posthog google analytics ga4 heap events tracking telemetry snowplow rudderstack', glyph.trend, 190),
  'feature-store': {
    name: 'Feature store',
    group: 'analytics',
    keywords: 'feast tecton feature store ml features online offline hopsworks',
    w: 150,
    h: 76,
    labelX: 86,
    labelY: 46,
    draw: (o, w, h) => [...cylinder(o, w, h), ...glyph.list(o, 28, 46)],
  },
  recommender: tiled('Recommendation engine', 'analytics', 'recommendation recommender personalization ranking collaborative filtering feed ranking two tower', glyph.star, 220),
  notebook: {
    name: 'Notebook',
    group: 'analytics',
    keywords: 'jupyter notebook databricks colab sagemaker studio hex data science experiment',
    w: 100,
    h: 82,
    labelY: 74,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 22, 4, 48, 58, o), ...[0, 1, 2, 3].map((i) => gen.circle(c - 22, 14 + i * 13, 6, l)), ...[18, 28, 38].map((y, i) => gen.line(c - 10, y, c + (i === 2 ? 6 : 16), y, l))];
    },
  },
  training: tiled('Model training', 'analytics', 'training pipeline fine tuning fine-tune gpu cluster sagemaker vertex ai kubeflow mlflow mlops experiment tracking', glyph.cycle, 180),

  // Third party
  sms: tiled('SMS / voice', 'external', 'twilio sms voice otp call vonage messagebird whatsapp sinch phone verification', glyph.phone, 160, { dashed: true }),
  maps: tiled('Maps / geo', 'external', 'google maps mapbox geocoding location gps here osm openstreetmap routing geolocation places', glyph.pin, 160, { dashed: true }),
  crm: tiled('CRM / ERP', 'external', 'salesforce hubspot sap erp crm zendesk netsuite dynamics odoo customer support helpdesk', glyph.list, 160, { dashed: true }),
  'cloud-provider': {
    name: 'Cloud provider',
    group: 'external',
    keywords: 'aws amazon web services azure gcp google cloud oracle cloud ibm cloud digitalocean hetzner ovh cloud account tenant',
    kits: ['system', 'network'],
    w: 170,
    h: 90,
    labelY: 60,
    dashed: true,
    draw: (o, w, h) => [cloud(o, w, h)],
  },
} satisfies Partial<Record<ComponentType, Spec>>;
