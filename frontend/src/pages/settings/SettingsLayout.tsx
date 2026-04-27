import { Outlet } from 'react-router-dom';
import { SettingsSubNav } from './SettingsSubNav';
import './settings.css';

/**
 * Settings shell — sticky horizontal sub-nav + page content slot.
 * Each /settings/* route renders into the <Outlet/>.
 *
 * This component does NOT call useLayoutActions; each sub-page owns
 * its own header / quick-actions area.
 */
export function SettingsLayout() {
  return (
    <>
      <SettingsSubNav />
      <Outlet />
    </>
  );
}

export default SettingsLayout;
