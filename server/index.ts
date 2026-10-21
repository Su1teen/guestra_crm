import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { startIntegrationRecovery } from "./integration/recovery.js";
import { loadRegisteredMappings } from "./integration/registry.js";

const config = readConfig();
const { db } = createDatabase(config.DATABASE_URL);
await loadRegisteredMappings(db, config);
const app = createApp(db, config);
const stopRecovery = startIntegrationRecovery(db, config);
process.once("SIGTERM", stopRecovery);
process.once("SIGINT", stopRecovery);

app.listen(config.PORT, () => console.log(`Guestra CRM listening on port ${config.PORT}`));
