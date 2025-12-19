import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";
import { buildApplicationIfNeeded } from "./build-detector";
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
  workingDirectory: string = process.cwd(),
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

      // Paths should already be resolved by parseConfig, but handle both cases
      // Paths should already be absolute from parseConfig, but handle both cases
      let dockerfilePath = path.isAbsolute(serviceConfig.dockerfile)
        ? serviceConfig.dockerfile
        : path.resolve(workingDirectory, serviceConfig.dockerfile);

      // Remove any invalid path components (like docker.io accidentally included)
      dockerfilePath = path.normalize(dockerfilePath.replace(/[\/\\]docker\.io[\/\\]/gi, '/'));

      let contextPath: string;
      if (serviceConfig.context) {
        contextPath = path.isAbsolute(serviceConfig.context)
          ? serviceConfig.context
          : path.resolve(workingDirectory, serviceConfig.context);
        contextPath = path.normalize(contextPath.replace(/[\/\\]docker\.io[\/\\]/gi, '/'));
      } else {
        contextPath = path.dirname(dockerfilePath);
      }

      const finalDockerfilePath = dockerfilePath;

      // Debug: Log paths
      core.info(`   Dockerfile: ${finalDockerfilePath}`);
      core.info(`   Build context: ${contextPath}`);

      // Verify dockerfile exists
      if (!fs.existsSync(finalDockerfilePath)) {
        throw new Error(
          `❌ Dockerfile not found: ${finalDockerfilePath}\n` +
          `   Check your preview.yaml - dockerfile path should be relative to repo root.\n` +
          `   Example: frontend/Dockerfile (not docker.io/frontend/Dockerfile)`
        );
      }

      // Auto-build application if needed
      await buildApplicationIfNeeded(serviceConfig, finalDockerfilePath);

      // Verify build directory exists after auto-build
      const buildDirPath = path.join(contextPath, "build");
      if (!fs.existsSync(buildDirPath)) {
        // List what's actually in the context directory
        const contextContents = fs.existsSync(contextPath)
          ? fs.readdirSync(contextPath).join(", ")
          : "directory does not exist";

        throw new Error(
          `❌ Build directory not found after auto-build!\n` +
          `   Expected: ${buildDirPath}\n` +
          `   Context directory contents: ${contextContents}\n` +
          `   Dockerfile expects: COPY build /usr/share/nginx/html\n\n` +
          `   Please ensure your build process creates a 'build' directory, or add build steps to your workflow.`
        );
      }

      core.info(`   ✅ Build directory found: ${buildDirPath}`);

      // Check if context path exists
      if (!fs.existsSync(contextPath)) {
        throw new Error(
          `Build context path does not exist: ${contextPath}\n` +
          `Make sure your application is built before running PreviewCloud action.`
        );
      }

      // Build Docker image
      const buildArgs: string[] = [
        "build",
        "-f",
        finalDockerfilePath,
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