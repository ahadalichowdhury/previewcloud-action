import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
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

      // Check if build directory is needed (for Dockerfiles that COPY build)
      const dockerfileContent = fs.readFileSync(finalDockerfilePath, "utf8");
      const needsBuildDir = /COPY\s+build\s+/i.test(dockerfileContent);

      if (needsBuildDir) {
        const buildDirPath = path.join(contextPath, "build");
        if (!fs.existsSync(buildDirPath)) {
          // List what's actually in the context directory
          const contextContents = fs.existsSync(contextPath)
            ? fs.readdirSync(contextPath).join(", ")
            : "directory does not exist";

          throw new Error(
            `❌ Build directory not found!\n` +
            `   Expected: ${buildDirPath}\n` +
            `   Context directory contents: ${contextContents}\n` +
            `   Dockerfile expects: COPY build /usr/share/nginx/html\n\n` +
            `   Solution: Add build steps to your workflow BEFORE the PreviewCloud action.\n` +
            `   Example:\n` +
            `     - name: Build frontend\n` +
            `       run: |\n` +
            `         cd frontend\n` +
            `         npm install\n` +
            `         npm run build`
          );
        }
        core.info(`   ✅ Build directory found: ${buildDirPath}`);
      }

      // Check if context path exists
      if (!fs.existsSync(contextPath)) {
        throw new Error(
          `Build context path does not exist: ${contextPath}\n` +
          `Make sure your application is built before running PreviewCloud action.`
        );
      }

      // Check for .dockerignore that might exclude build directory
      const dockerignorePath = path.join(contextPath, ".dockerignore");
      if (fs.existsSync(dockerignorePath)) {
        const dockerignoreContent = fs.readFileSync(dockerignorePath, "utf8");
        if (dockerignoreContent.includes("build") || dockerignoreContent.includes("build/")) {
          core.warning(
            `⚠️  WARNING: .dockerignore file excludes 'build' directory!\n` +
            `   This will prevent Docker from copying the build directory.\n` +
            `   Please remove 'build' or 'build/' from .dockerignore file.`
          );
          throw new Error(
            `.dockerignore is excluding the 'build' directory.\n` +
            `Remove 'build' or 'build/' from ${dockerignorePath}`
          );
        }
      }

      // List what Docker will actually see in build context
      const contextFiles = fs.readdirSync(contextPath);
      core.info(`   Build context contains: ${contextFiles.join(", ")}`);

      // Only check for build directory if Dockerfile needs it
      if (needsBuildDir && !contextFiles.includes("build")) {
        throw new Error(
          `❌ 'build' directory not found in Docker build context!\n` +
          `   Context path: ${contextPath}\n` +
          `   Files in context: ${contextFiles.join(", ")}\n` +
          `   Dockerfile expects: COPY build /usr/share/nginx/html\n` +
          `   This might be caused by .dockerignore excluding 'build' directory.\n` +
          `   Check for .dockerignore file in: ${contextPath}`
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

