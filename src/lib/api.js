import { Channel, invoke } from '@tauri-apps/api/core';

// Thin wrappers over the Rust commands so screens can be tested with a mock of this module.
export const detectNode = (nodePath) => invoke('detect_node', { nodePath: nodePath || null });

export function startRun(settings, onEvent) {
  const channel = new Channel();
  channel.onmessage = onEvent;
  return invoke('start_run', { settings, onEvent: channel });
}

export const listRuns = () => invoke('list_runs');
export const readRun = (id) => invoke('read_run', { id });
export const readThreads = (id) => invoke('read_threads', { id });
export const readOutbox = (id) => invoke('read_outbox', { id });
export const queueReply = (id, revision, rootId, text) => invoke('queue_reply', { id, revision, rootId, text });
export const queueDone = (id, revision, rootId) => invoke('queue_done', { id, revision, rootId });
export const editReply = (id, revision, actionId, text) => invoke('edit_reply', { id, revision, actionId, text });
export const discardAction = (id, revision, actionId) => invoke('discard_action', { id, revision, actionId });
export const retryUncertain = (id, revision, actionId, verified) =>
  invoke('retry_uncertain', { id, revision, actionId, verified });

export function pushRun(id, revision, settings, onEvent) {
  const channel = new Channel();
  channel.onmessage = onEvent;
  return invoke('push_run', { id, revision, settings, onEvent: channel });
}

export const copyRun = (id, dest) => invoke('copy_run', { id, dest });
export const deleteRun = (id) => invoke('delete_run', { id });
export const deleteAllRuns = () => invoke('delete_all_runs');
