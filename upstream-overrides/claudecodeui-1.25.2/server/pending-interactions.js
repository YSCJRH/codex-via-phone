import crypto from 'crypto';

const pendingInteractions = new Map();

function createInteractionId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return crypto.randomBytes(16).toString('hex');
}

function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function serializeInteraction(interaction) {
  if (!interaction) {
    return null;
  }

  return {
    requestId: interaction.id,
    interactionId: interaction.id,
    provider: interaction.provider || 'unknown',
    kind: interaction.kind || 'permission',
    toolName: interaction.toolName || 'UnknownTool',
    title: interaction.title || null,
    message: interaction.message || null,
    input: interaction.input,
    context: interaction.context,
    sessionId: interaction.sessionId || null,
    resolutionMode: interaction.resolutionMode || 'approve-deny',
    options: Array.isArray(interaction.options) ? interaction.options : [],
    receivedAt: interaction.receivedAt,
    metadata: interaction.metadata || null,
  };
}

export function registerPendingInteraction(record = {}) {
  const id = record.id || record.requestId || createInteractionId();
  const interaction = {
    id,
    provider: record.provider || 'unknown',
    kind: record.kind || 'permission',
    toolName: record.toolName || 'UnknownTool',
    title: record.title || null,
    message: record.message || null,
    input: record.input,
    context: record.context,
    sessionId: record.sessionId || null,
    resolutionMode: record.resolutionMode || 'approve-deny',
    options: Array.isArray(record.options) ? record.options : [],
    receivedAt: toDate(record.receivedAt),
    metadata: record.metadata || null,
    resolver: typeof record.resolver === 'function' ? record.resolver : null,
  };

  pendingInteractions.set(id, interaction);
  return serializeInteraction(interaction);
}

export function getPendingInteraction(interactionId) {
  return serializeInteraction(pendingInteractions.get(interactionId));
}

export function removePendingInteraction(interactionId) {
  return pendingInteractions.delete(interactionId);
}

export function removePendingInteractionsForSession(sessionId, filters = {}) {
  if (!sessionId) {
    return 0;
  }

  let removed = 0;
  for (const [interactionId, interaction] of pendingInteractions.entries()) {
    if (interaction.sessionId !== sessionId) {
      continue;
    }

    if (filters.provider && interaction.provider !== filters.provider) {
      continue;
    }

    if (filters.kind && interaction.kind !== filters.kind) {
      continue;
    }

    pendingInteractions.delete(interactionId);
    removed += 1;
  }

  return removed;
}

export function resolvePendingInteraction(interactionId, decision = {}) {
  const interaction = pendingInteractions.get(interactionId);
  if (!interaction) {
    return null;
  }

  pendingInteractions.delete(interactionId);

  if (interaction.resolver) {
    interaction.resolver(decision);
  }

  return serializeInteraction(interaction);
}

export function listPendingInteractionsForSession(sessionId, filters = {}) {
  const items = [];

  for (const interaction of pendingInteractions.values()) {
    if (sessionId && interaction.sessionId !== sessionId) {
      continue;
    }

    if (filters.provider && interaction.provider !== filters.provider) {
      continue;
    }

    if (filters.kind && interaction.kind !== filters.kind) {
      continue;
    }

    items.push(serializeInteraction(interaction));
  }

  items.sort((left, right) => {
    const leftTime = new Date(left.receivedAt || 0).getTime();
    const rightTime = new Date(right.receivedAt || 0).getTime();
    return leftTime - rightTime;
  });

  return items;
}
