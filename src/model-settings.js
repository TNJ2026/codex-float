import { t } from './i18n.js';
export const effortLabels = {
  none: '无',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最高',
  ultra: '极高',
};
export const effortLabel = (effort) => t(effortLabels[effort]) || effort || t('默认');
export function supportedEfforts(model) {
  return Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts.filter((option) => typeof option.reasoningEffort === 'string')
    : [];
}
export function effortIndex(model, effort) {
  return Math.max(
    0,
    supportedEfforts(model).findIndex(
      (option) => option.reasoningEffort === (effort || model?.defaultReasoningEffort),
    ),
  );
}
export function effortForModel(model, previous) {
  const options = supportedEfforts(model);
  if (previous && options.some((option) => option.reasoningEffort === previous)) return previous;
  return options.some((option) => option.reasoningEffort === model?.defaultReasoningEffort)
    ? model.defaultReasoningEffort
    : options[0]?.reasoningEffort || '';
}
export function withModelSettings(state, settings) {
  if (!state) return state;
  const effort = settings.reasoningEffort ?? null;
  return {
    ...state,
    latestModel: settings.model,
    latestReasoningEffort: effort,
    latestThreadSettings: { ...state.latestThreadSettings, model: settings.model, effort },
    ...(state.latestCollaborationMode
      ? {
          latestCollaborationMode: {
            ...state.latestCollaborationMode,
            settings: {
              ...state.latestCollaborationMode.settings,
              model: settings.model,
              reasoning_effort: effort,
            },
          },
        }
      : {}),
  };
}
