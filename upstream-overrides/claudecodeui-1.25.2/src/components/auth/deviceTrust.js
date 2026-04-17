const DEVICE_SESSION_STORAGE_KEY = 'codex-device-session-v1';
const DEVICE_ID_STORAGE_KEY = 'codex-device-id-v1';
const DEVICE_KEY_META_STORAGE_KEY = 'codex-device-key-meta-v1';
const DEVICE_KEY_DB_NAME = 'codex-device-keys-v1';
const DEVICE_KEY_STORE_NAME = 'device-keys';
const DEVICE_KEY_RECORD_ID = 'primary';

function hasWindow() {
  return typeof window !== 'undefined';
}

function readStorage(key) {
  if (!hasWindow()) {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  if (!hasWindow()) {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures in private/incognito WebViews.
  }
}

function removeStorage(key) {
  if (!hasWindow()) {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures in private/incognito WebViews.
  }
}

function getWebCrypto() {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto?.subtle) {
    return null;
  }

  return globalThis.crypto;
}

function inferAppType() {
  if (!hasWindow()) {
    return 'unknown';
  }

  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone;
  const ua = window.navigator?.userAgent || '';
  if (standalone) {
    return 'standalone';
  }
  if (/; wv\)|webview|version\/[\d.]+ chrome\/[\d.]+ mobile safari/i.test(ua)) {
    return 'webview';
  }
  return 'browser';
}

function inferDeviceName() {
  if (!hasWindow()) {
    return 'unknown-device';
  }

  const platform = window.navigator?.platform || '';
  const userAgent = window.navigator?.userAgent || '';
  if (/android/i.test(userAgent)) {
    return inferAppType() === 'webview' ? 'Android wrapped app' : 'Android browser';
  }
  if (/iphone|ipad|ios/i.test(userAgent)) {
    return inferAppType() === 'webview' ? 'iPhone/iPad wrapped app' : 'iPhone/iPad browser';
  }
  return platform || 'browser-device';
}

function encodeBase64Url(data) {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function digestSha256Base64Url(data) {
  const cryptoApi = getWebCrypto();
  if (!cryptoApi) {
    throw new Error('WebCrypto is unavailable.');
  }

  const digest = await cryptoApi.subtle.digest('SHA-256', data);
  return encodeBase64Url(digest);
}

function parseDeviceKeyMeta() {
  const raw = readStorage(DEVICE_KEY_META_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function storeDeviceKeyMeta(payload) {
  writeStorage(DEVICE_KEY_META_STORAGE_KEY, JSON.stringify(payload));
}

function clearDeviceKeyMeta() {
  removeStorage(DEVICE_KEY_META_STORAGE_KEY);
}

function openDeviceKeyDatabase() {
  if (!hasWindow() || !window.indexedDB) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DEVICE_KEY_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DEVICE_KEY_STORE_NAME)) {
        database.createObjectStore(DEVICE_KEY_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open device key database.'));
  });
}

async function readDeviceKeyRecord() {
  const database = await openDeviceKeyDatabase();
  if (!database) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DEVICE_KEY_STORE_NAME, 'readonly');
    const store = transaction.objectStore(DEVICE_KEY_STORE_NAME);
    const request = store.get(DEVICE_KEY_RECORD_ID);

    request.onsuccess = () => {
      database.close();
      resolve(request.result || null);
    };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error('Failed to read device key record.'));
    };
  });
}

async function writeDeviceKeyRecord(record) {
  const database = await openDeviceKeyDatabase();
  if (!database) {
    throw new Error('IndexedDB is unavailable.');
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DEVICE_KEY_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DEVICE_KEY_STORE_NAME);
    store.put(record);

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Failed to write device key record.'));
    };
  });
}

async function deleteDeviceKeyRecord() {
  const database = await openDeviceKeyDatabase();
  if (!database) {
    return;
  }

  await new Promise((resolve, reject) => {
    const transaction = database.transaction(DEVICE_KEY_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DEVICE_KEY_STORE_NAME);
    store.delete(DEVICE_KEY_RECORD_ID);

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Failed to delete device key record.'));
    };
  });
}

async function buildDeviceKeyRecord(publicKey, privateKey, source = 'webcrypto-nonextractable') {
  const cryptoApi = getWebCrypto();
  if (!cryptoApi) {
    throw new Error('WebCrypto is unavailable.');
  }

  const publicKeySpkiBuffer = await cryptoApi.subtle.exportKey('spki', publicKey);
  const devicePublicKeySpki = encodeBase64Url(publicKeySpkiBuffer);
  const deviceKeyThumbprint = await digestSha256Base64Url(publicKeySpkiBuffer);

  return {
    id: DEVICE_KEY_RECORD_ID,
    privateKey,
    publicKey,
    devicePublicKeySpki,
    deviceKeyThumbprint,
    generatedAt: new Date().toISOString(),
    source,
  };
}

async function generateDeviceKeyRecord() {
  const cryptoApi = getWebCrypto();
  if (!cryptoApi) {
    throw new Error('WebCrypto is unavailable.');
  }

  try {
    const keyPair = await cryptoApi.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify'],
    );

    return buildDeviceKeyRecord(keyPair.publicKey, keyPair.privateKey, 'webcrypto-nonextractable');
  } catch {
    const keyPair = await cryptoApi.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
    const privateKeyPkcs8 = await cryptoApi.subtle.exportKey('pkcs8', keyPair.privateKey);
    const lockedPrivateKey = await cryptoApi.subtle.importKey(
      'pkcs8',
      privateKeyPkcs8,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );

    return buildDeviceKeyRecord(keyPair.publicKey, lockedPrivateKey, 'webcrypto-reimported-private-key');
  }
}

export function getOrCreateDeviceId() {
  const existing = readStorage(DEVICE_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const generated = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `device-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  writeStorage(DEVICE_ID_STORAGE_KEY, generated);
  return generated;
}

async function getOrCreateDeviceKeyMaterial() {
  const cryptoApi = getWebCrypto();
  if (!cryptoApi) {
    throw new Error('This browser does not support WebCrypto device keys.');
  }

  if (!hasWindow() || !window.indexedDB) {
    throw new Error('This browser does not support IndexedDB device key storage.');
  }

  const storedRecord = await readDeviceKeyRecord();
  const storedMeta = parseDeviceKeyMeta();
  if (
    storedRecord?.privateKey
    && storedMeta?.devicePublicKeySpki
    && storedMeta?.deviceKeyThumbprint
  ) {
    return {
      ...storedMeta,
      privateKey: storedRecord.privateKey,
      publicKey: storedRecord.publicKey || null,
    };
  }

  const nextRecord = await generateDeviceKeyRecord();
  await writeDeviceKeyRecord({
    id: DEVICE_KEY_RECORD_ID,
    privateKey: nextRecord.privateKey,
    publicKey: nextRecord.publicKey,
    generatedAt: nextRecord.generatedAt,
    source: nextRecord.source,
  });
  storeDeviceKeyMeta({
    devicePublicKeySpki: nextRecord.devicePublicKeySpki,
    deviceKeyThumbprint: nextRecord.deviceKeyThumbprint,
    generatedAt: nextRecord.generatedAt,
    source: nextRecord.source,
  });

  return nextRecord;
}

export async function getDeviceIdentity() {
  const keyMaterial = await getOrCreateDeviceKeyMaterial();

  return {
    deviceId: getOrCreateDeviceId(),
    deviceName: inferDeviceName(),
    platform: hasWindow() ? window.navigator?.platform || window.navigator?.userAgent || 'unknown' : 'unknown',
    appType: inferAppType(),
    devicePublicKeySpki: keyMaterial.devicePublicKeySpki,
    deviceKeyThumbprint: keyMaterial.deviceKeyThumbprint,
  };
}

export async function signDeviceChallenge(challengeNonce) {
  const cryptoApi = getWebCrypto();
  const keyMaterial = await getOrCreateDeviceKeyMaterial();
  if (!cryptoApi || !keyMaterial?.privateKey) {
    throw new Error('Device key signing is unavailable in this browser.');
  }

  const signature = await cryptoApi.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyMaterial.privateKey,
    new TextEncoder().encode(String(challengeNonce || '')),
  );
  return encodeBase64Url(signature);
}

export async function resetDeviceKeyMaterial() {
  await deleteDeviceKeyRecord();
  clearDeviceKeyMeta();
}

export function getStoredDeviceSession() {
  const raw = readStorage(DEVICE_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function storeDeviceSession(payload) {
  writeStorage(DEVICE_SESSION_STORAGE_KEY, JSON.stringify(payload));
}

export function clearDeviceSession() {
  removeStorage(DEVICE_SESSION_STORAGE_KEY);
}
