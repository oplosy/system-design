// A small MCP server to try the app's MCP client with. One tool only reads, the other declares no such thing, so the
// app calls the first and refuses the second. Run through mcp-servers.json; see the README.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export function ticketsServer() {
  const server = new McpServer({ name: 'tickets', version: '1.0.0' });
  server.registerTool(
    'list_tickets',
    { description: 'Open tickets of a service', inputSchema: { service: z.string() }, annotations: { readOnlyHint: true } },
    async ({ service }) => ({ content: [{ type: 'text', text: `OPS-1: ${service} is slow` }] }),
  );
  server.registerTool('close_ticket', { description: 'Close a ticket', inputSchema: { id: z.string() } }, async ({ id }) => ({ content: [{ type: 'text', text: `closed ${id}` }] }));
  return server;
}

if (process.argv[2] === 'stdio') await ticketsServer().connect(new StdioServerTransport());
