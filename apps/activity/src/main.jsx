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
  const [teams, setTeams] = useState([]);
  const [teamName, setTeamName] = useState("");
  const [teamStatus, setTeamStatus] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);

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
        if (!response.ok) throw new Error(result.message || `Authentication failed (${response.status}).`);
        if (cancelled) return;

        setSession(result);
        setAuth({ status: "connected", message: "Discord identity verified by the TeamSpace API." });
        try {
          const teamsResponse = await fetch(`${apiOrigin}/api/v1/teams`, {
            headers: { Authorization: `Bearer ${result.token}` },
          });
          const teamsPayload = await teamsResponse.json().catch(() => ({}));
          if (!teamsResponse.ok) throw new Error(teamsPayload.message || "Could not load teams.");
          if (!cancelled) setTeams(teamsPayload.teams ?? []);
        } catch (error) {
          if (!cancelled) setTeamStatus(error instanceof Error ? error.message : "Could not load teams.");
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

  async function createTeam(event) {
    event.preventDefault();
    if (!session?.token || !teamName.trim()) return;
    setCreatingTeam(true);
    setTeamStatus("");
    try {
      const response = await fetch(`${apiOrigin}/api/v1/teams`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ name: teamName.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `Could not create team (${response.status}).`);
      setTeams((current) => [...current, result.team]);
      setTeamName("");
      setTeamStatus("Team created and saved to PostgreSQL.");
    } catch (error) {
      setTeamStatus(error instanceof Error ? error.message : "Could not create team.");
    } finally {
      setCreatingTeam(false);
    }
  }

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

      {session && (
        <section className="teams-panel" aria-labelledby="teams-title">
          <div className="teams-heading">
            <div><p className="eyebrow">YOUR ORGANIZATION</p><h3 id="teams-title">Teams & workspaces</h3></div>
            <span className="team-count">{teams.length} {teams.length === 1 ? "team" : "teams"}</span>
          </div>
          <form className="team-form" onSubmit={createTeam}>
            <label htmlFor="team-name">Create a team</label>
            <div className="team-form-row">
              <input id="team-name" value={teamName} onChange={(event) => setTeamName(event.target.value)} maxLength={80} placeholder="e.g. Design team" required />
              <button type="submit" disabled={creatingTeam || !teamName.trim()}>{creatingTeam ? "Creating…" : "Create team"}</button>
            </div>
          </form>
          {teamStatus && <p className="team-status" role="status">{teamStatus}</p>}
          {teams.length > 0 ? (
            <div className="team-grid">
              {teams.map((team) => (
                <article className="team-card" key={team.id}>
                  <div className="team-card-top"><span className="team-avatar">{team.name.slice(0, 1).toUpperCase()}</span><span className="role-chip">{team.role}</span></div>
                  <h4>{team.name}</h4><p className="team-slug">/{team.slug}</p>
                  <div className="workspace-list">
                    {(team.workspaces ?? []).map((workspace) => <div className="workspace-row" key={workspace.id}><span className="workspace-icon">▦</span><span>{workspace.name}</span></div>)}
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="empty-teams">No teams yet. Create one to initialize your first workspace.</p>}
        </section>
      )}

      <footer><span>TEAMSPACE</span><span>Early development · Do not use for production</span></footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
