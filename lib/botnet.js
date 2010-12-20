var tls = require('tls');
var path = require('path');
var fs = require('fs');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var protocol = require('./frame-protocol');

var PORT = 8123;
exports.defaultPort = PORT;

var assert = process.assert;

// BotPeer is a foreign bot. Each Bot maintains a set of BotPeer objects
// representing members of the network. There may be zero to many
// connections established with a BotPeer.
// A BotPeer holds various information:
//   - sessionId: a random number choosen by the BotPeer on startup
//   - connections: any TLS connections made with the BotPeer
//   - address: The IP address of the BotPeer
//   - port: If the bot is accepting connections, the port that's on
function BotPeer(bot, sessionId) {
  if (!(this instanceof BotPeer)) return new BotPeer(bot, sessionId);
  EventEmitter.call(this);

  this.bot = bot;
  this.sessionId = sessionId;
  this.connections = [];
  this.address = null;
  this.port = null;
}
util.inherits(BotPeer, EventEmitter);


BotPeer.prototype.addConnection = function(connection) {
  if (connection._botTarget) {
    this.address = connection._botTarget.address;
    this.port = connection._botTarget.port;
  } else {
    this.address = connection.socket.address().address;
  }

  this.connections.push(connection);
};


BotPeer.prototype.removeConnection = function(connection) {
  var i = this.connections.indexOf(connection);
  if (i >= 0) this.connections.splice(i, 1);
};


BotPeer.prototype.send = function(message) {
  for (var i = 0; i < this.connections.length; i++) {
    var c = this.connections[i];
    if (c.state == 'ok' && c.writable) {
      message._seq = this.bot._seq++;
      return c.write(protocol.serialize(message));
    }
  }
  return false;
};


BotPeer.prototype.disconnect = function() {
  for (var i = 0; i < this.connections.length; i++) {
    this.connections[i].destroy();
  }
  this.bot.peers[this.sessionId] = undefined;
  this.bot.emit("disconnect", this);
};


BotPeer.prototype._updateState = function(s) {
  if (!this.address) this.address = s.address;
  if (!this.port) this.port = s.port;
};


function Bot() {
  if (!(this instanceof Bot)) return new Bot();
  EventEmitter.call(this);

  this.state = 'loading';
  this.peers = [];
  this._seq = 0;

  // Choose a large random number. Used to uniquely identify a bot session.
  this.sessionId = Math.round(Math.random() * 99999999);
}
util.inherits(Bot, EventEmitter);


exports.createBot = function(configDir) {
  var bot = new Bot();
  bot.loadConfig(configDir);
  bot.listen();
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


Bot.prototype._onListen = function() {
  this.state = 'listening';
  this.emit('listening');
};


Bot.prototype.listen = function() {
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
    self._initPeerConnection(connection);
  });

  try {
    this.server.listen(PORT, function () { self._onListen(); });
  } catch (e) {
    this.server.close();
    this.server.listen(function () { self._onListen(); });
  }
};


Bot.prototype.connect = function(/* port,  host, cb */) {
  var port = PORT, host = null, cb = null;

  // parse arguments
  if (typeof arguments[0] == 'number') {
    port = arguments[0];
    if (typeof arguments[1] == 'string') {
      host = arguments[1];
      cb = arguments[2];
    } else {
      cb = arguments[1];
    }
  } else if (typeof arguments[0] == 'string') {
    host = arguments[0];
    cb = arguments[1];
  } else {
    cb = arguments[0];
  }


  var options = {
    key: this.key,
    cert: this.cert,
    ca: this.caCert
  };

  var self = this;

  var connection = tls.connect(port, options, function () {
    self._initPeerConnection(connection);
    if (cb) {
      self.once('peerConnect', cb);
    }
  });

  connection._botTarget = { port: port, address: '127.0.0.1' };
};


Bot.prototype._connectPeer = function(peer) {
  if (peer.port && peer.address) {
    this.connect(peer.port, peer.address);
  }
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
      var peer = BotPeer(this, sessionId);
      this.peers[sessionId] = peer;
      peer._updateState(info);

      // Since it's a new peer, attempt to establish a connection
      this._connectPeer(peer);
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
  if (this.server && this.server.fd) a.port = this.server.address().port;
  state[this.sessionId] = a;

  return state;
};


Bot.prototype._sendState = function(peer) {
  peer.send({ state : this._state() });
};


Bot.prototype._initPeerConnection = function(connection) {
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

      // Either use the existing BotPeer object we have for this sessionId or
      // create a new one.
      if (self.peers[sessionId]) {
        peer = self.peers[sessionId];
      } else {
        peer = BotPeer(self, message.sessionId);
        self.peers[sessionId] = peer;
      }

      peer.addConnection(connection);
      connection.state = 'ok';

      self.emit('peerConnect', peer);

      self._sendState(peer);
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


