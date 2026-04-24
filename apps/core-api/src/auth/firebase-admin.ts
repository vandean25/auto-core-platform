import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export function getFirebaseAdminApp() {
  if (getApps().length > 0) {
    return getApp();
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  const rawCredentials = process.env.GCP_CREDENTIALS;

  if (rawCredentials) {
    const parsed = JSON.parse(rawCredentials) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };

    if (parsed.client_email && parsed.private_key) {
      return initializeApp({
        credential: cert({
          projectId: parsed.project_id ?? projectId,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key,
        }),
        projectId: parsed.project_id ?? projectId,
      });
    }
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

export function getFirebaseAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}