/**
 * OpenAI Configuration Utility
 *
 * Centralizes OpenAI client creation and model configuration.
 * Supports both standard OpenAI and Azure OpenAI (or other OpenAI-compatible APIs).
 *
 * Environment Variables:
 * - NEXT_PUBLIC_OPENAI_API_KEY or OPENAI_API_KEY: API key
 * - NEXT_PUBLIC_OPENAI_BASE_URL or OPENAI_BASE_URL: Custom base URL (for Azure, proxies, etc.)
 * - NEXT_PUBLIC_OPENAI_MODEL_DEFAULT or MODEL_DEFAULT: Default model (e.g., "azure.gpt-4o" or "gpt-4o")
 * - NEXT_PUBLIC_OPENAI_MODEL_FAST or MODEL_FAST: Fast/cheap model (e.g., "azure.gpt-4o-mini" or "gpt-4o-mini")
 */

import OpenAI from 'openai';

// Model configuration with Azure support
// If using Azure, set MODEL_DEFAULT to something like "azure.gpt-4o"
const MODEL_DEFAULT =
  process.env.NEXT_PUBLIC_OPENAI_MODEL_DEFAULT ||
  process.env.MODEL_DEFAULT ||
  (typeof window !== 'undefined' ? (window as any).__OPENAI_MODEL_DEFAULT__ : null) ||
  'gpt-4o';

const MODEL_FAST =
  process.env.NEXT_PUBLIC_OPENAI_MODEL_FAST ||
  process.env.MODEL_FAST ||
  (typeof window !== 'undefined' ? (window as any).__OPENAI_MODEL_FAST__ : null) ||
  'gpt-4o-mini';

// Embedding model - note: Azure uses different deployment names
const MODEL_EMBEDDING =
  process.env.NEXT_PUBLIC_OPENAI_MODEL_EMBEDDING ||
  process.env.MODEL_EMBEDDING ||
  (typeof window !== 'undefined' ? (window as any).__OPENAI_MODEL_EMBEDDING__ : null) ||
  'text-embedding-3-small';

/**
 * Get the configured model name
 * @param type - 'default' for main model, 'fast' for cheaper/faster model, 'embedding' for embeddings
 */
export function getModelName(type: 'default' | 'fast' | 'embedding' = 'fast'): string {
  switch (type) {
    case 'default':
      return MODEL_DEFAULT;
    case 'embedding':
      return MODEL_EMBEDDING;
    case 'fast':
    default:
      return MODEL_FAST;
  }
}

/**
 * Check if we're using Azure OpenAI (or other custom endpoint)
 */
export function isUsingCustomEndpoint(): boolean {
  const baseURL = getBaseURL();
  return !!baseURL;
}

/**
 * Get the base URL for OpenAI API
 */
export function getBaseURL(): string | undefined {
  return process.env.NEXT_PUBLIC_OPENAI_BASE_URL ||
         process.env.OPENAI_BASE_URL ||
         (typeof window !== 'undefined' ? (window as any).__OPENAI_BASE_URL__ : undefined);
}

/**
 * Get the API key
 */
export function getAPIKey(): string {
  const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY ||
                 process.env.OPENAI_API_KEY ||
                 (typeof window !== 'undefined' ? (window as any).__OPENAI_API_KEY__ : null);

  if (!apiKey || apiKey === 'sk-...' || apiKey.includes('...')) {
    throw new Error(
      'OpenAI API key not configured. Please add OPENAI_API_KEY (or NEXT_PUBLIC_OPENAI_API_KEY for browser) to your .env.local file.'
    );
  }

  return apiKey;
}

/**
 * Create an OpenAI client with proper configuration for standard OpenAI or Azure
 * @param options - Additional options to pass to OpenAI constructor
 */
export function createOpenAIClient(options: {
  dangerouslyAllowBrowser?: boolean;
  timeout?: number;
  maxRetries?: number;
} = {}): OpenAI {
  const apiKey = getAPIKey();
  const baseURL = getBaseURL();

  const config: ConstructorParameters<typeof OpenAI>[0] = {
    apiKey,
    timeout: options.timeout ?? 60000,
    maxRetries: options.maxRetries ?? 2,
  };

  // Add base URL if configured (for Azure or proxies)
  if (baseURL) {
    config.baseURL = baseURL;
    console.log('[OpenAI Config] Using custom base URL:', baseURL);
  }

  // Allow browser usage if specified
  if (options.dangerouslyAllowBrowser) {
    config.dangerouslyAllowBrowser = true;
  }

  console.log('[OpenAI Config] Initializing client');
  console.log('[OpenAI Config] Default model:', MODEL_DEFAULT);
  console.log('[OpenAI Config] Fast model:', MODEL_FAST);

  return new OpenAI(config);
}

/**
 * Create a browser-safe OpenAI client
 */
export function createBrowserOpenAIClient(): OpenAI {
  return createOpenAIClient({
    dangerouslyAllowBrowser: true,
    timeout: 60000,
    maxRetries: 2,
  });
}

/**
 * Create a server-side OpenAI client
 */
export function createServerOpenAIClient(): OpenAI {
  return createOpenAIClient({
    timeout: 120000,
    maxRetries: 3,
  });
}

// Export model names for convenience
export { MODEL_DEFAULT, MODEL_FAST, MODEL_EMBEDDING };
