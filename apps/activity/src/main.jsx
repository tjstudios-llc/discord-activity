import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import "./styles.css";

function App() {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  const apiOrigin = (import.meta.env.VITE_API_ORIGIN || "").replace(/\/$/, "");
  const started = useRef(false);
  const [auth, setAuth] = useState({ status: "starting", message: "Preparing Discord authorization…" });
  const [session, setSession] = useState(null);
  const [teams, setTeams] = useState([]);
  const [teamName, setTeamName] = useState("");
  const [teamStatus, setTeamStatus] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskStatus, setTaskStatus] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);

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
        const { access_token: discordAccessToken, ...teamspaceSession } = result;
        if (!discordAccessToken) throw new Error("The API did not return a Discord access token.");
        await discordSdk.commands.authenticate({ access_token: discordAccessToken });
        if (cancelled) return;

        setSession(teamspaceSession);
        setAuth({ status: "connected", message: "Discord identity verified by the TeamSpace API." });
        try {
          const teamsResponse = await fetch(`${apiOrigin}/api/v1/teams`, {
            headers: { Authorization: `Bearer ${teamspaceSession.token}` },
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
      const initialWorkspace = result.team.workspaces?.[0];
      if (initialWorkspace) void openWorkspace(initialWorkspace, result.team.role, session.token);
    } catch (error) {
      setTeamStatus(error instanceof Error ? error.message : "Could not create team.");
    } finally {
      setCreatingTeam(false);
    }
  }

  async function openWorkspace(workspace, role, token = session?.token) {
    if (!token) return;
    setSelectedWorkspace({ ...workspace, teamRole: role });
    setTasks([]);
    setTaskStatus("Loading tasks…");
    try {
      const response = await fetch(`${apiOrigin}/api/v1/workspaces/${workspace.id}/tasks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Could not load tasks.");
      setTasks(result.tasks ?? []);
      setTaskStatus("");
    } catch (error) {
      setTaskStatus(error instanceof Error ? error.message : "Could not load tasks.");
    }
  }

  async function createTask(event) {
    event.preventDefault();
    if (!session?.token || !selectedWorkspace || !taskTitle.trim()) return;
    setCreatingTask(true);
    setTaskStatus("");
    try {
      const response = await fetch(`${apiOrigin}/api/v1/workspaces/${selectedWorkspace.id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ title: taskTitle.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Could not create task.");
      setTasks((current) => [...current, result.task].sort((a, b) => a.position - b.position));
      setTaskTitle("");
      setTaskStatus("Task saved to PostgreSQL.");
    } catch (error) {
      setTaskStatus(error instanceof Error ? error.message : "Could not create task.");
    } finally {
      setCreatingTask(false);
    }
  }

  async function toggleTask(task) {
    if (!session?.token || !selectedWorkspace) return;
    setTaskStatus("");
    try {
      const response = await fetch(`${apiOrigin}/api/v1/workspaces/${selectedWorkspace.id}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ status: task.status === "DONE" ? "TODO" : "DONE" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Could not update task.");
      setTasks((current) => current.map((item) => item.id === task.id ? result.task : item));
    } catch (error) {
      setTaskStatus(error instanceof Error ? error.message : "Could not update task.");
    }
  }

  async function deleteTask(task) {
    if (!session?.token || !selectedWorkspace) return;
    setTaskStatus("");
    try {
      const response = await fetch(`${apiOrigin}/api/v1/workspaces/${selectedWorkspace.id}/tasks/${task.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || "Could not delete task.");
      }
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setTaskStatus("Task deleted.");
    } catch (error) {
      setTaskStatus(error instanceof Error ? error.message : "Could not delete task.");
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
          <p className="config-line">API target: {apiOrigin || "same-origin /api proxy"}</p>
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
                    {(team.workspaces ?? []).map((workspace) => <button type="button" className="workspace-row" key={workspace.id} onClick={() => openWorkspace(workspace, team.role, session.token)}><span className="workspace-icon">▦</span><span>{workspace.name}</span><span className="workspace-open">Open</span></button>)}
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="empty-teams">No teams yet. Create one to initialize your first workspace.</p>}
        </section>
      )}


      {selectedWorkspace && session && (
        <section className="tasks-panel" aria-labelledby="tasks-title">
          <div className="teams-heading">
            <div><p className="eyebrow">WORKSPACE</p><h3 id="tasks-title">{selectedWorkspace.name} tasks</h3></div>
            <span className="team-count">{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span>
          </div>
          <form className="team-form" onSubmit={createTask}>
            <label htmlFor="task-title">Add a task</label>
            <div className="team-form-row">
              <input id="task-title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} maxLength={160} placeholder="What needs to get done?" required />
              <button type="submit" disabled={creatingTask || !taskTitle.trim()}>{creatingTask ? "Saving…" : "Add task"}</button>
            </div>
          </form>
          {taskStatus && <p className="team-status" role="status">{taskStatus}</p>}
          <div className="task-list">
            {tasks.map((task) => (
              <article className={`task-row ${task.status === "DONE" ? "task-done" : ""}`} key={task.id}>
                <button type="button" className="task-toggle" aria-label={task.status === "DONE" ? "Mark task incomplete" : "Mark task complete"} onClick={() => toggleTask(task)}>{task.status === "DONE" ? "✓" : "○"}</button>
                <div className="task-copy"><h4>{task.title}</h4><p>{task.status.replaceAll("_", " ")}</p></div>
                {["OWNER", "ADMIN", "EDITOR"].includes(selectedWorkspace.teamRole) && <button type="button" className="task-delete" aria-label={`Delete ${task.title}`} onClick={() => deleteTask(task)}>×</button>}
              </article>
            ))}
            {tasks.length === 0 && !taskStatus && <p className="empty-teams">No tasks in this workspace yet.</p>}
          </div>
        </section>
      )}
      <footer><span>TEAMSPACE</span><span>Early development · Do not use for production</span></footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
