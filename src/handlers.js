// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so the
// tests run the exact wiring of the container. Read-only: no command handler,
// the Alfa is never commanded.
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // --- Discovery -------------------------------------------------------------------
  // The known device, never a read (the next one comes at its time).
  gladys.onScanRequest(() => app.scan());
  // A device just created: its values come at the next read.
  gladys.onDeviceCreated((device) => app.onDeviceCreated(device));
  gladys.onDeviceUpdated((device) => app.onDeviceUpdated(device));

  // --- Configuration screen buttons -----------------------------------------------
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  // The only way to take an index held back (a save of the form never does).
  gladys.onAction(ACTIONS.ACCEPT_HELD, () => app.acceptHeldIndex());

  // --- Configuration changed by the user ----------------------------------------
  gladys.onConfigUpdated((config) => {
    logger?.info('Configuration updated: restarting');
    return app.start(config);
  });

  // --- Connection lifecycle ------------------------------------------------------
  // Every connection (the first one and each reconnection): the configuration
  // read from Gladys, again and again while it fails (src/app.js
  // connectedFrom), then the Discovery list and the status again, and the
  // values at the next read.
  gladys.on('connected', async () => {
    try {
      await app.connectedFrom(() => gladys.getConfig());
    } catch (err) {
      logger?.error(`Start failed (${err?.name ?? 'Error'})`);
    }
  });
  gladys.on('disconnected', () => {
    app.stop().catch((err) => logger?.error(`Stop failed (${err?.name ?? 'Error'})`));
  });
}
