/**
 * TikTok Video Downloader Extension
 *
 * This script is loaded on TikTok pages and detects video URLs
 * to send them to the API for download.
 */

const logger = createScopedLogger('content');

const TIKTOK_URL_PATTERNS = [
  /https?:\/\/(www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/,
  /https?:\/\/(www\.)?vm\.tiktok\.com\/\w+/,
  /https?:\/\/(www\.)?m\.tiktok\.com\/v\/\d+/
];

function isValidTikTokUrl(url) {
  return TIKTOK_URL_PATTERNS.some(pattern => pattern.test(url));
}

function normalizeTikTokUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('is_copy_url');
    parsed.searchParams.delete('is_from_webapp_v1');
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    logger.debug('Failed to normalize URL', { url, error: error.message });
    return url;
  }
}

function notifyVideoDetected(url) {
  chrome.runtime.sendMessage({
    action: 'content.videoDetected',
    url,
    normalizedUrl: normalizeTikTokUrl(url)
  }, response => {
    if (chrome.runtime.lastError) {
      logger.warn('Video detection message delivery failed', chrome.runtime.lastError.message);
      return;
    }
    if (response?.ack) {
      logger.debug('Background acknowledged video detection', { url: response.url });
    }
  });
}

function processCurrentPage() {
  const url = window.location.href;
  const valid = isValidTikTokUrl(url);
  logger.debug('Processing page', { url, valid });

  if (!valid) {
    logger.debug('Current URL is not a TikTok video, skipping');
    return;
  }

  logger.info('TikTok video detected', { url });
  notifyVideoDetected(url);

  chrome.runtime.sendMessage({
    action: 'checkTikTokVideo',
    url: normalizeTikTokUrl(url)
  }, response => {
    if (chrome.runtime.lastError) {
      logger.error('Error communicating with extension', chrome.runtime.lastError.message);
      return;
    }
    if (response && response.downloadLinks) {
      logger.info('Download links received', { count: response.downloadLinks.length });
    } else {
      logger.debug('No download links provided in response');
    }
  });

  addDownloadHint();
}

function addDownloadHint() {
  // Placeholder for future UI integration on TikTok pages.
}

processCurrentPage();

let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  logger.debug('URL change detected', { url: lastUrl });
  processCurrentPage();
}).observe(document, { subtree: true, childList: true });
