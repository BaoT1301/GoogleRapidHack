import { describe, expect, it } from "vitest";
import { parseMongoFirstHost, probeMongodb } from "./mcp-mongodb-reachability";

describe("parseMongoFirstHost", () => {
  it("parses a standard mongodb:// URI host:port", () => {
    expect(parseMongoFirstHost("mongodb://localhost:27017/orchestrator")).toEqual({
      host: "localhost",
      port: 27017,
      srv: false,
    });
  });

  it("takes the first host of a comma-separated replica set and strips credentials", () => {
    const cs =
      "mongodb://user:pass@host-a.example.net:27017,host-b.example.net:27017/db?ssl=true";
    expect(parseMongoFirstHost(cs)).toEqual({
      host: "host-a.example.net",
      port: 27017,
      srv: false,
    });
  });

  it("marks mongodb+srv URIs as srv (port comes from the SRV record)", () => {
    expect(parseMongoFirstHost("mongodb+srv://cluster.example.mongodb.net/db")).toEqual({
      host: "cluster.example.mongodb.net",
      port: 27017,
      srv: true,
    });
  });

  it("returns null for an unparseable string", () => {
    expect(parseMongoFirstHost("not-a-uri")).toBeNull();
  });
});

describe("probeMongodb", () => {
  it("is reachable when the first host TCP-connects", async () => {
    const r = await probeMongodb({
      env: { MDB_MCP_CONNECTION_STRING: "mongodb://db:27017/x" } as unknown as NodeJS.ProcessEnv,
      tcpConnect: async () => true,
    });
    expect(r.reachable).toBe(true);
  });

  it("is unreachable with a reason when the TCP connect fails", async () => {
    const r = await probeMongodb({
      env: { MDB_MCP_CONNECTION_STRING: "mongodb://db:27017/x" } as unknown as NodeJS.ProcessEnv,
      tcpConnect: async () => false,
    });
    expect(r.reachable).toBe(false);
    expect(r.reason).toMatch(/could not connect/i);
  });

  it("resolves SRV records before connecting for mongodb+srv URIs", async () => {
    const seen: string[] = [];
    const r = await probeMongodb({
      env: {
        MDB_MCP_CONNECTION_STRING: "mongodb+srv://cluster.example.mongodb.net/db",
      } as unknown as NodeJS.ProcessEnv,
      resolveSrvHosts: async (hostname) => {
        seen.push(hostname);
        return [{ name: "shard-00.example.mongodb.net", port: 27017 }];
      },
      tcpConnect: async (host) => host === "shard-00.example.mongodb.net",
    });
    expect(seen).toEqual(["cluster.example.mongodb.net"]);
    expect(r.reachable).toBe(true);
  });

  it("is unreachable when SRV resolution throws", async () => {
    const r = await probeMongodb({
      env: {
        MDB_MCP_CONNECTION_STRING: "mongodb+srv://cluster.example.mongodb.net/db",
      } as unknown as NodeJS.ProcessEnv,
      resolveSrvHosts: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(r.reachable).toBe(false);
    expect(r.reason).toMatch(/resolve SRV/i);
  });
});
