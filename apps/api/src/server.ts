import { loadEnv } from './env';
import { installCrashHandlers } from './monitoring';
import { buildApi } from './build';

loadEnv();
installCrashHandlers();
const port = Number(process.env.PORT ?? 4000);
const { app, file } = buildApi();
app.listen(port, () => console.log(`[api] listening on :${port} (db: ${file})`));
