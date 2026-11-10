export function orderedItems(turn) {
  if (Array.isArray(turn.items)) return turn.items;
  const entities = turn.items?.entitiesByKey || {},
    keys = turn.items?.islands?.flatMap((island) => island.entries.map((entry) => entry.value));
  return keys
    ? [...new Set(keys)].map((key) => entities[key]).filter(Boolean)
    : Object.values(entities);
}
const text = (value) => (typeof value === 'string' ? value : '');
const status = (value) =>
  value === 'completed'
    ? 'completed'
    : ['inProgress', 'in_progress'].includes(value)
      ? 'inProgress'
      : value === 'pending'
        ? 'pending'
        : 'unknown';
export function taskDetailMessage(item, turn, items, index, turnKey) {
  const completed = Array.isArray(turn.completedItemIds)
    ? turn.completedItemIds.includes(item.id)
    : turn.completedItemIds?.[item.id] === true;
  const active =
    turn.status === 'inProgress' &&
    !completed &&
    item.status !== 'completed' &&
    index === items.length - 1;
  const base = {
    id: item.id || `task-item:${turnKey}:${index}`,
    role: 'assistant',
    text: '',
    images: [],
    turnStatus: turn.status,
    active,
  };
  if (item.type === 'reasoning') {
    // Only render the supplied public summary. Never use raw reasoning content as a fallback.
    const summary = (Array.isArray(item.summary) ? item.summary : [item.summary])
      .filter((value) => typeof value === 'string' && value.trim())
      .join('\n\n');
    return summary ? { ...base, type: 'reasoningSummary', text: summary } : null;
  }
  if (item.type === 'plan')
    return text(item.text).trim() ? { ...base, type: 'proposedPlan', text: item.text } : null;
  if (item.type === 'todo-list') {
    const plans = items.filter((entry) => entry.type === 'todo-list');
    if (item !== plans[0]) return null;
    const latest = plans.at(-1),
      steps = (Array.isArray(latest.plan) ? latest.plan : [])
        .filter((entry) => text(entry?.step).trim())
        .map((entry) => ({ text: entry.step, status: status(entry.status) }));
    if (!steps.length) return null;
    return {
      ...base,
      id: `task-plan:${turnKey}`,
      type: 'taskPlan',
      active: turn.status === 'inProgress',
      steps,
      explanation: text(latest.explanation),
    };
  }
  return null;
}
