import { describe, it, expect } from 'vitest';
import { AlertSettingsSchema } from '../integrations.schemas.js';

const AlertThresholdsSchema = {
  parse: (t: unknown) => AlertSettingsSchema.parse({ thresholds: t }).thresholds,
  safeParse: (t: unknown) => AlertSettingsSchema.safeParse({ thresholds: t }),
};

describe('AlertThresholdsSchema', () => {
  it('keeps the metric thresholds (previously stripped) and the SentinelOne agent counts', () => {
    const parsed = AlertThresholdsSchema.parse({
      enabled: true, defense_score_min: 80, error_rate_max: 20, secure_score_min: 60,
      s1_infected_agents_max: 0, s1_detect_only_agents_max: 5, s1_outdated_agents_max: 10,
    });
    expect(parsed).toMatchObject({
      defense_score_min: 80, error_rate_max: 20, secure_score_min: 60,
      s1_infected_agents_max: 0, s1_detect_only_agents_max: 5, s1_outdated_agents_max: 10,
    });
  });
  it('rejects negative or fractional agent counts', () => {
    expect(AlertThresholdsSchema.safeParse({ enabled: true, s1_infected_agents_max: -1 }).success).toBe(false);
    expect(AlertThresholdsSchema.safeParse({ enabled: true, s1_outdated_agents_max: 1.5 }).success).toBe(false);
  });
});
