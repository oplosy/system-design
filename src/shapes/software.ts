import type { ComponentType } from '../../core/schema.ts';
import { type Spec, gen, roundRect, line, box, glyph, tiled } from './base.ts';

/** Parts of a software design: UML, architecture, DDD and flows. */
export const software = {
  // Software: use case / UML
  'use-case': {
    name: 'Use case',
    group: 'sw-uml',
    keywords: 'use case usecase uml scenario user goal oval ellipse',
    w: 170,
    h: 64,
    labelY: 32,
    draw: (o, w, h) => [gen.ellipse(w / 2, h / 2, w - 6, h - 6, o)],
  },
  class: {
    name: 'Class',
    group: 'sw-uml',
    keywords: 'class uml object type attributes methods oop model',
    w: 170,
    h: 100,
    labelY: 18,
    draw: (o, w, h) => {
      const l = line(o);
      return [gen.rectangle(3, 3, w - 6, h - 6, o), gen.line(3, 33, w - 3, 33, l), gen.line(3, 66, w - 3, 66, l), gen.line(14, 46, w * 0.55, 46, l), gen.line(14, 79, w * 0.45, 79, l)];
    },
  },
  interface: tiled('Interface', 'sw-uml', 'interface contract protocol trait abstract api uml lollipop', glyph.lollipop, 160),
  module: {
    name: 'Component / module',
    group: 'sw-uml',
    keywords: 'uml component module bounded unit deployable part subsystem',
    w: 180,
    h: 60,
    labelX: 96,
    labelY: 30,
    draw: (o, w, h) => [gen.rectangle(12, 3, w - 15, h - 6, o), gen.rectangle(4, 13, 16, 9, o), gen.rectangle(4, h - 22, 16, 9, o)],
  },
  package: {
    name: 'Package / namespace',
    group: 'sw-uml',
    keywords: 'package namespace folder module uml directory',
    w: 180,
    h: 70,
    labelY: 42,
    draw: (o, w, h) => [gen.rectangle(3, 3, 64, 12, o), gen.rectangle(3, 15, w - 6, h - 18, o)],
  },
  table: {
    name: 'Entity / table',
    group: 'sw-uml',
    keywords: 'er erd entity relationship table schema database model columns rows',
    w: 170,
    h: 96,
    labelY: 17,
    draw: (o, w, h) => {
      const l = line(o);
      return [gen.rectangle(3, 3, w - 6, h - 6, o), gen.line(3, 31, w - 3, 31, l), ...[48, 63, 78].map((y, i) => gen.line(14, y, w * (0.6 - i * 0.08), y, l))];
    },
  },


  // Software: architecture
  layer: {
    name: 'Layer',
    group: 'sw-arch',
    keywords: 'layer tier presentation business domain persistence infrastructure n-tier onion clean architecture',
    w: 260,
    h: 50,
    labelY: 25,
    draw: (o, w, h) => [gen.rectangle(3, 3, w - 6, h - 6, o)],
  },
  ui: tiled('UI / view', 'sw-arch', 'ui view page screen frontend presentation mvc mvvm component', glyph.eye, 150),
  controller: tiled('Controller / handler', 'sw-arch', 'controller handler endpoint route resolver mvc http api', glyph.arrows, 215),
  'app-service': tiled('Application service', 'sw-arch', 'application service use case interactor orchestrator business logic service layer', glyph.gear, 210),
  repository: tiled('Repository', 'sw-arch', 'repository dao data access orm persistence', glyph.db, 160),
  port: {
    name: 'Port',
    group: 'sw-arch',
    keywords: 'port hexagonal ports and adapters inbound outbound clean architecture boundary',
    w: 150,
    h: 60,
    labelY: 30,
    draw: (o, w, h) => [gen.polygon([[3, h / 2], [22, 3], [w - 22, 3], [w - 3, h / 2], [w - 22, h - 3], [22, h - 3]], o)],
  },
  adapter: tiled('Adapter', 'sw-arch', 'adapter driver driven gateway client integration anti-corruption layer acl hexagonal', glyph.link, 150),
  library: tiled('Library / SDK', 'sw-arch', 'library sdk package dependency npm shared lib framework', glyph.doc, 170),

  // Software: domain / CQRS
  aggregate: {
    name: 'Aggregate',
    group: 'sw-ddd',
    keywords: 'aggregate root ddd domain consistency boundary',
    w: 170,
    h: 70,
    labelY: 35,
    draw: (o, w, h) => [box(o, w, h), gen.path(roundRect(10, 10, w - 20, h - 20, 7), line(o))],
  },
  entity: {
    name: 'Domain entity',
    group: 'sw-ddd',
    keywords: 'entity domain model ddd identity object',
    w: 160,
    h: 56,
    labelY: 28,
    draw: (o, w, h) => [box(o, w, h)],
  },
  'value-object': {
    name: 'Value object',
    group: 'sw-ddd',
    keywords: 'value object ddd immutable money address dto',
    w: 160,
    h: 56,
    labelY: 28,
    dashed: true,
    draw: (o, w, h) => [box(o, w, h)],
  },
  command: tiled('Command', 'sw-ddd', 'command cqrs write intent request event storming', glyph.play, 160),
  query: tiled('Query / read model', 'sw-ddd', 'query cqrs read model projection view', glyph.list, 205),
  'domain-event': tiled('Domain event', 'sw-ddd', 'domain event sourcing fact happened event storming integration event', glyph.sparkle, 170),
  policy: tiled('Policy / saga', 'sw-ddd', 'policy saga process manager reaction orchestration choreography compensation', glyph.cycle, 170),

  // Software: flow / activity / state
  start: {
    name: 'Start',
    group: 'sw-flow',
    keywords: 'start initial node begin entry activity state flowchart',
    w: 70,
    h: 62,
    labelY: 54,
    draw: (o, w) => [gen.circle(w / 2, 18, 28, { ...o, fill: 'currentColor', fillStyle: 'solid' })],
  },
  end: {
    name: 'End',
    group: 'sw-flow',
    keywords: 'end final node finish stop terminate flowchart',
    w: 70,
    h: 62,
    labelY: 54,
    draw: (o, w) => [gen.circle(w / 2, 18, 32, line(o)), gen.circle(w / 2, 18, 18, { ...o, fill: 'currentColor', fillStyle: 'solid' })],
  },
  action: {
    name: 'Action / step',
    group: 'sw-flow',
    keywords: 'action activity step task process flowchart',
    w: 170,
    h: 52,
    labelY: 26,
    draw: (o, w, h) => [gen.path(roundRect(3, 3, w - 6, h - 6, (h - 6) / 2), o)],
  },
  choice: {
    name: 'Decision / branch',
    group: 'sw-flow',
    keywords: 'decision branch condition if choice merge gateway flowchart diamond',
    w: 180,
    h: 90,
    labelY: 45,
    draw: (o, w, h) => [gen.polygon([[w / 2, 3], [w - 3, h / 2], [w / 2, h - 3], [3, h / 2]], o)],
  },
  fork: {
    name: 'Fork / join',
    group: 'sw-flow',
    keywords: 'fork join parallel sync bar concurrency split',
    w: 160,
    h: 34,
    labelY: 26,
    draw: (o, w) => [gen.rectangle(4, 3, w - 8, 7, { ...o, fill: 'currentColor', fillStyle: 'solid' })],
  },
  state: {
    name: 'State',
    group: 'sw-flow',
    keywords: 'state machine status statechart fsm mode',
    w: 160,
    h: 70,
    labelY: 17,
    draw: (o, w, h) => [gen.path(roundRect(3, 3, w - 6, h - 6, 14), o), gen.line(3, 31, w - 3, 31, line(o))],
  },
  signal: {
    name: 'Signal / message',
    group: 'sw-flow',
    keywords: 'signal send message emit notify event',
    w: 170,
    h: 52,
    labelX: 76,
    labelY: 26,
    draw: (o, w, h) => [gen.polygon([[3, 3], [w - 24, 3], [w - 3, h / 2], [w - 24, h - 3], [3, h - 3]], o)],
  },
  timer: tiled('Timer / wait', 'sw-flow', 'timer wait delay timeout schedule sleep time event', glyph.clock, 160),
} satisfies Partial<Record<ComponentType, Spec>>;
