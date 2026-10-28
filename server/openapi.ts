import { z } from 'zod';
import { EVENT_TYPES } from '../core/events.ts';
import { HookInput } from '../core/hooks.ts';
import { DesignSchema } from '../core/schema.ts';

// The API's published contract: an OpenAPI 3.1 document and the design file's JSON Schema, both built from the zod
// schemas the server validates with, so they can't drift from what it accepts. Served at /api/v1/openapi.json and
// /api/v1/schema/design.json.

const json = (schema: z.ZodType) => {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return rest;
};

export const designJsonSchema = () => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/oplosy/system-design/schema/design.json',
  title: 'system-design design file',
  ...json(DesignSchema),
});

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const body = (schema: object) => ({ required: true, content: { 'application/json': { schema } } });
const ok = (description: string, schema?: object) => ({ description, ...(schema && { content: { 'application/json': { schema } } }) });
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' } };
const errors = { '400': ok('Invalid input', ref('Error')), '403': ok('Another site, or a host name this server does not answer to', ref('Error')), '404': ok('Not found', ref('Error')) };

export function openApi(version: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'system-design',
      version,
      description:
        'Local API of the system-design canvas. Writes from a browser must come from the same origin; tools without a browser (curl, scripts) send no Origin and are allowed. Every change is also sent to the configured webhooks as CloudEvents (see /hooks).',
      license: { name: 'MIT' },
    },
    servers: [{ url: '/api/v1' }],
    paths: {
      '/designs': {
        get: { summary: 'List designs', responses: { '200': ok('Summaries', { type: 'array', items: ref('Summary') }) } },
        post: {
          summary: 'Create a design (blank, from a template, as a copy) or add one from a file',
          requestBody: body({
            oneOf: [
              { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' }, template: { type: 'string' }, from: { type: 'string', description: 'Id of a design to copy' } } },
              { type: 'object', required: ['design'], properties: { design: ref('Design') } },
            ],
          }),
          responses: { '201': ok('The new design', ref('Design')), '409': ok('The id is taken', ref('Error')), ...errors },
        },
      },
      '/designs/{id}': {
        parameters: [id],
        get: { summary: 'Read a design', responses: { '200': ok('The design', ref('Design')), ...errors } },
        put: {
          summary: 'Replace a design',
          description: '`rev` must match the file on disk; the answer has rev + 1. A 409 means someone wrote in between: read it again and reapply.',
          requestBody: body(ref('Design')),
          responses: { '200': ok('The design as written', ref('Design')), '409': ok('Changed on disk since it was read', ref('Error')), ...errors },
        },
        delete: { summary: 'Move a design to the trash', responses: { '200': ok('Trashed', { type: 'object', properties: { trashed: { type: 'string' } } }), ...errors } },
      },
      '/designs/{id}/share': {
        parameters: [id],
        get: { summary: 'One self-contained, read-only HTML file of the design', responses: { '200': { description: 'HTML', content: { 'text/html': { schema: { type: 'string' } } } }, ...errors } },
      },
      '/designs/{id}/live': {
        parameters: [id],
        get: {
          summary: 'Measured load on the lines, from Prometheus (needs PROMETHEUS_URL)',
          responses: {
            '200': ok('Per line id: requests per second, one-way latency in ms, percent of calls failed', {
              type: 'object',
              properties: { lines: { type: 'object', additionalProperties: { type: 'object', properties: { qps: { type: 'number' }, latency: { type: 'number' }, errors: { type: 'number' } } } }, unmatched: { type: 'array', items: { type: 'string' } } },
            }),
            ...errors,
          },
        },
      },
      '/templates': { get: { summary: 'List templates', responses: { '200': ok('Summaries', { type: 'array', items: ref('Summary') }) } } },
      '/trash': { get: { summary: 'Designs in the trash', responses: { '200': ok('Entries', { type: 'array', items: ref('Trashed') }) } } },
      '/trash/{entry}': {
        parameters: [{ name: 'entry', in: 'path', required: true, schema: { type: 'string' } }],
        post: { summary: 'Restore a design from the trash', responses: { '200': ok('The design', ref('Design')), '409': ok('A design has its id now', ref('Error')), ...errors } },
      },
      '/hooks': {
        get: { summary: 'Webhooks (secrets are never returned)', responses: { '200': ok('Hooks', { type: 'array', items: ref('Hook') }) } },
        post: { summary: 'Add a webhook', requestBody: body(ref('HookInput')), responses: { '201': ok('The hook', ref('Hook')), ...errors } },
      },
      '/hooks/{hook}': {
        parameters: [{ name: 'hook', in: 'path', required: true, schema: { type: 'string' } }],
        delete: { summary: 'Remove a webhook', responses: { '200': ok('Removed'), ...errors } },
      },
      '/hooks/{hook}/test': {
        parameters: [{ name: 'hook', in: 'path', required: true, schema: { type: 'string' } }],
        post: {
          summary: 'Send a system-design.ping event and report the answer',
          responses: { '200': ok('How the address answered', { type: 'object', properties: { ok: { type: 'boolean' }, status: { type: 'integer' }, error: { type: 'string' } } }), ...errors },
        },
      },
      '/events': { get: { summary: 'Server-sent events: `data: {"id": "<design>"}` whenever a design file changes', responses: { '200': { description: 'Event stream', content: { 'text/event-stream': { schema: { type: 'string' } } } } } } },
      '/openapi.json': { get: { summary: 'This document', responses: { '200': ok('OpenAPI 3.1') } } },
      '/schema/design.json': { get: { summary: 'JSON Schema of a design file', responses: { '200': ok('JSON Schema 2020-12') } } },
    },
    webhooks: {
      designEvents: {
        post: {
          summary: 'What changed, after every write',
          description: `One request per write and hook, with the events that hook wants. Signed hooks carry X-System-Design-Signature: sha256=<HMAC-SHA256 of the body with the hook's secret>. Types: ${EVENT_TYPES.map((t) => `system-design.${t}`).join(', ')}.`,
          requestBody: { content: { 'application/cloudevents-batch+json': { schema: { type: 'array', items: ref('CloudEvent') } } } },
          responses: { '200': { description: 'Any 2xx is success; 429 and 5xx are retried twice' } },
        },
      },
    },
    components: {
      schemas: {
        Design: json(DesignSchema),
        HookInput: json(HookInput),
        Hook: { allOf: [ref('HookInput'), { type: 'object', required: ['id'], properties: { id: { type: 'string' }, signed: { type: 'boolean' } } }] },
        Summary: {
          type: 'object',
          required: ['id', 'title', 'steps', 'unseen'],
          properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, steps: { type: 'integer' }, unseen: { type: 'integer' }, updated: { type: 'number' } },
        },
        Trashed: { type: 'object', properties: { entry: { type: 'string' }, id: { type: 'string' }, title: { type: 'string' }, deleted: { type: 'number' } } },
        Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
        CloudEvent: {
          type: 'object',
          required: ['specversion', 'id', 'source', 'type', 'subject', 'time', 'data'],
          properties: {
            specversion: { const: '1.0' },
            id: { type: 'string' },
            source: { type: 'string', description: 'system-design://<host>/designs/<design>' },
            type: { type: 'string', enum: EVENT_TYPES.map((t) => `system-design.${t}`) },
            subject: { type: 'string', description: '<design> or <design>/<item>' },
            time: { type: 'string', format: 'date-time' },
            actor: { enum: ['app', 'agent'], description: 'app: the reviewer in the app; agent: an agent, sync or command' },
            data: { type: 'object', description: 'design {id, title, rev}, link to the item in the app, and the item as it is now (plus fields and before for changes)' },
          },
        },
      },
    },
  };
}
