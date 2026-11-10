import { turnsOf, messagesOf } from './model.js';

export function predictionKey(event, text) {
  if (
    !text ||
    event.nativeEvent?.isComposing ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey
  )
    return null;
  return event.key === 'Tab' ? 'accept' : event.key === 'Escape' ? 'dismiss' : null;
}

export function readPredictions(storage) {
  try {
    return storage.getItem('codex-float-predictions') === 'true';
  } catch {
    return false;
  }
}
export function predictionTarget(conversation) {
  const turn = turnsOf(conversation).at(-1);
  if (!turn || turn.status !== 'completed') return null;
  const turnId = turn.turnId || turn.id;
  if (!turnId) return null;
  const messages = messagesOf(conversation).filter(
    (message) => !message.type && message.text?.trim(),
  );
  if (!messages.some((message) => message.turnId === turnId && message.role === 'assistant'))
    return null;
  // Only conversation text is used: no attachment data, tool output, or hidden reasoning.
  let remaining = 16000;
  const context = [];
  for (const message of messages.slice(-12).reverse()) {
    if (remaining <= 0) break;
    const text = message.text.slice(-Math.min(4000, remaining));
    remaining -= text.length;
    context.unshift({ role: message.role, text });
  }
  return { turnId, context };
}
