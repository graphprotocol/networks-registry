import { printErrorsAndWarnings } from "./print";
import { validateFirehose } from "./validate_firehose";
import { validateLogic } from "./validate_logic";
import { validateSchema } from "./validate_schema";
import { validateUrls } from "./validate_urls";
import { Octokit } from "@octokit/rest";

const issueTitle = "🔍 Daily Maintenance Report";
const [owner, repo] = (process.env.GITHUB_REPOSITORY || "").split("/");
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});
const startTime = Date.now();

async function createOrUpdateIssue(errors: string[], warnings: string[]) {
  if (!owner || !repo) {
    console.error(
      "GITHUB_REPOSITORY environment variable is required. This script can only proceed from Github Actions workflow",
    );
    process.exit(1);
  }
  const body = `## Maintenance Report (${new Date().toISOString().split("T")[0]})

${
  errors.length > 0
    ? `### ❌ ${errors.length} Error${errors.length > 1 ? "s" : ""}\n\n` +
      errors
        .sort()
        .map((e) => `- [ ] ${e}`)
        .join("\n")
    : "### ✅ No errors found"
}

${
  warnings.length > 0
    ? `### ⚠️ ${warnings.length} Warning${warnings.length > 1 ? "s" : ""}\n\n` +
      warnings
        .sort()
        .map((w) => `- [ ] ${w}`)
        .join("\n")
    : "### ✅ No warnings found"
}

[View workflow run](https://github.com/${owner}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID})
Generated: ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC
Elapsed: ${((Date.now() - startTime) / 1000).toFixed(0)}s`;

  console.log(body);

  try {
    const { data: issues } = await octokit.issues.listForRepo({
      owner,
      repo,
      state: "open",
      creator: "github-actions[bot]",
    });

    const existingIssue = issues.find((issue) => issue.title === issueTitle);
    if (existingIssue) {
      await octokit.issues.update({
        owner,
        repo,
        issue_number: existingIssue.number,
        body,
      });

      // Add a comment if there are new errors
      const newErrors = errors.filter((e) => !existingIssue.body?.includes(e));
      if (newErrors.length > 0) {
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: existingIssue.number,
          body: `### 🚨 ${newErrors.length} new issue${
            newErrors.length > 1 ? "s" : ""
          }\n${newErrors.map((e) => `- [ ] ${e}`).join("\n")}`,
        });
      }

      console.log(`Updated existing issue #${existingIssue.number}`);
    } else {
      const { data: newIssue } = await octokit.issues.create({
        owner,
        repo,
        title: issueTitle,
        body: body,
        labels: ["maintenance"],
      });
      console.log(`Created new issue #${newIssue.number}`);
    }
  } catch (error) {
    console.error("Failed to create/update issue:", error);
    throw error;
  }
}

async function main() {
  const { errors: e1, warnings: w1 } = await validateSchema(
    "registry",
    "schemas/registry.schema.json",
  );
  const { errors: e2, warnings: w2 } = await validateUrls("registry");
  const { errors: e3, warnings: w3 } = await validateLogic("registry");
  const { errors: e4, warnings: w4 } = await validateFirehose("registry");

  const errors = [...e1, ...e2, ...e3, ...e4];
  const warnings = [...w1, ...w2, ...w3, ...w4];

  printErrorsAndWarnings(errors, warnings);

  await createOrUpdateIssue(errors, warnings);
}

await main();
