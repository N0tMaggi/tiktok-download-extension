importScripts('logger.js');

const logger = createScopedLogger('background');
const CACHE_STORAGE_KEY = 'tiktokCache';
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour
const cache = new Map();
let cacheLoadPromise = null;
let persistTimeoutId = null;

function ensureCacheLoaded() {
  if (cacheLoadPromise) return cacheLoadPromise;

  cacheLoadPromise = new Promise(resolve => {
    chrome.storage.local.get({ [CACHE_STORAGE_KEY]: [] }, result => {
      const storedEntries = Array.isArray(result[CACHE_STORAGE_KEY]) ? result[CACHE_STORAGE_KEY] : [];
      const now = Date.now();
      storedEntries.forEach(entry => {
        if (!entry || !entry.key) return;
        const age = now - (entry.timestamp || 0);
        if (age <= CACHE_TTL_MS && entry.data) {
          cache.set(entry.key, { data: entry.data, timestamp: entry.timestamp });
        }
      });
      if (storedEntries.length) pruneExpiredEntries();
      logger.debug('Cache hydrated', { size: cache.size });
      resolve();
    });
  });

  return cacheLoadPromise;
}

function pruneExpiredEntries() {
  const now = Date.now();
  let removed = 0;
  cache.forEach((value, key) => {
    if (now - (value.timestamp || 0) > CACHE_TTL_MS) {
      cache.delete(key);
      removed += 1;
    }
  });
  if (removed) {
    logger.info('Expired cache entries pruned', { removed, size: cache.size });
    schedulePersist();
  }
}

function persistCache() {
  persistTimeoutId = null;
  const serialized = Array.from(cache.entries()).map(([key, value]) => ({
    key,
    data: value.data,
    timestamp: value.timestamp
  }));
  chrome.storage.local.set({ [CACHE_STORAGE_KEY]: serialized }, () => {
    if (chrome.runtime.lastError) {
      logger.error('Failed to persist cache', chrome.runtime.lastError);
      return;
    }
    logger.debug('Cache persisted', { size: serialized.length });
  });
}

function schedulePersist() {
  if (persistTimeoutId) return;
  persistTimeoutId = setTimeout(persistCache, 2000);
}

function cacheLookup(key) {
  if (!key) return null;
  const entry = cache.get(key);
  if (!entry) return null;
  const age = Date.now() - (entry.timestamp || 0);
  if (age > CACHE_TTL_MS) {
    cache.delete(key);
    logger.debug('Cache entry expired', { key });
    schedulePersist();
    return null;
  }
  return { data: entry.data, age };
}

function upsertCache(key, data) {
  if (!key || !data) return;
  cache.set(key, { data, timestamp: Date.now() });
  schedulePersist();
}

function deriveCacheKey(request) {
  if (request.cacheKey) return request.cacheKey;
  try {
    const apiUrl = new URL(request.apiUrl);
    const targetUrl = apiUrl.searchParams.get('url') || apiUrl.searchParams.get('source');
    return targetUrl ? decodeURIComponent(targetUrl) : request.apiUrl;
  } catch (error) {
    logger.warn('Failed to derive cache key, falling back to apiUrl', error);
    return request.apiUrl;
  }
}

async function handleFetchTikTokData(request) {
  await ensureCacheLoaded();
  pruneExpiredEntries();

  const cacheKey = deriveCacheKey(request);
  const cached = cacheLookup(cacheKey);
  if (cached) {
    logger.info('Cache hit', { cacheKey, age: cached.age });
    return { data: cached.data, cacheHit: true, cacheAge: cached.age };
  }

  logger.info('Cache miss, fetching', { cacheKey });
  const timer = logger.time('fetch');

  let response;
  try {
    response = await fetch(request.apiUrl, { cache: 'no-store' });
  } catch (networkError) {
    timer.end(false, { reason: 'network failure' });
    logger.error('Network error during fetch', networkError);
    throw new Error(networkError.message || 'Network error');
  }

  if (!response.ok) {
    timer.end(false, { status: response.status });
    logger.warn('API responded with non-OK status', { status: response.status, url: request.apiUrl });
    throw new Error(`HTTP error: ${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (parseError) {
    timer.end(false, { reason: 'json parse' });
    logger.error('Failed to parse API response', parseError);
    throw new Error('Failed to parse API response');
  }

  timer.end(true, { status: response.status });
  upsertCache(cacheKey, payload);
  logger.debug('Cache updated', { cacheKey });
  return { data: payload, cacheHit: false, cacheAge: 0 };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) return false;

  if (request.action === 'fetchTikTokData') {
    handleFetchTikTokData(request)
      .then(result => sendResponse(result))
      .catch(error => {
        logger.error('fetchTikTokData failed', error);
        sendResponse({ error: error.message || 'Unknown error' });
      });
    return true;
  }

  if (request.action === 'content.videoDetected') {
    const normalized = request.normalizedUrl || request.url;
    logger.debug('Video detection ping', { url: normalized });
    sendResponse({ ack: true, url: normalized });
    return false;
  }

  return false;
});

logger.info('Background Service Worker started');

setInterval(() => {
  logger.debug('Background keep-alive ping');
}, 20000);
