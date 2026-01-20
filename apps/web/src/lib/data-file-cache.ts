/**
 * Data File Cache Manager
 *
 * Caches data files (CSV, Excel, JSON, Parquet) at the document level to avoid
 * re-fetching from GitHub for every block.
 *
 * Expected impact: 40% faster generation for documents with multiple chart blocks
 */

export interface CachedDataFile {
  content: string;
  url?: string;
  fetchedAt: number;
  size: number;
  encoding?: 'utf-8' | 'base64';
}

export class DataFileCache {
  private cache: Map<string, CachedDataFile>;
  private maxAge: number; // Max age in milliseconds

  constructor(maxAgeMinutes: number = 30) {
    this.cache = new Map();
    this.maxAge = maxAgeMinutes * 60 * 1000;
  }

  /**
   * Get a file from cache if it exists and hasn't expired
   */
  get(filePath: string): CachedDataFile | null {
    const cached = this.cache.get(filePath);

    if (!cached) {
      return null;
    }

    // Check if expired
    const age = Date.now() - cached.fetchedAt;
    if (age > this.maxAge) {
      console.log(`[DataFileCache] Expired: ${filePath} (age: ${Math.round(age / 1000)}s)`);
      this.cache.delete(filePath);
      return null;
    }

    console.log(`[DataFileCache] ✅ Hit: ${filePath} (${cached.size} bytes, age: ${Math.round(age / 1000)}s)`);
    return cached;
  }

  /**
   * Add a file to cache
   */
  set(filePath: string, file: Omit<CachedDataFile, 'fetchedAt'>): void {
    this.cache.set(filePath, {
      ...file,
      fetchedAt: Date.now(),
    });

    console.log(`[DataFileCache] 💾 Cached: ${filePath} (${file.size} bytes)`);
  }

  /**
   * Check if a file exists in cache and is still valid
   */
  has(filePath: string): boolean {
    return this.get(filePath) !== null;
  }

  /**
   * Clear all cached files
   */
  clear(): void {
    this.cache.clear();
    console.log(`[DataFileCache] 🗑️ Cleared cache`);
  }

  /**
   * Get cache statistics
   */
  getStats(): { entries: number; totalSize: number; oldestAge: number } {
    let totalSize = 0;
    let oldestAge = 0;
    const now = Date.now();

    for (const file of this.cache.values()) {
      totalSize += file.size;
      const age = now - file.fetchedAt;
      oldestAge = Math.max(oldestAge, age);
    }

    return {
      entries: this.cache.size,
      totalSize,
      oldestAge: Math.round(oldestAge / 1000), // in seconds
    };
  }
}

/**
 * Fetch a data file with caching
 */
export async function fetchDataFileWithCache(
  filePath: string,
  url: string,
  cache?: Map<string, CachedDataFile>
): Promise<{ content: string; fromCache: boolean }> {
  // Check cache first
  if (cache) {
    const cached = cache.get(filePath);
    if (cached) {
      const age = Date.now() - cached.fetchedAt;
      // Cache valid for 30 minutes
      if (age < 30 * 60 * 1000) {
        console.log(`[DataFileCache] ✅ Hit: ${filePath} (age: ${Math.round(age / 1000)}s)`);
        return { content: cached.content, fromCache: true };
      } else {
        console.log(`[DataFileCache] Expired: ${filePath}, refetching`);
        cache.delete(filePath);
      }
    }
  }

  // Fetch from URL
  console.log(`[DataFileCache] ⬇️ Fetching: ${filePath} from ${url}`);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000), // 30s timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();
    const fetchTime = Date.now() - startTime;

    console.log(`[DataFileCache] ✅ Fetched: ${filePath} (${content.length} bytes in ${fetchTime}ms)`);

    // Cache it
    if (cache) {
      cache.set(filePath, {
        content,
        url,
        fetchedAt: Date.now(),
        size: content.length,
      });
    }

    return { content, fromCache: false };
  } catch (error) {
    console.error(`[DataFileCache] ❌ Failed to fetch ${filePath}:`, error);
    throw error;
  }
}

/**
 * Initialize cache for a generation context
 */
export function initializeDataFileCache(): Map<string, CachedDataFile> {
  console.log(`[DataFileCache] 🆕 Initialized new cache`);
  return new Map();
}

/**
 * Pre-fetch common data files for a project
 */
export async function preFetchDataFiles(
  dataFiles: Array<{ path: string; url: string }>,
  cache: Map<string, CachedDataFile>,
  maxConcurrent: number = 3
): Promise<void> {
  console.log(`[DataFileCache] 🚀 Pre-fetching ${dataFiles.length} data files...`);

  // Batch requests to avoid overwhelming the server
  for (let i = 0; i < dataFiles.length; i += maxConcurrent) {
    const batch = dataFiles.slice(i, i + maxConcurrent);

    await Promise.all(
      batch.map(file =>
        fetchDataFileWithCache(file.path, file.url, cache).catch(error => {
          console.warn(`[DataFileCache] Failed to pre-fetch ${file.path}:`, error);
        })
      )
    );
  }

  const stats = {
    entries: cache.size,
    totalSize: Array.from(cache.values()).reduce((sum, f) => sum + f.size, 0),
  };

  console.log(`[DataFileCache] ✅ Pre-fetch complete: ${stats.entries} files, ${Math.round(stats.totalSize / 1024)}KB total`);
}
