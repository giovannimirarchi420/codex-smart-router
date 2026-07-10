import assert from "node:assert/strict";
import test from "node:test";
import { TERSE_POLICY, transformClientMessage } from "../src/proxy.mjs";

const catalog = {
  models: [
    { slug: "gpt-5.6-sol", visibility: "list", supported_reasoning_levels: [{ effort: "high" }, { effort: "max" }] },
    { slug: "gpt-5.6-terra", visibility: "list", supported_reasoning_levels: [{ effort: "medium" }] },
    { slug: "gpt-5.6-luna", visibility: "list", supported_reasoning_levels: [{ effort: "low" }] },
    { slug: "gpt-5.4-mini", visibility: "list", supported_reasoning_levels: [{ effort: "low" }] },
  ],
};

const classifier = {
  async classify() {
    return {
      tier: "frontier",
      confidence: 0.95,
      taskType: "research",
      rationale: "Requires deep comparative judgment.",
      classifier: { provider: "test", model: "test", latencyMs: 1, usage: null },
    };
  },
};

test("patches top-level and collaboration-mode routing fields", async () => {
  const input = {
    id: 3,
    method: "turn/start",
    params: {
      threadId: "thread-1",
      input: [{ type: "text", text: "Deep research the architecture and compare alternatives" }],
      model: "gpt-5.4-mini",
      effort: "low",
      collaborationMode: {
        mode: "plan",
        settings: { model: "gpt-5.4-mini", reasoning_effort: "low", developer_instructions: null },
      },
    },
  };
  const result = await transformClientMessage(JSON.stringify(input), catalog, { classifier });
  const output = JSON.parse(result.raw);
  assert.equal(output.params.model, "gpt-5.6-sol");
  assert.equal(output.params.effort, "high");
  assert.equal(output.params.collaborationMode.settings.model, "gpt-5.6-sol");
  assert.equal(output.params.collaborationMode.settings.reasoning_effort, "high");
});

test("sets first-party verbosity on thread start", async () => {
  const input = {
    id: 1,
    method: "thread/start",
    params: { cwd: "/tmp", developerInstructions: "Existing instructions." },
  };
  const result = await transformClientMessage(JSON.stringify(input), catalog, { verbosity: "low", terse: true });
  const output = JSON.parse(result.raw);
  assert.equal(output.params.config.model_verbosity, "low");
  assert.match(output.params.developerInstructions, /Existing instructions/);
});

test("adds terse policy as turn context so collaboration modes cannot replace it", async () => {
  const input = {
    id: 2,
    method: "turn/start",
    params: {
      threadId: "thread-1",
      input: [{ type: "text", text: "Explain this function" }],
      collaborationMode: {
        mode: "default",
        settings: { model: "gpt-5.4-mini", reasoning_effort: "low", developer_instructions: null },
      },
    },
  };
  const result = await transformClientMessage(JSON.stringify(input), catalog, { terse: true, classifier });
  const output = JSON.parse(result.raw);
  assert.equal(
    output.params.additionalContext["codex-smart-router.output-policy"].value,
    TERSE_POLICY,
  );
});

test("does not route a turn explicitly marked off", async () => {
  const input = {
    id: 4,
    method: "turn/start",
    params: {
      threadId: "thread-1",
      input: [{ type: "text", text: "::route off\nExplain this" }],
      model: "gpt-5.6-sol",
      effort: "xhigh",
    },
  };
  const result = await transformClientMessage(JSON.stringify(input), catalog);
  const output = JSON.parse(result.raw);
  assert.equal(output.params.model, "gpt-5.6-sol");
  assert.equal(output.params.effort, "xhigh");
  assert.equal(output.params.input[0].text, "Explain this");
});
