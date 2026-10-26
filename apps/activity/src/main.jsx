import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import "./styles.css";

const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || "").replace(/\/$/, "");
const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function apiUrl(path) {
  return `${API_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

async function apiRequest(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response;
  try {
    response = await fetch(apiUrl(path), { ...options, headers, cache: "no-store" });
  } catch {
    throw new Error("The TeamSpace API could not be reached. Check the Activity proxy and API service.");
  }

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || `Request failed with status ${response.status}.`;
    throw new ApiError(message, response.status);
  }
  if (payload === null) throw new Error("The API returned an unreadable response.");
  return payload;
}

function initials(value = "") {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "T";
}

function formatDate(value) {
  if (!value) return "Recently";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function App() {
  const [authAttempt, setAuthAttempt] = useState(0);
  const [auth, setAuth] = useState({ status: "starting", message: "Preparing your secure Discord connection." });
  const [session, setSession] = useState(null);
  const [teams, setTeams] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [activeView, setActiveView] = useState("overview");
  const [teamName, setTeamName] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [teamStatus, setTeamStatus] = useState("");
  const [taskStatus, setTaskStatus] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const loadTeams = useCallback(async (token) => {
    setLoadingTeams(true);
    try {
      const result = await apiRequest("/api/v1/teams", { token });
      setTeams(Array.isArray(result.teams) ? result.teams : []);
      setTeamStatus("");
    } catch (error) {
      setTeamStatus(error instanceof Error ? error.message : "Could not load teams.");
    } finally {
      setLoadingTeams(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let issuedSessionToken = null;

    async function connect() {
      if (!CLIENT_ID) {
        setAuth({ status: "configuration", message: "The Activity is missing VITE_DISCORD_CLIENT_ID. Configure the public Discord application ID and rebuild the frontend." });
        return;
      }

      setAuth({ status: "starting", message: "Connecting to Discord's embedded Activity SDK…" });
      try {
        const discordSdk = new DiscordSDK(CLIENT_ID);
        await discordSdk.ready();
        if (cancelled) return;

        setAuth({ status: "authorizing", message: "Verifying your Discord identity securely…" });
        const authorization = await discordSdk.commands.authorize({
          client_id: CLIENT_ID,
          response_type: "code",
          state: "",
          prompt: "none",
          scope: ["identify"],
        });
        if (!authorization?.code) throw new Error("Discord did not return an authorization code. Retry the connection from inside Discord.");

        const exchange = await apiRequest("/api/v1/auth/discord/exchange", {
          method: "POST",
          body: JSON.stringify({ code: authorization.code }),
        });
        const { access_token: discordAccessToken, ...teamspaceSession } = exchange || {};
        if (!discordAccessToken || !teamspaceSession.token || !teamspaceSession.user) {
          throw new Error("The authentication service returned an incomplete session. Please retry.");
        }
        issuedSessionToken = teamspaceSession.token;

        setAuth({ status: "finishing", message: "Finishing your Discord connection…" });
        await discordSdk.commands.authenticate({ access_token: discordAccessToken });
        if (cancelled) {
          void apiRequest("/api/v1/auth/logout", { method: "POST", token: issuedSessionToken }).catch(() => {});
          return;
        }

        setSession(teamspaceSession);
        setAuth({ status: "connected", message: "Your Discord identity is verified." });
        await loadTeams(teamspaceSession.token);
      } catch (error) {
        if (issuedSessionToken) {
          void apiRequest("/api/v1/auth/logout", { method: "POST", token: issuedSessionToken }).catch(() => {});
        }
        if (!cancelled) {
          setSession(null);
          setAuth({
            status: "error",
            message: error instanceof Error ? error.message : "Could not complete Discord authentication.",
          });
        }
      }
    }

    void connect();
    return () => { cancelled = true; };
  }, [authAttempt, loadTeams]);

  const workspaceCount = useMemo(
    () => teams.reduce((count, team) => count + (team.workspaces?.length || 0), 0),
    [teams],
  );
  const openTaskCount = useMemo(() => tasks.filter((task) => task.status !== "DONE" && task.status !== "ARCHIVED").length, [tasks]);

  async function openWorkspace(workspace, role) {
    if (!session?.token) return;
    setSelectedWorkspace({ ...workspace, teamRole: role });
    setActiveView("tasks");
    setTasks([]);
    setLoadingTasks(true);
    setTaskStatus("");
    try {
      const result = await apiRequest(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/tasks`, { token: session.token });
      setTasks(Array.isArray(result.tasks) ? result.tasks : []);
    } catch (error) {
      setTaskStatus(error instanceof Error ? error.message : "Could not load workspace tasks.");
    } finally {
      setLoadingTasks(false);
    }
  }

  async function createTeam(event) {
    event.preventDefault();
    const name = teamName.trim();
    if (!session?.token || !name || creatingTeam) return;
    setCreatingTeam(true);
    setTeamStatus("");
    try {
      const result = await apiRequest("/api/v1/teams", {
        method: "POST",
        token: session.token,
        body: JSON.stringify({ name }),
      });
      if (!result?.team) throw new Error("The API did not return the created team.");
      setTeams((current) => [...current, result.team]);
      setTeamName("");
      setTeamStatus("Team created and saved.");
      const workspace = result.team.workspaces?.[0];
      if (workspace) void openWorkspace(workspace, result.team.role);
    } catch (error) {
      setTeamStatus(error instanceof Error ? error.message : "Could not create team.");
    } finally {
      setCreatingTeam(false);
    }
  }

  async function createTask(event) {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!session?.token || !selectedWorkspace || !title || creatingTask) return;
    setCreatingTask(true);
    setTaskStatus("");
    try {
      const result = await apiRequest(`/api/v1/workspaces/${encodeURIComponent(selectedWorkspace.id)}/tasks`, {
        method: "POST",
        token: session.token,
        body: JSON.stringify({ title }),
      });
      if (!result?.task) throw new Error("The API did not return the created task.");
      setTasks((current) => [...current, result.task].sort((a, b) => a.position - b.position));
      setTaskTitle("");
      setTaskStatus("Task saved to your workspace.");
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
      const result = await apiRequest(`/api/v1/workspaces/${encodeURIComponent(selectedWorkspace.id)}/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        token: session.token,
        body: JSON.stringify({ status: task.status === "DONE" ? "TODO" : "DONE" }),
      });
      setTasks((current) => current.map((item) => item.id === task.id ? result.task : item));
    } catch (error) {
      setTaskStatus(error instanceof Error ? error.message : "Could not update task.");
    }
  }

  async function deleteTask(task) {
    if (!session?.token || !selectedWorkspace) return;
    setTaskStatus("");
    try {
      await apiRequest(`/api/v1/workspaces/${encodeURIComponent(selectedWorkspace.id)}/tasks/${encodeURIComponent(task.id)}`, {
        method: "DELETE",
        token: session.token,
      });
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setTaskStatus("Task deleted.");
    } catch (error) {
      setTaskStatus(error instanceof Error ? error.message : "Could not delete task.");
    }
  }

  async function signOut() {
    if (!session?.token || signingOut) return;
    setSigningOut(true);
    try {
      await apiRequest("/api/v1/auth/logout", { method: "POST", token: session.token });
    } catch (error) {
      setTeamStatus(error instanceof Error ? `Signed out locally; server revocation failed: ${error.message}` : "Signed out locally; server revocation failed.");
    } finally {
      setSession(null);
      setTeams([]);
      setTasks([]);
      setSelectedWorkspace(null);
      setActiveView("overview");
      setAuth({ status: "signed-out", message: "Your TeamSpace session has been cleared from this Activity." });
      setSigningOut(false);
    }
  }

  function reconnect() {
    setSession(null);
    setTeams([]);
    setTasks([]);
    setSelectedWorkspace(null);
    setTeamStatus("");
    setTaskStatus("");
    setAuthAttempt((attempt) => attempt + 1);
  }

  const displayName = session?.user?.displayName || session?.user?.username || "there";
  const avatarUrl = session?.user?.avatar && session?.user?.discordId
    ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatar}.png?size=96`
    : null;

  if (!session) {
    const busy = ["starting", "authorizing", "finishing"].includes(auth.status);
    return (
      <main className="auth-screen">
        <div className="auth-orb auth-orb-one" />
        <div className="auth-orb auth-orb-two" />
        <header className="auth-topbar">
          <Brand />
          <span className={`connection-indicator ${busy ? "is-pending" : auth.status === "error" ? "is-error" : "is-idle"}`}>
            <span className="indicator-dot" />{busy ? "Connecting" : auth.status === "error" ? "Connection issue" : "Discord Activity"}
          </span>
        </header>
        <section className="auth-layout">
          <div className="auth-copy">
            <div className="overline"><span className="overline-line" /> YOUR TEAM, IN SYNC</div>
            <h1>Work together.<br /><span>Move forward.</span></h1>
            <p className="auth-lead">A focused home for your team’s projects, tasks, and shared work — right inside Discord.</p>
            <div className="auth-benefits">
              <div className="benefit"><span className="benefit-icon">⌘</span><span><strong>One shared workspace</strong><small>Keep your team organized in one place.</small></span></div>
              <div className="benefit"><span className="benefit-icon">↗</span><span><strong>Discord identity</strong><small>Your account is verified through Discord.</small></span></div>
              <div className="benefit"><span className="benefit-icon">◈</span><span><strong>Server-verified access</strong><small>Your session is issued by the TeamSpace API.</small></span></div>
            </div>
          </div>
          <div className="auth-card">
            <div className="auth-card-mark"><BrandMark /></div>
            <p className="eyebrow">SECURE SIGN-IN</p>
            <h2>{busy ? "Connecting to Discord" : auth.status === "configuration" ? "Setup required" : auth.status === "signed-out" ? "You’re signed out" : auth.status === "error" ? "Couldn’t connect" : "Welcome to TeamSpace"}</h2>
            <p className="auth-message" role="status">{auth.message}</p>
            <div className={`auth-progress ${busy ? "active" : ""}`}>
              <span className={busy ? "step complete" : "step"}>1</span><span className="progress-line" />
              <span className={["authorizing", "finishing"].includes(auth.status) ? "step complete" : "step"}>2</span><span className="progress-line" />
              <span className={auth.status === "connected" ? "step complete" : "step"}>3</span>
            </div>
            <div className="progress-labels"><span>Discord</span><span>Verify</span><span>Workspace</span></div>
            {busy ? (
              <div className="loading-state"><span className="spinner" /><span>Waiting for Discord to finish authentication…</span></div>
            ) : (
              <button className="primary-button auth-action" onClick={reconnect} disabled={auth.status === "configuration"}>
                <span className="discord-glyph">◉</span>{auth.status === "configuration" ? "Configuration required" : auth.status === "signed-out" ? "Reconnect Discord" : "Try again"}
                <span className="button-arrow">↗</span>
              </button>
            )}
            <p className="auth-footnote"><span className="lock-icon">▣</span> Authentication is handled by Discord and the TeamSpace API. No password is stored by this Activity.</p>
          </div>
        </section>
        <footer className="auth-footer"><span>© {new Date().getFullYear()} TeamSpace</span><span>Powered by <strong>TJ Studios</strong></span></footer>
      </main>
    );
  }

  return (
    <main className="workspace-app">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-section-label">WORKSPACE</div>
        <button className={`nav-item ${activeView === "overview" ? "active" : ""}`} onClick={() => setActiveView("overview")}><span className="nav-icon">⌂</span>Overview</button>
        <button className={`nav-item ${activeView === "tasks" ? "active" : ""}`} onClick={() => setActiveView("tasks")}><span className="nav-icon">☷</span>Tasks <span className="nav-count">{tasks.length || ""}</span></button>
        <div className="sidebar-section-row"><span className="sidebar-section-label">YOUR TEAMS</span><span className="sidebar-count">{teams.length}</span></div>
        <div className="sidebar-team-list">
          {teams.map((team) => (
            <div className="sidebar-team" key={team.id}>
              <div className="sidebar-team-avatar">{initials(team.name)}</div>
              <div className="sidebar-team-content"><strong>{team.name}</strong><small>{team.workspaces?.length || 0} workspaces</small></div>
              <span className="team-role-dot" title={team.role} />
              {(team.workspaces || []).map((workspace) => (
                <button className={`sidebar-workspace ${selectedWorkspace?.id === workspace.id ? "selected" : ""}`} key={workspace.id} onClick={() => void openWorkspace(workspace, team.role)}>
                  <span>▦</span>{workspace.name}
                </button>
              ))}
            </div>
          ))}
          {!teams.length && !loadingTeams && <p className="sidebar-empty">Your teams will appear here.</p>}
        </div>
        <button className="sidebar-create" onClick={() => { setActiveView("overview"); document.getElementById("create-team-name")?.focus(); }}><span>＋</span> Create a team</button>
        <div className="sidebar-bottom">
          <div className="sidebar-user">
            {avatarUrl ? <img className="user-avatar" src={avatarUrl} alt="" /> : <div className="user-avatar avatar-fallback">{initials(displayName)}</div>}
            <div className="user-copy"><strong>{displayName}</strong><small>Connected with Discord</small></div>
            <button className="icon-button" onClick={() => void signOut()} disabled={signingOut} aria-label="Sign out" title="Sign out">↪</button>
          </div>
          <div className="powered-by">POWERED BY <strong>TJ STUDIOS</strong></div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="main-topbar">
          <div className="breadcrumb"><span>TeamSpace</span><span className="breadcrumb-slash">/</span><strong>{activeView === "tasks" ? selectedWorkspace?.name || "Tasks" : "Overview"}</strong></div>
          <div className="topbar-right"><span className="live-status"><span /> API session active</span><div className="topbar-avatar">{initials(displayName)}</div></div>
        </header>

        {activeView === "overview" ? (
          <div className="page-content">
            <div className="welcome-row">
              <div><p className="eyebrow">YOUR TEAMSPACE</p><h1>Good to have you here, {displayName.split(" ")[0]}.</h1><p className="page-subtitle">Here’s what’s happening across your teams.</p></div>
              <span className="date-chip">{new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</span>
            </div>
            <div className="stat-grid">
              <StatCard label="Your teams" value={teams.length} detail="Teams you belong to" icon="◈" />
              <StatCard label="Workspaces" value={workspaceCount} detail="Across your teams" icon="▦" />
              <StatCard label="Tasks loaded" value={tasks.length} detail={selectedWorkspace ? selectedWorkspace.name : "Open a workspace to view tasks"} icon="☷" />
            </div>
            <div className="content-grid">
              <section className="panel-card teams-overview">
                <div className="panel-heading"><div><p className="eyebrow">ORGANIZATION</p><h2>Your teams</h2></div><span className="panel-meta">{loadingTeams ? "Refreshing…" : `${teams.length} total`}</span></div>
                {teamStatus && <p className="inline-alert" role="status">{teamStatus}</p>}
                {teams.length ? <div className="overview-team-list">{teams.map((team) => (
                  <article className="overview-team-row" key={team.id}>
                    <div className="team-large-avatar">{initials(team.name)}</div>
                    <div className="overview-team-copy"><strong>{team.name}</strong><span>/{team.slug} · {team.workspaces?.length || 0} workspaces</span></div>
                    <span className="role-badge">{team.role}</span>
                    <div className="overview-workspaces">{(team.workspaces || []).map((workspace) => <button key={workspace.id} onClick={() => void openWorkspace(workspace, team.role)}><span>▦</span>{workspace.name}<span className="row-arrow">→</span></button>)}</div>
                  </article>
                ))}</div> : <EmptyState icon="◈" title={loadingTeams ? "Loading your teams" : "Your team starts here"} description={loadingTeams ? "Getting the latest data from the TeamSpace API." : "Create a team to create its first workspace and start organizing tasks."} />}
              </section>
              <section className="panel-card create-panel">
                <div className="create-panel-icon">＋</div><p className="eyebrow">GET STARTED</p><h2>Create a team</h2><p>Set up a shared space for a project, department, or group.</p>
                <form onSubmit={createTeam} className="create-form">
                  <label htmlFor="create-team-name">Team name</label>
                  <input id="create-team-name" value={teamName} onChange={(event) => setTeamName(event.target.value)} maxLength={80} placeholder="e.g. Product team" required />
                  <button className="primary-button" type="submit" disabled={creatingTeam || !teamName.trim()}>{creatingTeam ? "Creating team…" : "Create team"} <span>→</span></button>
                </form>
                {teamStatus && <p className="form-message" role="status">{teamStatus}</p>}
              </section>
            </div>
            <div className="bottom-note"><span className="note-dot" />Live data from your TeamSpace API and PostgreSQL database. No demo content.</div>
          </div>
        ) : (
          <div className="page-content">
            <div className="welcome-row">
              <div><p className="eyebrow">WORK MANAGEMENT</p><h1>{selectedWorkspace ? selectedWorkspace.name : "Workspace tasks"}</h1><p className="page-subtitle">{selectedWorkspace ? "Track the work that moves your team forward." : "Choose a workspace from the sidebar to view its tasks."}</p></div>
              {selectedWorkspace && <span className="role-badge">{selectedWorkspace.teamRole}</span>}
            </div>
            {selectedWorkspace ? (
              <section className="panel-card task-panel">
                <div className="panel-heading"><div><p className="eyebrow">TASK BOARD</p><h2>Tasks <span className="subtle-count">{tasks.length}</span></h2></div><span className="panel-meta">{loadingTasks ? "Loading…" : `${openTaskCount} open`}</span></div>
                <form className="task-create-form" onSubmit={createTask}>
                  <span className="task-add-icon">＋</span><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} maxLength={160} placeholder="Add a task to this workspace…" aria-label="New task title" required />
                  <button className="primary-button" type="submit" disabled={creatingTask || !taskTitle.trim()}>{creatingTask ? "Saving…" : "Add task"}</button>
                </form>
                {taskStatus && <p className="inline-alert" role="status">{taskStatus}</p>}
                <div className="task-list">
                  {tasks.map((task) => (
                    <article className={`task-row ${task.status === "DONE" ? "is-done" : ""}`} key={task.id}>
                      <button className={`task-check ${task.status === "DONE" ? "checked" : ""}`} onClick={() => void toggleTask(task)} aria-label={task.status === "DONE" ? "Mark incomplete" : "Mark complete"}>{task.status === "DONE" ? "✓" : ""}</button>
                      <div className="task-info"><strong>{task.title}</strong><span>{task.status.replaceAll("_", " ")} · Updated {formatDate(task.updatedAt)}</span></div>
                      <span className={`task-status status-${task.status.toLowerCase()}`}>{task.status.replaceAll("_", " ")}</span>
                      {["OWNER", "ADMIN", "EDITOR"].includes(selectedWorkspace.teamRole) && <button className="task-delete" onClick={() => void deleteTask(task)} aria-label={`Delete ${task.title}`} title="Delete task">×</button>}
                    </article>
                  ))}
                  {loadingTasks && <EmptyState icon="◌" title="Loading tasks" description="Fetching the latest tasks from your workspace." />}
                  {!loadingTasks && tasks.length === 0 && !taskStatus && <EmptyState icon="☷" title="A clean slate" description="Add your first task above. It will be saved to the TeamSpace database." />}
                </div>
              </section>
            ) : <EmptyState icon="▦" title="Select a workspace" description="Choose one of your team's workspaces in the sidebar to open its task board." />}
            <div className="bottom-note"><span className="note-dot" />Changes are saved through the authenticated TeamSpace API.</div>
          </div>
        )}
      </section>
    </main>
  );
}

function BrandMark() {
  return <span className="brand-mark"><span /></span>;
}

function Brand() {
  return <div className="brand-lockup"><BrandMark /><span className="brand-wordmark">TeamSpace<small>POWERED BY TJ STUDIOS</small></span></div>;
}

function StatCard({ label, value, detail, icon }) {
  return <article className="stat-card"><div className="stat-card-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong className="stat-value">{value}</strong><small>{detail}</small></article>;
}

function EmptyState({ icon, title, description }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><strong>{title}</strong><p>{description}</p></div>;
}

createRoot(document.getElementById("root")).render(<App />);
