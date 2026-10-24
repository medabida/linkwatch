import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { LiveProvider } from "./components/LiveProvider.js";
import { StatusBar } from "./components/StatusBar.js";
import { HistoryPage } from "./pages/HistoryPage.js";
import { HomePage } from "./pages/HomePage.js";
import { MonitoringPage } from "./pages/MonitoringPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { WorkersPage } from "./pages/WorkersPage.js";

export function App() {
  return (
    <LiveProvider>
      <header className="topbar">
        <span className="brand">LinkWatch</span>
        <nav>
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/history">History</NavLink>
          <NavLink to="/workers">Workers</NavLink>
          <NavLink to="/monitoring">Monitoring</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <main>
        <StatusBar />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/workers" element={<WorkersPage />} />
          <Route path="/monitoring" element={<MonitoringPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </LiveProvider>
  );
}
