import { getVersion } from '@tauri-apps/api/app';
import { Channel, invoke } from '@tauri-apps/api/core';

// Thin wrappers over the Rust commands so screens can be tested with a mock of this module.
export const appVersion = () => getVersion();
export const detectNode = (nodePath) => invoke('detect_node', { nodePath: nodePath || null });

export function startRun(settings, onEvent) {
  const channel = new Channel();
  channel.onmessage = onEvent;
  return invoke('start_run', { settings, onEvent: channel });
}

export const listRuns = () => invoke('list_runs');
export const readRun = (id) => invoke('read_run', { id });
export const copyRun = (id, dest) => invoke('copy_run', { id, dest });
export const deleteRun = (id) => invoke('delete_run', { id });
export const deleteAllRuns = () => invoke('delete_all_runs');
