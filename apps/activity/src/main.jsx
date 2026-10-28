import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import { Client } from "colyseus.js";
import "./styles.css";

const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || "").replace(/\/$/, "");
const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;
const REALTIME_URL = import.meta.env.VITE_REALTIME_URL || import.meta.env.VITE_REALTIME_ORIGIN || (location.hostname === "localhost" ? "ws://localhost:2567" : (location.protocol === "https:" ? "wss://" : "ws://") + location.host);
const WORLD = { width: 1600, height: 900 };

class ApiError extends Error {
  constructor(message, status) { super(message); this.name = "ApiError"; this.status = status; }
}
function apiUrl(path) { return API_ORIGIN + (path.startsWith("/") ? path : "/" + path); }
async function apiRequest(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", "Bearer " + token);
  let response;
  try { response = await fetch(apiUrl(path), { ...options, headers, cache: "no-store" }); }
  catch { throw new Error("The game API could not be reached. Check the /api proxy and API service."); }
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(payload?.message || "Request failed (" + response.status + ").", response.status);
  if (payload === null) throw new Error("The API returned an unreadable response.");
  return payload;
}
function xpProgress(profile) {
  if (!profile) return 0;
  return Math.min(100, Math.round((profile.xpIntoLevel / Math.max(1, profile.xpForNextLevel)) * 100));
}
function Icon({ children }) { return <span className="brand-icon">{children}</span>; }

function ArenaCanvas({ snapshot, fireRef, moveRef, aimRef, onAim }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const state = snapshot;
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    ctx.strokeStyle = "rgba(105,145,190,.11)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD.width; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.height); ctx.stroke(); }
    for (let y = 0; y <= WORLD.height; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD.width, y); ctx.stroke(); }
    for (const [x,y,w,h] of [[260,180,130,90],[640,120,190,80],[1080,190,150,100],[360,600,160,100],[840,620,120,110],[1260,600,120,90]]) {
      ctx.fillStyle = "#121e31"; ctx.strokeStyle = "#253650"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(x,y,w,h,14); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(85,134,180,.10)"; ctx.fillRect(x+10,y+10,w-20,h-20);
    }
    for (const bullet of state?.bullets || []) {
      ctx.fillStyle = "#ffdc8a"; ctx.shadowColor = "#ffb84d"; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(bullet.x, bullet.y, 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
    for (const player of state?.players || []) {
      ctx.save(); ctx.translate(player.x, player.y);
      ctx.strokeStyle = player.team === "red" ? "#ff718b" : player.team === "blue" ? "#78a8ff" : player.color;
      ctx.lineWidth = 4; ctx.globalAlpha = .95;
      ctx.beginPath(); ctx.arc(0,0,22,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle = player.color || "#62e6c5";
      ctx.beginPath(); ctx.arc(0,0,15,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = "#f5f8ff"; ctx.lineWidth = 5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(player.aimX*29,player.aimY*29); ctx.stroke();
      ctx.fillStyle = "#182235"; ctx.fillRect(-24,-34,48,6);
      ctx.fillStyle = player.health > 55 ? "#62e6c5" : player.health > 25 ? "#ffd166" : "#ff718b";
      ctx.fillRect(-24,-34,48*Math.max(0,player.health/player.maxHealth),6);
      ctx.fillStyle = player.isSelf ? "#ffffff" : "#b8c6db"; ctx.font = "600 16px system-ui"; ctx.textAlign = "center";
      ctx.fillText(player.isSelf ? "YOU" : player.name,0,47);
      ctx.restore();
    }
    if (!state?.players?.length) {
      ctx.fillStyle = "#b8c6db"; ctx.font = "600 28px system-ui"; ctx.textAlign = "center";
      ctx.fillText("Waiting for players…", WORLD.width/2, WORLD.height/2);
      ctx.font = "18px system-ui"; ctx.fillStyle = "#71839c"; ctx.fillText("Move with WASD or arrow keys · Aim with your pointer · Hold to fire", WORLD.width/2, WORLD.height/2+38);
    }
  }, [snapshot]);
  function point(event) {
    const rect = canvasRef.current.getBoundingClientRect();
    const aim = { x: (event.clientX-rect.left)/rect.width*WORLD.width, y: (event.clientY-rect.top)/rect.height*WORLD.height };
    aimRef.current = aim; onAim?.(aim);
  }
  return <canvas ref={canvasRef} className="arena-canvas" width={WORLD.width} height={WORLD.height} onPointerMove={point} onPointerDown={(event) => { point(event); fireRef.current = true; canvasRef.current.setPointerCapture?.(event.pointerId); }} onPointerUp={() => { fireRef.current = false; }} onPointerCancel={() => { fireRef.current = false; }} aria-label="PvP arena. Move with WASD or arrow keys and hold the pointer to fire." />;
}

function App() {
  const [authAttempt, setAuthAttempt] = useState(0);
  const [auth, setAuth] = useState({ status: "starting", message: "Preparing your secure Discord connection." });
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [view, setView] = useState("play");
  const [mode, setMode] = useState("team");
  const [room, setRoom] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [matchMessage, setMatchMessage] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const keysRef = useRef(new Set());
  const fireRef = useRef(false);
  const moveRef = useRef({ x: 0, y: 0 });
  const aimRef = useRef({ x: 800, y: 450 });
  const snapshotRef = useRef(snapshot);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  const roomRef = useRef(null);
  const lastInputRef = useRef(0);

  const refreshGameData = useCallback(async (token) => {
    const [game, shop, board] = await Promise.all([
      apiRequest("/api/v1/game/profile", { token }),
      apiRequest("/api/v1/game/catalog", { token }),
      apiRequest("/api/v1/game/leaderboard", { token }),
    ]);
    setProfile(game.profile);
    setInventory(game.inventory || []);
    setCatalog(shop.items || []);
    setLeaderboard(board.players || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let issuedToken = null;
    async function connect() {
      if (!CLIENT_ID) { setAuth({ status: "configuration", message: "Set VITE_DISCORD_CLIENT_ID and rebuild the Activity." }); return; }
      setAuth({ status: "starting", message: "Connecting to Discord's Embedded App SDK…" });
      try {
        const sdk = new DiscordSDK(CLIENT_ID);
        await sdk.ready();
        if (cancelled) return;
        setAuth({ status: "authorizing", message: "Verifying your Discord identity…" });
        const authorization = await sdk.commands.authorize({ client_id: CLIENT_ID, response_type: "code", state: "", prompt: "none", scope: ["identify"] });
        if (!authorization?.code) throw new Error("Discord did not return an authorization code. Open this game from Discord and retry.");
        const exchange = await apiRequest("/api/v1/auth/discord/exchange", { method: "POST", body: JSON.stringify({ code: authorization.code }) });
        const { access_token: discordAccessToken, ...gameSession } = exchange || {};
        if (!discordAccessToken || !gameSession.token || !gameSession.user) throw new Error("The authentication service returned an incomplete session.");
        issuedToken = gameSession.token;
        await sdk.commands.authenticate({ access_token: discordAccessToken });
        if (cancelled) { void apiRequest("/api/v1/auth/logout", { method: "POST", token: issuedToken }).catch(() => {}); return; }
        setSession(gameSession);
        await refreshGameData(gameSession.token);
        if (!cancelled) setAuth({ status: "connected", message: "Discord identity verified." });
      } catch (error) {
        if (issuedToken) void apiRequest("/api/v1/auth/logout", { method: "POST", token: issuedToken }).catch(() => {});
        if (!cancelled) { setSession(null); setProfile(null); setAuth({ status: "error", message: error instanceof Error ? error.message : "Could not complete Discord authentication." }); }
      }
    }
    void connect();
    return () => { cancelled = true; };
  }, [authAttempt, refreshGameData]);

  useEffect(() => {
    function down(event) {
      const key = event.key.toLowerCase();
      if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"," "].includes(key)) event.preventDefault();
      keysRef.current.add(key);
    }
    function up(event) { keysRef.current.delete(event.key.toLowerCase()); }
    function blur() { keysRef.current.clear(); fireRef.current = false; }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);

  useEffect(() => {
    if (!room) return;
    const timer = window.setInterval(() => {
      const keys = keysRef.current;
      let x = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
      let y = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
      x += moveRef.current.x; y += moveRef.current.y;
      const length = Math.hypot(x,y);
      if (length > 1) { x /= length; y /= length; }
      const self = snapshotRef.current?.players?.find((player) => player.isSelf);
      const aim = { x: aimRef.current.x - (self?.x ?? 800), y: aimRef.current.y - (self?.y ?? 450) };
      room.send("input", { x, y, aimX: aim.x, aimY: aim.y, fire: fireRef.current });
    }, 50);
    return () => window.clearInterval(timer);
  }, [room]);

  useEffect(() => () => { roomRef.current?.leave(); }, []);

  async function startMatch() {
    if (!session?.token || connecting || room) return;
    setConnecting(true); setStatus(""); setMatchMessage(""); setSnapshot(null);
    try {
      const client = new Client(REALTIME_URL);
      client.auth.token = session.token;
      const joined = await client.joinOrCreate("arena", { mode, token: session.token });
      roomRef.current = joined;
      setRoom(joined);
      joined.onMessage("welcome", () => {});
      joined.onMessage("snapshot", (data) => setSnapshot(data));
      joined.onMessage("match-ended", (data) => {
        setMatchMessage(data.message || "Match complete.");
        setStatus(data.mode === "team" ? "Team battle finished." : "Free-for-all finished.");
        setView("results");
        void refreshGameData(session.token).catch((error) => setStatus(error.message));
      });
      joined.onLeave((code) => {
        setRoom((current) => current === joined ? null : current);
        roomRef.current = null; setSnapshot(null); setConnecting(false);
        if (code && code !== 1000) setStatus("Connection closed (" + code + "). You can queue again.");
      });
      setView("arena");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not join the arena. Check the realtime WebSocket URL and service.");
    } finally { setConnecting(false); }
  }

  async function leaveMatch() {
    const active = roomRef.current;
    if (active) { active.send("leave-match", {}); await active.leave(); }
    roomRef.current = null; setRoom(null); setSnapshot(null); setView("play");
  }

  async function buyItem(item) {
    if (!session?.token || loading) return;
    setLoading(true); setStatus("");
    try {
      const result = await apiRequest("/api/v1/game/shop/purchase", { method: "POST", token: session.token, body: JSON.stringify({ itemId: item.slug }) });
      setProfile(result.profile); setInventory(result.inventory || []); setStatus(result.message || "Purchase saved.");
    } catch (error) { setStatus(error.message); }
    finally { setLoading(false); }
  }

  async function equipItem(item) {
    if (!session?.token || loading) return;
    setLoading(true); setStatus("");
    try {
      const result = await apiRequest("/api/v1/game/loadout", { method: "POST", token: session.token, body: JSON.stringify({ itemId: item.slug }) });
      setProfile(result.profile); setInventory(result.inventory || []); setStatus(result.message || "Loadout saved.");
    } catch (error) { setStatus(error.message); }
    finally { setLoading(false); }
  }

  async function signOut() {
    if (!session?.token || signingOut) return;
    setSigningOut(true);
    try { await apiRequest("/api/v1/auth/logout", { method: "POST", token: session.token }); }
    catch (error) { setStatus("Signed out locally; server revocation failed: " + error.message); }
    finally {
      if (roomRef.current) await roomRef.current.leave().catch(() => {});
      roomRef.current = null; setRoom(null); setSession(null); setProfile(null); setInventory([]); setCatalog([]);
      setAuth({ status: "signed-out", message: "Your session has been cleared from this Activity." }); setSigningOut(false);
    }
  }

  const displayName = session?.user?.displayName || session?.user?.username || "Arena player";
  const avatar = session?.user?.avatar && session?.user?.discordId ? "https://cdn.discordapp.com/avatars/" + session.user.discordId + "/" + session.user.avatar + ".png?size=96" : null;
  const owned = useMemo(() => new Set(inventory.map((item) => item.slug)), [inventory]);
  const weapons = catalog.filter((item) => item.type === "WEAPON");
  const characters = catalog.filter((item) => item.type === "CHARACTER");
  const inArena = Boolean(room);

  if (!session) {
    const busy = ["starting","authorizing"].includes(auth.status);
    return <main className="login-shell"><div className="login-glow" /><header className="login-top"><Brand /><span className="status-pill"><i />{busy ? "CONNECTING" : auth.status === "error" ? "CONNECTION ISSUE" : "DISCORD ACTIVITY"}</span></header><section className="login-content"><div className="login-copy"><p className="eyebrow">TJ STUDIOS PRESENTS</p><h1>Drop in.<br /><span>Rise up.</span></h1><p className="login-lead">A fast, competitive top-down arena shooter. Fight your rivals, level up, unlock gear, and build your legend.</p><div className="feature-row"><span>✦</span><div><strong>Persistent progression</strong><small>Your XP, coins, and gear are saved to your account.</small></div></div><div className="feature-row"><span>⌁</span><div><strong>Two ways to battle</strong><small>Team battles and free-for-all arena matches.</small></div></div><div className="feature-row"><span>⬡</span><div><strong>Earn every upgrade</strong><small>Level unlocks and a shop backed by server-side validation.</small></div></div></div><div className="login-card"><Icon>✦</Icon><p className="eyebrow">ARENA ACCESS</p><h2>{busy ? "Connecting to Discord" : auth.status === "configuration" ? "Setup required" : auth.status === "signed-out" ? "You're signed out" : auth.status === "error" ? "Couldn't connect" : "Welcome, fighter"}</h2><p className="login-message" role="status">{auth.message}</p>{busy ? <div className="auth-loading"><span className="spinner" />Verifying your Discord account…</div> : <button className="button primary wide" disabled={auth.status === "configuration"} onClick={() => { setAuth({ status: "starting", message: "Retrying Discord authentication…" }); setAuthAttempt((n) => n + 1); }}>◉ &nbsp; Reconnect Discord <span>↗</span></button>}<p className="privacy-note">Your Discord identity is verified server-side. Game progress is stored in PostgreSQL, not browser storage.</p></div></section><footer className="login-footer"><span>TEAMSPACE ARENA · PRE-RELEASE</span><span>POWERED BY <b>TJ STUDIOS</b></span></footer></main>;
  }

  return <main className="game-shell">
    <aside className="game-sidebar"><Brand /><div className="side-label">ARENA</div>
      <button className={"side-link " + (view === "play" || view === "arena" || view === "results" ? "selected" : "")} onClick={() => { if (!inArena) setView("play"); }}><span>⌁</span>Play</button>
      <button className={"side-link " + (view === "armory" ? "selected" : "")} onClick={() => !inArena && setView("armory")}><span>⚒</span>Armory</button>
      <button className={"side-link " + (view === "shop" ? "selected" : "")} onClick={() => !inArena && setView("shop")}><span>◈</span>Shop <span className="side-badge">COINS</span></button>
      <button className={"side-link " + (view === "leaderboard" ? "selected" : "")} onClick={() => !inArena && setView("leaderboard")}><span>♜</span>Leaderboard</button>
      <div className="sidebar-bottom"><div className="player-mini">{avatar ? <img src={avatar} alt="" /> : <span className="avatar-fallback">{displayName.slice(0,1).toUpperCase()}</span>}<div className="player-mini-copy"><b>{displayName}</b><small>Level {profile?.level || 1} Operator</small></div><button className="logout-button" onClick={() => void signOut()} disabled={signingOut} title="Sign out" aria-label="Sign out">↪</button></div><div className="sidebar-credit">POWERED BY <b>TJ STUDIOS</b></div></div>
    </aside>
    <section className="game-main">
      <header className="game-topbar"><div className="breadcrumb">TEAMSPACE ARENA <span>/</span> <b>{view === "arena" ? "LIVE MATCH" : view.toUpperCase()}</b></div><div className="top-stats"><div className="coin-pill">◈ <b>{profile?.coins ?? "—"}</b><small>COINS</small></div><div className="level-pill"><span>LVL</span><b>{profile?.level || 1}</b></div></div></header>
      {status && <div className="notice" role="status">{status}<button onClick={() => setStatus("")}>×</button></div>}
      {view === "play" && <div className="page-wrap"><div className="hero-banner"><div className="hero-content"><p className="eyebrow">SEASON ZERO · ARENA PROTOCOL</p><h1>Ready to <span>fight?</span></h1><p>Queue up, outplay the opposition, and earn rewards every match.</p><div className="hero-tags"><span>● SERVER-AUTHORITATIVE</span><span>◈ PROGRESSION SAVED</span></div></div><div className="hero-emblem">✦<span>TS</span></div></div>
        <div className="profile-strip"><div className="profile-avatar">{avatar ? <img src={avatar} alt="" /> : displayName.slice(0,1).toUpperCase()}</div><div className="profile-info"><div className="profile-title"><h2>{displayName}</h2><span>LEVEL {profile?.level || 1}</span></div><div className="xp-track"><span style={{ width: xpProgress(profile) + "%" }} /></div><small>{profile?.xpIntoLevel || 0} / {profile?.xpForNextLevel || 100} XP TO NEXT LEVEL</small></div><div className="profile-record"><div><b>{profile?.wins || 0}</b><small>WINS</small></div><div><b>{profile?.kills || 0}</b><small>ELIMS</small></div><div><b>{profile?.deaths || 0}</b><small>DEATHS</small></div></div></div>
        <div className="section-heading"><div><p className="eyebrow">CHOOSE YOUR BATTLE</p><h2>Game modes</h2></div><span className="match-length">MATCHES · 3 MIN</span></div>
        <div className="mode-grid"><button className={"mode-card team-mode " + (mode === "team" ? "mode-selected" : "")} onClick={() => setMode("team")}><div className="mode-art team-art"><span>2</span><i>VS</i><span>2</span></div><div className="mode-card-copy"><div><h3>Team Battle</h3><p>Fight as a squad. Every elimination counts.</p></div><span className="mode-count">2 TEAMS</span></div><div className="mode-bottom"><span>RED vs BLUE</span><b>{mode === "team" ? "SELECTED ✓" : "SELECT MODE →"}</b></div></button><button className={"mode-card ffa-mode " + (mode === "free-for-all" ? "mode-selected" : "")} onClick={() => setMode("free-for-all")}><div className="mode-art ffa-art"><span>✦</span><span>✧</span><span>✦</span><span>✧</span></div><div className="mode-card-copy"><div><h3>Free-for-all</h3><p>No allies. No excuses. Be the last one standing.</p></div><span className="mode-count">EVERYONE</span></div><div className="mode-bottom"><span>SOLO COMBAT</span><b>{mode === "free-for-all" ? "SELECTED ✓" : "SELECT MODE →"}</b></div></button></div>
        <div className="queue-row"><div><b>Up for the challenge?</b><small>Controls: WASD / arrows · Aim with pointer · Hold to fire</small></div><button className="button primary queue-button" onClick={() => void startMatch()} disabled={connecting || inArena}>{connecting ? <><span className="spinner" /> Finding match…</> : <>⚔ &nbsp; Enter Arena <span>→</span></>}</button></div>
      </div>}
      {view === "arena" && <div className="arena-page"><div className="arena-heading"><div><p className="eyebrow">LIVE COMBAT · {mode === "team" ? "RED VS BLUE" : "FREE-FOR-ALL"}</p><h1>Battle in progress</h1></div><button className="button ghost" onClick={() => void leaveMatch()}>Leave match</button></div><div className="arena-hud"><div><small>TIME LEFT</small><b>{Math.ceil((snapshot?.remainingMs ?? 180000)/1000)}s</b></div>{mode === "team" ? <div className="team-score"><b className="red-score">RED {snapshot?.scores?.red ?? 0}</b><span>—</span><b className="blue-score">BLUE {snapshot?.scores?.blue ?? 0}</b></div> : <div><small>PLAYERS</small><b>{snapshot?.players?.length ?? 1}</b></div>}<div><small>YOUR ELIMS</small><b>{snapshot?.players?.find((p) => p.isSelf)?.kills ?? 0}</b></div></div><div className="arena-frame"><ArenaCanvas snapshot={snapshot} fireRef={fireRef} moveRef={moveRef} aimRef={aimRef} /></div><div className="mobile-pad" aria-label="Touch movement controls"><div className="pad-cross"><button onPointerDown={(e) => { e.preventDefault(); moveRef.current.y = -1; }} onPointerUp={() => { moveRef.current.y = 0; }} onPointerCancel={() => { moveRef.current.y = 0; }} onPointerLeave={() => { moveRef.current.y = 0; }}>▲</button><div><button onPointerDown={(e) => { e.preventDefault(); moveRef.current.x = -1; }} onPointerUp={() => { moveRef.current.x = 0; }} onPointerCancel={() => { moveRef.current.x = 0; }} onPointerLeave={() => { moveRef.current.x = 0; }}>◀</button><button onPointerDown={(e) => { e.preventDefault(); moveRef.current.y = 1; }} onPointerUp={() => { moveRef.current.y = 0; }} onPointerCancel={() => { moveRef.current.y = 0; }} onPointerLeave={() => { moveRef.current.y = 0; }}>▼</button><button onPointerDown={(e) => { e.preventDefault(); moveRef.current.x = 1; }} onPointerUp={() => { moveRef.current.x = 0; }} onPointerCancel={() => { moveRef.current.x = 0; }} onPointerLeave={() => { moveRef.current.x = 0; }}>▶</button></div></div><button className="touch-fire" onPointerDown={(e) => { e.preventDefault(); fireRef.current = true; }} onPointerUp={() => { fireRef.current = false; }} onPointerCancel={() => { fireRef.current = false; }} onPointerLeave={() => { fireRef.current = false; }}>FIRE</button></div><div className="arena-controls"><span>W A S D <small>MOVE</small></span><span>POINTER <small>AIM</small></span><span>HOLD CLICK <small>FIRE</small></span><button onClick={() => void leaveMatch()}>Exit match</button></div></div>}
      {view === "results" && <div className="page-wrap result-page"><div className="result-card"><Icon>✦</Icon><p className="eyebrow">MATCH REPORT</p><h1>Battle <span>complete.</span></h1><p>{matchMessage || "Your match results have been recorded."}</p><div className="result-stats"><div><b>{profile?.xp || 0}</b><small>TOTAL XP</small></div><div><b>{profile?.coins || 0}</b><small>COINS SAVED</small></div><div><b>{profile?.level || 1}</b><small>LEVEL</small></div></div><button className="button primary" onClick={() => { setView("play"); setMatchMessage(""); setStatus(""); }}>Back to lobby →</button></div></div>}
      {view === "shop" && <div className="page-wrap"><div className="page-title"><div><p className="eyebrow">SPEND YOUR EARNINGS</p><h1>Item <span>shop</span></h1><p>Every purchase is verified and saved on the game server.</p></div><div className="coin-large">◈ {profile?.coins ?? 0} <small>COINS</small></div></div><div className="item-grid">{catalog.filter((item) => !item.isStarter && item.price > 0).map((item) => <ItemCard key={item.slug} item={item} owned={owned.has(item.slug)} level={profile?.level || 1} loading={loading} onBuy={() => void buyItem(item)} onEquip={() => void equipItem(item)} />)}</div></div>}
      {view === "armory" && <div className="page-wrap"><div className="page-title"><div><p className="eyebrow">YOUR LOADOUT</p><h1>The <span>armory</span></h1><p>Equip weapons and operators you've unlocked.</p></div></div><div className="section-heading"><div><p className="eyebrow">OPERATORS</p><h2>Characters</h2></div></div><div className="item-grid">{characters.map((item) => <ItemCard key={item.slug} item={item} owned={owned.has(item.slug)} equipped={profile?.selectedCharacterId === item.slug} level={profile?.level || 1} loading={loading} onBuy={() => void buyItem(item)} onEquip={() => void equipItem(item)} />)}</div><div className="section-heading"><div><p className="eyebrow">WEAPON SYSTEMS</p><h2>Weapons</h2></div></div><div className="item-grid">{weapons.map((item) => <ItemCard key={item.slug} item={item} owned={owned.has(item.slug)} equipped={profile?.selectedWeaponId === item.slug} level={profile?.level || 1} loading={loading} onBuy={() => void buyItem(item)} onEquip={() => void equipItem(item)} />)}</div></div>}
      {view === "leaderboard" && <div className="page-wrap"><div className="page-title"><div><p className="eyebrow">PROVE YOUR SKILL</p><h1>Top <span>operators</span></h1><p>Ranked by wins, then eliminations and XP.</p></div></div><div className="leaderboard"><div className="leader-row leader-head"><span>RANK</span><span>PLAYER</span><span>LEVEL</span><span>WINS</span><span>ELIMS</span></div>{leaderboard.map((player,index) => <div className="leader-row" key={player.name + index}><span className={"rank rank-" + (index+1)}>{String(index+1).padStart(2,"0")}</span><span className="leader-name">{player.avatar ? <img src={"https://cdn.discordapp.com/avatars/" + player.discordId + "/" + player.avatar + ".png?size=48"} alt="" /> : <i>{player.name.slice(0,1).toUpperCase()}</i>}<b>{player.name}</b></span><span>{player.level}</span><span>{player.wins}</span><span>{player.kills}</span></div>)}{!leaderboard.length && <p className="empty-state">No match records yet. Be the first to join the arena.</p>}</div></div>}
    </section>
  </main>;
}

function Brand() { return <div className="brand"><span className="brand-symbol"><i /><i /><i /><i /></span><span>TEAMSPACE <small>ARENA</small></span></div>; }
function ItemCard({ item, owned, equipped, level, loading, onBuy, onEquip }) {
  const locked = level < item.unlockLevel;
  const stats = item.stats || {};
  return <article className={"item-card rarity-" + item.rarity}><div className="item-art"><span className="item-type">{item.type}</span><div className="item-glyph">{item.type === "WEAPON" ? "⌁" : item.type === "CHARACTER" ? "♟" : "✦"}</div><span className="rarity-label">{item.rarity}</span></div><div className="item-copy"><h3>{item.name}</h3><p>{item.description}</p><div className="item-stats">{Object.entries(stats).slice(0,2).map(([key,value]) => <span key={key}>{key.toUpperCase()} <b>{typeof value === "number" ? value : "✦"}</b></span>)}</div><div className="item-action">{owned ? <button className={"button " + (equipped ? "equipped" : "secondary")} disabled={loading || equipped || item.type === "SKIN"} onClick={onEquip}>{equipped ? "✓ Equipped" : item.type === "SKIN" ? "Owned" : "Equip"}</button> : locked ? <button className="button locked" disabled>🔒 Level {item.unlockLevel}</button> : item.price === 0 ? <button className="button primary" disabled={loading} onClick={onBuy}>Unlock reward</button> : <button className="button secondary" disabled={loading} onClick={onBuy}>◈ {item.price}</button>}</div></div></article>;
}

createRoot(document.getElementById("root")).render(<App />);
