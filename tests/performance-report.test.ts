import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  copyReport,
  reportProgressHtml,
  reportRequested,
  reportResultHtml,
  withoutReportParameter,
} from '../src/ui/performanceReport';

test('the report runs only on a link carrying ?diagnostic, and a reload does not run it again', () => {
  assert.equal(reportRequested('?diagnostic'), true);
  assert.equal(reportRequested('?a=1&diagnostic='), true);
  assert.equal(reportRequested(''), false);
  assert.equal(reportRequested('?diag'), false);
  // The share link lives in the hash: it survives, only the parameter goes.
  assert.equal(
    withoutReportParameter('https://example.test/?diagnostic&x=2#p1:abc'),
    '/?x=2#p1:abc',
  );
  assert.equal(withoutReportParameter('https://example.test/?diagnostic'), '/');
});

test('the report is escaped text, with a progress bar while it measures', () => {
  assert.match(reportProgressHtml(2, 5), /<progress id="report-progress" max="5" value="2">/);
  const html = reportResultHtml('GPU <script>alert(1)</script> · 1,8 ms');
  assert.ok(!html.includes('<script>'), 'a renderer name cannot inject markup');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /id="copy-report"/);
});

test('copying falls back to selecting the text when the clipboard refuses', async () => {
  const window = new Window();
  const pre = window.document.createElement('pre');
  pre.textContent = 'rapport';
  window.document.body.append(pre);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async () => Promise.reject(new Error('denied')) } },
  });
  try {
    assert.equal(await copyReport('rapport', pre as unknown as HTMLElement), false);
    assert.equal(window.document.getSelection()?.toString(), 'rapport');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText: async () => undefined } },
    });
    assert.equal(await copyReport('rapport', pre as unknown as HTMLElement), true);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
  }
});
