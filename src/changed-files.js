const emptyFiles = Object.freeze([]),
  cache = new WeakMap();
const pathKey = (path) => {
  const normalized = path.replaceAll('\\', '/');
  return /^[a-z]:\//iu.test(normalized) ? normalized.toLowerCase() : normalized;
};

export function changedFilesOf(turn) {
  if (turn.status !== 'completed') return emptyFiles;
  if (cache.has(turn)) return cache.get(turn);
  const items = Array.isArray(turn.items)
    ? turn.items
    : Object.values(turn.items?.entitiesByKey || {});
  const files = new Map();
  for (const item of items) {
    if (item.type !== 'fileChange' || item.status !== 'completed' || !Array.isArray(item.changes))
      continue;
    for (const change of item.changes) {
      if (typeof change.path !== 'string' || !change.path) continue;
      const kind = typeof change.kind === 'string' ? change.kind : change.kind?.type;
      if (!['add', 'update', 'delete'].includes(kind)) continue;
      const key = pathKey(change.path),
        previous = files.get(key);
      const diffs =
        typeof change.diff === 'string'
          ? [...(previous?.diffs || []), { kind, path: change.path, text: change.diff }]
          : previous?.diffs;
      const detail = diffs ? { diffs } : {};
      const destination = change.kind?.move_path || change.kind?.movePath;
      if (kind === 'update' && typeof destination === 'string' && destination) {
        files.delete(key);
        files.set(pathKey(destination), {
          path: destination,
          kind: previous?.kind === 'add' ? 'add' : 'rename',
          previousPath:
            previous?.kind === 'add' ? undefined : previous?.previousPath || change.path,
          ...detail,
        });
      } else if (kind === 'delete') {
        if (previous?.kind === 'add') files.delete(key);
        else if (previous?.kind === 'rename') {
          files.delete(key);
          files.set(pathKey(previous.previousPath), {
            path: previous.previousPath,
            kind: 'delete',
            ...detail,
          });
        } else files.set(key, { path: change.path, kind: 'delete', ...detail });
      } else {
        const nextKind =
          previous?.kind === 'add'
            ? 'add'
            : previous?.kind === 'rename'
              ? 'rename'
              : kind === 'add' && !previous
                ? 'add'
                : 'update';
        files.set(key, { ...previous, path: change.path, kind: nextKind, ...detail });
      }
    }
  }
  const result = files.size
    ? [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
    : emptyFiles;
  cache.set(turn, result);
  return result;
}

export function fileLabel(path, cwd = '') {
  const normalized = path.replaceAll('\\', '/'),
    base = cwd.replaceAll('\\', '/').replace(/\/$/u, '');
  const relative =
    base && pathKey(normalized).startsWith(pathKey(base) + '/')
      ? normalized.slice(base.length + 1)
      : normalized;
  return { name: normalized.split('/').at(-1), relative };
}
