import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendAudit, appendUsageAudit, readAuditStats } from "../src/audit.mjs";

test("records prompt-free routes and aggregates real token usage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-smart-audit-"));
  const path = join(directory, "routes.jsonl");
  await appendAudit({
    routeId: "route-1",
    threadId: "thread-1",
    tier: "economy",
    score: 12,
    model: "gpt-5.4-mini",
    effort: "low",
    overridden: false,
    confidence: 0.9,
    taskType: "transformation",
    classifier: {
      provider: "openai-api",
      model: "gpt-5.4-nano",
      latencyMs: 200,
      usage: {
        inputTokens: 300,
        cachedInputTokens: 0,
        outputTokens: 40,
        reasoningOutputTokens: 10,
        totalTokens: 340
      }
    },
  }, path);
  await appendUsageAudit({
    routeId: "route-1",
    threadId: "thread-1",
    turnId: "turn-1",
    tier: "economy",
    model: "gpt-5.4-mini",
    effort: "low",
    status: "completed",
    durationMs: 100,
    usage: {
      inputTokens: 100,
      cachedInputTokens: 80,
      outputTokens: 20,
      reasoningOutputTokens: 5,
      totalTokens: 120,
    },
  }, path);

  const content = await readFile(path, "utf8");
  assert.doesNotMatch(content, /Fix a typo/);

  const stats = await readAuditStats(path);
  assert.equal(stats.total, 1);
  assert.deepEqual(stats.tiers, { economy: 1 });
  assert.equal(stats.usage.turns, 1);
  assert.equal(stats.usage.totalTokens, 120);
  assert.equal(stats.usage.reasoningOutputTokens, 5);
  assert.equal(stats.averageConfidence, 0.9);
  assert.equal(stats.classifierUsage.totalTokens, 340);
});
