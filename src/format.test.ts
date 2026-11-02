import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asDetail, asTitle } from './format.ts';

test('a heading starts with a capital and has single spaces', () => {
  assert.equal(asTitle('  dailyw   (Windows) '), 'Dailyw (Windows)');
  assert.equal(asTitle('api gateway'), 'Api gateway');
  assert.equal(asTitle('Load balancer'), 'Load balancer');
});

test('a heading keeps a first word with its own spelling', () => {
  assert.equal(asTitle('macOS JSON files'), 'macOS JSON files');
  assert.equal(asTitle('tasks.json store'), 'tasks.json store');
});

test('a description starts small and has single spaces', () => {
  assert.equal(asDetail('Swift, AppKit  +  SwiftUI'), 'swift, AppKit + SwiftUI');
  assert.equal(asDetail('User chose no sync'), 'user chose no sync');
  assert.equal(asDetail('Queue'), 'queue');
});

test('a description keeps a first word with its own spelling, and its line breaks', () => {
  assert.equal(asDetail('WPF cannot run'), 'WPF cannot run');
  assert.equal(asDetail('PowerShell 5.1'), 'PowerShell 5.1');
  assert.equal(asDetail('S3 bucket'), 'S3 bucket');
  assert.equal(asDetail('first\nsecond'), 'first\nsecond');
});
