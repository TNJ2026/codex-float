import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaWindows,ringQuota} from '../src/usage.js';

test('account windows show remaining quota, duration and reset timestamps',()=>{
 const result=quotaWindows({rateLimits:{primary:{usedPercent:100,windowDurationMins:300,resetsAt:1800000000},secondary:{usedPercent:16,windowDurationMins:10080}}});
 assert.deepEqual(result.map(w=>[w.label,w.remaining]),[['5小时',0],['每周',84]]);
 assert.equal(result[0].resetsAt,1800000000);
 assert.equal(result[1].resetsAt,null);
});
test('ring prefers five-hour quota, including zero remaining, and falls back to weekly quota when absent',()=>{
 const weekly={id:'codex-secondary',windowMinutes:10080,remaining:84};
 const other={id:'other-primary',windowMinutes:300,remaining:50};
 const account={id:'codex-primary',windowMinutes:300,remaining:0};
 assert.equal(ringQuota([weekly,other,account]),account);
 assert.equal(ringQuota([weekly]),weekly);
 assert.equal(ringQuota([weekly,other]),other);
 assert.equal(ringQuota([]),null);
 assert.equal(ringQuota([{windowMinutes:60,remaining:50}]),null);
 const otherWeekly={id:'other-secondary',windowMinutes:10080,remaining:30};
 assert.equal(ringQuota([otherWeekly,weekly]),weekly);
});
test('per-model buckets take priority over the legacy bucket and stay distinct',()=>{
 const window={usedPercent:20,windowDurationMins:60};
 const result=quotaWindows({rateLimits:{primary:window},rateLimitsByLimitId:{a:{limitName:'Model A',primary:window},b:{limitName:'Model B',secondary:window}}});
 assert.equal(result.length,2);
 assert.deepEqual(result.map(w=>w.bucket),['Model A','Model B']);
 assert.notEqual(result[0].id,result[1].id);
});
test('missing data is never reported as zero usage and percentages remain bounded',()=>{
 assert.deepEqual(quotaWindows(null),[]);
 assert.deepEqual(quotaWindows({rateLimits:{primary:{usedPercent:null},secondary:{usedPercent:NaN}}}),[]);
 const result=quotaWindows({rateLimitsByLimitId:{},rateLimits:{primary:{usedPercent:-1},secondary:{usedPercent:110}}});
 assert.deepEqual(result.map(w=>w.remaining),[100,0]);
});
