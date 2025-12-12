"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseConfig = parseConfig;
const core = __importStar(require("@actions/core"));
const fs = __importStar(require("fs"));
const yaml = __importStar(require("js-yaml"));
const path = __importStar(require("path"));
/**
 * Parse preview.yaml configuration file
 */
async function parseConfig(configFile, workingDirectory) {
    const configPath = path.join(workingDirectory, configFile);
    // Check if file exists
    if (!fs.existsSync(configPath)) {
        throw new Error(`Configuration file not found: ${configPath}`);
    }
    try {
        // Read and parse YAML
        const fileContents = fs.readFileSync(configPath, "utf8");
        const config = yaml.load(fileContents);
        // Validate configuration
        validateConfig(config);
        // Resolve relative paths
        resolveServicePaths(config, workingDirectory);
        return config;
    }
    catch (error) {
        throw new Error(`Failed to parse config file: ${error.message}`);
    }
}
/**
 * Validate configuration structure
 */
function validateConfig(config) {
    if (!config) {
        throw new Error("Configuration is empty");
    }
    if (!config.services || typeof config.services !== "object") {
        throw new Error("services field is required and must be an object");
    }
    // Validate each service
    for (const [name, service] of Object.entries(config.services)) {
        if (!service.dockerfile) {
            throw new Error(`Service '${name}' is missing required field: dockerfile`);
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
            throw new Error(`Invalid database type: ${config.database.type}. Must be one of: ${validTypes.join(", ")}`);
        }
    }
}
/**
 * Resolve relative paths in service configurations
 */
function resolveServicePaths(config, workingDirectory) {
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
    if (config.database?.migrations &&
        !path.isAbsolute(config.database.migrations)) {
        config.database.migrations = path.join(workingDirectory, config.database.migrations);
    }
}
