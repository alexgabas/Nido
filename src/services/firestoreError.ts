export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  code: string;
  error: string;
  operationType: OperationType;
  path: string | null;
  isSignedIn: boolean;
  emailVerified: boolean;
}

export class FirestoreAppError extends Error {
  readonly info: FirestoreErrorInfo;
  readonly path: string | null;

  constructor(userMessage: string, info: FirestoreErrorInfo) {
    super(userMessage);
    this.name = 'FirestoreAppError';
    this.info = info;
    this.path = info.path;
  }
}

function sanitizeSinglePath(rawPath: string): string {
  const segments = rawPath
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return '';
  return segments
    .map((seg, idx) => (idx % 2 === 1 ? '{id}' : seg))
    .join('/');
}

/**
 * Redacta IDs concretos de documentos en rutas Firestore (p. ej. `households/abc123` -> `households/{id}`)
 * para diagnóstico técnico sin exponer identificadores de hogar ni usuario.
 */
export function sanitizeFirestorePath(path: string | null | undefined): string | null {
  if (!path || typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  const sep = trimmed.includes(' | ') ? ' | ' : trimmed.includes(', ') ? ', ' : null;
  if (!sep) {
    return sanitizeSinglePath(trimmed) || null;
  }
  const parts = trimmed
    .split(sep)
    .map((part) => sanitizeSinglePath(part))
    .filter(Boolean);
  return parts.length > 0 ? Array.from(new Set(parts)).join(sep) : null;
}

export function extractFirestoreErrorCode(error: unknown): string {
  if (error instanceof FirestoreAppError) {
    return error.info.code || 'unknown';
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const rawCode = String((error as { code?: unknown }).code ?? '').trim();
    if (rawCode) {
      return rawCode.replace(/^firestore\//i, '').slice(0, 64);
    }
  }
  const rawMsg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  if (rawMsg.includes('permission-denied') || rawMsg.includes('missing or insufficient permissions')) {
    return 'permission-denied';
  }
  if (rawMsg.includes('offline') || rawMsg.includes('unavailable')) {
    return 'unavailable';
  }
  if (rawMsg.includes('invalid-argument')) {
    return 'invalid-argument';
  }
  if (rawMsg.includes('failed-precondition')) {
    return 'failed-precondition';
  }
  if (rawMsg.includes('unauthenticated')) {
    return 'unauthenticated';
  }
  return 'unknown';
}

export function sanitizeFirestoreErrorMessage(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? '');
  const redactedEmails = msg.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]');
  const trimmed = redactedEmails.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return 'Error de Firestore';
  }
  return trimmed.slice(0, 240);
}

export function getFriendlyFirestoreMessage(
  error: unknown,
  operationType: OperationType,
  rawPath: string | null,
  customMessage?: string
): string {
  if (customMessage) return customMessage;

  const code = extractFirestoreErrorCode(error);
  const rawMsg = error instanceof Error ? error.message : String(error);
  const lower = `${code} ${rawMsg}`.toLowerCase();

  if (lower.includes('offline') || code === 'unavailable') {
    return 'Sin conexión con el servidor. Tus cambios locales se sincronizarán cuando vuelva la red.';
  }

  if (rawPath && /^households\/[^/]+$/.test(rawPath) && operationType === OperationType.CREATE) {
    return 'No se ha podido crear el hogar, inténtalo de nuevo.';
  }
  if (rawPath && rawPath.startsWith('invites/') && operationType === OperationType.GET) {
    return 'No se ha podido comprobar el código de invitación. Inténtalo de nuevo.';
  }
  if (code === 'permission-denied' || lower.includes('missing or insufficient permissions')) {
    return 'No tienes permisos para realizar esta acción o alguno de los datos no es válido.';
  }
  if (operationType === OperationType.DELETE) {
    return 'No se pudo eliminar el elemento. Inténtalo de nuevo.';
  }
  if (operationType === OperationType.GET || operationType === OperationType.LIST) {
    return 'No se pudieron cargar los datos del hogar. Revisa tu conexión e inténtalo de nuevo.';
  }
  return 'No se pudieron guardar los cambios. Inténtalo de nuevo.';
}

export function toUserFriendlyErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof FirestoreAppError) return err.message;
  if (err instanceof Error) {
    const trimmed = err.message.trim();
    if (!trimmed) return fallback;
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return fallback;
    }
    if (trimmed.includes('Missing or insufficient permissions') || trimmed.includes('FirebaseError:')) {
      return fallback;
    }
    return trimmed;
  }
  return fallback;
}

export function formatFirestoreFailureForUser(err: unknown, fallback: string): string {
  const base = toUserFriendlyErrorMessage(err, fallback);
  if (err instanceof FirestoreAppError) {
    const details: string[] = [`código: ${err.info.code}`, `operación: ${err.info.operationType}`];
    if (err.info.path) {
      details.push(`ruta: ${err.info.path}`);
    }
    return `${base} (${details.join(' · ')})`;
  }
  const code = extractFirestoreErrorCode(err);
  if (code !== 'unknown') {
    return `${base} (código: ${code})`;
  }
  return base;
}

export function buildSafeFirestoreErrorInfo(
  error: unknown,
  operationType: OperationType,
  rawPath: string | null,
  authState: { isSignedIn: boolean; emailVerified: boolean }
): FirestoreErrorInfo {
  return {
    code: extractFirestoreErrorCode(error),
    error: sanitizeFirestoreErrorMessage(error),
    operationType,
    path: sanitizeFirestorePath(rawPath),
    isSignedIn: Boolean(authState.isSignedIn),
    emailVerified: Boolean(authState.emailVerified),
  };
}
