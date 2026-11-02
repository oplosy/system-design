import fs from 'node:fs';
import path from 'node:path';
import { BASE_DIR, DATA_DIR, HUB_DATA_DIR } from '../playwright.config.ts';

/** Fresh data folders holding only the three-tier template, so every run starts from the same design. */
export default function setup() {
  fs.rmSync(BASE_DIR, { recursive: true, force: true });
  for (const dir of [DATA_DIR, HUB_DATA_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(import.meta.dirname, '..', 'templates', 'three-tier.json'), path.join(dir, 'three-tier.json'));
  }
}
