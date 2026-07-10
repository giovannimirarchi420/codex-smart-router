import assert from "node:assert/strict";
import test from "node:test";
import { createClassifier, OpenAIClassifier } from "../src/classifier.mjs";

test("OpenAI classifier requests strict structured output and parses usage", async () => {
  let request;
  const classifier = new OpenAIClassifier({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({
        output_text: JSON.stringify({
          tier: "complex",
          confidence: 0.88,
          taskType: "infrastructure",
          rationale: "Requires repository analysis and deployment configuration.",
        }),
        usage: {
          input_tokens: 250,
          input_tokens_details: { cached_tokens: 100 },
          output_tokens: 40,
          output_tokens_details: { reasoning_tokens: 12 },
          total_tokens: 290,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await classifier.classify({
    prompt: "Create a Helm chart",
    history: ["Inspect this repository"],
  });
  assert.equal(request.model, "gpt-5.4-nano");
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(result.tier, "complex");
  assert.equal(result.classifier.usage.reasoningOutputTokens, 12);
});

test("auto mode uses native Codex auth when API key is absent", () => {
  const classifier = createClassifier({ mode: "auto", env: {} });
  assert.equal(classifier.provider, "codex-native");
  assert.equal(classifier.model, "gpt-5.4-mini");
});

test("auto mode prefers nano API classifier when API key exists", () => {
  const classifier = createClassifier({ mode: "auto", env: { OPENAI_API_KEY: "test" } });
  assert.equal(classifier.provider, "openai-api");
  assert.equal(classifier.model, "gpt-5.4-nano");
});
