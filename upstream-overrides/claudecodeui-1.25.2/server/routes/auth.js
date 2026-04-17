import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { userDb, db, trustedDevicesDb } from '../database/db.js';
import {
  authenticateToken,
  clearAuthCookie,
  clearPendingApprovalCookie,
  generateToken,
  getPendingApprovalTokenFromRequest,
  setAuthCookie,
  setPendingApprovalCookie,
} from '../middleware/auth.js';

const router = express.Router();
const sanitizeUser = (user) => ({ id: user.id, username: user.username });
const DEVICE_CHALLENGE_TTL_SECONDS = 300;

const getRequestIp = (req) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || null;
};

const normalizeTextField = (value, maxLength = 160) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
};

const normalizeBase64UrlField = (value, maxLength = 4096) => {
  const normalized = normalizeTextField(value, maxLength);
  if (!normalized) {
    return null;
  }

  return /^[A-Za-z0-9_-]+$/.test(normalized) ? normalized : null;
};

const getDeviceMetadataFromRequest = (req) => ({
  deviceId: normalizeTextField(req.body?.deviceId, 128),
  deviceName: normalizeTextField(req.body?.deviceName, 160),
  platform: normalizeTextField(req.body?.platform, 80),
  appType: normalizeTextField(req.body?.appType, 80),
  ip: getRequestIp(req),
  userAgent: normalizeTextField(req.headers['user-agent'], 512),
  devicePublicKeySpki: normalizeBase64UrlField(req.body?.devicePublicKeySpki, 4096),
  deviceKeyThumbprint: normalizeBase64UrlField(req.body?.deviceKeyThumbprint, 256),
  challengeId: normalizeTextField(req.body?.challengeId, 128),
  deviceChallengeSignature: normalizeBase64UrlField(req.body?.deviceChallengeSignature, 1024),
});

const hasDeviceKeyMetadata = (deviceMetadata) =>
  Boolean(deviceMetadata?.devicePublicKeySpki && deviceMetadata?.deviceKeyThumbprint);

const buildApprovalPayload = (
  request,
  message = 'This device must be approved on the desktop before it can sign in.',
) => ({
  success: false,
  approvalRequired: true,
  approvalStatus: request.status,
  approvalKind: request.approval_kind || 'new-device',
  message,
  deviceName: request.device_name || request.device_id,
});

const buildChallengePayload = (
  challenge,
  message = 'Approved devices must prove possession of their device key before sign-in completes.',
) => ({
  success: false,
  challengeRequired: true,
  challengeId: challenge.id,
  challengeNonce: challenge.challenge_nonce,
  challengeExpiresAt: challenge.expires_at,
  message,
});

const issueAuthSession = (req, res, user, deviceMetadata = null) => {
  const token = generateToken(user, {
    deviceId: deviceMetadata?.deviceId || null,
    deviceName: deviceMetadata?.deviceName || null,
    appType: deviceMetadata?.appType || null,
    deviceKeyThumbprint: deviceMetadata?.deviceKeyThumbprint || null,
  });

  setAuthCookie(res, token, req);
  clearPendingApprovalCookie(res, req);

  return {
    success: true,
    token,
    user: sanitizeUser(user),
  };
};

const queueDeviceApproval = (req, res, user, deviceMetadata, approvalKind, message) => {
  const requestToken = crypto.randomBytes(24).toString('hex');
  const request = trustedDevicesDb.createOrRefreshPendingApproval(
    user.id,
    deviceMetadata.deviceId,
    requestToken,
    {
      ...deviceMetadata,
      approvalKind,
    },
  );

  setPendingApprovalCookie(res, request.request_token, req);
  return res.status(202).json(buildApprovalPayload(request, message));
};

const toBase64UrlBuffer = (value) => Buffer.from(value, 'base64url');

const verifyDeviceChallengeSignature = async (devicePublicKeySpki, challengeNonce, signature) => {
  const subtle = crypto.webcrypto?.subtle;
  if (!subtle) {
    throw new Error('Server WebCrypto is unavailable for device-key verification.');
  }

  const publicKey = await subtle.importKey(
    'spki',
    toBase64UrlBuffer(devicePublicKeySpki),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );

  return subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    toBase64UrlBuffer(signature),
    Buffer.from(challengeNonce, 'utf8'),
  );
};

router.get('/status', async (req, res) => {
  try {
    const hasUsers = await userDb.hasUsers();
    res.json({
      needsSetup: !hasUsers,
      isAuthenticated: false,
    });
  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({ error: 'Server internal error' });
  }
});

router.get('/device-approval', async (req, res) => {
  try {
    const requestToken = normalizeTextField(getPendingApprovalTokenFromRequest(req), 128);
    if (!requestToken) {
      return res.status(400).json({ error: 'Approval request expired. Please sign in again.' });
    }

    const request = trustedDevicesDb.getApprovalRequestByToken(requestToken);
    if (!request) {
      clearPendingApprovalCookie(res, req);
      return res.status(404).json({ error: 'No matching approval request was found.' });
    }

    if (request.status === 'rejected' || request.status === 'superseded') {
      clearPendingApprovalCookie(res, req);
    }

    return res.json({
      success: true,
      approvalStatus: request.status,
      approvalKind: request.approval_kind || 'new-device',
      message:
        request.status === 'approved'
          ? 'Device approved. Please complete sign-in again.'
          : request.status === 'rejected'
            ? 'This device request was rejected on the desktop.'
            : request.status === 'superseded'
              ? 'This device request was replaced. Please sign in again.'
              : 'Waiting for desktop approval for this device.',
    });
  } catch (error) {
    console.error('Device approval status error:', error);
    res.status(500).json({ error: 'Server internal error' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const deviceMetadata = getDeviceMetadataFromRequest(req);

    if (!username || !password) {
      return res.status(400).json({ error: 'Please provide both username and password.' });
    }

    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: 'Username must be at least 3 characters and password at least 6 characters.' });
    }

    if (!deviceMetadata.deviceId) {
      return res.status(400).json({ error: 'This client did not send a device identifier. Refresh and try again.' });
    }

    if (!hasDeviceKeyMetadata(deviceMetadata)) {
      return res.status(400).json({ error: 'This browser must register a device key before setup can finish.' });
    }

    db.prepare('BEGIN').run();
    try {
      const hasUsers = userDb.hasUsers();
      if (hasUsers) {
        db.prepare('ROLLBACK').run();
        return res.status(403).json({ error: 'A user already exists. This installation supports a single account only.' });
      }

      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      const user = userDb.createUser(username, passwordHash);

      trustedDevicesDb.approveDevice(user.id, deviceMetadata.deviceId, deviceMetadata);

      db.prepare('COMMIT').run();
      userDb.updateLastLogin(user.id);
      res.json(issueAuthSession(req, res, user, deviceMetadata));
    } catch (error) {
      db.prepare('ROLLBACK').run();
      throw error;
    }
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Username already exists.' });
    } else {
      res.status(500).json({ error: 'Server internal error' });
    }
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const deviceMetadata = getDeviceMetadataFromRequest(req);

    if (!username || !password) {
      return res.status(400).json({ error: 'Please provide both username and password.' });
    }

    if (!deviceMetadata.deviceId) {
      return res.status(400).json({ error: 'This client did not send a device identifier. Refresh and try again.' });
    }

    if (!hasDeviceKeyMetadata(deviceMetadata)) {
      return res.status(400).json({ error: 'This browser must provide a device key before sign-in can continue.' });
    }

    const user = userDb.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const approvedDevice = trustedDevicesDb.getApprovedDevice(user.id, deviceMetadata.deviceId);
    if (!approvedDevice) {
      return queueDeviceApproval(
        req,
        res,
        user,
        deviceMetadata,
        'new-device',
        'This new device must be approved on the desktop before sign-in can continue.',
      );
    }

    if (!approvedDevice.device_key_thumbprint || !approvedDevice.device_public_key_spki) {
      return queueDeviceApproval(
        req,
        res,
        user,
        deviceMetadata,
        'legacy-upgrade',
        'This previously trusted device must be re-approved on the desktop to register its device key.',
      );
    }

    if (
      approvedDevice.device_key_thumbprint !== deviceMetadata.deviceKeyThumbprint
      || approvedDevice.device_public_key_spki !== deviceMetadata.devicePublicKeySpki
    ) {
      return queueDeviceApproval(
        req,
        res,
        user,
        deviceMetadata,
        'device-key-rotation',
        'This device key does not match the approved record. Desktop re-approval is required.',
      );
    }

    if (!deviceMetadata.challengeId || !deviceMetadata.deviceChallengeSignature) {
      const challenge = trustedDevicesDb.createDeviceAuthChallenge(
        user.id,
        deviceMetadata.deviceId,
        deviceMetadata.deviceKeyThumbprint,
        deviceMetadata.devicePublicKeySpki,
        {
          ip: deviceMetadata.ip,
          userAgent: deviceMetadata.userAgent,
          ttlSeconds: DEVICE_CHALLENGE_TTL_SECONDS,
        },
      );

      return res.status(401).json(buildChallengePayload(challenge));
    }

    const challenge = trustedDevicesDb.getDeviceAuthChallenge(deviceMetadata.challengeId);
    if (!challenge || challenge.status !== 'pending') {
      return res.status(401).json({ error: 'Device challenge expired. Start sign-in again.' });
    }

    const expiresAtMs = Date.parse(challenge.expires_at || '');
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return res.status(401).json({ error: 'Device challenge expired. Start sign-in again.' });
    }

    if (
      challenge.user_id !== user.id
      || challenge.device_id !== deviceMetadata.deviceId
      || challenge.device_key_thumbprint !== deviceMetadata.deviceKeyThumbprint
      || challenge.device_public_key_spki !== deviceMetadata.devicePublicKeySpki
    ) {
      return res.status(403).json({ error: 'Device challenge does not match this sign-in attempt.' });
    }

    const signatureIsValid = await verifyDeviceChallengeSignature(
      challenge.device_public_key_spki,
      challenge.challenge_nonce,
      deviceMetadata.deviceChallengeSignature,
    );
    if (!signatureIsValid) {
      return res.status(403).json({ error: 'Device key proof could not be verified.' });
    }

    trustedDevicesDb.completeDeviceAuthChallenge(challenge.id);
    trustedDevicesDb.touchApprovedDevice(user.id, deviceMetadata.deviceId, {
      ...deviceMetadata,
      updateLogin: true,
    });

    userDb.updateLastLogin(user.id);
    res.json(issueAuthSession(req, res, user, deviceMetadata));
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server internal error' });
  }
});

router.get('/user', authenticateToken, (req, res) => {
  res.json({
    user: sanitizeUser(req.user),
  });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res, req);
  clearPendingApprovalCookie(res, req);
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
