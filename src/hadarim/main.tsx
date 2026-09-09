import React from "react";
import { createRoot } from "react-dom/client";
import { HadarimApp } from "./App";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/components.css";
import "./styles/hadarim.css";

// the report has its own page; the old `?app=report` address still works
if (new URLSearchParams(location.search).get("app") === "report") {
  const params = new URLSearchParams(location.search);
  params.delete("app");
  const rest = params.toString();
  location.replace(`report.html${rest ? `?${rest}` : ""}`);
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HadarimApp />
  </React.StrictMode>,
);
