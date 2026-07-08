import { Outlet, NavLink } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="layout">
      <header className="header">
        <NavLink to="/" className="header-brand">
          <div className="logo">PP</div>
          ProofPack
        </NavLink>
        <nav className="header-nav">
          <NavLink to="/disputes" className={({ isActive }) => isActive ? 'active' : ''}>
            Disputes
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}>
            Settings
          </NavLink>
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
