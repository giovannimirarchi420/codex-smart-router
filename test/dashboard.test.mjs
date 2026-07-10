import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboard } from "../src/dashboard.mjs";

test("maps the GPT-5.6 router models to standard pricing", () => {
  const dashboard = buildDashboard({
    total: 1,
    tiers: { frontier: 1 },
    models: { "gpt-5.6-sol": 1 },
    usage: { turns: 1, inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 100_000, reasoningOutputTokens: 0 },
    usageByModel: { "gpt-5.6-sol": { turns: 1, inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 100_000, reasoningOutputTokens: 0 } },
    averageConfidence: 1,
    daily: {},
  });
  assert.equal(dashboard.estimate.routedCost, 8);
  assert.equal(dashboard.estimate.pricingConfigured, true);
});

test("calculates savings from per-model usage and classifier overhead", () => {
  const dashboard = buildDashboard({
    total: 1,
    tiers: { economy: 1 },
    models: { "gpt-5.4-mini": 1 },
    usage: { turns: 1, inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 100_000, reasoningOutputTokens: 0, totalTokens: 1_100_000 },
    usageByModel: { "gpt-5.4-mini": { turns: 1, inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 100_000, reasoningOutputTokens: 0, totalTokens: 1_100_000 } },
    classifiers: { "openai-api:gpt-5.4-nano": 1 },
    classifierUsage: { calls: 1, latencyMs: 20, inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100, reasoningOutputTokens: 0, totalTokens: 1100 },
    classifierUsageByModel: { "openai-api:gpt-5.4-nano": { calls: 1, inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100, reasoningOutputTokens: 0, totalTokens: 1100 } },
    averageConfidence: 0.9,
    daily: {},
  });
  assert.equal(dashboard.estimate.baselineModel, "gpt-5.5");
  assert.ok(dashboard.estimate.routedCost > 1.19 && dashboard.estimate.routedCost < 1.21);
  assert.ok(dashboard.estimate.estimatedSavings > 6.79 && dashboard.estimate.estimatedSavings < 6.81);
});

test("formats routed cost and savings to cents", () => {
  const dashboard = buildDashboard({
    total: 1,
    tiers: { economy: 1 },
    models: { "gpt-5.4-mini": 1 },
    usage: { turns: 1, inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 100_000, reasoningOutputTokens: 0, totalTokens: 1_100_000 },
    usageByModel: { "gpt-5.4-mini": { turns: 1, inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 100_000, reasoningOutputTokens: 0, totalTokens: 1_100_000 } },
    classifiers: { "openai-api:gpt-5.4-nano": 1 },
    classifierUsage: { calls: 1, latencyMs: 20, inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100, reasoningOutputTokens: 0, totalTokens: 1100 },
    classifierUsageByModel: { "openai-api:gpt-5.4-nano": { calls: 1, inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100, reasoningOutputTokens: 0, totalTokens: 1100 } },
    averageConfidence: 0.9,
    daily: {},
  });
  const text = dashboard.estimate;
  assert.equal(text.routedCost.toFixed(2), "1.20");
  assert.equal(text.estimatedSavings.toFixed(2), "6.80");
});
