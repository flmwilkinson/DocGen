/**
 * Storage Adapter
 *
 * Provides a unified interface for file storage that supports:
 * - Local filesystem (STORAGE_TYPE=local) - For POC/development
 * - S3/MinIO (STORAGE_TYPE=s3) - For production
 *
 * Set STORAGE_TYPE=local to use local filesystem storage without Docker/MinIO
 */

import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

// Storage configuration
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'local'; // 'local' or 's3'
const LOCAL_STORAGE_PATH = process.env.LOCAL_STORAGE_PATH || './data/storage';
const S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost:9000';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'minioadmin';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'minioadmin';
const S3_BUCKET = process.env.S3_BUCKET || 'docgen-artifacts';
const S3_REGION = process.env.S3_REGION || 'us-east-1';

// S3 client (lazy loaded only when needed)
let s3Client: any = null;

async function getS3Client() {
  if (!s3Client) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    s3Client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      credentials: {
        accessKeyId: S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
      },
      forcePathStyle: true,
    });
  }
  return s3Client;
}

// Ensure local storage directory exists
function ensureLocalDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getLocalPath(key: string): string {
  return path.join(LOCAL_STORAGE_PATH, key);
}

/**
 * Upload a file to storage
 */
export async function uploadFile(
  key: string,
  body: Buffer | Readable,
  contentType: string
): Promise<string> {
  if (STORAGE_TYPE === 'local') {
    const filePath = getLocalPath(key);
    ensureLocalDir(filePath);

    if (body instanceof Readable) {
      // Convert stream to buffer
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(Buffer.from(chunk));
      }
      fs.writeFileSync(filePath, Buffer.concat(chunks));
    } else {
      fs.writeFileSync(filePath, body);
    }

    // Store metadata alongside file
    const metaPath = filePath + '.meta.json';
    fs.writeFileSync(metaPath, JSON.stringify({ contentType, uploadedAt: new Date().toISOString() }));

    logger.debug({ key, contentType, storage: 'local' }, 'File uploaded to local storage');
    return key;
  }

  // S3 storage
  const client = await getS3Client();
  const { Upload } = await import('@aws-sdk/lib-storage');

  const upload = new Upload({
    client,
    params: {
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    },
  });

  await upload.done();
  logger.debug({ key, contentType, storage: 's3' }, 'File uploaded to S3');

  return key;
}

/**
 * Get a file from storage
 */
export async function getFile(key: string): Promise<{
  body: Readable;
  contentType: string;
  contentLength: number;
}> {
  if (STORAGE_TYPE === 'local') {
    const filePath = getLocalPath(key);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${key}`);
    }

    const stats = fs.statSync(filePath);
    const metaPath = filePath + '.meta.json';
    let contentType = 'application/octet-stream';

    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      contentType = meta.contentType || contentType;
    }

    return {
      body: fs.createReadStream(filePath),
      contentType,
      contentLength: stats.size,
    };
  }

  // S3 storage
  const client = await getS3Client();
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  const response = await client.send(command);

  return {
    body: response.Body as Readable,
    contentType: response.ContentType || 'application/octet-stream',
    contentLength: response.ContentLength || 0,
  };
}

/**
 * Delete a file from storage
 */
export async function deleteFile(key: string): Promise<void> {
  if (STORAGE_TYPE === 'local') {
    const filePath = getLocalPath(key);
    const metaPath = filePath + '.meta.json';

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }

    logger.debug({ key, storage: 'local' }, 'File deleted from local storage');
    return;
  }

  // S3 storage
  const client = await getS3Client();
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');

  const command = new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  await client.send(command);
  logger.debug({ key, storage: 's3' }, 'File deleted from S3');
}

/**
 * Check if a file exists in storage
 */
export async function fileExists(key: string): Promise<boolean> {
  if (STORAGE_TYPE === 'local') {
    const filePath = getLocalPath(key);
    return fs.existsSync(filePath);
  }

  // S3 storage
  const client = await getS3Client();
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');

  try {
    const command = new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    });
    await client.send(command);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a storage key for project files
 */
export function generateStorageKey(projectId: string, filename: string): string {
  const timestamp = Date.now();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `projects/${projectId}/${timestamp}-${sanitizedFilename}`;
}

/**
 * Get storage info for diagnostics
 */
export function getStorageInfo(): { type: string; path?: string; endpoint?: string } {
  if (STORAGE_TYPE === 'local') {
    return {
      type: 'local',
      path: path.resolve(LOCAL_STORAGE_PATH),
    };
  }
  return {
    type: 's3',
    endpoint: S3_ENDPOINT,
  };
}

// Export s3Client for backward compatibility (lazy loaded)
export { getS3Client as s3Client };
