import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  const apiOrigin = import.meta.env.VITE_API_ORIGIN;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">T</div>
        <div><p className="eyebrow">TEAM WORKSPACE</p><h1>TeamSpace</h1></div>
        <span className="status-pill"><span className="status-dot" /> Foundation</span>
      </header>
      <section className="hero">
        <p className="eyebrow">YOUR TEAM, IN SYNC</p>
        <h2>A calmer place to<br /><span>get work moving.</span></h2>
        <p className="intro">TeamSpace brings your team’s workspace into Discord, with customizable layouts, approved widgets, and real-time collaboration.</p>
      </section>
      <section className="setup-card" aria-labelledby="setup-title">
        <div className="card-icon" aria-hidden="true">↗</div>
        <div className="card-content">
          <h3 id="setup-title">Development foundation</h3>
          <p>The application shell is online. Team data and Discord sign-in will appear here once the API, database, and verified Discord OAuth flow are configured.</p>
          <ul className="checks">
            <li><span className="check-mark">✓</span> Workspace-first architecture</li>
            <li><span className="check-mark">✓</span> Server-side data is the source of truth</li>
            <li><span className="pending-mark">○</span> Discord authentication not configured</li>
          </ul>
          <p className="config-line">{clientId ? "Discord application ID configured" : "Set VITE_DISCORD_CLIENT_ID when wiring the Activity SDK"}</p>
          <p className="config-line">{apiOrigin ? `API target: ${apiOrigin}` : "API target not configured"}</p>
        </div>
      </section>
      <footer><span>TEAMSPACE</span><span>Early development · Do not use for production</span></footer>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
