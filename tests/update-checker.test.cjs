const test = require('node:test');
const assert = require('node:assert/strict');
const { UPDATE_MANIFEST_URL, RELEASES_API, REPOSITORY_URL, DEFAULT_TIMEOUT_MS, parseVersion, compareVersions, parseRelease, checkForUpdate } = require('../src/update-checker.cjs');

function release(version = '1.1.10', overrides = {}) {
  const filename = 'OrangeSchedule-Setup-' + version + '.exe';
  return {
    tag_name: 'v' + version,
    draft: false,
    prerelease: false,
    html_url: REPOSITORY_URL + '/releases/tag/v' + version,
    body: '改进日历与提醒。',
    published_at: '2026-10-12T08:00:00Z',
    assets: [{ name: filename, state: 'uploaded', size: 123456, browser_download_url: REPOSITORY_URL + '/releases/download/v' + version + '/' + filename }],
    ...overrides
  };
}
const response = (data = release(), status = 200, headers = {}) => ({ status, headers: new Headers(headers), json: async () => data });
const hasCode = code => error => error.name === 'UpdateCheckError' && error.code === code && /[\u3400-\u9fff]/.test(error.message);
const check = (fetchImpl, options = {}) => checkForUpdate({ currentVersion: '1.1.9', fetchImpl, ...options });

test('stable versions use numeric components without implicit coercion', () => {
  assert.deepEqual(parseVersion('0.0.0'), [0, 0, 0]);
  assert.deepEqual(parseVersion('12.34.567'), [12, 34, 567]);
  for (const value of [null, undefined, 123, {}, ['1.2.3'], '', 'v1.2.3', '1.2', '1.2.3.4', '01.2.3', '1.02.3', '1.2.03', '-1.2.3', '1.2.3-beta.1', '1.2.3+build', ' 1.2.3', '1.2.3\n', '１.２.３', '9007199254740992.0.0']) {
    assert.equal(parseVersion(value), null, String(value));
  }
});

test('numeric comparison handles double digits, major and minor changes', () => {
  assert.equal(compareVersions('1.1.10', '1.1.9'), 1);
  assert.equal(compareVersions('1.10.0', '1.9.99'), 1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('1.1.9', '1.1.10'), -1);
  assert.equal(compareVersions('1.1.10', '1.1.10'), 0);
  assert.throws(() => compareVersions('1.2.3-beta', '1.2.3'), hasCode('INVALID_VERSION'));
});

test('a newer stable release returns only validated installation metadata', () => {
  const result = parseRelease(release(), '1.1.9');
  assert.deepEqual(result, {
    version: '1.1.10',
    url: REPOSITORY_URL + '/releases/download/v1.1.10/OrangeSchedule-Setup-1.1.10.exe',
    releaseUrl: REPOSITORY_URL + '/releases/tag/v1.1.10',
    notes: '改进日历与提醒。',
    publishedAt: '2026-10-12T08:00:00.000Z'
  });
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('matching and older valid releases do not offer downgrades', () => {
  assert.equal(parseRelease(release('1.1.9'), '1.1.9'), null);
  assert.equal(parseRelease(release('1.1.8'), '1.1.9'), null);
});

test('drafts, prereleases and missing or non-boolean stability flags are rejected', () => {
  for (const flags of [{ draft: true }, { prerelease: true }, { draft: undefined }, { prerelease: undefined }, { draft: 0 }, { prerelease: 'false' }]) {
    assert.throws(() => parseRelease(release('1.1.10', flags), '1.1.9'), hasCode('INVALID_RELEASE'));
  }
});

test('only exact vX.Y.Z release tags are eligible', () => {
  for (const tag of [null, 123, '1.1.10', 'V1.1.10', 'vv1.1.10', 'v1.1.10-beta', 'v1.1.10+meta', 'v01.1.10', 'v1.1.10/', 'v1.1.10\n', 'v9007199254740992.0.0']) {
    assert.throws(() => parseRelease(release('1.1.10', { tag_name: tag }), '1.1.9'), hasCode('INVALID_RELEASE'));
  }
});

test('an exact, uploaded and non-empty Windows installer is required', () => {
  for (const assets of [undefined, {}, [], [{ name: 'source.zip', state: 'uploaded', size: 12 }]]) {
    assert.throws(() => parseRelease(release('1.1.10', { assets }), '1.1.9'), hasCode('MISSING_INSTALLER'));
  }
  for (const patch of [{ name: 'OrangeSchedule-Setup-1.1.9.exe' }, { name: 'OrangeSchedule-Setup-1.1.10.exe.zip' }, { state: 'new' }, { state: undefined }, { size: 0 }, { size: -1 }, { size: 0.5 }, { size: '123' }, { size: NaN }, { size: Infinity }, { size: Number.MAX_SAFE_INTEGER + 1 }]) {
    const fixture = release();
    Object.assign(fixture.assets[0], patch);
    assert.throws(() => parseRelease(fixture, '1.1.9'), hasCode('MISSING_INSTALLER'));
  }
});

test('download links cannot change the host, repository, tag, file or protocol', () => {
  const official = release().assets[0].browser_download_url;
  const unsafe = [
    undefined, null, {}, 'javascript:alert(1)', 'file:///C:/installer.exe', '//github.com/file.exe',
    official.replace('https:', 'http:'),
    official.replace('github.com', 'github.com.evil.example'),
    official.replace('github.com', 'github.com@evil.example'),
    official.replace('github.com', 'evil.example@github.com'),
    official.replace('github.com', 'github.com:443'),
    official.replace('OrangeCatzhang', 'another-owner'),
    official.replace('orange-schedule', 'another-repo'),
    official.replace('/v1.1.10/', '/v1.1.9/'),
    official.replace('Setup-1.1.10.exe', 'Setup-1.1.9.exe'),
    official.replace('/releases/', '/releases/../releases/'),
    official.replace('OrangeSchedule', '%4FrangeSchedule'),
    official + '?download=1', official + '#fragment', official + '\n', ' ' + official,
    official.replaceAll('/', '\\')
  ];
  for (const url of unsafe) {
    const fixture = release();
    fixture.assets[0].browser_download_url = url;
    assert.throws(() => parseRelease(fixture, '1.1.9'), hasCode('INVALID_DOWNLOAD_URL'), String(url));
  }
});

test('release links are constructed locally and optional display values remain plain data', () => {
  const result = parseRelease(release('1.1.10', { html_url: 'javascript:alert(1)', body: null, published_at: 'not a date' }), '1.1.9');
  assert.equal(result.releaseUrl, REPOSITORY_URL + '/releases/tag/v1.1.10');
  assert.equal(result.notes, '');
  assert.equal(result.publishedAt, null);
  const long = parseRelease(release('1.1.10', { body: ' ' + 'a'.repeat(11000) + ' ' }), '1.1.9');
  assert.equal(long.notes.length, 10000);
});

test('invalid response data and current versions fail explicitly', () => {
  for (const data of [null, undefined, [], 'release']) assert.throws(() => parseRelease(data, '1.1.9'), hasCode('INVALID_RELEASE'));
  assert.throws(() => parseRelease(release(), '1.1.9-beta'), hasCode('INVALID_CURRENT_VERSION'));
});

test('normal checks read only the public manifest with cancellation and no credentials', async () => {
  const calls = [];
  const result = await check(async (url, options) => { calls.push({ url, options }); return response(); });
  assert.equal(result.version, '1.1.10');
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url, UPDATE_MANIFEST_URL);
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.Accept, 'application/json');
  assert.equal(options.headers['X-GitHub-Api-Version'], undefined);
  assert.equal(options.headers['User-Agent'], 'OrangeSchedule/1.1.9');
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.cache, 'no-store');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.signal.aborted, false);
  assert.equal(DEFAULT_TIMEOUT_MS, 12000);
});

test('a successful check for the installed release returns null', async () => {
  assert.equal(await check(async () => response(release('1.1.9'))), null);
});

test('404, forbidden, rate limiting and service errors remain distinguishable', async () => {
  for (const [status, headers, code] of [[404, {}, 'NO_RELEASE'], [403, {}, 'ACCESS_DENIED'], [403, { 'x-ratelimit-remaining': '0' }, 'RATE_LIMITED'], [403, { 'retry-after': '60' }, 'RATE_LIMITED'], [429, {}, 'RATE_LIMITED'], [500, {}, 'HTTP_ERROR']]) {
    let parsed = false;
    await assert.rejects(check(async () => ({ ...response(null, status, headers), json: async () => { parsed = true; throw new Error('Do not parse an HTTP error body'); } })), hasCode(code));
    assert.equal(parsed, false);
  }
});

test('offline and synchronous network failures use a friendly network error', async () => {
  for (const fetchImpl of [async () => { throw new TypeError('fetch failed'); }, () => { throw new Error('secret proxy details'); }]) {
    await assert.rejects(check(fetchImpl), error => hasCode('NETWORK_ERROR')(error) && !error.message.includes('secret') && !error.message.includes('fetch failed'));
  }
});

test('invalid responses and invalid JSON are not reported as up to date', async () => {
  for (const result of [null, {}, { status: '200' }, { status: 999 }, { status: 200 }]) await assert.rejects(check(async () => result), hasCode('INVALID_RESPONSE'));
  await assert.rejects(check(async () => ({ status: 200, json: async () => { throw new SyntaxError('Invalid JSON'); } })), hasCode('INVALID_RESPONSE'));
  await assert.rejects(check(async () => response({})), hasCode('INVALID_RELEASE'));
  await assert.rejects(check(async () => ({ status: 200, json: async () => { throw new TypeError('body disconnected'); } })), hasCode('NETWORK_ERROR'));
});

test('timeout aborts a pending request even when the fetch mock ignores the signal', { timeout: 1000 }, async () => {
  let signal;
  await assert.rejects(check((url, options) => { signal = options.signal; return new Promise(() => {}); }, { timeoutMs: 10 }), hasCode('TIMEOUT'));
  assert.equal(signal.aborted, true);
});

test('timeout also covers a response body that never finishes', { timeout: 1000 }, async () => {
  let signal;
  await assert.rejects(check(async (url, options) => { signal = options.signal; return { status: 200, json: () => new Promise(() => {}) }; }, { timeoutMs: 10 }), hasCode('TIMEOUT'));
  assert.equal(signal.aborted, true);
});

test('completed requests clear their timer instead of aborting later', async () => {
  let signal;
  await check(async (url, options) => { signal = options.signal; return response(); }, { timeoutMs: 10 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(signal.aborted, false);
});

test('invalid options are rejected before any network access', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response(); };
  await assert.rejects(check(fetchImpl, { currentVersion: 'v1.1.9' }), hasCode('INVALID_CURRENT_VERSION'));
  for (const timeoutMs of [0, -1, 1.5, '12', Infinity, 60001]) await assert.rejects(check(fetchImpl, { timeoutMs }), hasCode('INVALID_TIMEOUT'));
  await assert.rejects(checkForUpdate({ currentVersion: '1.1.9' }), hasCode('UNSUPPORTED'));
  assert.equal(calls, 0);
});


test('the public manifest succeeds even when the shared anonymous API quota is exhausted', async () => {
  const calls = [];
  const result = await check(async url => {
    calls.push(url);
    if (url === RELEASES_API) return response(null, 403, { 'x-ratelimit-remaining': '0' });
    return response();
  });
  assert.equal(result.version, '1.1.10');
  assert.deepEqual(calls, [UPDATE_MANIFEST_URL]);
});

test('unavailable public files get one fixed API fallback and abort their unread bodies', async () => {
  for (const status of [301, 403, 404, 429, 500, 503]) {
    const calls = [];
    let manifestSignal;
    const result = await check(async (url, options) => {
      calls.push(url);
      if (url === UPDATE_MANIFEST_URL) {
        manifestSignal = options.signal;
        return response(null, status);
      }
      assert.equal(manifestSignal.aborted, true);
      assert.equal(url, RELEASES_API);
      assert.equal(options.headers.Accept, 'application/vnd.github+json');
      assert.equal(options.headers['X-GitHub-Api-Version'], '2026-03-10');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      assert.notEqual(options.signal, manifestSignal);
      return response();
    });
    assert.equal(result.version, '1.1.10');
    assert.deepEqual(calls, [UPDATE_MANIFEST_URL, RELEASES_API]);
  }
});

test('an offline manifest or interrupted body can use the API fallback', async () => {
  for (const failure of [
    () => { throw new TypeError('DNS failed'); },
    () => ({ status: 200, json: async () => { throw new TypeError('body disconnected'); } })
  ]) {
    const calls = [];
    assert.equal((await check(async url => {
      calls.push(url);
      return url === UPDATE_MANIFEST_URL ? failure() : response();
    })).version, '1.1.10');
    assert.deepEqual(calls, [UPDATE_MANIFEST_URL, RELEASES_API]);
  }
});

test('a 200 manifest with invalid JSON, metadata or download URLs fails closed without API fallback', async () => {
  const badUrl = release();
  badUrl.assets[0].browser_download_url = 'https://evil.example/setup.exe';
  for (const [fixture, code] of [
    [{ status: 200, json: async () => { throw new SyntaxError('bad JSON'); } }, 'INVALID_RESPONSE'],
    [{ status: 200 }, 'INVALID_RESPONSE'],
    [response({}), 'INVALID_RELEASE'],
    [response(release('1.1.10', { draft: true })), 'INVALID_RELEASE'],
    [response(release('1.1.10', { assets: [] })), 'MISSING_INSTALLER'],
    [response(badUrl), 'INVALID_DOWNLOAD_URL']
  ]) {
    const calls = [];
    await assert.rejects(check(async url => {
      calls.push(url);
      return url === UPDATE_MANIFEST_URL ? fixture : response();
    }), hasCode(code));
    assert.deepEqual(calls, [UPDATE_MANIFEST_URL]);
  }
});

test('a valid current manifest does not use the API to search for another version', async () => {
  const calls = [];
  assert.equal(await check(async url => {
    calls.push(url);
    return response(release('1.1.9'));
  }), null);
  assert.deepEqual(calls, [UPDATE_MANIFEST_URL]);
});

test('a slow manifest is aborted before the API fallback starts', { timeout: 1000 }, async () => {
  for (const pendingBody of [false, true]) {
    const calls = [];
    let manifestSignal;
    const result = await check(async (url, options) => {
      calls.push(url);
      if (url === UPDATE_MANIFEST_URL) {
        manifestSignal = options.signal;
        return pendingBody ? { status: 200, json: () => new Promise(() => {}) } : new Promise(() => {});
      }
      assert.equal(manifestSignal.aborted, true);
      assert.equal(options.signal.aborted, false);
      return response();
    }, { timeoutMs: 100 });
    assert.equal(result.version, '1.1.10');
    assert.deepEqual(calls, [UPDATE_MANIFEST_URL, RELEASES_API]);
  }
});

test('two stalled sources share one total timeout budget and both requests are aborted', async t => {
  const calls = [];
  const signals = [];
  const timers = [];
  let monotonicTime = 1000;
  t.mock.method(require('node:perf_hooks').performance, 'now', () => monotonicTime);
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', timer => { timer.cleared = true; });
  const rejected = assert.rejects(check(async (url, options) => {
    calls.push(url);
    signals.push(options.signal);
    return { status: 200, json: () => new Promise(() => {}) };
  }, { timeoutMs: 160 }), hasCode('TIMEOUT'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 80);
  monotonicTime += 80;
  timers[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delay, 80, 'fallback only receives the remaining total budget');
  monotonicTime += 80;
  timers[1].callback();
  await rejected;
  assert.deepEqual(calls, [UPDATE_MANIFEST_URL, RELEASES_API]);
  assert.ok(signals.every(signal => signal.aborted));
  assert.ok(timers.every(timer => timer.cleared));
});

test('API fallback errors stop after two requests and explain the manual download path', async () => {
  const calls = [];
  await assert.rejects(check(async url => {
    calls.push(url);
    return url === UPDATE_MANIFEST_URL ? response(null, 503) : response(null, 403, { 'x-ratelimit-remaining': '0' });
  }), error => hasCode('RATE_LIMITED')(error) && error.message.includes('官方下载页') && !error.message.includes('次数已达'));
  assert.deepEqual(calls, [UPDATE_MANIFEST_URL, RELEASES_API]);
});

test('a late timed-out response never reads its body or replaces the fallback result', { timeout: 1000 }, async () => {
  let completeManifest;
  let readLateBody = false;
  const result = await check(async url => {
    if (url === UPDATE_MANIFEST_URL) return new Promise(resolve => { completeManifest = resolve; });
    return response();
  }, { timeoutMs: 100 });
  completeManifest({ status: 200, json: async () => { readLateBody = true; return release('99.0.0'); } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.version, '1.1.10');
  assert.equal(readLateBody, false);
});
