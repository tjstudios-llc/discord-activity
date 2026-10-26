import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import "./styles.css";

function App() {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  const apiOrigin = import.meta.env.VITE_API_ORIGIN || "http://localhost:4000";
  const started = useRef(false);
  const [auth, setAuth] = useState({ status: "starting", message: "Preparing Discord authorization…" });
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;

    async function connectDiscord() {
      if (!clientId) {
        setAuth({ status: "configuration", message: "Set VITE_DISCORD_CLIENT_ID to your Discord application ID." });
        return;
      }
      try {
        const discordSdk = new DiscordSDK(clientId);
        await discordSdk.ready();
        const authorization = await discordSdk.commands.authorize({
          client_id: clientId,
          response_type: "code",
          state: "",
          prompt: "none",
          scope: ["identify"],
        });

        const response = await fetch(`${apiOrigin}/api/v1/auth/discord/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: authorization.code }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.message || `Authentication failed (${response.status}).`);
        }
        if (!cancelled) {
          setSession(result);
          setAuth({ status: "connected", message: "Discord identity verified by the TeamSpace API." });
        }
      } catch (error) {
        if (!cancelled) {
          setAuth({
            status: "error",
            message: error instanceof Error
              ? error.message
              : "Could not connect to Discord. Open this Activity inside Discord and check the application settings.",
          });
        }
      }
    }

    void connectDiscord();
    return () => { cancelled = true; };
  }, [clientId, apiOrigin]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">T</div>
        <div><p className="eyebrow">TEAM WORKSPACE</p><h1>TeamSpace</h1></div>
        <span className={`status-pill ${auth.status}`}><span className="status-dot" />{auth.status === "connected" ? "Connected" : auth.status === "starting" ? "Connecting" : "Setup needed"}</span>
      </header>

      <section className="hero">
        <p className="eyebrow">YOUR TEAM, IN SYNC</p>
        <h2>A calmer place to<br /><span>get work moving.</span></h2>
        <p className="intro">TeamSpace brings your team’s workspace into Discord, with customizable layouts, approved widgets, and real-time collaboration.</p>
      </section>

      <section className="setup-card" aria-labelledby="setup-title">
        <div className="card-icon" aria-hidden="true">{session ? "✓" : "↗"}</div>
        <div className="card-content">
          <h3 id="setup-title">{session ? `Welcome, ${session.user.displayName || session.user.username}` : "Connect your Discord account"}</h3>
          <p>{auth.message}</p>
          <ul className="checks">
            <li><span className="check-mark">✓</span> Workspace-first architecture</li>
            <li><span className="check-mark">✓</span> Discord identity verified server-side</li>
            <li><span className={session ? "check-mark" : "pending-mark"}>{session ? "✓" : "○"}</span> {session ? "Session created" : "Team and workspace setup comes next"}</li>
          </ul>
          <p className="config-line">API target: {apiOrigin}</p>
          {session && <p className="config-line">Session expires: {new Date(session.expiresAt).toLocaleString()}</p>}
        </div>
      </section>

      <footer><span>TEAMSPACE</span><span>Early development · Do not use for production</span></footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
