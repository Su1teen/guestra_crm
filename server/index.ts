import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { startIntegrationRecovery } from "./integration/recovery.js";
import { loadRegisteredMappings } from "./integration/registry.js";
import { startDistributionLoop } from "./services/distribution.js";
import { startProviderEventWorker } from "./meta/events.js";
import { seedDefaultTemplates } from "./services/message-templates.js";

const config = readConfig();
const { db } = createDatabase(config.DATABASE_URL);
await loadRegisteredMappings(db, config);
await seedDefaultTemplates(db);
const providerEvents = startProviderEventWorker(db);
const app = createApp(db, config, { onProviderEvents: providerEvents.kick });
const stopRecovery = startIntegrationRecovery(db, config);
const stopDistribution = startDistributionLoop(db);
const stop = () => { stopRecovery(); stopDistribution(); providerEvents.stop(); };
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

app.listen(config.PORT, () => console.log(`Guestra CRM listening on port ${config.PORT}`));
