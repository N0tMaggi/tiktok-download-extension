const logger = createScopedLogger('popup');

const downloadBtn = document.getElementById('downloadBtn');
const btnText = document.getElementById('btnText');
const btnLoader = document.getElementById('btnLoader');
const downloadMusicBtn = document.getElementById('downloadMusicBtn');
const musicBtnText = document.getElementById('musicBtnText');
const musicBtnLoader = document.getElementById('musicBtnLoader');
const statusMessage = document.getElementById('statusMessage');
const terminal = document.getElementById('terminal');
const clearTerminalBtn = document.getElementById('clearTerminal');
const toggleTerminalBtn = document.getElementById('toggleTerminal');
const themeToggleBtn = document.getElementById('themeToggle');
const manualEntry = document.getElementById('manualEntry');
const manualUrlInput = document.getElementById('manualUrlInput');
const manualFetchBtn = document.getElementById('manualFetchBtn');
const cacheBadge = document.getElementById('cacheBadge');

const TIKTOK_PATTERNS = [
  /https?:\/\/(www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/,
  /https?:\/\/(www\.)?tiktok\.com\/@[\w.-]+\/photo\/\d+/, 
  /https?:\/\/(www\.)?vm\.tiktok\.com\/\w+/, 
  /https?:\/\/(www\.)?m\.tiktok\.com\/v\/\d+/
];

const API_ENDPOINT = 'https://api.ag7-dev.de/v1/tiktok/tiktok.php';

const state = {
  phase: 'idle', // idle | fetching | ready | downloading
  contentType: null,
  manualMode: false,
  manualUrl: '',
  status: { message: '', type: '' },
  loading: { primary: false, music: false },
  theme: 'light',
  terminalVisible: true,
  meta: null,
  musicMeta: null,
  cacheHit: false,
  cacheAge: 0,
  activeUrl: null
};

let renderQueued = false;

function isValidTikTokUrl(url) {
  if (!url) return false;
  return TIKTOK_PATTERNS.some(pattern => pattern.test(url.trim()));
}

function normalizeTikTokUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('is_copy_url');
    parsed.searchParams.delete('is_from_webapp_v1');
    parsed.searchParams.delete('lang');
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    logger.warn('Failed to normalize URL', { url, error: error.message });
    return url;
  }
}

function mergeState(updates) {
  Object.entries(updates).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && state[key] && typeof state[key] === 'object' && !Array.isArray(state[key])) {
      state[key] = { ...state[key], ...value };
    } else {
      state[key] = value;
    }
  });
  queueRender();
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function computePrimaryLabel() {
  if (state.phase === 'fetching') return 'Processing...';
  if (state.phase === 'downloading') {
    return state.contentType === 'images' ? 'Downloading Photos...' : 'Downloading Video...';
  }
  if (state.phase === 'ready') {
    return state.contentType === 'images' ? 'Download Photos' : 'Download Video';
  }
  return state.manualMode ? 'Fetch TikTok' : 'Prepare Download';
}

function isPrimaryDisabled() {
  if (state.loading.primary) return true;
  if (state.phase === 'ready') return false;
  const targetUrl = state.manualMode ? state.manualUrl : state.activeUrl;
  return !isValidTikTokUrl(targetUrl);
}

function isMusicDisabled() {
  if (state.loading.music) return true;
  if (!state.meta) return true;
  return !state.musicMeta || !state.musicMeta.url;
}

function render() {
  document.documentElement.setAttribute('data-theme', state.theme);

  statusMessage.textContent = state.status.message || '';
  const statusType = state.status.type ? ` ${state.status.type}` : '';
  statusMessage.className = `status${statusType}`;
  statusMessage.style.display = state.status.message ? 'block' : 'none';

  btnText.textContent = computePrimaryLabel();
  btnLoader.style.display = state.loading.primary ? 'inline-block' : 'none';
  downloadBtn.disabled = isPrimaryDisabled();

  musicBtnText.textContent = state.loading.music ? 'Processing...' : 'Download Music';
  musicBtnLoader.style.display = state.loading.music ? 'inline-block' : 'none';
  downloadMusicBtn.disabled = isMusicDisabled();

  terminal.style.display = state.terminalVisible ? 'block' : 'none';
  toggleTerminalBtn.textContent = state.terminalVisible ? 'Hide' : 'Show';

  if (manualEntry) {
    manualEntry.classList.toggle('hidden', !state.manualMode);
  }
  if (manualUrlInput) {
    manualUrlInput.value = state.manualUrl;
  }
  if (manualFetchBtn) {
    const manualValid = isValidTikTokUrl(state.manualUrl);
    manualFetchBtn.disabled = state.loading.primary || !manualValid;
  }

  if (cacheBadge) {
    if (state.cacheHit) {
      cacheBadge.textContent = `Cache: ${Math.round(state.cacheAge / 1000)}s`;
      cacheBadge.classList.remove('hidden');
    } else {
      cacheBadge.classList.add('hidden');
    }
  }
  if (themeToggleBtn) {
    themeToggleBtn.textContent = state.theme === 'dark' ? 'Light' : 'Dark';
  }
}

function setStatus(message, type) {
  mergeState({ status: { message, type } });
}

function clearStatus() {
  mergeState({ status: { message: '', type: '' } });
}

function buildApiUrl(url, includeDemoKey = false) {
  const params = new URLSearchParams();
  if (includeDemoKey) params.set('api_key', 'Demo');
  params.set('url', url);
  return `${API_ENDPOINT}?${params.toString()}`;
}

function fetchTikTokData(url, { includeDemoKey = false, reason = 'manual' } = {}) {
  const normalized = normalizeTikTokUrl(url);
  const apiUrl = buildApiUrl(normalized, includeDemoKey);
  logToTerminal(`Requesting TikTok data (${reason})`, 'info', { apiUrl });
  logger.info('Requesting TikTok data', { apiUrl, reason });
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'fetchTikTokData',
      apiUrl,
      cacheKey: normalized
    }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from background service.'));
        return;
      }
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      resolve({ ...response, apiUrl, normalized });
    });
  });
}

function extractMusicMeta(result, fallbackAuthor) {
  if (!result.music?.playUrl?.length) return null;
  const url = result.music.playUrl[0];
  if (!url) return null;
  return {
    url,
    title: result.music.title || 'tiktok-music',
    author: result.music.author || fallbackAuthor || 'unknown'
  };
}

function handleApiResponse(payload, context = {}) {
  try {
    if (!payload || payload.status !== 'success' || !payload.result) {
      throw new Error('Invalid API response format.');
    }

    const result = payload.result;
    const authorUsername = result.author?.username || 'unknown';
    const contentId = result.id || 'tiktok-content';
    const baseMeta = {
      author: authorUsername,
      id: contentId,
      sourceUrl: context.sourceUrl || state.activeUrl || state.manualUrl
    };

    const musicMeta = extractMusicMeta(result, authorUsername);

    if (result.video?.playAddr?.length) {
      const videoUrl = result.video.playAddr[0];
      mergeState({
        phase: 'ready',
        contentType: 'video',
        meta: { ...baseMeta, type: 'video', videoUrl },
        musicMeta,
        cacheHit: !!context.cacheHit,
        cacheAge: context.cacheAge || 0
      });
      setStatus(`Ready to download video${context.cacheHit ? ' (cached)' : ''}.`, 'success');
      logToTerminal('Video metadata prepared', 'success', { cacheHit: context.cacheHit });
    } else if (result.images?.length) {
      const imageUrls = result.images;
      mergeState({
        phase: 'ready',
        contentType: 'images',
        meta: { ...baseMeta, type: 'images', imageUrls },
        musicMeta,
        cacheHit: !!context.cacheHit,
        cacheAge: context.cacheAge || 0
      });
      setStatus(`Ready to download ${imageUrls.length} photos${context.cacheHit ? ' (cached)' : ''}.`, 'success');
      logToTerminal('Image metadata prepared', 'success', { count: imageUrls.length });
    } else {
      throw new Error('No downloadable video or images found.');
    }
  } catch (error) {
    handleResponseError(error.message, payload);
  }
}

function handleResponseError(message, data) {
  logToTerminal(message, 'error');
  if (data) logger.error('API response error payload', data);
  setStatus(message, 'error');
  mergeState({ phase: 'idle', meta: null, musicMeta: null, cacheHit: false, cacheAge: 0 });
}

function handleDownloadError(type, message) {
  logToTerminal(message, 'error');
  setStatus(message, 'error');
  if (type === 'music') {
    mergeState({ loading: { music: false } });
  } else {
    mergeState({ loading: { primary: false }, phase: 'idle' });
  }
}

function finalizePrimaryAction() {
  mergeState({ loading: { primary: false }, phase: 'ready' });
  queueRender();
}

function logToTerminal(message, type = 'default', meta) {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = document.createElement('div');
  let prefix = '[LOG] ';
  let className = '';

  switch (type) {
    case 'error':
      prefix = '[ERROR] ';
      className = 'error-log';
      logger.error(message, meta);
      break;
    case 'success':
      prefix = '[SUCCESS] ';
      className = 'success-log';
      logger.info(message, meta);
      break;
    case 'warning':
      prefix = '[WARNING] ';
      className = 'warning-log';
      logger.warn(message, meta);
      break;
    case 'info':
      prefix = '[INFO] ';
      className = 'info-log';
      logger.info(message, meta);
      break;
    default:
      logger.debug(message, meta);
  }

  const detail = meta ? ` ${JSON.stringify(meta)}` : '';
  logEntry.textContent = `${timestamp}: ${prefix}${message}${detail}`;
  if (className) logEntry.classList.add(className);
  terminal.appendChild(logEntry);
  terminal.scrollTop = terminal.scrollHeight;
}

function toggleTerminal() {
  mergeState({ terminalVisible: !state.terminalVisible });
}

function clearTerminal() {
  terminal.innerHTML = '';
  logToTerminal('Terminal cleared', 'info');
}

function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  mergeState({ theme: savedTheme });
  logToTerminal(`Theme set to ${savedTheme}`, 'info');
}

function toggleTheme() {
  const newTheme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', newTheme);
  mergeState({ theme: newTheme });
  logToTerminal(`Theme changed to ${newTheme}`, 'info');
}

async function prepareDownloadFromUrl(url, { reason = 'manual', includeDemoKey = false } = {}) {
  const normalized = normalizeTikTokUrl(url);
  mergeState({ loading: { primary: true }, phase: 'fetching', activeUrl: normalized });
  setStatus('Retrieving data...', 'loading');
  try {
    const response = await fetchTikTokData(normalized, { includeDemoKey, reason });
    handleApiResponse(response.data, {
      cacheHit: response.cacheHit,
      cacheAge: response.cacheAge,
      sourceUrl: normalized
    });
    if (response.cacheHit) {
      logToTerminal('Served from cache', 'info', { cacheAge: response.cacheAge });
    }
  } catch (error) {
    handleDownloadError('video', error.message);
  } finally {
    mergeState({ loading: { primary: false } });
  }
}

async function checkCurrentTabStatus() {
  logToTerminal('Evaluating current tab...', 'info');
  clearStatus();
  mergeState({ phase: 'idle', meta: null, musicMeta: null, cacheHit: false, cacheAge: 0 });

  try {
    const tabs = await queryActiveTab();
    const activeUrl = tabs[0]?.url;
    if (!activeUrl || !isValidTikTokUrl(activeUrl)) {
      mergeState({ manualMode: true, activeUrl: null });
      setStatus('Not on a TikTok video. Paste a TikTok link below to begin.', 'info');
      logToTerminal('Manual mode activated - no TikTok tab detected', 'warning');
      return;
    }

    mergeState({ manualMode: false, activeUrl: activeUrl });
    await prepareDownloadFromUrl(activeUrl, { reason: 'auto', includeDemoKey: true });
  } catch (error) {
    handleDownloadError('video', `Error: ${error.message}`);
  }
}

function queryActiveTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs || []));
  });
}

function buildVideoFilename() {
  if (!state.meta) return 'tiktok-video.mp4';
  return `${state.meta.author}-${state.meta.id}.mp4`;
}

function buildImageFilename(index) {
  if (!state.meta) return `tiktok-photo-${index + 1}.jpeg`;
  return `${state.meta.author}-${state.meta.id}-${index + 1}.jpeg`;
}

function buildMusicFilename(musicMeta) {
  return `${musicMeta.author}-${musicMeta.title}.mp3`;
}

function startVideoDownload() {
  if (!state.meta?.videoUrl) {
    handleDownloadError('video', 'No video URL found for download.');
    return;
  }

  mergeState({ loading: { primary: true }, phase: 'downloading' });
  const filename = buildVideoFilename();
  logToTerminal(`Starting video download: ${filename}`, 'info');

  chrome.downloads.download({
    url: state.meta.videoUrl,
    filename,
    saveAs: true
  }, id => {
    if (chrome.runtime.lastError) {
      handleDownloadError('video', `Download error: ${chrome.runtime.lastError.message}`);
      return;
    }
    logToTerminal(`Video download started (ID: ${id})`, 'success');
    setStatus('Video download started!', 'success');
    finalizePrimaryAction();
  });
}

async function startImageDownload() {
  const images = state.meta?.imageUrls || [];
  if (!images.length) {
    handleDownloadError('images', 'No image URLs found for download.');
    return;
  }

  mergeState({ loading: { primary: true }, phase: 'downloading' });
  for (let index = 0; index < images.length; index += 1) {
    const url = images[index];
    const filename = buildImageFilename(index);
    setStatus(`Downloading photo ${index + 1}/${images.length}...`, 'loading');
    logToTerminal(`Downloading image ${index + 1}: ${filename}`, 'info');    await new Promise(resolve => {
      chrome.downloads.download({ url, filename, saveAs: false }, id => {
        if (chrome.runtime.lastError) {
          logToTerminal(`Error downloading image ${index + 1}: ${chrome.runtime.lastError.message}`, 'error');
        } else {
          logToTerminal(`Image download started (ID: ${id})`, 'success');
        }
        resolve();
      });
    });
  }
  setStatus('All photo downloads started!', 'success');
  finalizePrimaryAction();
}

function ensureMusicMetaAvailable() {
  if (state.musicMeta?.url) return state.musicMeta;
  return null;
}

function startMusicDownload(musicMeta) {
  mergeState({ loading: { music: true } });
  const filename = buildMusicFilename(musicMeta);
  logToTerminal(`Starting music download: ${filename}`, 'info');
  chrome.downloads.download({
    url: musicMeta.url,
    filename,
    saveAs: true
  }, id => {
    if (chrome.runtime.lastError) {
      handleDownloadError('music', chrome.runtime.lastError.message);
      return;
    }
    logToTerminal(`Music download started (ID: ${id})`, 'success');
    setStatus('Music download started!', 'success');
    mergeState({ loading: { music: false } });
  });
}

async function handleManualFetch() {
  if (!isValidTikTokUrl(state.manualUrl)) {
    setStatus('Enter a valid TikTok link.', 'warning');
    return;
  }
  await prepareDownloadFromUrl(state.manualUrl, { reason: 'manual' });
}

downloadBtn.addEventListener('click', async () => {
  clearStatus();
  if (state.phase === 'ready') {
    if (state.contentType === 'video') {
      startVideoDownload();
    } else if (state.contentType === 'images') {
      await startImageDownload();
    }
    return;
  }

  const targetUrl = state.manualMode ? state.manualUrl : state.activeUrl;
  if (!isValidTikTokUrl(targetUrl)) {
    handleDownloadError('video', 'No valid TikTok URL detected.');
    return;
  }
  await prepareDownloadFromUrl(targetUrl, { reason: state.manualMode ? 'manual' : 'button' });
});

downloadMusicBtn.addEventListener('click', async () => {
  clearStatus();
  const meta = ensureMusicMetaAvailable();
  if (meta) {
    startMusicDownload(meta);
    return;
  }

  const targetUrl = state.manualMode ? state.manualUrl : state.activeUrl;
  if (!isValidTikTokUrl(targetUrl)) {
    handleDownloadError('music', 'No valid TikTok URL detected.');
    return;
  }

  mergeState({ loading: { music: true } });
  setStatus('Retrieving music data...', 'loading');
  try {
    const response = await fetchTikTokData(targetUrl, { includeDemoKey: true, reason: 'music' });
    const result = response.data?.result?.music;
    if (!result?.playUrl?.length) {
      throw new Error('No music found.');
    }
    const musicMeta = {
      url: result.playUrl[0],
      title: result.title || 'tiktok-music',
      author: result.author || state.meta?.author || 'unknown'
    };
    mergeState({ musicMeta });
    startMusicDownload(musicMeta);
  } catch (error) {
    handleDownloadError('music', error.message);
  }
});

clearTerminalBtn.addEventListener('click', clearTerminal);
toggleTerminalBtn.addEventListener('click', toggleTerminal);
if (manualFetchBtn) {
  manualFetchBtn.addEventListener('click', handleManualFetch);
}
if (manualUrlInput) {
  manualUrlInput.addEventListener('input', event => {
    mergeState({ manualUrl: event.target.value.trim() });
  });
  manualUrlInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleManualFetch();
    }
  });
}
themeToggleBtn.addEventListener('click', toggleTheme);

chrome.runtime.onMessage.addListener(message => {
  if (message?.action === 'content.videoDetected' && message.url) {
    const normalized = normalizeTikTokUrl(message.url);
    logToTerminal('Content script detected TikTok video', 'info', { url: normalized });
    mergeState({ manualMode: false, activeUrl: normalized });
  }
});

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  logToTerminal('Extension popup loaded', 'info');
  checkCurrentTabStatus();
  render();
});


