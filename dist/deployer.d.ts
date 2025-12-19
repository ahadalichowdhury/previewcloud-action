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
export declare function deployPreview(options: DeploymentOptions): Promise<DeploymentResult>;
/**
 * Check deployment status
 */
export declare function checkDeploymentStatus(apiUrl: string, apiToken: string, prNumber: number): Promise<any>;
