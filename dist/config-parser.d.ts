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
export declare function parseConfig(configFile: string, workingDirectory: string): Promise<PreviewConfig>;
