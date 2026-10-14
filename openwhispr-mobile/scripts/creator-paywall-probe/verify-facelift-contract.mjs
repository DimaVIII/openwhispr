#!/usr/bin/env node
// Evaluate exported provider guards without invoking callbacks or purchases.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/evidence/pro-paywall-facelift-20261014');
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const flatten = root => new Map((function visit(n) { return [n, ...(n.children ?? []).flatMap(visit)]; })(root).map(n => [n.id, n]));
const before = flatten(read('saved-revision-12-tree.json'));
const after = flatten(read(process.argv[2] ?? 'after-tree.json'));
const prop = (tree, id, key) => tree.get(`node:${id}`).properties[key];
const cta = 'pDgcNxc_9Z5d3wt0IqFLe';
const apply = 'B60CBN3z2I4ZhYYqcTq35';
const recovery = '9GmjDdt6iqbDhlzQ9C_RL';
const input = 'state:node.o9Et2gOJEgdSPj0nV1CkE.value';
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
check('all original nodes retained', () => { for (const id of before.keys()) assert(after.has(id), id); });
check('all original actions byte-identical except visible-form recovery', () => {
  for (const [id, node] of before) {
    if (id === `node:${recovery}`) continue;
    for (const [key, value] of Object.entries(node.properties ?? {})) {
      if (key.includes('click-behavior')) assert.deepEqual(after.get(id).properties[key], value, id);
    }
  }
});
check('verified monthly price binding unchanged', () => assert.deepEqual(prop(after,'UP9u1xFiCJUt3enmJAxkn','prop:text'),prop(before,'UP9u1xFiCJUt3enmJAxkn','prop:text')));
check('verified renewal bindings unchanged', () => {
  const old = structuredClone(prop(before,'tnUG_5WOOvvGtnUJQl22T','prop:text'));
  old.options.at(-1).value.value.value = 'Billed monthly';
  assert.deepEqual(prop(after,'tnUG_5WOOvvGtnUJQl22T','prop:text'), old);
});
check('product identities, order and default unchanged', () => assert.deepEqual(read('after-products.json'),read('before-products.json')));
check('authored defaults contain no preview fixtures', () => {
  const old = read('before-variables.json');
  for (const v of read('after-variables.json').data) {
    assert.equal(v.currentValue, null, v.id);
    const prior = old.find(x => x.id === v.id);
    if (v.id === 'state:state.creatorOpen') assert.equal(v.initialValue, true);
    else if (prior) assert.deepEqual(v.initialValue, prior.initialValue, v.id);
  }
});
function matches(q, state) {
  const results = q.rules.map(r => {
    if (r.rules) return matches(r,state);
    const left=state[r.field], right=r.value?.value ?? r.value;
    if (r.operator === '=') return left === right;
    if (r.operator === '!=') return left !== right;
    if (r.operator === 'contains') return typeof left === 'string' && left.includes(right);
    throw new Error(`Unsupported operator: ${r.operator}`);
  });
  return q.combinator === 'or' ? results.some(Boolean) : results.every(Boolean);
}
function resolve(value, state) {
  if (value.type === 'literal') return value.value;
  if (value.type === 'conditional') {
    const option=value.options.find(o=>matches(o.query,state));
    return option ? resolve(option.value,state) : undefined;
  }
  throw new Error(`Unsupported value: ${value.type}`);
}
const base = {
  'state:products.selectedIndex':1, 'state:state.creatorPhase':'empty',
  'state:state.creatorOpen':true, 'state:state.regularMonthlyChosen':false,
  'state:params.creator_offer_ready':false, [input]:'',
};
const actionTypes = (tree, id, state) => (resolve(prop(tree,id,'prop:click-behavior'),state)?.clickActions ?? []).map(x => x.action.type==='request-callback' ? x.action.name : x.action.type);
const cases = [
  ['empty', {}, ['purchase']],
  ['unchecked', {[input]:'EXAMPLE'}, []],
  ['checking', {[input]:'EXAMPLE','state:state.creatorPhase':'checking'}, []],
  ['error with entered code', {[input]:'EXAMPLE','state:state.creatorPhase':'error'}, []],
  ['resolved missing fields', {[input]:'EXAMPLE','state:state.creatorPhase':'resolved'}, []],
  ['seed missing fields', {'state:params.creator_offer_ready':true}, []],
  ['verified callback', {[input]:'EXAMPLE','state:state.creatorPhase':'resolved','state:callbacks.creatorCodeApply.data.priceText':'localized price','state:callbacks.creatorCodeApply.data.renewalText':'verified renewal','state:callbacks.creatorCodeApply.data.offerToken':'fixture'}, ['creatorOfferRedeem']],
  ['verified seed', {'state:params.creator_offer_ready':true,'state:params.creator_offer_price':'localized price','state:params.creator_offer_renewal':'verified renewal','state:params.creator_offer_token':'fixture'}, ['creatorOfferRedeem']],
  ['annual', {'state:products.selectedIndex':0,[input]:'EXAMPLE'}, ['purchase']],
];
for (const [name, patch, expected] of cases) check(`CTA ${name}`,()=>assert.deepEqual(actionTypes(after,cta,{...base,...patch}), expected));
check('empty apply and duplicate checking apply are blocked',()=>{
  assert.deepEqual(actionTypes(after,apply,base),[]);
  assert.deepEqual(actionTypes(after,apply,{...base,[input]:'EXAMPLE','state:state.creatorPhase':'checking'}),[]);
});
check('recovery clears input and keeps new entries guarded',()=>{
  const state={...base,[input]:'EXAMPLE','state:state.creatorPhase':'error'};
  const actions=resolve(prop(after,recovery,'prop:click-behavior'),state).clickActions;
  assert.equal(actions.length,4);
  for(const {action} of actions) { assert.equal(action.type,'set-state'); state[action.stateId]=action.value.value; }
  assert.equal(state[input],''); assert.equal(state['state:state.creatorOpen'],true);
  assert.deepEqual(actionTypes(after,cta,state),['purchase']);
  assert.deepEqual(actionTypes(after,cta,{...state,[input]:'NEW'}),[]);
});
check('readonly applied field uses original complete-offer condition',()=>assert.deepEqual(prop(after,'skK9RyT0oCCmsghH5NBVP','css:display'),prop(before,'WDfx5BKJg1vH77_Elw1ga','css:display')));
check('blue design asset and transparent panels are present',()=>{
  assert(JSON.stringify(prop(after,'47gzotiR1GAS698jtsYEe','css:backgroundImage')).includes('Qk5W_puKFGoJ0Ezp1vSpv.png'));
  assert.equal(prop(after,'mNGRVZn75AHICKdRz1wc9','css:backgroundColor').value.value,'#ffffffd1');
});
for (const phase of ['error','unavailable']) {
  const state={...base,'state:state.creatorPhase':phase};
  assert.deepEqual(actionTypes(before,cta,state),['purchase']);
  assert.deepEqual(actionTypes(after,cta,state),['purchase']);
  console.log(`KNOWN BASELINE GAP: ${phase} + manually empty input permits ordinary purchase; no transaction executed.`);
}
console.log(`${checks} contract checks passed; 2 pre-existing guard gaps remain. This is exported-configuration evidence, not native/storefront acceptance.`);
