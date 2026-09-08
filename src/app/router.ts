import { useSyncExternalStore } from "react";

export type RouteName = "overview" | "projects" | "budget" | "records" | "documents" | "questions" | "reports" | "chat" | "knowledge" | "scenarios";

export interface Route {
  name: RouteName;
  params: URLSearchParams;
  hash: string;
}

const VALID: RouteName[] = ["overview", "projects", "budget", "records", "documents", "questions", "reports", "chat", "knowledge", "scenarios"];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const name = (VALID.includes(path as RouteName) ? path : "overview") as RouteName;
  return { name, params: new URLSearchParams(query), hash };
}

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function getSnapshot() {
  return window.location.hash || "#/overview";
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => "#/overview");
  return parseHash(hash);
}

export function navigate(hash: string) {
  const target = hash.startsWith("#") ? hash : `#/${hash}`;
  if (window.location.hash === target) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.hash = target;
}

export function routeWith(name: RouteName, params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") search.set(k, v);
  const q = search.toString();
  return `#/${name}${q ? `?${q}` : ""}`;
}
