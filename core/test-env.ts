import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Imported first by every test file, so what they load finds a data folder of its own. Each test file runs in its own process.
process.env.SYSTEM_DESIGN_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'sd-test-'));
// Webhooks from these writes go to a file of the test's own, never to the machine's real ones.
process.env.SYSTEM_DESIGN_HOOKS = path.join(process.env.SYSTEM_DESIGN_DIR, '..', `sd-hooks-${process.pid}.json`);
delete process.env.SYSTEM_DESIGN_WEBHOOK;
process.env.SYSTEM_DESIGN_PLUGINS = path.join(import.meta.dirname, '..', 'examples', 'plugins');
process.env.SYSTEM_DESIGN_MCP = path.join(process.env.SYSTEM_DESIGN_DIR, '..', `sd-mcp-${process.pid}.json`);
