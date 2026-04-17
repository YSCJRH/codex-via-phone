import fsSync from 'fs';
import os from 'os';
import path from 'path';

const UNIX_FORBIDDEN_WORKSPACE_PATHS = [
  '/',
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/dev',
  '/proc',
  '/sys',
  '/var',
  '/boot',
  '/root',
  '/lib',
  '/lib64',
  '/opt',
  '/tmp',
  '/run',
];

const WINDOWS_FORBIDDEN_WORKSPACE_PATHS = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\System Volume Information',
  'C:\\$Recycle.Bin',
];

const TOOL_INTERNAL_DIRECTORY_NAMES = new Set([
  '.codex',
  '.claude',
  '.cursor',
  '.gemini',
]);

const TEMP_DIRECTORY_NAMES = new Set(['temp', 'tmp']);
const PYTEST_SEGMENT_PATTERN = /^pytest(?:-of-.+|-\d+)$/i;

export const FORBIDDEN_WORKSPACE_PATHS = process.platform === 'win32'
  ? WINDOWS_FORBIDDEN_WORKSPACE_PATHS
  : UNIX_FORBIDDEN_WORKSPACE_PATHS;

export const PROJECTS_CACHE_SCHEMA_VERSION = 2;

function isWindowsPathStyle(inputPath) {
  if (typeof inputPath !== 'string') {
    return false;
  }

  return /^[a-z]:[\\/]/i.test(inputPath)
    || inputPath.startsWith('\\\\?\\')
    || inputPath.startsWith('\\\\');
}

function getPathApi(inputPath) {
  return isWindowsPathStyle(inputPath) ? path.win32 : path.posix;
}

function stripLongPathPrefix(inputPath) {
  if (typeof inputPath !== 'string') {
    return '';
  }

  return inputPath.startsWith('\\\\?\\')
    ? inputPath.slice(4)
    : inputPath;
}

function getPathSegments(inputPath) {
  return stripLongPathPrefix(inputPath)
    .split(/[\\/]+/)
    .filter(Boolean);
}

function isSamePathOrDescendant(candidatePath, basePath) {
  if (!candidatePath || !basePath) {
    return false;
  }

  if (candidatePath === basePath) {
    return true;
  }

  const separator = candidatePath.includes('\\') || basePath.includes('\\') ? '\\' : '/';
  const normalizedBasePath = basePath.endsWith(separator) ? basePath : `${basePath}${separator}`;
  return candidatePath.startsWith(normalizedBasePath);
}

function isDriveRootPath(inputPath) {
  const normalized = stripLongPathPrefix(inputPath).trim();
  if (!normalized) {
    return false;
  }

  if (isWindowsPathStyle(normalized)) {
    return /^[a-z]:(?:\\)?$/i.test(path.win32.normalize(normalized));
  }

  return path.posix.normalize(normalized) === '/';
}

function getProjectLastActivityTimestamp(project) {
  return (Array.isArray(project?.codexSessions) ? project.codexSessions : []).reduce((latest, session) => {
    const timestamp = new Date(
      session?.lastActivity
        || session?.updated_at
        || session?.createdAt
        || session?.created_at
        || 0,
    ).getTime();

    return timestamp > latest ? timestamp : latest;
  }, 0);
}

function getSessionTimestamp(session) {
  return new Date(
    session?.lastActivity
      || session?.updated_at
      || session?.createdAt
      || session?.created_at
      || 0,
  ).getTime();
}

export function resolveProjectPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return '';
  }

  const pathApi = getPathApi(inputPath);
  const normalized = pathApi.normalize(stripLongPathPrefix(inputPath).trim());

  if (!normalized) {
    return '';
  }

  const resolvedPath = pathApi.resolve(normalized);
  const canUseRealPath = (pathApi === path.win32 && process.platform === 'win32')
    || (pathApi === path.posix && process.platform !== 'win32');

  if (canUseRealPath) {
    try {
      return fsSync.realpathSync.native(resolvedPath);
    } catch {
      return resolvedPath;
    }
  }

  return resolvedPath;
}

export function normalizeComparablePath(inputPath) {
  const resolvedPath = resolveProjectPath(inputPath);
  if (!resolvedPath) {
    return '';
  }

  return isWindowsPathStyle(resolvedPath)
    ? resolvedPath.toLowerCase()
    : resolvedPath;
}

export function getProjectPathDisplayName(projectPath, fallback = '') {
  const resolvedPath = resolveProjectPath(projectPath);
  if (!resolvedPath) {
    return fallback;
  }

  const pathApi = getPathApi(resolvedPath);
  const parsedPath = pathApi.parse(resolvedPath);
  if (parsedPath.base) {
    return parsedPath.base;
  }

  const segments = getPathSegments(resolvedPath);
  return segments[segments.length - 1] || fallback || resolvedPath;
}

export function shouldHideAutoDetectedProject(projectPath, options = {}) {
  const { isManuallyAdded = false, homeDir = os.homedir(), forbiddenPaths = null } = options;
  if (isManuallyAdded) {
    return false;
  }

  const resolvedPath = resolveProjectPath(projectPath);
  if (!resolvedPath) {
    return true;
  }

  if (isDriveRootPath(resolvedPath)) {
    return true;
  }

  const normalizedPath = normalizeComparablePath(resolvedPath);
  if (!normalizedPath) {
    return true;
  }

  const activeForbiddenPaths = Array.isArray(forbiddenPaths)
    ? forbiddenPaths
    : (isWindowsPathStyle(resolvedPath) ? WINDOWS_FORBIDDEN_WORKSPACE_PATHS : UNIX_FORBIDDEN_WORKSPACE_PATHS);

  const normalizedHomeDir = normalizeComparablePath(homeDir);
  if (normalizedHomeDir && normalizedPath === normalizedHomeDir) {
    return true;
  }

  for (const forbiddenPath of activeForbiddenPaths) {
    const normalizedForbiddenPath = normalizeComparablePath(forbiddenPath);
    if (normalizedForbiddenPath && isSamePathOrDescendant(normalizedPath, normalizedForbiddenPath)) {
      return true;
    }
  }

  const lowerCaseSegments = getPathSegments(resolvedPath).map((segment) => segment.toLowerCase());
  if (lowerCaseSegments.some((segment) => TOOL_INTERNAL_DIRECTORY_NAMES.has(segment))) {
    return true;
  }

  if (lowerCaseSegments.includes('appdata')) {
    return true;
  }

  if (lowerCaseSegments.some((segment) => TEMP_DIRECTORY_NAMES.has(segment) || PYTEST_SEGMENT_PATTERN.test(segment))) {
    return true;
  }

  return false;
}

export function sortCodexProjectsForDisplay(projects) {
  return [...(Array.isArray(projects) ? projects : [])].sort((leftProject, rightProject) => {
    const rightTimestamp = getProjectLastActivityTimestamp(rightProject);
    const leftTimestamp = getProjectLastActivityTimestamp(leftProject);

    if (rightTimestamp !== leftTimestamp) {
      return rightTimestamp - leftTimestamp;
    }

    return String(leftProject?.displayName || leftProject?.name || '').localeCompare(
      String(rightProject?.displayName || rightProject?.name || ''),
      undefined,
      { sensitivity: 'base' },
    );
  });
}

export function indexCodexSessionsByProjectPath(sessions) {
  const sessionsByProject = new Map();

  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session?.id) {
      continue;
    }

    const resolvedCwd = resolveProjectPath(session.cwd) || session.cwd;
    const normalizedProjectPath = normalizeComparablePath(resolvedCwd);
    if (!normalizedProjectPath) {
      continue;
    }

    if (!sessionsByProject.has(normalizedProjectPath)) {
      sessionsByProject.set(normalizedProjectPath, new Map());
    }

    const projectSessions = sessionsByProject.get(normalizedProjectPath);
    const nextSession = {
      ...session,
      cwd: resolvedCwd,
    };
    const existing = projectSessions.get(nextSession.id);

    if (!existing || getSessionTimestamp(nextSession) >= getSessionTimestamp(existing)) {
      projectSessions.set(nextSession.id, nextSession);
    }
  }

  for (const [projectPath, projectSessions] of sessionsByProject.entries()) {
    sessionsByProject.set(
      projectPath,
      [...projectSessions.values()].sort((leftSession, rightSession) => (
        getSessionTimestamp(rightSession) - getSessionTimestamp(leftSession)
      )),
    );
  }

  return sessionsByProject;
}
