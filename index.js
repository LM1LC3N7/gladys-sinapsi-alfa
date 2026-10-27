// -----------------------------------------------------------------------------
// Entry point: SDK wiring only (src/handlers.js). Every handler is registered
// BEFORE connect(), and delegates to the AlfaApp (src/app.js). Read-only: no
// command handler, the Alfa is never commanded.
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { AlfaApp } from './src/app.js';
import { registerHandlers } from './src/handlers.js';

const gladys = new GladysIntegration();
const app = new AlfaApp({ gladys });

registerHandlers(gladys, app, logger);
gladys.handleShutdown(() => app.stop());

logger.info('Starting the Sinapsi Alfa integration...');
gladys.connect().catch((err) => {
  logger.error(`Initial connection failed (${err?.name ?? 'Error'})`);
  process.exit(1);
});
