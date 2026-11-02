import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../playwright.config.ts';

/** A fresh data folder holding only the three-tier template, so every run starts from the same design. */
export default function setup() {
  fs.rmSync(path.dirname(DATA_DIR), { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.copyFileSync(path.join(import.meta.dirname, '..', 'templates', 'three-tier.json'), path.join(DATA_DIR, 'three-tier.json'));
}
