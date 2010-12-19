var tls = require('tls');
var path = require('path');
var fs = require('fs');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var protocol = require('./frame-protocol');

var assert = process.assert;

// Peer is a foreign bot. Each Bot maintains a set of Peer objects
// representing members of the network. There may be zero to many
// connections established with a Peer.
// A Peer holds various information:
//   - sessionId: a random number choosen by the Peer on startup
//   - connections: any TLS connections made with the Peer
//   - address: The IP address of the Peer
//   - port: If the bot is accepting connections, the port that's on
function Peer(bot, sessionId) {
  if (!(this instanceof Peer)) return new Peer(bot, sessionId);
  EventEmitter.call(this);

  this.bot = bot;
  this.sessionId = sessionId;
  this.connections = [];
  this.address = null;
  this.port = null;
}
util.inherits(Peer, EventEmitter);


Peer.prototype.addConnection = function(connection) {
  if (connection._botTarget) {
    this.address = connection._botTarget.address;
    this.port = connection._botTarget.port;
  } else {
    this.address = connection.socket.address().address;
  }

  this.connections.push(connection);
};


Peer.prototype.removeConnection = function(connection) {
  var i = this.connections.indexOf(connection);
  if (i >= 0) this.connections.splice(i, 1);
};


Peer.prototype.send = function(message) {
  for (var i = 0; i < this.connections.length; i++) {
    var c = this.connections[i];
    if (c.state == 'ok' && c.writable) {
      return c.write(protocol.serialize(message));
    }
  }
  return false;
};


Peer.prototype.disconnect = function() {
  for (var i = 0; i < this.connections.length; i++) {
    this.connections[i].destroy();
  }
  this.bot.peers[this.sessionId] = undefined;
  this.bot.emit("disconnect", this);
};


Peer.prototype._updateState = function(s) {
  if (!this.address) this.address = s.address;
  if (!this.port) this.port = s.port;
};


function Bot() {
  if (!(this instanceof Bot)) return new Bot();
  EventEmitter.call(this);

  this.state = 'loading';
  this.peers = [];

  // Choose a large random number. Used to uniquely identify a bot session.
  this.sessionId = Math.round(Math.random() * 99999999);
}
util.inherits(Bot, EventEmitter);


exports.createBot = function(configDir) {
  var bot = new Bot();
  bot.loadConfig(configDir);
  return bot;
};


Bot.prototype.close = function() {
  for (var sessionId in this.peers) {
    if (this.peers[sessionId]) {
      this.peers[sessionId].disconnect();
    }
  }

  if (this.server) this.server.close();
};


Bot.prototype.loadConfig = function(dir) {
  if (this.state != 'loading') {
    throw new Error('loadConfig() can only be called ' +
                    'directly after constructing a bot');
  }

  var keyFilename = path.join(dir, 'key.pem');
  var certFilename = path.join(dir, 'cert.pem');
  var caCertFilename = path.join(dir, 'ca-cert.pem');
  var knownBotsFilename = path.join(dir, 'known-bots.txt');

  this.key = fs.readFileSync(keyFilename);
  this.cert = fs.readFileSync(certFilename);
  this.caCert = fs.readFileSync(caCertFilename);

  try {
    var knownBots = fs.readFileSync(knownBotsFilename).split('\n');
    this.knownBots = {};
    for (var i = 0; i < knownBots.length; i++) {
      if (knownBots[i].length) {
        this.knownbots[knownBots[i]] = null;
      }
    }
  } catch (e) {
    this.knownBots = {};
    // okay if known-bots.txt does not exist.
  }

  this.state = 'loaded';
};


Bot.prototype.listen = function(port) {
  if (this.state == 'loading') {
    throw new Error('loadConfig() must be called first');
  }

  this.tlsOptions = {
    key: this.key,
    cert: this.cert,
    ca: this.caCert,
    requestCert: true,
    rejectUnauthorized: true
  };

  var self = this;

  this.server = tls.createServer(this.tlsOptions, function (connection) {
    self.initPeerConnection(connection);
  });


  this.server.listen(port, function () {
    self.state = 'listening';
    self.emit('listening');
  });
};


Bot.prototype.connect = function(port, cb) {
  var options = {
    key: this.key,
    cert: this.cert,
    ca: this.caCert
  };

  var self = this;

  var connection = tls.connect(port, options, function () {
    self.initPeerConnection(connection);
    self.once('peerConnect', cb);
  });

  connection._botTarget = { port: port, address: '127.0.0.1' };
};


Bot.prototype.broadcast = function(m) {
  for (var sessionId in this.peers) {
    if (this.peers[sessionId]) {
      this.peers[sessionId].send(m);
    }
  }
};


Bot.prototype._updateState = function(s) {
  for (var sessionId in s) {
    var info = s[sessionId];
    if (!info) continue;

    if (sessionId == this.sessionId) {
      // Update our address as seen by the peer.
      if (!this.address) this.address = info.address;
    } else if (this.peers[sessionId]) {
      // We know this peer. Update the state.
      this.peers[sessionId]._updateState(info);
    } else {
      // We don't know this peer. Add to this.peers
      var peer = Peer(this, sessionId);
      this.peers[sessionId] = peer;
      peer._updateState(info);
    }
  }
};


Bot.prototype._state = function() {
  var state = {};
  for (var sessionId in this.peers) {
    var peer = this.peers[sessionId];
    if (peer) {
      state[sessionId] = { address: peer.address, port: peer.port };
    }
  }

  assert(!state[this.sessionId]);

  var a = { address: this.address };
  if (this.server) a.port = this.server.address().port;
  state[this.sessionId] = a;

  return state;
};


Bot.prototype.initPeerConnection = function(connection) {
  if (!connection.authorized) {
    console.error('unauthorized connect. destroying it.');
    connection.destroy();
    return false;
  }

  var self = this

  connection.write(protocol.serialize({ sessionId: this.sessionId }));
  connection.state = 'sessionIdWait';

  connection.parser = protocol.Parser();

  connection.on('data', function (d) {
    connection.parser.execute(d);
  });

  // Initially we don't know which peer this connection is associated with.
  // We must wait for them to send their sessionId
  var peer, sessionId;

  connection.parser.on('message', function (message) {
    if (message.state) {
      self._updateState(message.state);
      return;
    }

    if (connection.state == 'sessionIdWait' ) {
      // The first message must contain sessionId
      if (!message.sessionId) {
        connection.destroy();
        return;
      }

      sessionId = message.sessionId;

      // Either use the existing Peer object we have for this sessionId or
      // create a new one.
      if (self.peers[sessionId]) {
        peer = self.peers[sessionId];
      } else {
        peer = Peer(self, message.sessionId);
        self.peers[sessionId] = peer;
      }

      peer.addConnection(connection);
      connection.state = 'ok';

      self.emit('peerConnect', peer);

      peer.send({ state : self._state() });
    } else {
      assert(peer);
      assert(sessionId);
      self.emit('message', message, peer);
      peer.emit('message', message);
    }
  });

  connection.parser.on('upgrade', function (type, firstChunk) {
    connection.state = 'upgraded';
    // do something
  });

  connection.on('end', function () {
    if (peer) {
      peer.removeConnection(connection);
    }
  });

  return true;
};


