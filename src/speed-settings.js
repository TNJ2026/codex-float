import { t } from './i18n.js';
export const fastTier = (model) =>
  (model?.serviceTiers || []).find(
    (tier) =>
      ['fast', 'priority'].includes(tier.id) ||
      ['fast', 'priority'].includes(tier.name?.toLowerCase()),
  )?.id ||
  (model?.additionalSpeedTiers || []).find((id) => ['fast', 'priority'].includes(id)) ||
  null;
export const isFast = (tier) => ['fast', 'priority'].includes(tier);
export const effectiveTier = (tier, model) => tier ?? model?.defaultServiceTier ?? 'default';
export const speedLabel = (tier) =>
  isFast(tier)
    ? t('快速模式')
    : tier === 'ultrafast'
      ? t('极速模式')
      : tier === 'flex'
        ? t('弹性模式')
        : t('标准速度');
