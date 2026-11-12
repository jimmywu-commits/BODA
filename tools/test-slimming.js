'use strict';
/* Relevant slimming checks, run serially so browser tests do not compete for
 * CPU/RAM. Does not rebuild fonts, use a user profile, or download files. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const jobs = [
  ['build-block-catalogue.js', '--check'],
  ['test-loading-dependencies.js'], ['test-block-catalogue.js'],
  ['test-save-queue.js'], ['test-root-persistence.js'],
  ['test-storage-ownership.js'], ['test-bottom-loading.js', '--browser'],
  ['test-exposure-snapshot-bridge.js'], ['test-shadow-batching.js'],
  ['test-background-isolation.js'], ['test-exposure-image-switch.js'],
  ['test-endorser-image-replacement.js'], ['test-package-image-routing.js'],
  ['test-activity-badge-cta-colors.js'], ['test-exposure-workorder-order.js'],
  ['test-exposure-global-shadow-color.js'], ['test-character-bounds.js'],
  ['test-export-font-loader.js'], ['test-activity-render-reuse.js'],
  ['test-exposure-performance.js'], ['test-exposure-preview-lifecycle.js'], ['test-exposure-state-storage.js'],
  ['test-exposure-dependencies.js'],
  ['test-slimming-workflow.js'], ['test-performance-monitor.js'],
  ['test-lazy-workflow.js'], ['test-lazy-child-sync.js'],
  ['test-lazy-bottom-preview.js'], ['test-lazy-exposure-export.js'],
  ['test-lazy-preview-state.js']
];
let log = 'BODA slimming verification ' + new Date().toISOString() + '\n';
let passed = 0;
for (const job of jobs) {
  const command = [path.join(__dirname, job[0]), ...job.slice(1)];
  const heading = '\n> node tools/' + job.join(' ') + '\n';
  process.stdout.write(heading); log += heading;
  const result = spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  const output = (result.stdout || '') + (result.stderr || '') + (result.error ? result.error.message + '\n' : '');
  process.stdout.write(output); log += output;
  if (result.status !== 0) { log += 'FAILED: ' + job[0] + '\n'; process.exitCode = 1; break; }
  passed++;
}
const summary = '\n' + (process.exitCode ? 'FAILED' : 'PASS') + ': ' + passed + '/' + jobs.length + ' relevant checks\n';
process.stdout.write(summary); log += summary;
const reportArg = process.argv.find(arg => arg.startsWith('--report='));
if (reportArg) {
  const report = path.resolve(root, reportArg.slice('--report='.length));
  if (!report.startsWith(root + path.sep)) throw new Error('Report must stay inside BODA');
  fs.mkdirSync(path.dirname(report), { recursive: true }); fs.writeFileSync(report, log);
}
