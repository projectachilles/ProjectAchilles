import fs from 'fs';
import { writeFileSync } from 'fs';

const SETTINGS_FILE = '/root/.projectachilles/analytics.json';
const INTEGRATIONS_FILE = '/root/.projectachilles/integrations.json';

// --- Should trigger ---

function unsafeWriteSettings(data: string) {
  // ruleid: projectachilles-settings-file-permissions
  fs.writeFileSync(SETTINGS_FILE, data);
}

function unsafeWriteIntegrations(data: string) {
  // ruleid: projectachilles-settings-file-permissions
  fs.writeFileSync(INTEGRATIONS_FILE, data, 'utf-8');
}

function unsafeWriteCredentials(data: string) {
  const credentialPath = '/root/.projectachilles/credentials.json';
  // ruleid: projectachilles-settings-file-permissions
  writeFileSync(credentialPath, data);
}

// --- Should NOT trigger ---

function safeWriteSettings(data: string) {
  // ok: projectachilles-settings-file-permissions
  fs.writeFileSync(SETTINGS_FILE, data, { mode: 0o600 });
}

function safeWriteIntegrations(data: string) {
  // ok: projectachilles-settings-file-permissions
  fs.writeFileSync(INTEGRATIONS_FILE, data, { mode: 0o600, encoding: 'utf-8' });
}

function safeWriteNonSensitive(data: string) {
  // ok: projectachilles-settings-file-permissions
  fs.writeFileSync('/tmp/output.json', data);
}
