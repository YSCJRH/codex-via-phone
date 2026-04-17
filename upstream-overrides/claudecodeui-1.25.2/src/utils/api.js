import { IS_CODEX_ONLY_HARDENED, IS_PLATFORM } from "../constants/config";
import { getDeviceIdentity } from "../components/auth/deviceTrust.js";

// Utility function for authenticated API calls
export const authenticatedFetch = (url, options = {}) => {
  const {
    timeoutMs = 0,
    signal,
    headers: customHeaders = {},
    ...requestOptions
  } = options;
  const defaultHeaders = {};
  const controller =
    !signal && timeoutMs > 0 && typeof AbortController !== 'undefined'
      ? new AbortController()
      : null;
  const timeoutId =
    controller && typeof globalThis.setTimeout === 'function'
      ? globalThis.setTimeout(() => controller.abort(), timeoutMs)
      : null;

  // Only set Content-Type for non-FormData requests
  if (!(requestOptions.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  const request = fetch(url, {
    ...requestOptions,
    credentials: 'same-origin',
    signal: signal || controller?.signal,
    headers: {
      ...defaultHeaders,
      ...customHeaders,
    },
  });

  if (timeoutId === null) {
    return request;
  }

  return request.finally(() => {
    globalThis.clearTimeout(timeoutId);
  });
};

const buildAuthPayload = async (username, password, extraPayload = {}) => ({
  username,
  password,
  ...(await getDeviceIdentity()),
  ...extraPayload,
});

// API endpoints
export const api = {
  // Auth endpoints (no token required)
  auth: {
    status: () => fetch('/api/auth/status', { credentials: 'same-origin' }),
    login: async (username, password, extraPayload = {}) => fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await buildAuthPayload(username, password, extraPayload)),
    }),
    register: async (username, password, extraPayload = {}) => fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await buildAuthPayload(username, password, extraPayload)),
    }),
    deviceApprovalStatus: () =>
      fetch('/api/auth/device-approval', { credentials: 'same-origin' }),
    user: () => authenticatedFetch('/api/auth/user'),
    logout: () => authenticatedFetch('/api/auth/logout', { method: 'POST' }),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  projects: (options = {}) => authenticatedFetch('/api/projects', options),
  desktopApprovalBridgeStatus: () =>
    authenticatedFetch('/api/codex/desktop-approvals/bridge-status'),
  resolveDesktopApproval: (requestId, action, currentSessionId) =>
    authenticatedFetch(`/api/codex/desktop-approvals/${encodeURIComponent(requestId)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        action,
        ...(currentSessionId ? { currentSessionId } : {}),
      }),
    }),
  codexSession: (sessionId, options = {}) =>
    authenticatedFetch(`/api/codex/sessions/${encodeURIComponent(sessionId)}`, options),
  codexSessions: (projectPath, limit = 5, offset = 0) =>
    authenticatedFetch(`/api/codex/sessions?projectPath=${encodeURIComponent(projectPath)}&limit=${limit}&offset=${offset}`),
  sessions: (projectName, limit = 5, offset = 0) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions?limit=${limit}&offset=${offset}`),
  sessionMessages: (projectName, sessionId, limit = null, offset = 0, provider = IS_CODEX_ONLY_HARDENED ? 'codex' : 'claude') => {
    const params = new URLSearchParams();
    if (limit !== null) {
      params.append('limit', limit);
      params.append('offset', offset);
    }
    const queryString = params.toString();

    let url;
    if (provider === 'codex') {
      url = `/api/codex/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    } else if (provider === 'cursor') {
      url = `/api/cursor/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    } else if (provider === 'gemini') {
      url = `/api/gemini/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    } else {
      url = `/api/projects/${projectName}/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    }
    return authenticatedFetch(url);
  },
  renameProject: (projectName, displayName) =>
    authenticatedFetch(`/api/projects/${projectName}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  deleteSession: (projectName, sessionId) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  renameSession: (sessionId, summary, provider) =>
    authenticatedFetch(`/api/sessions/${sessionId}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ summary, provider }),
    }),
  deleteCodexSession: (sessionId) =>
    authenticatedFetch(`/api/codex/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  deleteGeminiSession: (sessionId) =>
    authenticatedFetch(`/api/gemini/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  deleteProject: (projectName, force = false) =>
    authenticatedFetch(`/api/projects/${projectName}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
    }),
  searchConversationsUrl: (query, limit = 50) => {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return `/api/search/conversations?${params.toString()}`;
  },
  createProject: (path) =>
    authenticatedFetch('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  createWorkspace: (workspaceData) =>
    authenticatedFetch('/api/projects/create-workspace', {
      method: 'POST',
      body: JSON.stringify(workspaceData),
    }),
  readFile: (projectName, filePath) =>
    authenticatedFetch(`/api/projects/${projectName}/file?filePath=${encodeURIComponent(filePath)}`),
  saveFile: (projectName, filePath, content) =>
    authenticatedFetch(`/api/projects/${projectName}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content }),
    }),
  getFiles: (projectName, options = {}) =>
    authenticatedFetch(`/api/projects/${projectName}/files`, options),

  // File operations
  createFile: (projectName, { path, type, name }) =>
    authenticatedFetch(`/api/projects/${projectName}/files/create`, {
      method: 'POST',
      body: JSON.stringify({ path, type, name }),
    }),

  renameFile: (projectName, { oldPath, newName }) =>
    authenticatedFetch(`/api/projects/${projectName}/files/rename`, {
      method: 'PUT',
      body: JSON.stringify({ oldPath, newName }),
    }),

  deleteFile: (projectName, { path, type }) =>
    authenticatedFetch(`/api/projects/${projectName}/files`, {
      method: 'DELETE',
      body: JSON.stringify({ path, type }),
    }),

  uploadFiles: (projectName, formData) =>
    authenticatedFetch(`/api/projects/${projectName}/files/upload`, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    }),

  transcribe: (formData) =>
    authenticatedFetch('/api/transcribe', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    }),

  // TaskMaster endpoints
  taskmaster: {
    // Initialize TaskMaster in a project
    init: (projectName) =>
      authenticatedFetch(`/api/taskmaster/init/${projectName}`, {
        method: 'POST',
      }),

    // Add a new task
    addTask: (projectName, { prompt, title, description, priority, dependencies }) =>
      authenticatedFetch(`/api/taskmaster/add-task/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ prompt, title, description, priority, dependencies }),
      }),

    // Parse PRD to generate tasks
    parsePRD: (projectName, { fileName, numTasks, append }) =>
      authenticatedFetch(`/api/taskmaster/parse-prd/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ fileName, numTasks, append }),
      }),

    // Get available PRD templates
    getTemplates: () =>
      authenticatedFetch('/api/taskmaster/prd-templates'),

    // Apply a PRD template
    applyTemplate: (projectName, { templateId, fileName, customizations }) =>
      authenticatedFetch(`/api/taskmaster/apply-template/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ templateId, fileName, customizations }),
      }),

    // Update a task
    updateTask: (projectName, taskId, updates) =>
      authenticatedFetch(`/api/taskmaster/update-task/${projectName}/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      }),
  },

  // Browse filesystem for project suggestions
  browseFilesystem: (dirPath = null) => {
    const params = new URLSearchParams();
    if (dirPath) params.append('path', dirPath);

    return authenticatedFetch(`/api/browse-filesystem?${params}`);
  },

  createFolder: (folderPath) =>
    authenticatedFetch('/api/create-folder', {
      method: 'POST',
      body: JSON.stringify({ path: folderPath }),
    }),

  // User endpoints
  user: {
    gitConfig: () => authenticatedFetch('/api/user/git-config'),
    updateGitConfig: (gitName, gitEmail) =>
      authenticatedFetch('/api/user/git-config', {
        method: 'POST',
        body: JSON.stringify({ gitName, gitEmail }),
      }),
    onboardingStatus: () => authenticatedFetch('/api/user/onboarding-status'),
    completeOnboarding: () =>
      authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST',
      }),
  },

  debug: {
    connectivityTimeline: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
      if (params.sinceMs !== undefined) searchParams.set('sinceMs', String(params.sinceMs));
      if (params.surface) searchParams.set('surface', String(params.surface));
      if (params.sessionId) searchParams.set('sessionId', String(params.sessionId));
      const query = searchParams.toString();
      return authenticatedFetch(`/api/debug/connectivity/timeline${query ? `?${query}` : ''}`);
    },
    syncSession: (sessionId) =>
      authenticatedFetch(`/api/debug/sync/session/${encodeURIComponent(sessionId)}`),
    exportBundle: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
      if (params.sessionId) searchParams.set('sessionId', String(params.sessionId));
      const query = searchParams.toString();
      return authenticatedFetch(`/api/debug/export-bundle${query ? `?${query}` : ''}`);
    },
    clientConnectivityEvent: (payload) =>
      authenticatedFetch('/api/debug/connectivity/client-event', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    clientSyncEvent: (payload) =>
      authenticatedFetch('/api/debug/sync/client-event', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    clientSyncSnapshot: (payload) =>
      authenticatedFetch('/api/debug/sync/client-snapshot', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },

  // Generic GET method for any endpoint
  get: (endpoint) => authenticatedFetch(`/api${endpoint}`),

  // Generic POST method for any endpoint
  post: (endpoint, body) => authenticatedFetch(`/api${endpoint}`, {
    method: 'POST',
    ...(body instanceof FormData ? { body } : { body: JSON.stringify(body) }),
  }),

  // Generic PUT method for any endpoint
  put: (endpoint, body) => authenticatedFetch(`/api${endpoint}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }),

  // Generic DELETE method for any endpoint
  delete: (endpoint, options = {}) => authenticatedFetch(`/api${endpoint}`, {
    method: 'DELETE',
    ...options,
  }),
};
