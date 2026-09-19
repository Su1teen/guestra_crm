import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { createDatabase } from "./db/client.js";

const config = readConfig();
const { db } = createDatabase(config.DATABASE_URL);
const app = createApp(db, config);

app.listen(config.PORT, () => console.log(`Guestra CRM listening on port ${config.PORT}`));
