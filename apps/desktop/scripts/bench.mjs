#!/usr/bin/env node
// Renderer perf bench — measures two budgets from Phase 14:
//   1. Cold-start: app.ready -> first ChatView paint (target < 1500ms)
//   2. Keystroke-to-token p95: typing a char into the composer
//      and waiting for the textarea's value to reflect it (target < 50ms)
//
// Boots the packaged Electron build under Playwright headlessly, writes a
// JSON artifact under apps/desktop/.bench/<timestamp>.json, and (when a
// baseline is on disk) reports a regression delta. The script is invoked
// either directly (`node scripts/bench.mjs`) or via `pnpm bench`.
//
// TODO(perf-budget-ci): fail the script with non-zero exit on >10% regression
// vs the committed baseline once we have a stable baseline checked in.

import { _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, '..');
const mainEntry = join(desktopRoot, 'out', 'main', 'index.cjs');
const benchDir = join(desktopRoot, '.bench');
const baselinePath = join(benchDir, 'baseline.json');

const KEYSTROKE_SAMPLES = 30;
const COLD_START_BUDGET_MS = 1500;
const KEYSTROKE_P95_BUDGET_MS = 50;
const REGRESSION_THRESHOLD = 0.1; // 10%

function percentile(sortedSamples, p) {
  if (sortedSamples.length === 0) return 0;
  const idx = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedSamples.length) - 1),
  );
  return sortedSamples[idx];
}

async function measureColdStart() {
  const t0 = performance.now();
  const app = await electron.launch({ args: [mainEntry] });
  try {
    const window = await app.firstWindow();
    // First paint of ChatView is signalled by either:
    //   - .chat-pane (model loaded path)
    //   - .chat-empty (loading / no-model path)
    // Whichever appears first is the renderer's first usable paint.
    await window.waitForSelector('.chat-pane, .chat-empty', {
      state: 'attached',
      timeout: 15_000,
    });
    const coldStartMs = performance.now() - t0;
    return { coldStartMs, window, app };
  } catch (err) {
    await app.close();
    throw err;
  }
}

async function measureKeystrokeLatency(window) {
  // The textarea may not be present on the loading / empty path. If so we
  // record an empty sample set rather than failing the whole bench — the
  // cold-start metric is still useful.
  const textarea = await window.$('textarea.chat-input');
  if (!textarea) {
    return { samples: [], p50: null, p95: null, max: null, skipped: true };
  }
  await textarea.click();

  const samples = [];
  for (let i = 0; i < KEYSTROKE_SAMPLES; i += 1) {
    const sample = await window.evaluate(async () => {
      const el = document.querySelector('textarea.chat-input');
      if (!(el instanceof HTMLTextAreaElement)) return -1;
      const before = el.value.length;
      const start = performance.now();
      // Synthesise React-aware input. React reads the native setter so
      // a plain assignment doesn't trigger the onChange handler — we go
      // through the prototype setter then dispatch an input event.
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc?.set?.call(el, el.value + 'x');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      // Yield to React so the controlled-input re-render lands, then read.
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      const after = el.value.length;
      const ms = performance.now() - start;
      return after > before ? ms : -1;
    });
    if (sample >= 0) samples.push(sample);
  }

  samples.sort((a, b) => a - b);
  return {
    samples,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: samples[samples.length - 1] ?? 0,
    skipped: false,
  };
}

async function loadBaseline() {
  try {
    await access(baselinePath);
    const raw = await readFile(baselinePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function regressionPct(current, baseline) {
  if (baseline === 0 || baseline === null || baseline === undefined) return null;
  return (current - baseline) / baseline;
}

function formatMs(n) {
  return n === null || n === undefined ? 'n/a' : `${n.toFixed(1)}ms`;
}

async function main() {
  await mkdir(benchDir, { recursive: true });

  const { coldStartMs, window, app } = await measureColdStart();
  let keystrokeReport;
  try {
    keystrokeReport = await measureKeystrokeLatency(window);
  } finally {
    await app.close();
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseline = await loadBaseline();

  const coldStartRegression = baseline ? regressionPct(coldStartMs, baseline.coldStartMs) : null;
  const keystrokeRegression =
    baseline && !keystrokeReport.skipped
      ? regressionPct(keystrokeReport.p95, baseline.keystrokeP95Ms)
      : null;

  const report = {
    schemaVersion: 1,
    timestamp,
    platform: process.platform,
    nodeVersion: process.version,
    coldStartMs,
    coldStartBudgetMs: COLD_START_BUDGET_MS,
    coldStartWithinBudget: coldStartMs <= COLD_START_BUDGET_MS,
    keystrokeP95Ms: keystrokeReport.skipped ? null : keystrokeReport.p95,
    keystrokeP50Ms: keystrokeReport.skipped ? null : keystrokeReport.p50,
    keystrokeMaxMs: keystrokeReport.skipped ? null : keystrokeReport.max,
    keystrokeBudgetMs: KEYSTROKE_P95_BUDGET_MS,
    keystrokeWithinBudget: keystrokeReport.skipped
      ? null
      : keystrokeReport.p95 <= KEYSTROKE_P95_BUDGET_MS,
    keystrokeSamples: keystrokeReport.samples,
    keystrokeSkipped: keystrokeReport.skipped,
    baseline: baseline
      ? {
          coldStartMs: baseline.coldStartMs,
          keystrokeP95Ms: baseline.keystrokeP95Ms ?? null,
          coldStartRegression,
          keystrokeRegression,
        }
      : null,
  };

  const artifactPath = join(benchDir, `${timestamp}.json`);
  await writeFile(artifactPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(
    [
      `bench: cold-start ${formatMs(coldStartMs)} (budget ${COLD_START_BUDGET_MS}ms)`,
      keystrokeReport.skipped
        ? 'bench: keystroke p95 skipped (no composer in initial paint)'
        : `bench: keystroke p95 ${formatMs(keystrokeReport.p95)} (budget ${KEYSTROKE_P95_BUDGET_MS}ms)`,
      coldStartRegression !== null
        ? `bench: cold-start vs baseline ${(coldStartRegression * 100).toFixed(1)}%`
        : 'bench: no baseline (first run)',
      `bench: wrote ${artifactPath}`,
    ].join('\n'),
  );

  // CI gate: only enforce regression once a baseline exists. The budgets
  // themselves are advisory until the baseline is committed.
  let failed = false;
  if (baseline) {
    if (coldStartRegression !== null && coldStartRegression > REGRESSION_THRESHOLD) {
      console.error(
        `bench: FAIL cold-start regressed ${(coldStartRegression * 100).toFixed(1)}% vs baseline`,
      );
      failed = true;
    }
    if (keystrokeRegression !== null && keystrokeRegression > REGRESSION_THRESHOLD) {
      console.error(
        `bench: FAIL keystroke p95 regressed ${(keystrokeRegression * 100).toFixed(1)}% vs baseline`,
      );
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error('bench: fatal', err);
  process.exit(1);
});
