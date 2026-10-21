import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { LiveProvider } from "./components/LiveProvider.js";
import { StatusBar } from "./components/StatusBar.js";
import { HistoryPage } from "./pages/HistoryPage.js";
import { MonitoringPage } from "./pages/MonitoringPage.js";
import { WorkersPage } from "./pages/WorkersPage.js";

export function App() {
  return (
    <LiveProvider>
      <header className="topbar">
        <span className="brand">LinkWatch</span>
        <nav>
          <NavLink to="/history">History</NavLink>
          <NavLink to="/workers">Workers</NavLink>
          <NavLink to="/monitoring">Monitoring</NavLink>
        </nav>
      </header>
      <main>
        <StatusBar />
        <Routes>
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/workers" element={<WorkersPage />} />
          <Route path="/monitoring" element={<MonitoringPage />} />
          <Route path="*" element={<Navigate to="/history" replace />} />
        </Routes>
      </main>
    </LiveProvider>
  );
}
