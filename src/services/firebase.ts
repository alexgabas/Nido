import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

let dbInstance: Firestore;
try {
  dbInstance = initializeFirestore(
    app,
    {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    },
    firebaseConfig.firestoreDatabaseId
  );
} catch {
  dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export const db = dbInstance;
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
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

function getFriendlyFirestoreMessage(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  customMessage?: string
): string {
  if (customMessage) return customMessage;

  const rawCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  const rawMsg = error instanceof Error ? error.message : String(error);
  const lower = `${rawCode} ${rawMsg}`.toLowerCase();

  if (lower.includes('offline') || rawCode === 'unavailable') {
    return 'Sin conexión con el servidor. Tus cambios locales se sincronizarán cuando vuelva la red.';
  }

  if (path && /^households\/[^/]+$/.test(path) && operationType === OperationType.CREATE) {
    return 'No se ha podido crear el hogar, inténtalo de nuevo.';
  }
  if (path && path.startsWith('invites/') && operationType === OperationType.GET) {
    return 'No se ha podido comprobar el código de invitación. Inténtalo de nuevo.';
  }
  if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) {
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

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  customUserMessage?: string
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  const friendlyMessage = getFriendlyFirestoreMessage(error, operationType, path, customUserMessage);
  throw new FirestoreAppError(friendlyMessage, errInfo);
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Firestore está sin conexión. Se usará la caché local si está disponible.');
    }
  }
}

void testConnection();
