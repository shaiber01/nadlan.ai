/**
 * "Reset to seed": restores a project's ERP data, change log and the saved report versions of the seed
 * snapshot, and clears its control sessions, audit and heartbeats. Same effect as the reset button in the app.
 *
 *   npm run hadarim:reset            # project HADARIM
 *   npm run hadarim:reset -- OTHER   # another project id
 */
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_PROJECT_ID, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../src/hadarim/db/config";

const projectId = process.argv[2] ?? DEFAULT_PROJECT_ID;
const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY ?? SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });

const { error } = await supabase.rpc("reset_project", { p_project_id: projectId });
if (error) {
  console.error("✗ reset_project:", error);
  process.exit(1);
}
const { count } = await supabase.from("invoices").select("*", { count: "exact", head: true }).eq("project_id", projectId);
console.log(`✓ project ${projectId} reset to seed (${count} invoices)`);
