import { ServiceConfig } from "./config-parser";
export interface BuildResult {
    imageTag: string;
    serviceName: string;
}
/**
 * Build Docker images for services and push to registry
 */
export declare function buildAndPushImages(services: Record<string, ServiceConfig>, previewId: string, registry?: string, registryUsername?: string, registryPassword?: string): Promise<Record<string, string>>;
