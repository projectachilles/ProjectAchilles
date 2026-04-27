import { Outlet } from 'react-router-dom';
import { EndpointsSubNav } from './EndpointsSubNav';
import './endpoints.css';

/**
 * Layout wrapper for /endpoints/*. Renders the sub-nav plus an <Outlet/> for
 * the active page. The AchillesShell sidebar + topbar are provided by the
 * application AppLayout one level up.
 */
export default function EndpointsLayout() {
  return (
    <>
      <EndpointsSubNav />
      <Outlet />
    </>
  );
}
