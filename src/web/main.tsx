import { lazy, Suspense, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import "./styles.css";
import App from "./app.tsx";
import { installAdminAuthFetchPatch } from "./lib/admin-auth";

const FinancePage = lazy(() => import("./pages/finance"));
const isFinance =
  window.location.hostname === "dashboard.jamkkangudok.com" ||
  /^\/(?:dashboard\/)?finance\/?$/.test(window.location.pathname);
installAdminAuthFetchPatch();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router base="/dashboard">
      {isFinance ? (
        <Suspense
          fallback={
            <div style={{ padding: 40 }}>수익 대시보드 불러오는 중…</div>
          }
        >
          <FinancePage />
        </Suspense>
      ) : (
        <App />
      )}
    </Router>
  </StrictMode>,
);
