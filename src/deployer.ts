import * as core from "@actions/core";
import axios from "axios";
import { PreviewConfig } from "./config-parser";

export interface DeploymentOptions {
  apiUrl: string;
  apiToken: string;
  prNumber: number;
  repoName: string;
  repoOwner: string;
  branch: string;
  commitSha: string;
  config: PreviewConfig;
}

export interface DeploymentResult {
  success: boolean;
  urls: Record<string, string>;
  message?: string;
}

/**
 * Deploy preview environment via PreviewCloud API
 */
export async function deployPreview(
  options: DeploymentOptions
): Promise<DeploymentResult> {
  const {
    apiUrl,
    apiToken,
    prNumber,
    repoName,
    repoOwner,
    branch,
    commitSha,
    config,
  } = options;

  try {
    core.info("Calling PreviewCloud API...");

    // Prepare request payload
    const payload = {
      prNumber,
      repoName,
      repoOwner,
      branch,
      commitSha,
      services: config.services,
      database: config.database,
      env: config.env,
      password: config.password,
    };

    // Call PreviewCloud API
    const response = await axios.post(`${apiUrl}/api/previews`, payload, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      timeout: 300000, // 5 minutes
    });

    if (response.data.success) {
      const urls: Record<string, string> = {};

      // Extract URLs from response
      if (response.data.data?.urls) {
        Object.assign(urls, response.data.data.urls);
      } else if (response.data.data?.services) {
        // Extract URLs from services
        for (const service of response.data.data.services) {
          urls[service.name] = service.url;
        }
      }

      return {
        success: true,
        urls,
        message: response.data.message,
      };
    } else {
      throw new Error(response.data.error || "Deployment failed");
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      throw new Error(`API request failed: ${errorMessage}`);
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Check deployment status
 */
export async function checkDeploymentStatus(
  apiUrl: string,
  apiToken: string,
  prNumber: number
): Promise<any> {
  try {
    const response = await axios.get(`${apiUrl}/api/previews/${prNumber}`, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    });

    return response.data.data;
  } catch (error) {
    throw new Error(
      `Failed to check deployment status: ${(error as Error).message}`
    );
  }
}
