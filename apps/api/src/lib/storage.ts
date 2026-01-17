import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { logger } from './logger';

const S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost:9000';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'minioadmin';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'minioadmin';
const S3_BUCKET = process.env.S3_BUCKET || 'docgen-artifacts';
const S3_REGION = process.env.S3_REGION || 'us-east-1';

export const s3Client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
  forcePathStyle: true, // Required for MinIO
});

export async function uploadFile(
  key: string,
  body: Buffer | Readable,
  contentType: string
): Promise<string> {
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    },
  });

  await upload.done();
  logger.debug({ key, contentType }, 'File uploaded to S3');
  
  return key;
}

export async function getFile(key: string): Promise<{
  body: Readable;
  contentType: string;
  contentLength: number;
}> {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  const response = await s3Client.send(command);
  
  return {
    body: response.Body as Readable,
    contentType: response.ContentType || 'application/octet-stream',
    contentLength: response.ContentLength || 0,
  };
}

export async function deleteFile(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  await s3Client.send(command);
  logger.debug({ key }, 'File deleted from S3');
}

export function generateStorageKey(projectId: string, filename: string): string {
  const timestamp = Date.now();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `projects/${projectId}/${timestamp}-${sanitizedFilename}`;
}

