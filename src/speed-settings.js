export const fastTier=model=>(model?.serviceTiers||[]).find(tier=>['fast','priority'].includes(tier.id)||['fast','priority'].includes(tier.name?.toLowerCase()))?.id||(model?.additionalSpeedTiers||[]).find(id=>['fast','priority'].includes(id))||null;
export const isFast=tier=>['fast','priority'].includes(tier);
export const effectiveTier=(tier,model)=>tier??model?.defaultServiceTier??'default';
export const speedLabel=tier=>isFast(tier)?'快速模式':tier==='ultrafast'?'极速模式':tier==='flex'?'弹性模式':'标准速度';
