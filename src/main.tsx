import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { store } from "./app/store";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/layout.css";

// Exposed for presenters and automated checks (read-only inspection of the demo state in the console).
(window as unknown as { __bakaraStore: typeof store }).__bakaraStore = store;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
