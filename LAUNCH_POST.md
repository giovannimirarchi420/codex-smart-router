# Codex Smart Router: one-line install, per-turn model routing

Codex Smart Router is now available as an npm package:

```bash
npx codex-smart-router
```

It adds a local semantic control layer to Codex CLI. Easy turns stay on an economical model; ambiguous or high-risk work can use stronger reasoning. The existing Codex workflow remains intact, and a local dashboard shows the routing and estimated cost.

On a 42-turn audit of the repository itself, the router selected `gpt-5.4-mini`, `gpt-5.6-luna`, and `gpt-5.6-terra`. Using the pricing configured in `src/dashboard.mjs`, the run cost an estimated **USD 3.11**, versus **USD 9.72** for sending the same observed token mix to `gpt-5.5`: **USD 6.62 saved, or 68.0%**.

That is a cost measurement, not a quality claim: the fixed-model baselines were counterfactual and the App Server completion signal is operational, not human review. The point is to make the trade-off visible and measurable on your own workload.

Install globally if you use it often:

```bash
npm install --global codex-smart-router
codex-smart
```

Repository: https://github.com/giovannimirarchi420/codex-smart-router
