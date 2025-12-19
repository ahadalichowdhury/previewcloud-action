import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import { ServiceConfig } from "./config-parser";

export interface BuildResult {
  imageTag: string;
  serviceName: string;
}

/**
 * Build Docker images for services and push to registry
 */
export async function buildAndPushImages(
  services: Record<string, ServiceConfig>,
  previewId: string,
  registry?: string,
  registryUsername?: string,
  registryPassword?: string
): Promise<Record<string, string>> {
  const imageTags: Record<string, string> = {};

  // Default to Docker Hub if no registry specified
  const targetRegistry = registry || "docker.io";
  const useRegistry = !!registry || !!registryUsername; // Use registry if explicitly set or credentials provided

  // Login to registry if credentials provided
  if (useRegistry && registryUsername && registryPassword) {
    core.info(`🔐 Logging into registry: ${targetRegistry}`);
    await exec.exec("docker", [
      "login",
      targetRegistry,
      "-u",
      registryUsername,
      "-p",
      registryPassword,
    ]);
  }

  // Build and push each service
  for (const [serviceName, serviceConfig] of Object.entries(services)) {
    if (!serviceConfig.dockerfile) {
      core.warning(
        `Service ${serviceName} has no dockerfile, skipping build`
      );
      continue;
    }

    try {
      // Generate image tag
      const imageName = `${previewId}-${serviceName}`.toLowerCase();
      // Use registry format: registry/username/image:tag or just image:tag for Docker Hub
      const imageTag = useRegistry && registryUsername
        ? `${targetRegistry}/${registryUsername}/${imageName}:latest`
        : useRegistry
        ? `${targetRegistry}/${imageName}:latest`
        : `previewcloud/${imageName}:latest`;

      core.info(`🔨 Building image for ${serviceName}: ${imageTag}`);

      // Determine build context
      const dockerfilePath = path.resolve(serviceConfig.dockerfile);
      const contextPath = serviceConfig.context
        ? path.resolve(serviceConfig.context)
        : path.dirname(dockerfilePath);

      // Build Docker image
      const buildArgs: string[] = [
        "build",
        "-f",
        dockerfilePath,
        "-t",
        imageTag,
      ];

      // Add build args if provided
      if (serviceConfig.buildArgs) {
        for (const [key, value] of Object.entries(serviceConfig.buildArgs)) {
          buildArgs.push("--build-arg", `${key}=${value}`);
        }
      }

      buildArgs.push(contextPath);

      await exec.exec("docker", buildArgs);

      // Push to registry if using registry
      if (useRegistry) {
        core.info(`📤 Pushing ${imageTag} to registry...`);
        await exec.exec("docker", ["push", imageTag]);
      } else {
        core.warning(
          `⚠️  No registry configured. Image ${imageTag} built locally but not pushed. ` +
          `Backend won't be able to pull this image. Please configure a registry.`
        );
      }

      // Store image tag for this service
      imageTags[serviceName] = imageTag;
      core.info(`✅ Built and pushed: ${imageTag}`);
    } catch (error) {
      core.error(`Failed to build image for ${serviceName}: ${error}`);
      throw error;
    }
  }

  return imageTags;
}

