/**
 * @repo/data-core — the shared data layer imported by BOTH the orchestrator and the
 * standalone auth-bff service. Neither service owns the other; both depend on this
 * neutral package. Holds the Mongo models, db client, secrets vault, settings helpers,
 * and (added in the gateway phase) the Mongo persistence gateways.
 */
export * from "./db/client";
export * from "./db/models";
export * from "./secrets/vault";
export * from "./runtime/kiro-tools";
export * from "./runtime/cli-tool-catalogs";
