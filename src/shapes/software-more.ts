import type { Options } from 'roughjs/bin/core';
import type { ComponentType } from '../../core/schema.ts';
import { type Spec, gen, line, box, roundRect, glyph, tiled } from './base.ts';

const tick = (o: Options, x: number, y: number) => [gen.linearPath([[x - 10, y], [x - 3, y + 8], [x + 11, y - 9]], { ...line(o), strokeWidth: 2.2 })];
const blocks = (o: Options, x: number, y: number) => [[-11, -10], [1, -10], [-11, 1], [1, 1]].map(([dx, dy]) => gen.rectangle(x + dx, y + dy, 10, 9, line(o)));

/** More parts of a software design: sequence, data and frontend diagrams. Each file of parts keeps its own guessType rank (see FALLBACK in shapes.ts). */
export const softwareMore = {
  // Software: UML
  'abstract-class': {
    name: 'Abstract class',
    group: 'sw-uml',
    keywords: 'abstract class base class template method uml italic inheritance',
    w: 170,
    h: 100,
    labelY: 18,
    dashed: true,
    draw: (o, w, h) => {
      const l = line(o);
      return [gen.rectangle(3, 3, w - 6, h - 6, o), gen.line(3, 33, w - 3, 33, l), gen.line(3, 66, w - 3, 66, l)];
    },
  },
  artifact: {
    name: 'Artifact',
    group: 'sw-uml',
    keywords: 'artifact jar war binary bundle build output deliverable uml image',
    w: 150,
    h: 60,
    labelY: 32,
    draw: (o, w, h) => [gen.polygon([[3, 3], [w - 20, 3], [w - 3, 20], [w - 3, h - 3], [3, h - 3]], o), gen.linearPath([[w - 20, 3], [w - 20, 20], [w - 3, 20]], line(o))],
  },
  activation: {
    name: 'Activation',
    group: 'sw-uml',
    keywords: 'activation bar execution occurrence sequence diagram focus of control',
    w: 80,
    h: 112,
    labelY: 104,
    draw: (o, w) => [gen.rectangle(w / 2 - 8, 4, 16, 88, o)],
  },
  fragment: {
    name: 'Fragment',
    group: 'sw-uml',
    keywords: 'combined fragment alt opt loop par sequence diagram frame interaction',
    w: 260,
    h: 120,
    labelY: 62,
    draw: (o, w, h) => [gen.rectangle(3, 3, w - 6, h - 6, o), gen.polygon([[3, 3], [64, 3], [64, 16], [54, 26], [3, 26]], line(o))],
  },
  'db-view': {
    name: 'Database view',
    group: 'sw-uml',
    keywords: 'database view materialized view sql er erd virtual table',
    w: 170,
    h: 96,
    labelY: 17,
    dashed: true,
    draw: (o, w, h) => {
      const l = line(o);
      return [gen.rectangle(3, 3, w - 6, h - 6, o), gen.line(3, 31, w - 3, 31, l), ...[48, 63].map((y, i) => gen.line(14, y, w * (0.6 - i * 0.08), y, l))];
    },
  },
  'junction-table': {
    name: 'Junction table',
    group: 'sw-uml',
    keywords: 'junction table join table many to many bridge associative er erd pivot',
    w: 170,
    h: 76,
    labelY: 17,
    draw: (o, w, h) => {
      const l = line(o);
      return [gen.rectangle(3, 3, w - 6, h - 6, o), gen.line(3, 31, w - 3, 31, l), gen.line(14, 45, w * 0.5, 45, l), gen.line(14, 58, w * 0.5, 58, l)];
    },
  },

  // Software: architecture
  dto: tiled('DTO', 'sw-arch', 'dto data transfer object request response payload schema serializer', glyph.doc, 120),
  middleware: tiled('Middleware', 'sw-arch', 'middleware interceptor filter pipeline express guard decorator', glyph.link, 170),
  'event-handler': tiled('Event handler', 'sw-arch', 'event handler listener subscriber observer callback reducer', glyph.sparkle, 180),
  'api-client': tiled('API client', 'sw-arch', 'api client axios fetch httpclient stub openapi generated sdk', glyph.arrows, 160),
  'test-suite': tiled('Test suite', 'sw-arch', 'test suite unit integration e2e jest vitest pytest junit playwright cypress', tick, 160),

  // Software: domain
  'domain-service': tiled('Domain service', 'sw-ddd', 'domain service ddd stateless business rule calculation', glyph.gear, 180),
  factory: tiled('Factory', 'sw-ddd', 'factory builder creation constructor abstract factory creational pattern', glyph.star, 150),

  // Software: flow
  loop: {
    name: 'Loop',
    group: 'sw-flow',
    keywords: 'loop repeat iteration while for each flowchart preparation hexagon',
    w: 170,
    h: 52,
    labelY: 26,
    draw: (o, w, h) => [gen.polygon([[3, h / 2], [22, 3], [w - 22, 3], [w - 3, h / 2], [w - 22, h - 3], [22, h - 3]], o), ...glyph.cycle(o, 34, h / 2)],
  },
  'error-event': {
    name: 'Error event',
    group: 'sw-flow',
    keywords: 'error event exception failure throw catch bpmn boundary rollback',
    w: 90,
    h: 66,
    labelY: 58,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.circle(c, 22, 38, o), gen.polygon([[c + 3, 8], [c - 8, 24], [c - 1, 24], [c - 4, 36], [c + 8, 20], [c + 1, 20]], line(o))];
    },
  },
  'manual-task': {
    name: 'Manual task',
    group: 'sw-flow',
    keywords: 'manual task human approval review user task bpmn flowchart trapezoid',
    w: 170,
    h: 52,
    labelY: 26,
    draw: (o, w, h) => [gen.polygon([[3, 3], [w - 3, 3], [w - 22, h - 3], [22, h - 3]], o)],
  },
  'composite-state': {
    name: 'Composite state',
    group: 'sw-flow',
    keywords: 'composite state nested substate hierarchical statechart orthogonal region',
    w: 200,
    h: 110,
    labelY: 17,
    draw: (o, w, h) => {
      const l = line(o);
      return [gen.path(roundRect(3, 3, w - 6, h - 6, 14), o), gen.line(3, 31, w - 3, 31, l), gen.path(roundRect(16, 45, 70, 44, 9), l), gen.path(roundRect(w - 86, 45, 70, 44, 9), l), gen.line(86, 67, w - 86, 67, l)];
    },
  },

  // Software: frontend
  page: {
    name: 'Page',
    group: 'sw-front',
    keywords: 'page screen route view layout browser window',
    w: 170,
    h: 90,
    labelY: 54,
    draw: (o, w, h) => [gen.rectangle(3, 3, w - 6, h - 6, o), gen.line(3, 20, w - 3, 20, line(o)), ...[0, 1, 2].map((i) => gen.circle(13 + i * 9, 12, 4, line(o)))],
  },
  route: tiled('Route', 'sw-front', 'route react router vue router navigation url path deep link', glyph.pin, 130),
  'ui-component': tiled('UI component', 'sw-front', 'ui component widget design system storybook', blocks, 170),
  form: {
    name: 'Form',
    group: 'sw-front',
    keywords: 'form input validation submit react hook form formik field',
    w: 130,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const l = line(o);
      return [gen.rectangle(8, 4, w - 16, 60, o), gen.rectangle(18, 14, w - 36, 12, l), gen.rectangle(18, 34, w - 36, 12, l), gen.line(w - 50, 54, w - 18, 54, { ...l, strokeWidth: 2.4 })];
    },
  },
  'state-store': tiled('State store', 'sw-front', 'state store redux zustand pinia mobx vuex recoil jotai context client state', glyph.db, 160),
  hook: tiled('Hook', 'sw-front', 'hook react usestate useeffect composable custom hook', glyph.cycle, 120),
  modal: {
    name: 'Modal',
    group: 'sw-front',
    keywords: 'modal dialog popup drawer overlay sheet',
    w: 150,
    h: 86,
    labelY: 44,
    draw: (o, w, h) => [box(o, w, h), gen.line(w - 26, 13, w - 16, 23, line(o)), gen.line(w - 16, 13, w - 26, 23, line(o))],
  },
} satisfies Partial<Record<ComponentType, Spec>>;
