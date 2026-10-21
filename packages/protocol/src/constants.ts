export const PROTOCOL_VERSION = 1;

/** Path of the WebSocket endpoint workers connect to on the master. */
export const WS_PATH = "/ws/worker";

export const PING_INTERVAL_MS = 5_000;
/** Connection is considered dead when no pong arrived for this long. */
export const PONG_TIMEOUT_MS = 10_000;
/** A worker is shown as offline once it has been disconnected for longer than this. */
export const OFFLINE_GRACE_MS = 10_000;
export const HANDSHAKE_TIMEOUT_MS = 10_000;
export const MAX_MESSAGE_BYTES = 1024 * 1024;
/** Extra time the master waits beyond a test's own timeout before declaring the worker unresponsive. */
export const WATCHDOG_MARGIN_MS = 15_000;

export const INTERFACE_POLL_MS = 10_000;
export const INTERFACE_RESYNC_MS = 5 * 60_000;

/** WebSocket close codes (application range). */
export const CLOSE_REPLACED = 4000;
export const CLOSE_REJECTED = 4001;
export const CLOSE_PONG_TIMEOUT = 4002;
export const CLOSE_DISABLED = 4003;
export const CLOSE_TOKEN_ROTATED = 4004;
export const CLOSE_REMOVED = 4005;
