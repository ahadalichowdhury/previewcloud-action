import * as core from "@actions/core";
import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";

export interface PreviewConfig {
  services: Record<string, ServiceConfig>;
  database?: DatabaseConfig;
  env?: Record<string, string>;
  password?: string;
}

export interface ServiceConfig {
  dockerfile: string;
  port?: number;
  env?: Record<string, string>;
  context?: string;
  buildArgs?: Record<string, string>;
}

export interface DatabaseConfig {
  type: "postgres" | "mysql" | "mongodb";
  migrations?: string;
}

/**
 * Parse preview.yaml configuration file
 */
export async function parseConfig(
  configFile: string,
  workingDirectory: string
): Promise<PreviewConfig> {
  const configPath = path.join(workingDirectory, configFile);

  // Check if file exists
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  try {
    // Read and parse YAML
    const fileContents = fs.readFileSync(configPath, "utf8");
    const config = yaml.load(fileContents) as PreviewConfig;

    // Validate configuration
    validateConfig(config);

    // Resolve relative paths
    resolveServicePaths(config, workingDirectory);

    return config;
  } catch (error) {
    throw new Error(`Failed to parse config file: ${(error as Error).message}`);
  }
}

/**
 * Validate configuration structure
 */
function validateConfig(config: PreviewConfig): void {
  if (!config) {
    throw new Error("Configuration is empty");
  }

  if (!config.services || typeof config.services !== "object") {
    throw new Error("services field is required and must be an object");
  }

  // Validate each service
  for (const [name, service] of Object.entries(config.services)) {
    if (!service.dockerfile) {
      throw new Error(
        `Service '${name}' is missing required field: dockerfile`
      );
    }

    // Check if dockerfile exists
    if (!fs.existsSync(service.dockerfile)) {
      core.warning(`Dockerfile not found at path: ${service.dockerfile}`);
    }

    if (service.port && (service.port < 1 || service.port > 65535)) {
      throw new Error(`Service '${name}' has invalid port: ${service.port}`);
    }
  }

  // Validate database config if present
  if (config.database) {
    const validTypes = ["postgres", "mysql", "mongodb"];
    if (!validTypes.includes(config.database.type)) {
      throw new Error(
        `Invalid database type: ${
          config.database.type
        }. Must be one of: ${validTypes.join(", ")}`
      );
    }
  }
}

/**
 * Resolve relative paths in service configurations
 */
function resolveServicePaths(
  config: PreviewConfig,
  workingDirectory: string
): void {
  for (const service of Object.values(config.services)) {
    // Resolve dockerfile path
    if (!path.isAbsolute(service.dockerfile)) {
      service.dockerfile = path.join(workingDirectory, service.dockerfile);
    }

    // Resolve context path
    if (service.context && !path.isAbsolute(service.context)) {
      service.context = path.join(workingDirectory, service.context);
    }
  }

  // Resolve migrations path if present
  if (
    config.database?.migrations &&
    !path.isAbsolute(config.database.migrations)
  ) {
    config.database.migrations = path.join(
      workingDirectory,
      config.database.migrations
    );
  }
}
