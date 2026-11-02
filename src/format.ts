import type { Pt } from './edges.ts';

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

const spaced = (text: string) => text.replace(/[ 	]+/g, ' ').trim();

/** How a heading reads in a box: capital first, single spaces. A first word like macOS or tasks.json keeps its spelling. */
export const asTitle = (text: string) => spaced(text).replace(/^\p{Ll}[\p{Ll}\d-]*(?=[\s,;)]|$)/u, (w) => w[0].toUpperCase() + w.slice(1));

/** How a description reads in a box: small first, single spaces. A first word like WPF or PowerShell keeps its spelling. */
export const asDetail = (text: string) => spaced(text).replace(/^\p{Lu}\p{Ll}*(?=[\s,;)]|$)/u, (w) => w.toLowerCase());

export const MAX_IMPORT = 5e6;
export type Theme = 'system' | 'light' | 'dark';
export type Editing = { id: string; at: Pt; value: string; multiline: boolean };
