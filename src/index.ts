import * as core from "@actions/core";
import * as github from "@actions/github";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { buildAndPushImages } from "./docker-builder";

interface PreviewConfig {
  services: Record<string, any>;
  database?: any;
  secrets?: string[];
  env?: Record<string, string>;
  password?: string;
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
    // Only create Octokit if GITHUB_TOKEN is available (needed for PR comments)
    const githubToken = process.env.GITHUB_TOKEN;
    const octokit = githubToken ? github.getOctokit(githubToken) : null;

    // Determine preview type and identifier
    let previewType: "pull_request" | "branch";
    let previewIdentifier: string;
    let prNumber: number | undefined;
    let branchName: string;

    if (context.eventName === "pull_request") {
      // Pull request event
      previewType = "pull_request";
      prNumber = parseInt(
        prNumberInput || context.payload.pull_request?.number?.toString() || "0"
      );

      if (!prNumber || isNaN(prNumber)) {
        core.setFailed(
          "Could not determine PR number. Make sure this action runs on pull_request events."
        );
        return;
      }

      previewIdentifier = prNumber.toString();
      branchName = context.payload.pull_request?.head?.ref || context.ref.replace("refs/heads/", "");
    } else if (context.eventName === "push") {
      // Push event
      previewType = "branch";
      branchName = context.ref.replace("refs/heads/", "");

      if (!branchName) {
        core.setFailed("Could not determine branch name from push event.");
        return;
      }

      previewIdentifier = branchName;
    } else {
      core.setFailed(
        `Unsupported event type: ${context.eventName}. This action supports 'pull_request' and 'push' events.`
      );
      return;
    }

    // Determine action based on event
    let actionToPerform = action;
    if (action === "auto") {
      if (context.eventName === "pull_request" && context.payload.action === "closed") {
        actionToPerform = "destroy";
      } else if (
        context.eventName === "pull_request" &&
        ["opened", "synchronize", "reopened"].includes(
          context.payload.action || ""
        )
      ) {
        actionToPerform = "deploy";
      } else if (context.eventName === "push") {
        actionToPerform = "deploy";
      }
    }

    const previewLabel =
      previewType === "pull_request"
        ? `PR #${prNumber}`
        : `branch ${branchName}`;
    core.info(
      `🚀 PreviewCloud Action: ${actionToPerform} for ${previewLabel}`
    );

    // Handle destroy action
    if (actionToPerform === "destroy") {
      await destroyPreview(apiUrl, apiToken, previewIdentifier, previewType, context);
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

    // Use parseConfig to properly resolve paths
    const { parseConfig } = await import("./config-parser");
    const config = await parseConfig(configFile, workingDirectory);

    core.info(`📄 Loaded config from ${configFile}`);

    // Parse secrets into env variables
    const env: Record<string, string> = {};
    if (secretsInput) {
      const secretLines = secretsInput.split("\n").filter((line) => line.trim());
      for (const line of secretLines) {
        const [key, value] = line.split("=");
        if (key && value) {
          env[key.trim()] = value.trim();
        }
      }
    }

    // Merge config.env with parsed secrets
    if (config.env) {
      Object.assign(env, config.env);
    }

    // Build Docker images (GitHub Action has the code, so it builds)
    core.info("🔨 Building Docker images...");
    const registry = core.getInput("registry") || undefined;
    const registryUsername = core.getInput("registry-username") || undefined;
    const registryPassword = core.getInput("registry-password") || undefined;

    const imageTags = await buildAndPushImages(
      config.services,
      previewIdentifier,
      workingDirectory,
      registry,
      registryUsername,
      registryPassword
    );

    // Update services config with image tags
    const servicesWithImages: Record<string, any> = {};
    for (const [serviceName, serviceConfig] of Object.entries(config.services)) {
      servicesWithImages[serviceName] = {
        ...serviceConfig,
        imageTag: imageTags[serviceName] || (serviceConfig as any).imageTag, // Use built image or provided tag
      };
    }

    // Build deployment payload - match backend PreviewConfig interface
    const payload: any = {
      previewType,
      prNumber: previewType === "pull_request" ? prNumber : undefined,
      repoName: context.repo.repo,
      repoOwner: context.repo.owner,
      branch: branchName,
      commitSha: context.sha,
      services: servicesWithImages, // Services with image tags
      database: config.database, // Extract database from config
    };

    // Add optional fields only if they exist
    if (Object.keys(env).length > 0) {
      payload.env = env;
    }
    if (config.password) {
      payload.password = config.password;
    }

    // Debug: Log payload structure (without sensitive data)
    core.debug(`Payload structure: ${JSON.stringify({
      previewType: payload.previewType,
      prNumber: payload.prNumber,
      repoName: payload.repoName,
      repoOwner: payload.repoOwner,
      branch: payload.branch,
      commitSha: payload.commitSha?.substring(0, 7),
      servicesCount: Object.keys(payload.services || {}).length,
      hasDatabase: !!payload.database,
      hasEnv: !!payload.env,
    }, null, 2)}`);

    core.info("🔨 Deploying preview environment...");

    // Debug: Log payload structure (without sensitive data)
    core.debug(`Payload preview: ${JSON.stringify({
      previewType: payload.previewType,
      repoOwner: payload.repoOwner,
      repoName: payload.repoName,
      branch: payload.branch,
      servicesCount: Object.keys(payload.services || {}).length,
      hasDatabase: !!payload.database,
    }, null, 2)}`);

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

    // Comment on PR (only for pull_request events)
    if (
      commentOnPR &&
      octokit &&
      previewType === "pull_request" &&
      prNumber
    ) {
      await commentOnPullRequest(
        octokit,
        context,
        prNumber.toString(),
        response.data.urls,
        response.data.previewId,
        deploymentTime
      );
    } else if (commentOnPR && previewType === "pull_request" && !octokit) {
      core.warning("GITHUB_TOKEN not available. Skipping PR comment.");
    }
  } catch (error: any) {
    // Log full error details
    core.error(`\n=== Action Failed ===`);
    core.error(`Error Message: ${error.message}`);

    // If it's an axios error with response, log it again for visibility
    if (error.response) {
      core.error(`\nBackend Response Details:`);
      core.error(`Status: ${error.response.status}`);
      core.error(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
    }

    if (error.stack) {
      core.error(`\nStack Trace:`);
      core.error(error.stack);
    }

    core.error(`=====================\n`);

    // Set failed with the error message
    core.setFailed(`Action failed: ${error.message}`);
  }
}

async function deployPreview(
  apiUrl: string,
  apiToken: string,
  payload: any,
  wait: boolean,
  timeout: number
): Promise<PreviewResponse> {
  try {
    const response = await axios.post(`${apiUrl}/api/previews`, payload, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      timeout: timeout * 1000,
    });

    if (!response.data.success) {
      const errorMessage = response.data.message || response.data.error?.message || "Deployment failed";
      throw new Error(errorMessage);
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
  } catch (error: any) {
    // Enhanced error handling with detailed logging
    if (error.response) {
      // Server responded with error status
      const status = error.response.status;
      const errorData = error.response.data;

      // Always log full error response for debugging (even if it's verbose)
      core.error(`\n=== Backend Error Response (${status}) ===`);
      core.error(`Status Code: ${status}`);
      core.error(`Error Data: ${JSON.stringify(errorData, null, 2)}`);
      if (error.response.headers) {
        core.error(`Response Headers: ${JSON.stringify(error.response.headers, null, 2)}`);
      }
      core.error(`=========================================\n`);

      // Extract error message from various possible structures
      let errorMessage = `Request failed with status code ${status}`;

      if (errorData) {
        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else if (typeof errorData.error === 'string') {
          errorMessage = errorData.error;
        } else if (typeof errorData === 'string') {
          errorMessage = errorData;
        }
      }

      // Include full error data in the message for debugging
      const fullError = `${errorMessage} (Status: ${status})\n\nFull error response:\n${JSON.stringify(errorData, null, 2)}`;
      throw new Error(fullError);
    } else if (error.request) {
      // Request made but no response
      core.error(`\n=== No Response from Server ===`);
      core.error(`Request URL: ${error.config?.url}`);
      core.error(`Request Method: ${error.config?.method}`);
      core.error(`Request Headers: ${JSON.stringify(error.config?.headers, null, 2)}`);
      core.error(`================================\n`);
      throw new Error(`No response from server: ${error.message}`);
    } else {
      // Error setting up request
      core.error(`\n=== Request Setup Error ===`);
      core.error(`Error: ${error.message}`);
      core.error(`Stack: ${error.stack}`);
      core.error(`=======================\n`);
      throw new Error(`Request setup error: ${error.message}`);
    }
  }
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
  previewIdentifier: string,
  previewType: "pull_request" | "branch",
  context: typeof github.context
): Promise<void> {
  const previewLabel =
    previewType === "pull_request"
      ? `PR #${previewIdentifier}`
      : `branch ${previewIdentifier}`;
  core.info(`🗑️  Destroying preview for ${previewLabel}...`);

  // Use previewId endpoint (supports both PR and branch)
  await axios.delete(`${apiUrl}/api/previews/${previewIdentifier}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
  });
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
