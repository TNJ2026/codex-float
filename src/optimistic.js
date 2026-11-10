function sameContent(message, local) {
  const images = message.images || [],
    expected = local.images || [];
  return (
    message.text.trim() === local.text.trim() &&
    images.length === expected.length &&
    expected.every(
      (image, index) => image.src.replaceAll('\\', '/') === images[index].src.replaceAll('\\', '/'),
    )
  );
}
export function hasMessageEcho(remote, local) {
  return remote.some(
    (message) =>
      message.role === 'user' &&
      (message.id === local.id ||
        message.clientMessageId === local.id ||
        (!local.baselineIds.has(message.id) && sameContent(message, local))),
  );
}
export const isSendTimeout = (error) =>
  /thread-follower-(?:start|steer)-turn-timeout|request-timeout|Codex 请求超时/u.test(
    String(error),
  );
export async function waitForMessageEcho(
  read,
  local,
  isCurrent,
  { timeout = 5000, interval = 100 } = {},
) {
  const deadline = Date.now() + timeout;
  while (isCurrent()) {
    if (hasMessageEcho(read(), local)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return false;
}
export function unconfirmedMessages(remote, local) {
  const available = new Set(
    remote
      .map((message, index) => (message.role === 'user' ? index : null))
      .filter((index) => index !== null),
  );
  const matched = new Set();
  const match = (message, exact) => {
    const index = [...available].find((index) => {
      const candidate = remote[index];
      return exact
        ? candidate.id === message.id || candidate.clientMessageId === message.id
        : !message.baselineIds.has(candidate.id) && sameContent(candidate, message);
    });
    if (index !== undefined) {
      available.delete(index);
      matched.add(message);
    }
  };
  for (const message of local) match(message, true);
  for (const message of local) if (!matched.has(message)) match(message, false);
  return local.filter((message) => !matched.has(message));
}
export function mergeOptimisticMessages(remote, local) {
  return [...remote, ...unconfirmedMessages(remote, local)];
}
export function afterMessagePaint() {
  return new Promise((resolve) => {
    // Still send when the panel is hidden and animation frames are suspended.
    const timeout = setTimeout(resolve, 80);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timeout);
        resolve();
      }),
    );
  });
}
