import { printErrorsAndWarnings } from "./print";
import { validateFirehose } from "./validate_firehose";
import { validateLogic } from "./validate_logic";
import { validateSchema } from "./validate_schema";
import { validateUrls } from "./validate_urls";
import { Octokit } from "@octokit/rest";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  throw new Error("GITHUB_TOKEN environment variable is required");
}

const octokit = new Octokit({
  auth: GITHUB_TOKEN,
});

async function createOrUpdateIssue(errors: string[], warnings: string[]) {
  const today = new Date().toISOString().split("T")[0];
  const issueTitle = "🔍 Maintenance Report";

  // Format the issue body
  const body = `## Maintenance Report (${today})

${errors.length > 0 ? "### ❌ Errors\n\n" + errors.map((e) => `- ${e}`).join("\n") : "✅ No errors found"}

${warnings.length > 0 ? "### ⚠️ Warnings\n\n" + warnings.map((w) => `- ${w}`).join("\n") : "✅ No warnings found"}

Generated at: ${new Date().toISOString()}`;

  try {
    // Search for existing maintenance issue
    const { data: issues } = await octokit.issues.listForRepo({
      owner: "graphprotocol",
      repo: "networks-registry",
      state: "open",
      creator: "github-actions[bot]",
    });

    const existingIssue = issues.find((issue) => issue.title === issueTitle);

    if (existingIssue) {
      // Update existing issue
      await octokit.issues.update({
        owner: "graphprotocol",
        repo: "networks-registry",
        assignees: ["YaroShkvorets"],
        issue_number: existingIssue.number,
        body,
      });
      console.log(`Updated existing issue #${existingIssue.number}`);
    } else {
      // Create new issue
      const { data: newIssue } = await octokit.issues.create({
        owner: "graphprotocol",
        repo: "networks-registry",
        title: issueTitle,
        body,
        assignees: ["YaroShkvorets"],
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

  // Print to console as before
  printErrorsAndWarnings(errors, warnings);

  // Create or update GitHub issue
  await createOrUpdateIssue(errors, warnings);
}

await main();
