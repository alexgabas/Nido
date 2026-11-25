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

import {
  buildSafeFirestoreErrorInfo,
  FirestoreAppError,
  formatFirestoreFailureForUser,
  getFriendlyFirestoreMessage,
  OperationType,
  sanitizeFirestorePath,
  toUserFriendlyErrorMessage,
  type FirestoreErrorInfo,
} from './firestoreError';

export {
  FirestoreAppError,
  formatFirestoreFailureForUser,
  OperationType,
  sanitizeFirestorePath,
  toUserFriendlyErrorMessage,
  type FirestoreErrorInfo,
};

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  customUserMessage?: string
): never {
  const errInfo = buildSafeFirestoreErrorInfo(error, operationType, path, {
    isSignedIn: Boolean(auth.currentUser),
    emailVerified: Boolean(auth.currentUser?.emailVerified),
  });
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
