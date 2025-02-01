import { printErrorsAndWarnings } from "./print";
import { validateFirehose } from "./validate_firehose";
import { validateLogic } from "./validate_logic";
import { validateSchema } from "./validate_schema";
import { validateUrls } from "./validate_urls";
import { Octokit } from "@octokit/rest";

const issueTitle = "🔍 Daily Maintenance Report";
const assignees = ["YaroShkvorets"];
const [owner, repo] = (process.env.GITHUB_REPOSITORY || "").split("/");
if (!owner || !repo) {
  console.error(
    "GITHUB_REPOSITORY environment variable is required. This script can only proceed from Github Actions workflow",
  );
  process.exit(1);
}
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

async function createOrUpdateIssue(errors: string[], warnings: string[]) {
  const body = `## Maintenance Report (${new Date().toISOString().split("T")[0]})

${errors.length > 0 ? "### ❌ Errors\n\n" + errors.map((e) => `- [ ] ${e}`).join("\n") : "### ✅ No errors found"}

${warnings.length > 0 ? "### ⚠️ Warnings\n\n" + warnings.map((w) => `- [ ] ${w}`).join("\n") : "### ✅ No warnings found"}

<!-- maintenance-stats
errors: ${errors.length}
warnings: ${warnings.length}
date: ${new Date().toISOString()}
-->
`;

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
      const statsMatch = existingIssue.body?.match(
        /<!-- maintenance-stats\nerrors: (\d+)\nwarnings: (\d+)/,
      );
      const errorDiff = statsMatch
        ? errors.length - parseInt(statsMatch[1] ?? "0")
        : errors.length;
      const warningDiff = statsMatch
        ? warnings.length - parseInt(statsMatch[2] ?? "0")
        : warnings.length;

      const comparisonText = `### 📊 Changes Since Last Run
${errorDiff !== 0 ? `- Errors: ${errorDiff > 0 ? `+${errorDiff}` : errorDiff} (${errors.length} total)\n` : "- Errors: No change"}
${warningDiff !== 0 ? `- Warnings: ${warningDiff > 0 ? `+${warningDiff}` : warningDiff} (${warnings.length} total)\n` : "- Warnings: No change"}`;

      await octokit.issues.update({
        owner,
        repo,
        assignees,
        issue_number: existingIssue.number,
        body: `${body}\n\n${comparisonText}\n\nGenerated at: ${new Date().toISOString()}`,
      });

      // Add a comment if there are new errors
      if (errorDiff > 0) {
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: existingIssue.number,
          body: `🚨 ${errorDiff} new potential error${errorDiff > 1 ? "s" : ""} detected`,
        });
      }

      console.log(`Updated existing issue #${existingIssue.number}`);
    } else {
      const { data: newIssue } = await octokit.issues.create({
        owner,
        repo,
        title: issueTitle,
        body: `${body}\n\nGenerated at: ${new Date().toISOString()}`,
        assignees,
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
