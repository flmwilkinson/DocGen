/**
 * PostgreSQL to SQLite Migration Script
 *
 * This script exports data from a PostgreSQL database and imports it into SQLite.
 * Run with: npx ts-node scripts/migrate-pg-to-sqlite.ts
 *
 * Prerequisites:
 * 1. Set SOURCE_DATABASE_URL to your PostgreSQL connection string
 * 2. Set DATABASE_URL to your SQLite file path (e.g., file:./docgen.db)
 * 3. Ensure the SQLite schema is up-to-date: npx prisma db push
 *
 * Usage:
 *   # Export from PostgreSQL (creates JSON files in ./migration-data)
 *   npx ts-node scripts/migrate-pg-to-sqlite.ts export
 *
 *   # Import to SQLite (reads JSON files from ./migration-data)
 *   npx ts-node scripts/migrate-pg-to-sqlite.ts import
 *
 *   # Full migration (export + import)
 *   npx ts-node scripts/migrate-pg-to-sqlite.ts migrate
 */

import { PrismaClient as PostgresClient } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';

const MIGRATION_DIR = './migration-data';

// Tables in dependency order (parent tables first)
const TABLES = [
  'users',
  'projects',
  'templates',
  'repo_snapshots',
  'knowledge_graphs',
  'artifacts',
  'generation_runs',
  'document_versions',
  'block_outputs',
  'gap_questions',
  'vector_chunks',
  'agent_traces',
];

// Fields that need BigInt to Int conversion
const BIGINT_FIELDS: Record<string, string[]> = {
  repo_snapshots: ['totalSize'],
  artifacts: ['size'],
};

// Fields that are JSON (need to be stringified for SQLite)
const JSON_FIELDS: Record<string, string[]> = {
  projects: ['settings'],
  repo_snapshots: ['fileManifest', 'languageStats'],
  knowledge_graphs: ['nodes', 'edges', 'stats'],
  artifacts: ['metadata'],
  templates: ['templateJson'],
  generation_runs: ['inputs'],
  document_versions: ['contentJson', 'exportArtifacts'],
  block_outputs: ['content', 'citations', 'rawResponse'],
  gap_questions: ['choices'],
  vector_chunks: ['metadata', 'embedding'],
  agent_traces: ['events'],
};

async function ensureMigrationDir(): Promise<void> {
  await fs.mkdir(MIGRATION_DIR, { recursive: true });
}

async function exportFromPostgres(): Promise<void> {
  console.log('Connecting to PostgreSQL...');

  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  if (!sourceUrl) {
    console.error('ERROR: SOURCE_DATABASE_URL environment variable not set');
    console.error('Set it to your PostgreSQL connection string:');
    console.error('  export SOURCE_DATABASE_URL="postgresql://user:pass@localhost:5432/docgen"');
    process.exit(1);
  }

  // Create a temporary Prisma client for PostgreSQL
  // Note: This requires the PostgreSQL schema to be available
  const prisma = new PostgresClient({
    datasources: {
      db: { url: sourceUrl },
    },
  });

  try {
    await prisma.$connect();
    console.log('Connected to PostgreSQL');

    await ensureMigrationDir();

    for (const table of TABLES) {
      console.log(`Exporting ${table}...`);

      // Use raw query to get all data
      const data = await prisma.$queryRawUnsafe(`SELECT * FROM ${table}`);

      // Convert data for SQLite compatibility
      const convertedData = (data as Record<string, unknown>[]).map(row => {
        const converted: Record<string, unknown> = { ...row };

        // Convert BigInt fields to number
        const bigintFields = BIGINT_FIELDS[table] || [];
        for (const field of bigintFields) {
          if (converted[field] !== undefined && converted[field] !== null) {
            converted[field] = Number(converted[field]);
          }
        }

        // Convert JSON fields to string
        const jsonFields = JSON_FIELDS[table] || [];
        for (const field of jsonFields) {
          if (converted[field] !== undefined && converted[field] !== null) {
            // If it's already a string, leave it; otherwise stringify
            if (typeof converted[field] !== 'string') {
              converted[field] = JSON.stringify(converted[field]);
            }
          }
        }

        // Handle vector embeddings (pgvector to JSON array)
        if (table === 'vector_chunks' && converted.embedding) {
          // pgvector returns embeddings as a special type
          // Convert to JSON array string
          if (Array.isArray(converted.embedding)) {
            converted.embedding = JSON.stringify(converted.embedding);
          } else if (typeof converted.embedding === 'string' && converted.embedding.startsWith('[')) {
            // Already a JSON string, keep it
          } else {
            // Unknown format, set to null
            console.warn(`  Warning: Unknown embedding format for chunk ${converted.id}`);
            converted.embedding = null;
          }
        }

        return converted;
      });

      // Write to JSON file
      const filePath = path.join(MIGRATION_DIR, `${table}.json`);
      await fs.writeFile(filePath, JSON.stringify(convertedData, null, 2));
      console.log(`  Exported ${convertedData.length} rows to ${filePath}`);
    }

    console.log('\nExport complete!');
    console.log(`Data saved to ${MIGRATION_DIR}/`);

  } finally {
    await prisma.$disconnect();
  }
}

async function importToSqlite(): Promise<void> {
  console.log('Connecting to SQLite...');

  const targetUrl = process.env.DATABASE_URL;
  if (!targetUrl || !targetUrl.startsWith('file:')) {
    console.error('ERROR: DATABASE_URL must be set to a SQLite file path');
    console.error('Example: export DATABASE_URL="file:./docgen.db"');
    process.exit(1);
  }

  const prisma = new PostgresClient();

  try {
    await prisma.$connect();
    console.log('Connected to SQLite');

    for (const table of TABLES) {
      const filePath = path.join(MIGRATION_DIR, `${table}.json`);

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content) as Record<string, unknown>[];

        if (data.length === 0) {
          console.log(`Skipping ${table} (no data)`);
          continue;
        }

        console.log(`Importing ${data.length} rows into ${table}...`);

        // Insert data in batches to avoid memory issues
        const batchSize = 100;
        for (let i = 0; i < data.length; i += batchSize) {
          const batch = data.slice(i, i + batchSize);

          // Build insert statements
          for (const row of batch) {
            const columns = Object.keys(row);
            const placeholders = columns.map(() => '?').join(', ');
            const values = columns.map(col => row[col]);

            // Use raw query for flexibility
            await prisma.$executeRawUnsafe(
              `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
              ...values
            );
          }

          process.stdout.write(`\r  Imported ${Math.min(i + batchSize, data.length)}/${data.length} rows`);
        }

        console.log(); // New line after progress
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          console.log(`Skipping ${table} (no export file found)`);
        } else {
          throw error;
        }
      }
    }

    console.log('\nImport complete!');

  } finally {
    await prisma.$disconnect();
  }
}

async function migrate(): Promise<void> {
  console.log('=== PostgreSQL to SQLite Migration ===\n');
  await exportFromPostgres();
  console.log('\n');
  await importToSqlite();
  console.log('\n=== Migration Complete ===');
}

// Main
const command = process.argv[2];

switch (command) {
  case 'export':
    exportFromPostgres().catch(console.error);
    break;
  case 'import':
    importToSqlite().catch(console.error);
    break;
  case 'migrate':
    migrate().catch(console.error);
    break;
  default:
    console.log('Usage: npx ts-node scripts/migrate-pg-to-sqlite.ts [export|import|migrate]');
    console.log('');
    console.log('Commands:');
    console.log('  export  - Export data from PostgreSQL to JSON files');
    console.log('  import  - Import data from JSON files to SQLite');
    console.log('  migrate - Full migration (export + import)');
    console.log('');
    console.log('Environment variables:');
    console.log('  SOURCE_DATABASE_URL - PostgreSQL connection string (for export)');
    console.log('  DATABASE_URL        - SQLite file path (for import)');
}
