import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";

/**
 * Detect project type and build automatically
 */
export async function buildApplicationIfNeeded(
  serviceConfig: any,
  dockerfilePath: string
): Promise<void> {
  const contextPath = path.dirname(dockerfilePath);
  const buildDirPath = path.join(contextPath, "build");

  // Check if build directory already exists
  if (fs.existsSync(buildDirPath)) {
    core.info(`✅ Build directory already exists: ${buildDirPath}`);
    return;
  }

  core.info(`🔨 Build directory not found. Auto-building application...`);

  // Check for package.json (Node.js project)
  const packageJsonPath = path.join(contextPath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    await buildNodeApp(contextPath);
    return;
  }

  // Check for requirements.txt (Python project)
  const requirementsPath = path.join(contextPath, "requirements.txt");
  if (fs.existsSync(requirementsPath)) {
    await buildPythonApp(contextPath);
    return;
  }

  // Check for go.mod (Go project)
  const goModPath = path.join(contextPath, "go.mod");
  if (fs.existsSync(goModPath)) {
    await buildGoApp(contextPath);
    return;
  }

  // If we get here, we couldn't auto-detect
  core.warning(
    `⚠️  Could not auto-detect build system.\n` +
    `   Build directory not found: ${buildDirPath}\n` +
    `   Dockerfile expects: COPY build /usr/share/nginx/html\n` +
    `   Please add build steps to your workflow or ensure build directory exists.`
  );
}

async function buildNodeApp(contextPath: string): Promise<void> {
  core.info(`📦 Detected Node.js project. Installing dependencies...`);

  try {
    // Install dependencies
    await exec.exec("npm", ["install"], {
      cwd: contextPath,
    });

    core.info(`🔨 Building Node.js application...`);

    // Run build script
    await exec.exec("npm", ["run", "build"], {
      cwd: contextPath,
    });

    core.info(`✅ Node.js build completed successfully`);
  } catch (error) {
    core.error(`❌ Failed to build Node.js application: ${error}`);
    throw error;
  }
}

async function buildPythonApp(contextPath: string): Promise<void> {
  core.info(`🐍 Detected Python project. Installing dependencies...`);

  try {
    await exec.exec("pip", ["install", "-r", "requirements.txt"], {
      cwd: contextPath,
    });

    // Python apps might not need a build step, but check for setup.py or pyproject.toml
    const setupPyPath = path.join(contextPath, "setup.py");
    if (fs.existsSync(setupPyPath)) {
      await exec.exec("python", ["setup.py", "build"], {
        cwd: contextPath,
      });
    }

    core.info(`✅ Python build completed`);
  } catch (error) {
    core.error(`❌ Failed to build Python application: ${error}`);
    throw error;
  }
}

async function buildGoApp(contextPath: string): Promise<void> {
  core.info(`🐹 Detected Go project. Building...`);

  try {
    await exec.exec("go", ["build", "-o", "app", "./..."], {
      cwd: contextPath,
    });

    core.info(`✅ Go build completed`);
  } catch (error) {
    core.error(`❌ Failed to build Go application: ${error}`);
    throw error;
  }
}
