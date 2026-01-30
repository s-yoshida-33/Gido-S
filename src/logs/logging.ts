// src/logs/logging.ts
// Lightweight wrapper around window.logger for renderer-side logging.

type LogContext = Record<string, unknown>;

export type LogTag = 'SYS_INIT' | 'DATA_SYNC' | 'CMS_DELIVERY' | 'ASSET_CHECK' | 'GENERAL';

function baseContext(scope: string, extra?: LogContext, tag?: LogTag) {
  return {
    scope, // e.g. "map", "shopList", "video", "openTime"
    tag: tag || 'GENERAL',
    ...extra,
  };
}

export function logInfo(scope: string, message: string, context?: LogContext) {
  window.logger?.info(message, baseContext(scope, context, 'GENERAL'));
}

export function logWarn(scope: string, message: string, context?: LogContext) {
  window.logger?.warn(message, baseContext(scope, context, 'GENERAL'));
}

export function logError(scope: string, message: string, context?: LogContext) {
  window.logger?.error(message, baseContext(scope, context, 'GENERAL'));
}

export function logDebug(scope: string, message: string, context?: LogContext) {
  window.logger?.debug(message, baseContext(scope, context, 'GENERAL'));
}

// --- Specialized Loggers ---

/** BridgeGround API / Data Sync related */
export function logDataSync(message: string, details?: LogContext) {
  window.logger?.info(message, baseContext('dataSync', details, 'DATA_SYNC'));
}
export function logDataSyncError(message: string, details?: LogContext) {
  window.logger?.error(message, baseContext('dataSync', details, 'DATA_SYNC'));
}

/** CMS / Timeline Delivery related */
export function logCmsDelivery(message: string, details?: LogContext) {
  window.logger?.info(message, baseContext('cms', details, 'CMS_DELIVERY'));
}

/** Asset / Display Integrity related */
export function logAssetCheck(message: string, details?: LogContext, level: 'warn' | 'error' = 'warn') {
  if (level === 'error') {
    window.logger?.error(message, baseContext('asset', details, 'ASSET_CHECK'));
  } else {
    window.logger?.warn(message, baseContext('asset', details, 'ASSET_CHECK'));
  }
}
