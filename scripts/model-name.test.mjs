import test from 'node:test';
import assert from 'node:assert/strict';
import {modelDisplayName} from '../src/model.js';

test('desktop labels preserve GPT prefix and normalize suffix capitalization and spacing', () => {
  for (const [slug,label] of [['gpt-6.1-sol','GPT-6.1 Sol'],['gpt-6-astra','GPT-6 Astra'],['gpt-6.1-terra','GPT-6.1 Terra'],['gpt-5.6-luna','GPT-5.6 Luna'],['gpt-reserve','GPT-Reserve'],['gpt-5.1-codex-max','GPT-5.1 Codex Max']]) {
    assert.equal(modelDisplayName(slug), label);
    assert.equal(modelDisplayName(label), label);
  }
});
test('cached names take priority and custom labels remain unchanged', () => {
  const names={'custom-id':'GPT-6.1-Terra','gpt-alias':'Custom Display Name'};
  assert.equal(modelDisplayName('custom-id',names), 'GPT-6.1 Terra');
  assert.equal(modelDisplayName('gpt-alias',names), 'Custom Display Name');
  assert.equal(modelDisplayName('My Custom Model'), 'My Custom Model');
  assert.equal(modelDisplayName(undefined), '');
});
