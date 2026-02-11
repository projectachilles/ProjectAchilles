// ruleid: projectachilles-env-fallback-insecure
const apiKey = process.env.API_KEY || "default-key";

// ruleid: projectachilles-env-fallback-insecure
const secret = process.env.ENCRYPTION_SECRET ?? "fallback-secret";

// ruleid: projectachilles-env-fallback-insecure
const token = process.env.AUTH_TOKEN || "tok_default";

// ruleid: projectachilles-env-fallback-insecure
const password = process.env.DB_PASSWORD ?? "changeme";

// ok: projectachilles-env-fallback-insecure
const port = process.env.PORT || "3000";

// ok: projectachilles-env-fallback-insecure
const host = process.env.HOST ?? "localhost";

// ok: projectachilles-env-fallback-insecure
const indexPattern = process.env.ELASTICSEARCH_INDEX_PATTERN || "achilles-results-*";
