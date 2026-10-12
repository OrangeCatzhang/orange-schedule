const { performance } = require('node:perf_hooks');

const UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/OrangeCatzhang/orange-schedule/main/docs/updates/latest.json';
const RELEASES_API = 'https://api.github.com/repos/OrangeCatzhang/orange-schedule/releases/latest';
const REPOSITORY_URL = 'https://github.com/OrangeCatzhang/orange-schedule';
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_NOTES_LENGTH = 10000;

function updateError(code, message) {
  const error = new Error(message);
  error.name = 'UpdateCheckError';
  error.code = code;
  return error;
}

// Only stable, unprefixed X.Y.Z versions are accepted here; release tags add one v.
function parseVersion(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) throw updateError('INVALID_VERSION', '版本号格式不正确，无法比较更新。');
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function validateCurrentVersion(version) {
  if (!parseVersion(version)) throw updateError('INVALID_CURRENT_VERSION', '当前应用版本号格式不正确，无法检查更新。');
}

function parseRelease(release, currentVersion) {
  validateCurrentVersion(currentVersion);
  if (!release || typeof release !== 'object' || Array.isArray(release)) {
    throw updateError('INVALID_RELEASE', '更新信息格式不正确，请稍后重试，或打开官方下载页手动下载。');
  }
  if (release.draft !== false || release.prerelease !== false) {
    throw updateError('INVALID_RELEASE', '更新信息不是已发布的稳定版本，请稍后重试。');
  }
  const tag = release.tag_name;
  const version = typeof tag === 'string' && tag.startsWith('v') ? tag.slice(1) : '';
  if (!parseVersion(version)) {
    throw updateError('INVALID_RELEASE', '更新版本号格式不正确，无法确认可用更新。');
  }
  const filename = 'OrangeSchedule-Setup-' + version + '.exe';
  const url = REPOSITORY_URL + '/releases/download/' + tag + '/' + filename;
  const installer = Array.isArray(release.assets) ? release.assets.find(asset => asset && asset.name === filename) : null;
  if (!installer || installer.state !== 'uploaded' || !Number.isSafeInteger(installer.size) || installer.size <= 0) {
    throw updateError('MISSING_INSTALLER', '该版本的 Windows 安装包尚未准备好，请稍后重试。');
  }
  // Exact matching also excludes credentials, alternate hosts, query strings and protocols.
  if (installer.browser_download_url !== url) {
    throw updateError('INVALID_DOWNLOAD_URL', '更新安装包地址与官方发布地址不一致，已停止提供下载。');
  }
  if (compareVersions(version, currentVersion) <= 0) return null;
  const date = typeof release.published_at === 'string' ? Date.parse(release.published_at) : NaN;
  return {
    version,
    url,
    releaseUrl: REPOSITORY_URL + '/releases/tag/' + tag,
    notes: typeof release.body === 'string' ? release.body.trim().slice(0, MAX_NOTES_LENGTH) : '',
    publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null
  };
}

function httpError(response) {
  const status = response.status;
  const getHeader = name => typeof response.headers?.get === 'function' ? response.headers.get(name) : null;
  const manualDownload = '请稍后重试，或打开官方下载页手动下载。';
  if (status === 404) return updateError('NO_RELEASE', '暂未找到可用的公开版本（404），' + manualDownload);
  if (status === 429 || (status === 403 && (getHeader('x-ratelimit-remaining') === '0' || getHeader('retry-after') != null))) {
    return updateError('RATE_LIMITED', '更新服务暂时限制了当前网络的请求，' + manualDownload);
  }
  if (status === 403) return updateError('ACCESS_DENIED', '更新服务暂时拒绝访问（403），' + manualDownload);
  return updateError('HTTP_ERROR', '更新服务暂时不可用（HTTP ' + status + '），' + manualDownload);
}

function timeoutError() {
  return updateError('TIMEOUT', '检查更新超时，请检查网络后重试，或打开官方下载页手动下载。');
}

async function readRelease({ url, currentVersion, fetchImpl, timeoutMs, api = false }) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(timeoutError());
      controller.abort();
    }, timeoutMs);
  });
  const request = (async () => {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: api ? 'application/vnd.github+json' : 'application/json',
          ...(api ? { 'X-GitHub-Api-Version': '2026-03-10' } : {}),
          'User-Agent': 'OrangeSchedule/' + currentVersion
        },
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store'
      });
    } catch {
      throw updateError('NETWORK_ERROR', '无法连接更新服务，请检查网络后重试，或打开官方下载页手动下载。');
    }
    // A fetch implementation may finish after ignoring cancellation; do not read its body then.
    if (controller.signal.aborted) throw timeoutError();
    if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      throw updateError('INVALID_RESPONSE', '更新服务返回的响应格式不正确，请稍后重试，或打开官方下载页手动下载。');
    }
    if (response.status !== 200) throw httpError(response);
    if (typeof response.json !== 'function') {
      throw updateError('INVALID_RESPONSE', '更新服务返回的响应格式不正确，请稍后重试，或打开官方下载页手动下载。');
    }
    let release;
    try {
      release = await response.json();
    } catch (error) {
      if (error instanceof SyntaxError) throw updateError('INVALID_RESPONSE', '更新信息无法解析，请稍后重试，或打开官方下载页手动下载。');
      throw updateError('NETWORK_ERROR', '读取更新信息失败，请检查网络后重试，或打开官方下载页手动下载。');
    }
    if (controller.signal.aborted) throw timeoutError();
    return parseRelease(release, currentVersion);
  })();
  try {
    // Bound both headers and body, including implementations that ignore the abort signal.
    return await Promise.race([request, deadline]);
  } catch (error) {
    // Stop unread error bodies before starting the fallback request.
    controller.abort();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function checkForUpdate({ currentVersion, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  validateCurrentVersion(currentVersion);
  if (typeof fetchImpl !== 'function') throw updateError('UNSUPPORTED', '当前环境无法联网检查更新。');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw updateError('INVALID_TIMEOUT', '更新检查的超时设置必须在 1 至 60000 毫秒之间。');
  }
  const deadlineAt = performance.now() + timeoutMs;
  try {
    // Reading the public file avoids GitHub's anonymous REST API quota on normal checks.
    return await readRelease({
      url: UPDATE_MANIFEST_URL, currentVersion, fetchImpl,
      timeoutMs: Math.max(1, Math.floor(timeoutMs / 2))
    });
  } catch (error) {
    // Invalid successful payloads must fail closed rather than conceal a bad manifest.
    const retryable = ['NETWORK_ERROR', 'TIMEOUT', 'NO_RELEASE', 'RATE_LIMITED', 'ACCESS_DENIED', 'HTTP_ERROR'];
    if (!retryable.includes(error.code)) throw error;
    const remainingMs = Math.floor(deadlineAt - performance.now());
    if (remainingMs < 1) throw timeoutError();
    return readRelease({ url: RELEASES_API, currentVersion, fetchImpl, timeoutMs: remainingMs, api: true });
  }
}

module.exports = { UPDATE_MANIFEST_URL, RELEASES_API, REPOSITORY_URL, DEFAULT_TIMEOUT_MS, parseVersion, compareVersions, parseRelease, checkForUpdate };
