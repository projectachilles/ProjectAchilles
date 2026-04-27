import { NavLink } from 'react-router-dom';

/**
 * Horizontal sub-nav rendered below the topbar on every Endpoints page.
 * Three tabs: Dashboard / Agents / Tasks.
 *
 * Agent Detail is reached by clicking a row in Agents — not its own tab —
 * so we don't list it here.
 */
export function EndpointsSubNav() {
  return (
    <nav className="ep-subnav" aria-label="Endpoints sections">
      <NavLink to="/endpoints/dashboard" className={({ isActive }) => (isActive ? 'is-active' : '')}>
        Dashboard
      </NavLink>
      <NavLink
        to="/endpoints/agents"
        className={({ isActive }) => (isActive ? 'is-active' : '')}
      >
        Agents
      </NavLink>
      <NavLink to="/endpoints/tasks" className={({ isActive }) => (isActive ? 'is-active' : '')}>
        Tasks
      </NavLink>
    </nav>
  );
}
