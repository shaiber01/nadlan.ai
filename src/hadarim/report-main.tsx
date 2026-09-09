import React from "react";
import { createRoot } from "react-dom/client";
import { ReportApp } from "./ReportApp";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/components.css";
import "./styles/hadarim.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ReportApp />
  </React.StrictMode>,
);
