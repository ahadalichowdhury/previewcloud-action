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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deployPreview = deployPreview;
exports.checkDeploymentStatus = checkDeploymentStatus;
const core = __importStar(require("@actions/core"));
const axios_1 = __importDefault(require("axios"));
/**
 * Deploy preview environment via PreviewCloud API
 */
async function deployPreview(options) {
    const { apiUrl, apiToken, prNumber, repoName, repoOwner, branch, commitSha, config, } = options;
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
        const response = await axios_1.default.post(`${apiUrl}/api/previews`, payload, {
            headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
            },
            timeout: 300000, // 5 minutes
        });
        if (response.data.success) {
            const urls = {};
            // Extract URLs from response
            if (response.data.data?.urls) {
                Object.assign(urls, response.data.data.urls);
            }
            else if (response.data.data?.services) {
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
        }
        else {
            throw new Error(response.data.error || "Deployment failed");
        }
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error)) {
            const errorMessage = error.response?.data?.error?.message || error.message;
            throw new Error(`API request failed: ${errorMessage}`);
        }
        throw error instanceof Error ? error : new Error(String(error));
    }
}
/**
 * Check deployment status
 */
async function checkDeploymentStatus(apiUrl, apiToken, prNumber) {
    try {
        const response = await axios_1.default.get(`${apiUrl}/api/previews/${prNumber}`, {
            headers: {
                Authorization: `Bearer ${apiToken}`,
            },
        });
        return response.data.data;
    }
    catch (error) {
        throw new Error(`Failed to check deployment status: ${error.message}`);
    }
}
