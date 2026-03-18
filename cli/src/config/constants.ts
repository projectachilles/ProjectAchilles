import { join } from 'path';
import { homedir } from 'os';

export const VERSION = '0.1.0';
export const CLI_NAME = 'achilles';
export const CLI_DESCRIPTION = 'ProjectAchilles CLI — purple team platform management';

export const CONFIG_DIR = join(homedir(), '.achilles');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const AUTH_FILE = join(CONFIG_DIR, 'auth.json');
export const HISTORY_FILE = join(CONFIG_DIR, 'history');

export const DEFAULT_SERVER_URL = 'http://localhost:3000';
export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_OUTPUT = 'pretty' as const;

export const USER_AGENT = `achilles-cli/${VERSION}`;

/** Token refresh margin — refresh 5 minutes before expiry */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Device flow poll interval in milliseconds */
export const DEVICE_POLL_INTERVAL_MS = 2000;

/** Device code TTL in seconds */
export const DEVICE_CODE_TTL_SECONDS = 600;
