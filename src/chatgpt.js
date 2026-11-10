// App Tools pages are newest first; preserve loaded older turns during polling.
export function mergeChatGPTTurns(current, incoming, { older = false } = {}) {
  const page = [...(incoming || [])].reverse(),
    updated = new Map(page.map((turn) => [turn.id, turn]));
  const existing = new Set(current.map((turn) => turn.id));
  const retained = current.map((turn) => updated.get(turn.id) || turn);
  const added = page.filter((turn) => !existing.has(turn.id));
  return older ? [...added, ...retained] : [...retained, ...added];
}
export function chatGPTBusy(thread) {
  const status = typeof thread?.status === 'string' ? thread.status : thread?.status?.type;
  return ['active', 'running', 'inProgress', 'working', 'in_progress'].includes(status);
}
