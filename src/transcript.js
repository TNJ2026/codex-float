const normalCommentary = (message) =>
  message.role === 'assistant' &&
  !message.type &&
  message.phase === 'commentary' &&
  message.delivery !== 'async' &&
  !message.aeonSentMessage;
const realUser = (message) =>
  message.role === 'user' &&
  !message.pending &&
  message.deliveryStatus !== 'not-sent' &&
  message.steeringStatus !== 'pending' &&
  !message.hookFeedback &&
  !message.heartbeatTrigger &&
  !message.codexDelegation;
const needsAttention = (message) =>
  message.type === 'subagentProgress' &&
  (message.errors?.length ||
    message.agents?.some((agent) => ['errored', 'notFound'].includes(agent.status)));

// Match the desktop compact transcript rules for the item types this panel renders.
// Keep the original messages intact so expanding work never reconstructs or deletes history.
export function transcriptMessages(messages) {
  const protectedIds = new Set(),
    turns = new Map(),
    latestLiveTools = new Map();
  let previousCommentary = null;
  for (const message of messages) {
    if (message.type === 'toolDetails' && message.turnStatus === 'inProgress')
      latestLiveTools.set(message.turnId, message);
    if (realUser(message)) {
      if (previousCommentary) protectedIds.add(previousCommentary.id);
      previousCommentary = null;
    } else if (message.role === 'assistant' && !message.type)
      previousCommentary = normalCommentary(message) ? message : null;
    if (!message.turnId) continue;
    const turn = turns.get(message.turnId) || { hasAnswer: false, lastCommentary: null };
    if (normalCommentary(message)) turn.lastCommentary = message;
    else if (
      message.role === 'assistant' &&
      !message.type &&
      message.phase !== 'commentary' &&
      (message.hasStructuredOutput ||
        message.images?.length ||
        (message.text?.trim() && message.text.trim() !== 'done'))
    )
      turn.hasAnswer = true;
    turns.set(message.turnId, turn);
  }
  for (const turn of turns.values())
    if (!turn.hasAnswer && turn.lastCommentary) protectedIds.add(turn.lastCommentary.id);
  const result = [];
  let work = [];
  const flush = () => {
    if (!work.length) return;
    result.push({
      id: `work:${work[0].turnId}:${work[0].id}`,
      type: 'workSummary',
      role: 'assistant',
      text: '',
      images: [],
      turnId: work[0].turnId,
      turnStatus: work[0].turnStatus,
      turnDurationMs: work[0].turnDurationMs,
      workMessages: work,
    });
    work = [];
  };
  for (const message of messages) {
    if (
      message.type === 'toolDetails' &&
      message.turnStatus === 'inProgress' &&
      latestLiveTools.get(message.turnId) !== message
    )
      continue;
    const compact = message.turnStatus === 'completed';
    if (message.type === 'toolHistory' && message.turnStatus !== 'inProgress') continue;
    if (
      compact &&
      message.role === 'assistant' &&
      !message.type &&
      message.phase === 'final_answer' &&
      message.delivery !== 'async' &&
      !message.aeonSentMessage &&
      !message.hasStructuredOutput &&
      message.text?.trim() === 'done'
    )
      continue;
    const ended = ['completed', 'failed', 'interrupted', 'cancelled', 'canceled'].includes(
      message.turnStatus,
    );
    const hidden =
      (ended && message.type === 'toolDetails') ||
      (compact &&
        !needsAttention(message) &&
        ((normalCommentary(message) && !protectedIds.has(message.id)) ||
          ['taskPlan', 'subagentProgress'].includes(message.type)));
    if (hidden) {
      if (work.length && work[0].turnId !== message.turnId) flush();
      work.push(message);
    } else {
      flush();
      result.push(message);
    }
  }
  flush();
  return result;
}
