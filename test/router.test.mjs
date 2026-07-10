import assert from "node:assert/strict";
import test from "node:test";
import { extractRouteDirective, routePrompt } from "../src/router.mjs";

const catalog = {
  models: [
    { slug: "gpt-5.6-sol", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "max" }] },
    { slug: "gpt-5.6-terra", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }] },
    { slug: "gpt-5.6-luna", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }] },
    { slug: "gpt-5.4-mini", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }] },
  ],
};

function mockClassifier(tier, capture = null) {
  return {
    async classify(input) {
      if (capture) capture.push(input);
      return {
        tier,
        confidence: 0.91,
        taskType: "implementation",
        rationale: `Semantic classification selected ${tier}.`,
        classifier: { provider: "test", model: "test-classifier", latencyMs: 1, usage: null },
      };
    },
  };
}

test("uses semantic classifier output for execution routing", async () => {
  const decision = await routePrompt("Please create the helm chart for this project", catalog, {
    classifier: mockClassifier("complex"),
  });
  assert.equal(decision.tier, "complex");
  assert.equal(decision.model, "gpt-5.6-terra");
  assert.equal(decision.effort, "medium");
  assert.equal(decision.confidence, 0.91);
});

test("passes conversation history and prior turn context to classifier", async () => {
  const captured = [];
  await routePrompt("Continue", catalog, {
    classifier: mockClassifier("frontier", captured),
    history: ["Design a secure cross-region architecture"],
    context: {
      previousDecision: { tier: "complex", model: "gpt-5.6-terra", effort: "medium" },
      previousUsage: { totalTokens: 80_000 },
      previousStatus: "completed",
    },
  });
  assert.deepEqual(captured[0].history, ["Design a secure cross-region architecture"]);
  assert.equal(captured[0].previousRoute.tier, "complex");
  assert.equal(captured[0].previousUsage.totalTokens, 80_000);
});

test("supports explicit tier directives without calling classifier", async () => {
  let called = false;
  const decision = await routePrompt("::route max\nExplain this function", catalog, {
    classifier: { async classify() { called = true; } },
  });
  assert.equal(decision.tier, "max");
  assert.equal(decision.effort, "max");
  assert.equal(decision.prompt, "Explain this function");
  assert.equal(called, false);
});

test("supports explicit model and effort directives", async () => {
  const decision = await routePrompt(
    "::route model=gpt-5.6-terra effort=high\nReview this migration",
    catalog,
  );
  assert.equal(decision.tier, "custom");
  assert.equal(decision.model, "gpt-5.6-terra");
  assert.equal(decision.effort, "high");
});

test("supports route off without a classifier", async () => {
  const decision = await routePrompt("::route off\nExplain this", catalog);
  assert.equal(decision.tier, "off");
  assert.equal(decision.model, null);
});

test("rejects malformed directives", () => {
  assert.throws(() => extractRouteDirective("::route random\nDo work"), /Invalid route directive/);
});

test("fails visibly when semantic classifier is unavailable", async () => {
  await assert.rejects(() => routePrompt("Do work", catalog), /No semantic classifier/);
});
