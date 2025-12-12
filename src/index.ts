import * as core from "@actions/core";
import * as github from "@actions/github";
import axios from "axios";
import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";

interface PreviewConfig {
  services: Record<string, any>;
  database?: any;
  secrets?: string[];
  env?: Record<string, string>;
}

interface PreviewResponse {
  success: boolean;
  data: {
    previewId: string;
    urls: Record<string, string>;
    status: string;
  };
  message?: string;
}

async function run(): Promise<void> {
  try {
    // Get inputs
    const apiToken = core.getInput("api-token", { required: true });
    const apiUrl = core.getInput("api-url") || "https://api.previewcloud.cloud";
    const configFile = core.getInput("config-file") || "preview.yaml";
    const workingDirectory = core.getInput("working-directory") || ".";
    const secretsInput = core.getInput("secrets") || "";
    const prNumberInput = core.getInput("pr-number");
    const action = core.getInput("action") || "auto";
    const commentOnPR = core.getInput("comment-on-pr") === "true";
    const waitForDeployment = core.getInput("wait-for-deployment") === "true";
    const timeout = parseInt(core.getInput("timeout") || "600");

    // Get context
    const context = github.context;
    const octokit = github.getOctokit(process.env.GITHUB_TOKEN || "");

    // Determine PR number
    const prNumber =
      prNumberInput || context.payload.pull_request?.number?.toString();

    if (!prNumber) {
      core.setFailed(
        "Could not determine PR number. Make sure this action runs on pull_request events."
      );
      return;
    }

    // Determine action based on event
    let actionToPerform = action;
    if (action === "auto") {
      if (context.payload.action === "closed") {
        actionToPerform = "destroy";
      } else if (
        ["opened", "synchronize", "reopened"].includes(
          context.payload.action || ""
        )
      ) {
        actionToPerform = "deploy";
      }
    }

    core.info(
      `🚀 PreviewCloud Action: ${actionToPerform} for PR #${prNumber}`
    );

    // Handle destroy action
    if (actionToPerform === "destroy") {
      await destroyPreview(apiUrl, apiToken, prNumber, context);
      core.setOutput("status", "destroyed");
      core.info("✅ Preview environment destroyed");
      return;
    }

    // Load preview.yaml
    const configPath = path.join(workingDirectory, configFile);
    if (!fs.existsSync(configPath)) {
      core.setFailed(`Config file not found: ${configPath}`);
      return;
    }

    const configContent = fs.readFileSync(configPath, "utf8");
    const config = yaml.load(configContent) as PreviewConfig;

    core.info(`📄 Loaded config from ${configFile}`);

    // Parse secrets
    const secrets: Record<string, string> = {};
    if (secretsInput) {
      const secretLines = secretsInput.split("\n").filter((line) => line.trim());
      for (const line of secretLines) {
        const [key, value] = line.split("=");
        if (key && value) {
          secrets[key.trim()] = value.trim();
        }
      }
    }

    // Build deployment payload
    const payload = {
      prNumber: parseInt(prNumber),
      repoName: context.repo.repo,
      repoOwner: context.repo.owner,
      branch: context.payload.pull_request?.head?.ref || "unknown",
      commitSha: context.sha,
      config,
      secrets,
      metadata: {
        actor: context.actor,
        eventName: context.eventName,
        action: context.payload.action,
      },
    };

    core.info("🔨 Deploying preview environment...");

    // Deploy preview
    const startTime = Date.now();
    const response = await deployPreview(
      apiUrl,
      apiToken,
      payload,
      waitForDeployment,
      timeout
    );
    const deploymentTime = Math.floor((Date.now() - startTime) / 1000);

    // Set outputs
    core.setOutput("preview-id", response.data.previewId);
    core.setOutput("preview-url", getPrimaryUrl(response.data.urls));
    core.setOutput("preview-urls", JSON.stringify(response.data.urls));
    core.setOutput("status", response.data.status);
    core.setOutput("deployment-time", deploymentTime.toString());

    core.info("✅ Preview environment deployed successfully!");
    core.info(`⏱️  Deployment time: ${deploymentTime}s`);

    // Log URLs
    core.info("🌐 Preview URLs:");
    for (const [service, url] of Object.entries(response.data.urls)) {
      core.info(`   ${service}: ${url}`);
    }

    // Comment on PR
    if (commentOnPR && process.env.GITHUB_TOKEN) {
      await commentOnPullRequest(
        octokit,
        context,
        prNumber,
        response.data.urls,
        response.data.previewId,
        deploymentTime
      );
    }
  } catch (error: any) {
    core.setFailed(`Action failed: ${error.message}`);
    core.error(error.stack || error.toString());
  }
}

async function deployPreview(
  apiUrl: string,
  apiToken: string,
  payload: any,
  wait: boolean,
  timeout: number
): Promise<PreviewResponse> {
  const response = await axios.post(`${apiUrl}/api/previews`, payload, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    timeout: timeout * 1000,
  });

  if (!response.data.success) {
    throw new Error(response.data.message || "Deployment failed");
  }

  // If wait is enabled, poll for completion
  if (wait) {
    const previewId = response.data.data.previewId;
    return await waitForDeploymentComplete(
      apiUrl,
      apiToken,
      previewId,
      timeout
    );
  }

  return response.data;
}

async function waitForDeploymentComplete(
  apiUrl: string,
  apiToken: string,
  previewId: string,
  timeout: number
): Promise<PreviewResponse> {
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds

  core.info("⏳ Waiting for deployment to complete...");

  while (Date.now() - startTime < timeout * 1000) {
    const response = await axios.get(
      `${apiUrl}/api/previews/${previewId}/status`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      }
    );

    const status = response.data.data.status;
    core.info(`   Status: ${status}`);

    if (status === "running") {
      return response.data;
    } else if (status === "failed") {
      throw new Error("Deployment failed");
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error("Deployment timeout");
}

async function destroyPreview(
  apiUrl: string,
  apiToken: string,
  prNumber: string,
  context: typeof github.context
): Promise<void> {
  core.info(`🗑️  Destroying preview for PR #${prNumber}...`);

  await axios.delete(
    `${apiUrl}/api/previews/${context.repo.owner}/${context.repo.repo}/${prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    }
  );
}

async function commentOnPullRequest(
  octokit: ReturnType<typeof github.getOctokit>,
  context: typeof github.context,
  prNumber: string,
  urls: Record<string, string>,
  previewId: string,
  deploymentTime: number
): Promise<void> {
  const urlList = Object.entries(urls)
    .map(([service, url]) => `- **${service}**: ${url}`)
    .join("\n");

  const comment = `
## 🚀 PreviewCloud - Preview Environment Ready!

**PR #${prNumber}** - \`${context.payload.pull_request?.head?.ref || "unknown"}\`

### 🌐 Live Preview URLs:
${urlList}

### 📊 Deployment Info:
- **Status**: ✅ Running
- **Preview ID**: \`${previewId}\`
- **Build Time**: ${deploymentTime}s
- **Commit**: \`${context.sha.substring(0, 7)}\`

---

💡 **This preview will:**
- ✅ Auto-update on new commits
- 🗑️ Auto-destroy when PR is closed/merged

<sub>Powered by [PreviewCloud](https://previewcloud.cloud)</sub>
`;

  try {
    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: parseInt(prNumber),
      body: comment,
    });
    core.info("💬 Comment posted on PR");
  } catch (error: any) {
    core.warning(`Failed to post comment: ${error.message}`);
  }
}

function getPrimaryUrl(urls: Record<string, string>): string {
  // Prioritize: web > frontend > api > first available
  return (
    urls.web ||
    urls.frontend ||
    urls.app ||
    urls.api ||
    Object.values(urls)[0] ||
    ""
  );
}

// Run the action
run();
