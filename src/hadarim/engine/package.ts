import { generateHadarimPackage } from "../data/generate";
import type { HadarimPackage } from "../data/types";

/**
 * The project package the engine works on — reference data (project, people, suppliers, sections,
 * contracts, BOQ, forecast versions, documents) plus the seed's ERP rows. It starts as the deterministic
 * generator output (offline mode, tests) and is replaced by the database load when the app, the tools or
 * the CLI connect; importers see the new value because ES module bindings are live.
 */
export let pkg: HadarimPackage = generateHadarimPackage();

export function setPackage(next: HadarimPackage): void {
  pkg = next;
}
