import { db } from "../db/client";

/** The people of a project, read directly (the monitor does not load the engine's package). */
export interface PersonRow {
  id: string;
  nameHe: string;
  roleHe: string;
  channel: string | null;
}

export async function loadPeople(projectId: string): Promise<PersonRow[]> {
  const { data, error } = await db().from("people").select("id, name_he, role_he, channel").eq("project_id", projectId).order("id");
  if (error) throw new Error(`people: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, nameHe: r.name_he, roleHe: r.role_he, channel: r.channel ?? null }));
}
