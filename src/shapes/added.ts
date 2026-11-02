import type { ComponentType } from '../../core/schema.ts';
import { type Spec, gen, line, glyph, tiled } from './base.ts';

/** Parts added after the first release. guessType ranks them last (see FALLBACK in shapes.ts). */
export const added = {
  'policy-engine': tiled('Policy engine', 'edge', 'opa open policy agent kyverno cedar authz authorization policy as code rego pdp pep gatekeeper access control abac rbac', glyph.gear, 170),
  autoscaler: tiled('Autoscaler', 'compute', 'autoscaling hpa vpa keda cluster autoscaler karpenter asg auto scaling group scale out scale in elastic capacity', glyph.updown, 160),
  'dead-letter-queue': {
    name: 'Dead-letter queue',
    group: 'messaging',
    keywords: 'dlq dead letter queue poison message failed messages retry parking lot redrive error queue',
    kits: ['system', 'software'],
    w: 170,
    h: 72,
    labelY: 62,
    draw: (o, w) => {
      const x = 4, pw = w - 22, l = line(o);
      return [
        gen.rectangle(x, 4, pw, 40, o),
        gen.ellipse(x + pw, 24, 16, 40, o),
        ...[1, 2].map((i) => gen.line(x + (i * pw) / 4, 4, x + (i * pw) / 4, 44, l)),
        gen.line(x + (2.4 * pw) / 4, 14, x + (3.6 * pw) / 4, 34, l),
        gen.line(x + (2.4 * pw) / 4, 34, x + (3.6 * pw) / 4, 14, l),
      ];
    },
  },
  'schema-registry': tiled('Schema registry', 'messaging', 'schema registry confluent avro protobuf json schema apicurio glue schema registry contract compatibility evolution', glyph.doc, 190),
  'status-page': tiled('Status page', 'ops', 'status page statuspage atlassian statuspage instatus betteruptime uptime kuma cachet gatus statping incident communication public status sla', glyph.bars, 160),
  'vulnerability-scanner': tiled('Vulnerability scanner', 'ops', 'vulnerability scanner trivy snyk sonarqube sast dast sca dependabot grype clair security scan cve supply chain sbom', glyph.eye, 220),
  'data-catalog': tiled('Data catalog', 'analytics', 'data catalog datahub amundsen collibra alation unity catalog glue data catalog lineage governance metadata data quality discovery', glyph.list, 170),
  'transit-gateway': {
    name: 'Transit gateway',
    group: 'network',
    keywords: 'tgw transit gateway vpc peering hub and spoke cloud wan azure virtual wan network connectivity center interconnect direct connect',
    kits: ['system', 'network'],
    w: 120,
    h: 90,
    labelY: 80,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const spokes: [number, number][] = [[c - 34, 12], [c + 34, 12], [c - 34, 56], [c + 34, 56]];
      return [...spokes.map(([x, y]) => gen.line(c, 34, x, y, l)), ...spokes.map(([x, y]) => gen.circle(x, y, 14, o)), gen.circle(c, 34, 22, o)];
    },
  },
  'private-link': tiled('Private link', 'network', 'privatelink private link vpc endpoint interface endpoint private endpoint private service connect gateway endpoint', glyph.link, 220),
  'llm-gateway': tiled('LLM gateway', 'analytics', 'llm gateway litellm portkey openrouter helicone model router ai gateway guardrails prompt filter token budget fallback proxy', glyph.arrows, 170),
  'mcp-server': tiled('MCP server', 'analytics', 'mcp model context protocol server tool provider function calling tools plugin connector', glyph.link, 190),
  object: {
    name: 'Object',
    group: 'sw-uml',
    keywords: 'object instance uml object diagram snapshot runtime underlined endpoint tool',
    w: 160,
    h: 56,
    labelY: 24,
    draw: (o, w, h) => [gen.rectangle(3, 3, w - 6, h - 6, o), gen.line(18, 36, w - 18, 36, line(o))],
  },
  enum: {
    name: 'Enum',
    group: 'sw-uml',
    keywords: 'enum enumeration constants values uml type variants',
    w: 150,
    h: 84,
    labelY: 17,
    draw: (o, w, h) => {
      const l = line(o);
      return [gen.rectangle(3, 3, w - 6, h - 6, o), gen.line(3, 31, w - 3, 31, l), gen.line(14, 48, w * 0.5, 48, l), gen.line(14, 62, w * 0.62, 62, l)];
    },
  },
  'deployment-node': {
    name: 'Deployment node',
    group: 'sw-uml',
    keywords: 'deployment node uml device execution environment server machine runtime artifact cube 3d',
    w: 180,
    h: 80,
    labelX: 84,
    labelY: 50,
    draw: (o, w, h) => {
      const l = line(o), d = 14;
      return [
        gen.rectangle(3, d, w - 3 - d, h - d - 3, o),
        gen.polygon([[3, d], [3 + d, 3], [w - 3, 3], [w - 3 - d, d]], o),
        gen.polygon([[w - 3 - d, d], [w - 3, 3], [w - 3, h - d - 3], [w - 3 - d, h - 3]], l),
      ];
    },
  },
  lifeline: {
    name: 'Lifeline',
    group: 'sw-uml',
    keywords: 'lifeline sequence diagram participant uml message interaction timeline',
    w: 120,
    h: 170,
    labelY: 20,
    draw: (o, w, h) => [gen.rectangle(3, 3, w - 6, 34, o), gen.line(w / 2, 37, w / 2, h - 3, { ...line(o), strokeLineDash: [7, 6] })],
  },
  subprocess: {
    name: 'Subprocess',
    group: 'sw-flow',
    keywords: 'subprocess subroutine predefined process call activity bpmn flowchart nested',
    w: 170,
    h: 52,
    labelY: 26,
    draw: (o, w, h) => [gen.rectangle(3, 3, w - 6, h - 6, o), gen.line(16, 3, 16, h - 3, line(o)), gen.line(w - 16, 3, w - 16, h - 3, line(o))],
  },
  document: {
    name: 'Document',
    group: 'sw-flow',
    keywords: 'document file report output paper flowchart bpmn data object invoice',
    w: 160,
    h: 62,
    labelY: 26,
    draw: (o, w, h) => [gen.path(`M3 3 H${w - 3} V${h - 12} Q${w * 0.75} ${h - 24} ${w / 2} ${h - 12} T3 ${h - 12} Z`, o)],
  },
  'data-store': {
    name: 'Data store',
    group: 'sw-flow',
    keywords: 'data store dfd data flow diagram open rectangle repository file table yourdon',
    kits: ['software'],
    w: 170,
    h: 48,
    labelX: 96,
    labelY: 24,
    draw: (o, w, h) => [gen.linearPath([[w - 3, 3], [3, 3], [3, h - 3], [w - 3, h - 3]], o), gen.line(20, 3, 20, h - 3, line(o))],
  },
} satisfies Partial<Record<ComponentType, Spec>>;
