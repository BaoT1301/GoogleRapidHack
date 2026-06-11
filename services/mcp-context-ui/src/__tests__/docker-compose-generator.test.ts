/**
 * Tests for Docker Compose YAML generation logic.
 * Verifies that given configuration inputs produce expected YAML/env output.
 */
import { describe, it, expect } from "vitest";
import {
  generateDockerCompose,
  generateEnvFile,
  generateRunCommands,
  DEFAULT_CONFIG,
  type DockerConfig,
} from "../lib/docker-compose-generator";

describe("generateDockerCompose", () => {
  it("generates valid YAML with default config", () => {
    const yaml = generateDockerCompose(DEFAULT_CONFIG);

    expect(yaml).toContain("services:");
    expect(yaml).toContain("mcp-context-manager:");
    expect(yaml).toContain("mcp-ui:");
    expect(yaml).toContain("HTTP_PORT=3001");
    expect(yaml).toContain("WORKSPACE_ROOT=/workspace");
    expect(yaml).toContain("memory: 512M");
    expect(yaml).toContain('"8080:80"');
    expect(yaml).toContain("healthcheck:");
  });

  it("uses custom port configuration", () => {
    const config: DockerConfig = {
      ...DEFAULT_CONFIG,
      httpPort: 4000,
      uiPort: 9090,
    };
    const yaml = generateDockerCompose(config);

    expect(yaml).toContain("HTTP_PORT=4000");
    expect(yaml).toContain('"9090:80"');
    expect(yaml).toContain(`http://localhost:4000/api/v1/health`);
  });

  it("uses custom memory limit", () => {
    const config: DockerConfig = {
      ...DEFAULT_CONFIG,
      memoryLimit: "1G",
    };
    const yaml = generateDockerCompose(config);

    expect(yaml).toContain("memory: 1G");
  });

  it("generates volume mappings with read-only flag", () => {
    const config: DockerConfig = {
      ...DEFAULT_CONFIG,
      volumes: [
        { source: "src", readOnly: true },
        { source: "lib", readOnly: false },
      ],
    };
    const yaml = generateDockerCompose(config);

    expect(yaml).toContain("./src:/workspace/src:ro");
    expect(yaml).toContain("./lib:/workspace/lib");
    expect(yaml).not.toContain("./lib:/workspace/lib:ro");
  });

  it("includes log level in environment", () => {
    const config: DockerConfig = {
      ...DEFAULT_CONFIG,
      logLevel: "debug",
    };
    const yaml = generateDockerCompose(config);

    expect(yaml).toContain("LOG_LEVEL=debug");
  });

  it("generates proper service dependency", () => {
    const yaml = generateDockerCompose(DEFAULT_CONFIG);

    expect(yaml).toContain("depends_on:");
    expect(yaml).toContain("condition: service_healthy");
  });
});

describe("generateEnvFile", () => {
  it("generates env file with all config values", () => {
    const env = generateEnvFile(DEFAULT_CONFIG);

    expect(env).toContain("WORKSPACE_ROOT=./");
    expect(env).toContain("HTTP_PORT=3001");
    expect(env).toContain("UI_PORT=8080");
    expect(env).toContain("LOG_LEVEL=info");
    expect(env).toContain("MEMORY_LIMIT=512M");
  });

  it("reflects custom configuration", () => {
    const config: DockerConfig = {
      ...DEFAULT_CONFIG,
      workspaceRoot: "/home/user/project",
      httpPort: 5000,
      uiPort: 9000,
      logLevel: "warn",
      memoryLimit: "1G",
    };
    const env = generateEnvFile(config);

    expect(env).toContain("WORKSPACE_ROOT=/home/user/project");
    expect(env).toContain("HTTP_PORT=5000");
    expect(env).toContain("UI_PORT=9000");
    expect(env).toContain("LOG_LEVEL=warn");
    expect(env).toContain("MEMORY_LIMIT=1G");
  });
});

describe("generateRunCommands", () => {
  it("includes docker-compose up command", () => {
    const commands = generateRunCommands(DEFAULT_CONFIG);

    expect(commands).toContain("docker-compose up -d mcp-context-manager mcp-ui");
  });

  it("includes health check curl with correct port", () => {
    const config: DockerConfig = { ...DEFAULT_CONFIG, httpPort: 4000 };
    const commands = generateRunCommands(config);

    expect(commands).toContain("curl http://localhost:4000/api/v1/health");
  });

  it("includes open UI command with correct port", () => {
    const config: DockerConfig = { ...DEFAULT_CONFIG, uiPort: 9090 };
    const commands = generateRunCommands(config);

    expect(commands).toContain("open http://localhost:9090");
  });

  it("includes docker-compose down command", () => {
    const commands = generateRunCommands(DEFAULT_CONFIG);

    expect(commands).toContain("docker-compose down");
  });
});
