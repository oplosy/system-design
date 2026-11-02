import type { Pt } from './edges.ts';

export const pad = (n: number) => String(n).padStart(2, '0');

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

export function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const MAX_IMPORT = 5e6;
export type Theme = 'system' | 'light' | 'dark';
export type Editing = { id: string; at: Pt; value: string; multiline: boolean };
