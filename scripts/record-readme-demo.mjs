import { readAuditStats } from '../src/audit.mjs';
import { buildDashboard, formatDashboard } from '../src/dashboard.mjs';
import { loadCodexCatalog } from '../src/catalog.mjs';
import { createClassifier } from '../src/classifier.mjs';
import { routePrompt } from '../src/router.mjs';

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function type(text) {
  process.stdout.write(text);
}

async function main() {
  process.stdout.write('\x1Bc');
  type('$ codex-smart route "Find the failing dashboard test and fix the cost calculation"\n');
  await pause(450);

  const catalog = loadCodexCatalog();
  const classifier = createClassifier({ mode: 'codex' });
  const decision = await routePrompt('Find the failing dashboard test and fix the cost calculation', catalog, { classifier });
  type(`\n  routed to ${decision.model} (${decision.effort})\n`);
  type(`  tier: ${decision.tier} | confidence: ${(decision.confidence * 100).toFixed(0)}%\n`);
  await pause(900);

  type('\n$ codex-smart dashboard\n');
  await pause(450);
  const dashboard = buildDashboard(await readAuditStats());
  type(`\n${formatDashboard(dashboard, 'USD ')}\n`);
  await pause(2500);
}

main().catch((error) => {
  process.stderr.write(`demo failed: ${error.message}\n`);
  process.exitCode = 1;
});
