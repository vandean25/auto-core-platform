import type { Logger } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';

interface ParsedGcpCredentials {
  clientEmail: string;
  privateKey: string;
  projectId?: string;
}

function parseGcpCredentials(raw: string): ParsedGcpCredentials {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const clientEmail =
    typeof parsed.client_email === 'string' ? parsed.client_email : undefined;
  const privateKey =
    typeof parsed.private_key === 'string' ? parsed.private_key : undefined;
  const projectId =
    typeof parsed.project_id === 'string' ? parsed.project_id : undefined;

  if (!clientEmail || !privateKey) {
    throw new Error(
      'GCP_CREDENTIALS does not include client_email/private_key fields',
    );
  }

  return { clientEmail, privateKey, projectId };
}

function formatErrorMessage(error: unknown): {
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

function createClientFromCredentials(rawCredentials: string): {
  client: CloudTasksClient;
  cachedProjectId?: string;
} {
  const { clientEmail, privateKey, projectId } =
    parseGcpCredentials(rawCredentials);
  const client = new CloudTasksClient({
    projectId,
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
  });
  return { client, cachedProjectId: projectId };
}

export function initializeCloudTasksClient(logger: Logger): {
  client: CloudTasksClient;
  cachedProjectId?: string;
} {
  const credentials = process.env.GCP_CREDENTIALS;
  if (!credentials) {
    return { client: new CloudTasksClient() };
  }

  try {
    const result = createClientFromCredentials(credentials);
    logger.log('Cloud Tasks client initialized with GCP_CREDENTIALS from env');
    return result;
  } catch (error) {
    const { message, stack } = formatErrorMessage(error);
    logger.error(
      `Failed to parse GCP_CREDENTIALS for Cloud Tasks client; falling back to default credentials: ${message}`,
      stack,
    );
    return { client: new CloudTasksClient() };
  }
}
