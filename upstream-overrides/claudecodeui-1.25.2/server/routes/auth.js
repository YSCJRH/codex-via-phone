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

const getDeviceMetadataFromRequest = (req) => ({
  deviceId: normalizeTextField(req.body?.deviceId, 128),
  deviceName: normalizeTextField(req.body?.deviceName, 160),
  platform: normalizeTextField(req.body?.platform, 80),
  appType: normalizeTextField(req.body?.appType, 80),
  ip: getRequestIp(req),
  userAgent: normalizeTextField(req.headers['user-agent'], 512),
});

const buildApprovalPayload = (
  request,
  message = 'This device must be approved on the desktop before it can sign in.',
) => ({
  success: false,
  approvalRequired: true,
  approvalStatus: request.status,
  message,
  deviceName: request.device_name || request.device_id,
});

const issueAuthSession = (req, res, user, deviceMetadata = null) => {
  const token = generateToken(user, {
    deviceId: deviceMetadata?.deviceId || null,
    deviceName: deviceMetadata?.deviceName || null,
    appType: deviceMetadata?.appType || null,
  });

  setAuthCookie(res, token, req);
  clearPendingApprovalCookie(res, req);

  return {
    success: true,
    token,
    user: sanitizeUser(user),
  };
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

      if (deviceMetadata.deviceId) {
        trustedDevicesDb.approveDevice(user.id, deviceMetadata.deviceId, deviceMetadata);
      }

      db.prepare('COMMIT').run();
      userDb.updateLastLogin(user.id);
      res.json(issueAuthSession(req, res, user, deviceMetadata.deviceId ? deviceMetadata : null));
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
      const requestToken = crypto.randomBytes(24).toString('hex');
      const request = trustedDevicesDb.createOrRefreshPendingApproval(
        user.id,
        deviceMetadata.deviceId,
        requestToken,
        deviceMetadata,
      );
      setPendingApprovalCookie(res, request.request_token, req);
      return res.status(202).json(buildApprovalPayload(request));
    }

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
