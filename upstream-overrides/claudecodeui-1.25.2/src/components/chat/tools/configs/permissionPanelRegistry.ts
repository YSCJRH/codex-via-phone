import type { ComponentType } from 'react';
import type { PendingPermissionRequest } from '../../types/types';

export interface PermissionDecision {
  allow?: boolean;
  message?: string;
  rememberEntry?: string | null;
  updatedInput?: unknown;
  action?: string | null;
}

export interface PermissionPanelProps {
  request: PendingPermissionRequest;
  onDecision: (requestIds: string | string[], decision: PermissionDecision) => void;
}

const registry: Record<string, ComponentType<PermissionPanelProps>> = {};

export function registerPermissionPanel(
  toolName: string,
  component: ComponentType<PermissionPanelProps>,
): void {
  registry[toolName] = component;
}

export function getPermissionPanel(
  toolName: string,
): ComponentType<PermissionPanelProps> | null {
  return registry[toolName] || null;
}
