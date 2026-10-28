import type { Component, ComponentType, Design } from './schema.ts';

// Exports for other architecture tools: Structurizr DSL and C4-PlantUML (C4 container level), and a draw.io file
// that keeps the sheet's positions. Parts map to C4 by type: users are people, third parties are external systems,
// datastores and queues get their own shapes, everything else is a container of the one system the design describes.

const PEOPLE = new Set<ComponentType>(['user', 'admin']);
const EXTERNAL = new Set<ComponentType>(['external', 'payment', 'sms', 'maps', 'crm', 'cloud-provider', 'internet']);
export const DATASTORE = new Set<ComponentType>([
  'sql-db', 'nosql-db', 'key-value', 'cache', 'graph-db', 'time-series', 'vector-db', 'search', 'object-storage', 'file-storage',
  'warehouse', 'data-lake', 'olap', 'block-storage', 'local-db', 'backup', 'ledger', 'nas',
]);
export const QUEUE = new Set<ComponentType>(['queue', 'pubsub', 'stream', 'event-bus', 'mqtt']);
const role = (c: Component) => (PEOPLE.has(c.type) ? 'person' : EXTERNAL.has(c.type) ? 'external' : DATASTORE.has(c.type) ? 'db' : QUEUE.has(c.type) ? 'queue' : 'container');

/** Ids are lowercase-dashed; both tools want letters, digits and underscores, and not a leading digit. */
const ident = (id: string) => `${/^\d/.test(id) ? 'x' : ''}${id.replace(/-/g, '_')}`;
const oneLine = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export function toStructurizr(d: Design) {
  const q = (s: string | undefined) => `"${oneLine(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const sys = 'system_';
  const inSystem = (c: Component) => role(c) !== 'person' && role(c) !== 'external';
  const out = [`workspace ${q(d.title)} ${q(d.description)} {`, '  !identifiers hierarchical', '', '  model {', '    properties {', '      "structurizr.groupSeparator" "/"', '    }'];
  for (const c of d.components.filter((x) => !inSystem(x))) {
    out.push(role(c) === 'person' ? `    ${ident(c.id)} = person ${q(c.label)} ${q(c.description)}` : `    ${ident(c.id)} = softwareSystem ${q(c.label)} ${q(c.description)} "External"`);
  }
  out.push(`    ${sys} = softwareSystem ${q(d.title)} ${q(d.description)} {`);
  const write = (parent: string | undefined, indent: string) => {
    for (const b of d.boundaries.filter((x) => x.parent === parent)) {
      const inner: string[] = [];
      const before = out.length;
      write(b.id, `${indent}  `);
      inner.push(...out.splice(before));
      // Empty groups (only people or external systems inside) are left out.
      if (inner.length) out.push(`${indent}group ${q(b.label)} {`, ...inner, `${indent}}`);
    }
    for (const c of d.components.filter((x) => x.boundary === parent && inSystem(x))) {
      const tag = role(c) === 'db' ? 'Database' : role(c) === 'queue' ? 'Queue' : '';
      out.push(`${indent}${ident(c.id)} = container ${q(c.label)} ${q(c.description)} ${q(c.tech)} ${q(tag)}`);
    }
  };
  write(undefined, '      ');
  out.push('    }', '');
  // With hierarchical identifiers, containers are addressed through the system.
  const ref = (id: string) => {
    const c = d.components.find((x) => x.id === id);
    return c && inSystem(c) ? `${sys}.${ident(id)}` : ident(id);
  };
  for (const c of d.connections) out.push(`    ${ref(c.from)} -> ${ref(c.to)} ${q(c.label)}${c.async ? ' "" "Async"' : ''}`);
  out.push('  }', '', '  views {', `    container ${sys} "Containers" {`, '      include *', '      autoLayout lr', '    }', '    styles {');
  out.push('      element "Person" {', '        shape person', '      }', '      element "Database" {', '        shape cylinder', '      }');
  out.push('      element "Queue" {', '        shape pipe', '      }', '      element "External" {', '        background #999999', '      }');
  out.push('      relationship "Async" {', '        dashed true', '      }', '    }', '  }', '}');
  return out.join('\n') + '\n';
}

export function toPlantUml(d: Design) {
  // PlantUML has no escape for a quote inside a string.
  const q = (s: string | undefined) => `"${oneLine(s).replace(/"/g, "'")}"`;
  const out = ['@startuml', '!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml', '', `title ${oneLine(d.title)}`, ''];
  const macro = { person: 'Person', external: 'System_Ext', db: 'ContainerDb', queue: 'ContainerQueue', container: 'Container' };
  const write = (parent: string | undefined, indent: string) => {
    for (const b of d.boundaries.filter((x) => x.parent === parent)) {
      out.push(`${indent}Boundary(${ident(`b-${b.id}`)}, ${q(b.label)}, ${q(b.kind)}) {`);
      write(b.id, `${indent}  `);
      out.push(`${indent}}`);
    }
    for (const c of d.components.filter((x) => x.boundary === parent)) {
      const r = role(c);
      // People and external systems take (label, description); containers take (label, technology, description).
      out.push(`${indent}${macro[r]}(${ident(c.id)}, ${q(c.label)}, ${r === 'person' || r === 'external' ? q(c.description) : `${q(c.tech)}, ${q(c.description)}`})`);
    }
  };
  write(undefined, '');
  out.push('');
  for (const c of d.connections) out.push(`Rel(${ident(c.from)}, ${ident(c.to)}, ${q(c.label || (c.async ? 'async' : 'uses'))})`);
  out.push('', 'SHOW_LEGEND()', '@enduml');
  return out.join('\n') + '\n';
}

const SIZE = { w: 160, h: 70 };
const PAD = 30;

/** A draw.io (diagrams.net) file with each part where it sits on the sheet, boundaries drawn as dashed boxes around them. */
export function toDrawio(d: Design) {
  const x = (s: string | undefined) => (s ?? '').replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`).replace(/\n/g, '&#10;');
  // Parts the sheet never laid out (positions are saved after the first layout) go on a grid below the rest.
  const placed = d.components.filter((c) => c.position);
  const bottom = placed.length ? Math.max(...placed.map((c) => c.position!.y)) + 200 : 0;
  const at = new Map(d.components.map((c, i) => [c.id, c.position ?? { x: (i % 6) * 220, y: bottom + Math.floor(i / 6) * 140 }]));
  const style = (c: Component) => {
    const r = role(c);
    if (r === 'person') return 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;';
    if (r === 'db') return 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;size=12;';
    if (r === 'queue') return 'shape=cylinder3;direction=south;whiteSpace=wrap;html=1;boundedLbl=1;size=12;';
    if (r === 'external') return 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;fontColor=#666666;';
    return 'rounded=1;whiteSpace=wrap;html=1;';
  };
  // A boundary's box covers its parts and inner boxes, with room for its title.
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  const box = (id: string): { x: number; y: number; w: number; h: number } | undefined => {
    if (boxes.has(id)) return boxes.get(id);
    const inside = [
      ...d.components.filter((c) => c.boundary === id).map((c) => ({ ...at.get(c.id)!, w: SIZE.w, h: SIZE.h })),
      ...d.boundaries.filter((b) => b.parent === id).flatMap((b) => box(b.id) ?? []),
    ];
    if (!inside.length) return undefined;
    const x0 = Math.min(...inside.map((r) => r.x)) - PAD, y0 = Math.min(...inside.map((r) => r.y)) - PAD - 20;
    const r = { x: x0, y: y0, w: Math.max(...inside.map((r) => r.x + r.w)) + PAD - x0, h: Math.max(...inside.map((r) => r.y + r.h)) + PAD - y0 };
    boxes.set(id, r);
    return r;
  };
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  // Outer boxes first, so inner ones and the parts draw on top.
  const depth = (id: string | undefined): number => (id ? 1 + depth(d.boundaries.find((b) => b.id === id)?.parent) : 0);
  for (const b of [...d.boundaries].sort((a, c) => depth(a.id) - depth(c.id))) {
    const r = box(b.id);
    if (!r) continue;
    const label = b.detail ? `${b.label} · ${b.detail}` : b.label;
    cells.push(
      `<mxCell id="b-${b.id}" value="${x(label)}" style="rounded=1;dashed=1;fillColor=none;verticalAlign=top;align=left;spacingLeft=8;html=1;" vertex="1" parent="1"><mxGeometry x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" as="geometry"/></mxCell>`,
    );
  }
  for (const c of d.components) {
    const p = at.get(c.id)!;
    const value = c.tech ? `${x(c.label)}&lt;br&gt;&lt;i&gt;${x(c.tech)}&lt;/i&gt;` : x(c.label);
    cells.push(`<mxCell id="c-${c.id}" value="${value}" style="${style(c)}" vertex="1" parent="1"><mxGeometry x="${p.x}" y="${p.y}" width="${SIZE.w}" height="${SIZE.h}" as="geometry"/></mxCell>`);
  }
  for (const c of d.connections) {
    cells.push(
      `<mxCell id="e-${c.id}" value="${x(c.label)}" style="endArrow=block;html=1;${c.async ? 'dashed=1;' : ''}" edge="1" parent="1" source="c-${c.from}" target="c-${c.to}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    );
  }
  return `<mxfile><diagram name="${x(d.title)}"><mxGraphModel><root>\n${cells.join('\n')}\n</root></mxGraphModel></diagram></mxfile>\n`;
}
