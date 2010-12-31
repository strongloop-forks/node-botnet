//
// http://www.cs.cornell.edu/home/rvr/papers/flowgossip.pdf
// http://wiki.apache.org/cassandra/ArchitectureGossip
//
var assert = process.assert;

function State(id) {
  this._id = id;
  this._version = 0;
  this._states = { };
};
exports.State = State;

// bot.state.set('address', myip);
// bot.state.set('port', myport);
// bot.state.set('heartbeat', new Date());
State.prototype.set = function(key, value) {
  var states = this._states;
  var id = this._id;

  // Update the version, use the new value.
  var version = ++(this._version);

  if (!states[id]) states[id] = {};

  states[id][key] = [value, version];
};


State.prototype.get = function (id, key) {
  var states = this._states;

  if (states[id] && states[id][key]) {
    assert(Array.isArray(states[id][key]));
    return states[id][key][0]; // return value
  }

  // Implicitly return undefined when the key cannot be found.
};


// These are for sending to a peer

State.prototype.digest = function() {
  var digest = [];
  var states = this._states;

  for (var id in states) {
    if (!states[id]) continue;
    // Find the maximum version for this id.
    // TODO This can be done in constant time if we save the version during
    // reconcile() and set().
    var maxVersion = 0;
    for (var key in states[id]) {
      if (!states[id][key]) continue;
      assert(Array.isArray(states[id][key]));
      var version = states[id][key][1];
      if (version > maxVersion) maxVersion = version;
    }

    digest.push([id, maxVersion]);
  }

  return digest;
};


State.prototype.update = function(digest) {
  assert(Array.isArray(digest));
  var states = this._states;

  // For now, just send the entire state. Disregard digest.
  // TODO scuttlebutt

  var update = [];

  for (var id in states) {
    if (!states[id]) continue;

    for (var key in states[id]) {
      if (!states[id][key]) continue;

      var value = states[id][key][0];
      var version = states[id][key][1];

      update.push([id, key, value, version]);
    }
  }

  return update;
};


State.prototype.reconcile = function(update) {
  assert(Array.isArray(update));
  var states = this._states;

  for (var i = 0; i < update.length; i++) {
    assert(Array.isArray(update[i]) && update[i].length == 4);
    var id = update[i][0];
    var key = update[i][1];
    var value = update[i][2];
    var version = update[i][3];

    // Merge information.
    if (!states[id]) states[id] = {};
    if (!states[id][key] || states[id][key][1] < version) {
      states[id][key] = [value, version];
    }

    // Update our version.
    if (id == this._id && version > this._version) {
      this._version = version;
    }
  }
};
