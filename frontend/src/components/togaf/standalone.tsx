// ============================================================
// Standalone Entry Point — TOGAF Dashboard
// Mounts the dashboard with StandalonePlanProvider (fetch polling)
// ============================================================

import { render } from "solid-js/web";
import "../../styles/tokens.css";
import { StandalonePlanProvider } from "./stores/planProvider";
import TOGAFDashboard from "./TOGAFDashboard";
import ToastContainer from "./controls/Toast";

const App = () => (
  <StandalonePlanProvider planUrl="/plan.json" pollIntervalMs={2000}>
    <TOGAFDashboard />
    <ToastContainer />
  </StandalonePlanProvider>
);

const root = document.getElementById("app");
if (root) {
  render(() => <App />, root);
}
