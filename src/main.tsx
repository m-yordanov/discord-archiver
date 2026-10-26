import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CrashPanel, ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary
      fallback={(error) => (
        <div className="flex h-screen w-screen">
          <CrashPanel
            title="Discord Archiver ran into an error"
            error={error}
            actionLabel="Reload"
            onAction={() => window.location.reload()}
          />
        </div>
      )}
    >
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
