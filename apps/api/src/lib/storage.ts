/**
 * Storage Adapter
 *
 * Supports both S3/MinIO (cloud) and local filesystem storage.
 * Set STORAGE_MODE=local for Docker-free operation.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { logger } from './logger';

// Storage mode: 'local' or 's3'
const STORAGE_MODE = process.env.STORAGE_MODE || 'local';

// S3/MinIO configuration (only used if STORAGE_MODE=s3)
const S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost:9000';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'minioadmin';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'minioadmin';
const S3_BUCKET = process.env.S3_BUCKET || 'docgen-artifacts';
const S3_REGION = process.env.S3_REGION || 'us-east-1';

// Local filesystem configuration
const LOCAL_STORAGE_PATH = process.env.LOCAL_STORAGE_PATH || './storage';

// S3 client (lazy initialized only if needed)
let _s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!_s3Client) {
    _s3Client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      credentials: {
        accessKeyId: S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
      },
      forcePathStyle: true, // Required for MinIO
    });
  }
  return _s3Client;
}

// Export for backward compatibility
export const s3Client = STORAGE_MODE === 's3' ? getS3Client() : null;

/**
 * Ensure local storage directory exists
 */
async function ensureLocalStorageDir(key: string): Promise<string> {
  const filePath = path.join(LOCAL_STORAGE_PATH, key);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  return filePath;
}

/**
 * Upload a file to storage
 */
export async function uploadFile(
  key: string,
  body: Buffer | Readable,
  contentType: string
): Promise<string> {
  if (STORAGE_MODE === 's3') {
    // S3/MinIO upload
    const upload = new Upload({
      client: getS3Client(),
      params: {
        Bucket: S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      },
    });

    await upload.done();
    logger.debug({ key, contentType, mode: 's3' }, 'File uploaded to S3');
    return key;
  }

  // Local filesystem upload
  const filePath = await ensureLocalStorageDir(key);

  if (Buffer.isBuffer(body)) {
    await fs.writeFile(filePath, body);
  } else if (body instanceof Readable) {
    // Handle Readable stream
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
    }
    await fs.writeFile(filePath, Buffer.concat(chunks));
  } else {
    throw new Error('Unsupported body type');
  }

  // Also save metadata
  const metaPath = `${filePath}.meta.json`;
  await fs.writeFile(metaPath, JSON.stringify({ contentType, uploadedAt: new Date().toISOString() }));

  logger.debug({ key, contentType, mode: 'local', path: filePath }, 'File uploaded locally');
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
  if (STORAGE_MODE === 's3') {
    // S3/MinIO download
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    });

    const response = await getS3Client().send(command);

    return {
      body: response.Body as Readable,
      contentType: response.ContentType || 'application/octet-stream',
      contentLength: response.ContentLength || 0,
    };
  }

  // Local filesystem download
  const filePath = path.join(LOCAL_STORAGE_PATH, key);

  if (!fsSync.existsSync(filePath)) {
    throw new Error(`File not found: ${key}`);
  }

  const stat = await fs.stat(filePath);
  const buffer = await fs.readFile(filePath);

  // Try to read metadata
  let contentType = 'application/octet-stream';
  const metaPath = `${filePath}.meta.json`;
  try {
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
    contentType = meta.contentType || contentType;
  } catch {
    // Fallback: determine content type from extension
    const ext = path.extname(key).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.json': 'application/json',
      '.csv': 'text/csv',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.html': 'text/html',
      '.xml': 'application/xml',
      '.zip': 'application/zip',
    };
    contentType = mimeTypes[ext] || contentType;
  }

  return {
    body: Readable.from(buffer),
    contentType,
    contentLength: stat.size,
  };
}

/**
 * Delete a file from storage
 */
export async function deleteFile(key: string): Promise<void> {
  if (STORAGE_MODE === 's3') {
    // S3/MinIO delete
    const command = new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    });

    await getS3Client().send(command);
    logger.debug({ key, mode: 's3' }, 'File deleted from S3');
    return;
  }

  // Local filesystem delete
  const filePath = path.join(LOCAL_STORAGE_PATH, key);

  try {
    await fs.unlink(filePath);
    // Also delete metadata file if it exists
    await fs.unlink(`${filePath}.meta.json`).catch(() => {});
    logger.debug({ key, mode: 'local' }, 'File deleted locally');
  } catch (error) {
    // Ignore if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Check if a file exists in storage
 */
export async function fileExists(key: string): Promise<boolean> {
  if (STORAGE_MODE === 's3') {
    try {
      const command = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      });
      await getS3Client().send(command);
      return true;
    } catch {
      return false;
    }
  }

  // Local filesystem
  const filePath = path.join(LOCAL_STORAGE_PATH, key);
  return fsSync.existsSync(filePath);
}

/**
 * Generate a storage key for a project artifact
 */
export function generateStorageKey(projectId: string, filename: string): string {
  const timestamp = Date.now();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `projects/${projectId}/${timestamp}-${sanitizedFilename}`;
}

/**
 * Get the public URL for a file (for download links)
 */
export function getFileUrl(key: string): string {
  if (STORAGE_MODE === 's3') {
    // Return S3 URL (may need presigned URL for private buckets)
    return `${S3_ENDPOINT}/${S3_BUCKET}/${key}`;
  }

  // For local storage, return API endpoint
  return `/api/artifacts/download/${encodeURIComponent(key)}`;
}

/**
 * Get storage info for debugging
 */
export function getStorageInfo(): { mode: string; path?: string; endpoint?: string } {
  if (STORAGE_MODE === 's3') {
    return { mode: 's3', endpoint: S3_ENDPOINT };
  }
  return { mode: 'local', path: path.resolve(LOCAL_STORAGE_PATH) };
}

logger.info({ ...getStorageInfo() }, 'Storage initialized');
