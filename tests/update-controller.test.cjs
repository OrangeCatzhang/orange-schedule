const test = require('node:test');
const assert = require('node:assert/strict');
const { AUTO_CHECK_INTERVAL_MS, createUpdateController } = require('../src/update-controller.cjs');
const { REPOSITORY_URL } = require('../src/update-checker.cjs');

function release(version = '1.1.10') {
  const name = 'OrangeSchedule-Setup-' + version + '.exe';
  return {
    tag_name: 'v' + version,
    draft: false,
    prerelease: false,
    body: '改进日历与提醒。',
    published_at: '2026-10-12T08:00:00Z',
    assets: [{
      name,
      state: 'uploaded',
      size: 123456,
      browser_download_url: REPOSITORY_URL + '/releases/download/v' + version + '/' + name
    }]
  };
}
const response = (version = '1.1.10') => ({ status: 200, json: async () => release(version) });
const create = options => createUpdateController({
  currentVersion: '1.1.9',
  fetchImpl: async () => response(),
  ...options
});
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('initial state is serializable and snapshot mutations cannot alter the controller', () => {
  const controller = create({ now: () => 0 });
  assert.deepEqual(controller.snapshot(), {
    phase: 'idle', currentVersion: '1.1.9', release: null,
    checkedAt: null, error: '', dismissed: false
  });
  const first = controller.snapshot();
  first.phase = 'error';
  first.currentVersion = '9.9.9';
  first.release = { version: '9.9.9' };
  assert.equal(controller.snapshot().phase, 'idle');
  assert.equal(controller.snapshot().currentVersion, '1.1.9');
  assert.equal(controller.snapshot().release, null);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.snapshot())), controller.snapshot());
});

test('a check publishes checking immediately and an available release at completion time', async () => {
  let clock = 10;
  const gate = deferred();
  const events = [];
  const controller = create({ fetchImpl: () => gate.promise, now: () => clock, onChange: state => events.push(state) });
  const pending = controller.check();
  assert.equal(controller.snapshot().phase, 'checking');
  assert.equal(controller.snapshot().checkedAt, null);
  assert.deepEqual(events.map(state => state.phase), ['checking']);
  clock = 25;
  gate.resolve(response());
  const result = await pending;
  assert.equal(result.phase, 'available');
  assert.equal(result.release.version, '1.1.10');
  assert.equal(result.checkedAt, 25);
  assert.equal(result.error, '');
  assert.equal(result.dismissed, false);
  assert.deepEqual(events.map(state => state.phase), ['checking', 'available']);
});

test('matching and older stable versions yield current with no download', async () => {
  for (const version of ['1.1.9', '1.1.8']) {
    const controller = create({ fetchImpl: async () => response(version), now: () => 100 });
    assert.deepEqual(await controller.check(), {
      phase: 'current', currentVersion: '1.1.9', release: null,
      checkedAt: 100, error: '', dismissed: false
    });
  }
});

test('simultaneous automatic and manual checks share one promise and network request', async () => {
  let calls = 0;
  const gate = deferred();
  const controller = create({ fetchImpl: () => { calls++; return gate.promise; } });
  const first = controller.check({ manual: false });
  const second = controller.check();
  const third = controller.check({ manual: false });
  assert.strictEqual(first, second);
  assert.strictEqual(first, third);
  await Promise.resolve();
  assert.equal(calls, 1);
  gate.resolve(response());
  await first;
  assert.equal(calls, 1);
});

test('automatic checks wait six hours from the previous attempt, including a zero timestamp', async () => {
  assert.equal(AUTO_CHECK_INTERVAL_MS, 21600000);
  let clock = 0;
  let calls = 0;
  const events = [];
  const controller = create({
    now: () => clock,
    fetchImpl: async () => { calls++; return response(); },
    onChange: state => events.push(state.phase)
  });
  await controller.check({ manual: false });
  clock = AUTO_CHECK_INTERVAL_MS - 1;
  const cached = await controller.check({ manual: false });
  assert.equal(calls, 1);
  assert.equal(cached.checkedAt, 0);
  assert.deepEqual(events, ['checking', 'available']);
  clock = AUTO_CHECK_INTERVAL_MS;
  await controller.check({ manual: false });
  assert.equal(calls, 2);
  assert.equal(controller.snapshot().checkedAt, AUTO_CHECK_INTERVAL_MS);
});

test('the cooldown starts at attempt time, not the later completion time', async () => {
  let clock = 0;
  let calls = 0;
  const gate = deferred();
  const controller = create({
    now: () => clock,
    fetchImpl: () => { calls++; return calls === 1 ? gate.promise : Promise.resolve(response()); }
  });
  const first = controller.check({ manual: false });
  await Promise.resolve();
  clock = 1000;
  gate.resolve(response());
  await first;
  clock = AUTO_CHECK_INTERVAL_MS;
  await controller.check({ manual: false });
  assert.equal(calls, 2);
});

test('manual checks bypass cooldown and their attempts also delay automatic retries', async () => {
  let clock = 0;
  let calls = 0;
  const controller = create({
    now: () => clock,
    fetchImpl: async () => { calls++; return response(); }
  });
  await controller.check({ manual: false });
  clock = 10;
  await controller.check();
  assert.equal(calls, 2);
  clock = AUTO_CHECK_INTERVAL_MS;
  await controller.check({ manual: false });
  assert.equal(calls, 2);
  clock += 10;
  await controller.check({ manual: false });
  assert.equal(calls, 3);
});

test('network failure returns a Chinese error state and automatic failures are throttled', async () => {
  let clock = 40;
  let calls = 0;
  const controller = create({
    now: () => clock,
    fetchImpl: async () => { calls++; throw new Error('offline'); }
  });
  const failed = await controller.check({ manual: false });
  assert.equal(failed.phase, 'error');
  assert.match(failed.error, /无法连接更新服务/);
  assert.equal(failed.checkedAt, 40);
  assert.equal(failed.release, null);
  clock = 50;
  assert.deepEqual(await controller.check({ manual: false }), failed);
  assert.equal(calls, 2);
  await controller.check();
  assert.equal(calls, 4);
  assert.equal(controller.snapshot().checkedAt, 50);
});

test('retry clears an earlier error while checking and can succeed immediately when manual', async () => {
  let calls = 0;
  let clock = 10;
  const gate = deferred();
  const controller = create({
    now: () => clock,
    fetchImpl: () => {
      calls++;
      return calls <= 2 ? Promise.reject(new Error('offline')) : gate.promise;
    }
  });
  await controller.check();
  clock = 20;
  const retry = controller.check();
  assert.equal(controller.snapshot().phase, 'checking');
  assert.equal(controller.snapshot().error, '');
  assert.equal(controller.snapshot().checkedAt, 10);
  gate.resolve(response());
  const result = await retry;
  assert.equal(result.phase, 'available');
  assert.equal(result.error, '');
  assert.equal(result.checkedAt, 20);
  assert.equal(calls, 3);
});

test('dismiss has no effect before a release is found and preserves available download metadata', async () => {
  const events = [];
  const controller = create({ onChange: state => events.push(state.phase) });
  assert.equal(controller.dismiss().dismissed, false);
  assert.deepEqual(events, []);
  const available = await controller.check();
  const dismissed = controller.dismiss();
  assert.equal(dismissed.phase, 'available');
  assert.equal(dismissed.dismissed, true);
  assert.deepEqual(dismissed.release, available.release);
  assert.equal(dismissed.checkedAt, available.checkedAt);
  assert.deepEqual(events, ['checking', 'available', 'available']);
  controller.dismiss();
  assert.equal(events.length, 3);
});

test('automatic checks preserve dismissal for the same version and reset it for a new version', async () => {
  let clock = 0;
  let version = '1.1.10';
  const controller = create({ now: () => clock, fetchImpl: async () => response(version) });
  await controller.check({ manual: false });
  controller.dismiss();
  clock += AUTO_CHECK_INTERVAL_MS;
  assert.equal((await controller.check({ manual: false })).dismissed, true);
  version = '1.1.11';
  clock += AUTO_CHECK_INTERVAL_MS;
  const next = await controller.check({ manual: false });
  assert.equal(next.release.version, '1.1.11');
  assert.equal(next.dismissed, false);
});

test('a successful manual check restores a dismissed prompt even for the same version', async () => {
  const controller = create();
  await controller.check();
  controller.dismiss();
  const refreshed = await controller.check();
  assert.equal(refreshed.release.version, '1.1.10');
  assert.equal(refreshed.dismissed, false);
});

test('a manual caller joining an automatic request restores the prompt without another request', async () => {
  let clock = 0;
  let calls = 0;
  const gate = deferred();
  const controller = create({
    now: () => clock,
    fetchImpl: () => { calls++; return calls === 1 ? Promise.resolve(response()) : gate.promise; }
  });
  await controller.check({ manual: false });
  controller.dismiss();
  clock += AUTO_CHECK_INTERVAL_MS;
  const automatic = controller.check({ manual: false });
  const manual = controller.check();
  assert.strictEqual(automatic, manual);
  gate.resolve(response());
  const result = await manual;
  assert.equal(result.dismissed, false);
  assert.equal(calls, 2);
});

test('dismissing during an automatic check remains dismissed when the same version arrives', async () => {
  let clock = 0;
  let calls = 0;
  const gate = deferred();
  const controller = create({
    now: () => clock,
    fetchImpl: () => { calls++; return calls === 1 ? Promise.resolve(response()) : gate.promise; }
  });
  await controller.check();
  clock += AUTO_CHECK_INTERVAL_MS;
  const pending = controller.check({ manual: false });
  controller.dismiss();
  gate.resolve(response());
  assert.equal((await pending).dismissed, true);
});

test('failed refresh keeps the last validated release and its dismissal state', async () => {
  let clock = 0;
  let calls = 0;
  const controller = create({
    now: () => clock,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return response();
      throw new Error('offline');
    }
  });
  const available = await controller.check();
  controller.dismiss();
  clock = 100;
  const failed = await controller.check();
  assert.equal(failed.phase, 'error');
  assert.equal(failed.checkedAt, 100);
  assert.equal(failed.dismissed, true);
  assert.match(failed.error, /无法连接更新服务/);
  assert.deepEqual(failed.release, available.release);
});

test('invalid incoming release metadata never overwrites a previously validated download', async () => {
  let calls = 0;
  const controller = create({
    fetchImpl: async () => {
      if (++calls === 1) return response();
      const unsafe = release('1.1.11');
      unsafe.assets[0].browser_download_url = 'https://example.com/malicious.exe';
      return { status: 200, json: async () => unsafe };
    }
  });
  const first = await controller.check();
  const failed = await controller.check();
  assert.equal(failed.phase, 'error');
  assert.match(failed.error, /官方发布地址不一致/);
  assert.deepEqual(failed.release, first.release);
});

test('a valid current result clears stale availability and dismissal', async () => {
  let version = '1.1.10';
  const controller = create({ fetchImpl: async () => response(version) });
  await controller.check();
  controller.dismiss();
  version = '1.1.9';
  const result = await controller.check();
  assert.equal(result.phase, 'current');
  assert.equal(result.release, null);
  assert.equal(result.dismissed, false);
});

test('snapshots, emitted states and returned results cannot mutate stored release metadata', async () => {
  const emitted = [];
  const controller = create({ onChange: state => emitted.push(state) });
  const result = await controller.check();
  result.release.version = '9.9.9';
  result.phase = 'idle';
  const snapshot = controller.snapshot();
  snapshot.release.url = 'https://example.com/untrusted.exe';
  emitted.at(-1).release.notes = '篡改';
  emitted.at(-1).dismissed = true;
  const latest = controller.snapshot();
  assert.equal(latest.phase, 'available');
  assert.equal(latest.release.version, '1.1.10');
  assert.match(latest.release.url, /^https:\/\/github\.com\/OrangeCatzhang\/orange-schedule\//);
  assert.equal(latest.release.notes, '改进日历与提醒。');
  assert.equal(latest.dismissed, false);
  assert.deepEqual(JSON.parse(JSON.stringify(latest)), latest);
});

test('invalid current versions and unsupported fetch become readable states without throwing', async () => {
  let calls = 0;
  const invalid = create({
    currentVersion: 'invalid',
    fetchImpl: async () => { calls++; return response(); }
  });
  const invalidResult = await invalid.check();
  assert.equal(invalidResult.phase, 'error');
  assert.match(invalidResult.error, /当前应用版本号格式不正确/);
  assert.equal(calls, 0);
  const unsupported = create({ fetchImpl: undefined });
  const unsupportedResult = await unsupported.check();
  assert.equal(unsupportedResult.phase, 'error');
  assert.match(unsupportedResult.error, /当前环境无法联网检查更新/);
});

test('observer exceptions cannot interrupt checks or prevent later retries', async () => {
  let calls = 0;
  const controller = create({
    onChange: () => { throw new Error('window closed'); },
    fetchImpl: async () => { calls++; return response(); }
  });
  assert.equal((await controller.check()).phase, 'available');
  assert.equal(controller.dismiss().dismissed, true);
  assert.equal((await controller.check()).phase, 'available');
  assert.equal(calls, 2);
});

test('a reentrant observer joins the already established request', async () => {
  let calls = 0;
  let joined;
  const controller = create({
    onChange: state => {
      if (state.phase === 'checking') joined = controller.check();
    },
    fetchImpl: async () => { calls++; return response(); }
  });
  const initial = controller.check({ manual: false });
  assert.strictEqual(initial, joined);
  await initial;
  assert.equal(calls, 1);
});
