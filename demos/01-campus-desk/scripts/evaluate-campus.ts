import { mkdirSync, writeFileSync } from "node:fs";
import cases from "../evaluation.json";
import { handbook } from "../lib/handbook";
import { ask } from "../lib/pipeline";

async function main() {
  const results = await Promise.all(
    cases.map(async (item) => {
      const result = await ask(handbook, item.question);
      return {
        question: item.question,
        passed: item.expected_source
          ? result.sources.some((source) => source.id === item.expected_source)
          : result.status === item.expected_status,
        status: result.status,
        sources: result.sources.map((source) => source.id),
      };
    }),
  );
  const report = {
    engine: "TypeScript BM25",
    passed: results.filter((item) => item.passed).length,
    cases: results.length,
    results,
    scope: "Synthetic retrieval checks, not an answer-quality benchmark.",
  };
  mkdirSync("reports", { recursive: true });
  writeFileSync(
    "reports/campus-typescript.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.passed !== report.cases) process.exitCode = 1;
}
void main();
