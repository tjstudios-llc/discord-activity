const sections = [
  { number: "01", title: "Teams & workspaces", detail: "Membership, roles, and workspace settings", state: "Foundation" },
  { number: "02", title: "Appearance", detail: "Themes, layouts, and approved widgets", state: "Planned" },
  { number: "03", title: "Connections", detail: "Discord application and deployment settings", state: "Planned" },
];

export default function DashboardPage() {
  return (
    <main className="studio-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon">T</span><span>TeamSpace<small>STUDIO</small></span></div>
        <p className="nav-label">WORKSPACE</p>
        <a className="nav-item active" href="#overview">Overview</a>
        <a className="nav-item" href="#teams">Teams & workspaces</a>
        <a className="nav-item" href="#appearance">Appearance</a>
        <a className="nav-item" href="#connections">Connections</a>
        <div className="sidebar-bottom"><span className="online-dot" /> Local interface preview</div>
      </aside>
      <section className="main-panel" id="overview">
        <header className="page-header"><div><p className="kicker">CONTROL CENTER</p><h1>Workspace overview</h1><p className="muted">Your TeamSpace configuration, in one place.</p></div><span className="env-chip">DEVELOPMENT</span></header>
        <section className="welcome"><div><p className="kicker">WELCOME TO TEAMSPACE</p><h2>Build a workspace<br />that works for your team.</h2><p>Manage your teams, tailor the experience, and bring collaboration into Discord.</p></div><div className="welcome-orbit" aria-hidden="true"><span>✳</span></div></section>
        <div className="section-heading"><div><h2>Configuration areas</h2><p className="muted">The dashboard shell is ready for API-backed controls.</p></div></div>
        <div className="section-list">{sections.map((section) => <article className="section-card" key={section.number}><span className="section-number">{section.number}</span><div className="section-info"><h3>{section.title}</h3><p>{section.detail}</p></div><span className={section.state === "Foundation" ? "state-chip current" : "state-chip"}>{section.state}</span></article>)}</div>
        <footer>TEAMSPACE STUDIO <span>Early development · No live configuration loaded</span></footer>
      </section>
    </main>
  );
}
