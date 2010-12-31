var assert = require('assert');
var State = require('../lib/gossip').State;

var s1 = new State(1);
s1.set('foo', 'A');
s1.set('bar', 'B');

assert.equal('A', s1.get(1, 'foo'));
assert.equal('B', s1.get(1, 'bar'));

var s2 = new State(2);
s2.set('foo', 'C');
s2.set('bar', 'D');

assert.equal('C', s2.get(2, 'foo'));
assert.equal('D', s2.get(2, 'bar'));
assert.equal(undefined, s2.get(1, 'foo'));
assert.equal(undefined, s2.get(1, 'bar'));

// Do communication:


// 1. Digest
var s1Digest = s1.digest();
var s2Digest = s2.digest();

// 2. Update
var s1Update = s1.update(s2Digest);
var s2Update = s2.update(s1Digest);

// 3. Reconcile
s1.reconcile(s2Update);
s2.reconcile(s1Update);

console.log("s1: ");
console.log(s1);

assert.equal('C', s2.get(2, 'foo'));
assert.equal('D', s2.get(2, 'bar'));
assert.equal('A', s2.get(1, 'foo'));
assert.equal('B', s2.get(1, 'bar'));

assert.equal('A', s1.get(1, 'foo'));
assert.equal('B', s1.get(1, 'bar'));
assert.equal('C', s1.get(2, 'foo'));
assert.equal('D', s1.get(2, 'bar'));
