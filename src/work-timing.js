import { t } from './i18n.js';
const valid = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function turnDurationMs(turn) {
  if (valid(turn?.durationMs)) return turn.durationMs;
  // The app-server protocol defines startedAt/completedAt as Unix seconds.
  if (valid(turn?.startedAt) && valid(turn?.completedAt) && turn.completedAt >= turn.startedAt)
    return (turn.completedAt - turn.startedAt) * 1000;
  return null;
}
export function workDurationLabel(milliseconds) {
  if (!valid(milliseconds)) return t('未提供');
  const seconds = Math.round(milliseconds / 100) / 10,
    hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60),
    rest = Math.round((seconds % 60) * 10) / 10;
  return [
    hours ? t('{0} 小时', [hours]) : null,
    minutes ? t('{0} 分', [minutes]) : null,
    t('{0} 秒', [rest]),
  ]
    .filter(Boolean)
    .join(' ');
}
