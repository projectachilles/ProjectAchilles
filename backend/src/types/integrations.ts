// Type definitions for external integration settings (Azure / Entra ID, etc.)

export interface AzureIntegrationSettings {
  tenant_id: string;
  client_id: string;
  client_secret: string;
  configured: boolean;
  label?: string; // user-friendly name, e.g. "Contoso Production"
}

export interface DefenderIntegrationSettings {
  tenant_id: string;
  client_id: string;
  client_secret: string;
  configured: boolean;
  label?: string; // e.g. "Contoso Production"
}

export interface IntegrationsSettings {
  azure?: AzureIntegrationSettings;
  defender?: DefenderIntegrationSettings;
}
