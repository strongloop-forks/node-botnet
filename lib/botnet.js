var tls = require('tls');
var path = require('path');
var fs = require('fs');
var net = require('net');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var protocol = require('./frame-protocol');
var State = require('./gossip').State;

var PORT = 8123;
exports.defaultPort = PORT;

// Number of ms to wait before trying to gossip with a peer again.
exports.GOSSIP_INTERVAL = 1000;
// Number of ms to heartbeat
exports.HEARTBEAT_INTERVAL = 5 * 1000;
// Number of ms check for peers that haven't heartbeated.
exports.PEER_TIMEOUT = 10 * 1000;

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
  this._messageQueue = [];
}
util.inherits(BotPeer, EventEmitter);

BotPeer.prototype.part = function() {
  this._part = true;
  this.disconnect();
};


BotPeer.prototype.address = function() {
  var host = this.bot._state.get(this.sessionId, 'host');
  var port = this.bot._state.get(this.sessionId, 'port');
  var a = {};
  if (host) a.host = host;
  if (port) a.port = port;
  return a;
};


BotPeer.prototype.addConnection = function(connection) {
  if (this._part) return false;

  if (!connection.writable) return;
  if (connection.state == 'ok') {
    this._establishing = false;
  }
  this.connections.push(connection);

  var self = this;
  connection.on('close', function() {
    // Remove connection from list
    var i = self.connections.indexOf(connection);
    if (i >= 0) self.connections.splice(i, 1);
  })
};


BotPeer.prototype._establishConnection = function() {
  if (this._part) return false;

  var self = this;
  // First check if we have an establishing connection
  for (var i = 0; i < this.connections.length; i++) {
    var c = this.connections[i];
    if (c.state == 'establishing') return;
  }

  if (!this._establishing) {
    this._establishing = true;
    var a = this.address();
    var c = this.bot.connect(a.port, a.host, function (err) {
      this._establishing = false;

      if (err) {
        console.error("BotPeer error %s", err.message);
        setTimeout(function() {
          self._establishConnection();
        }, 1000);
      } else {
        var m;
        while (m = self._messageQueue.shift()) {
          self.send(m);
        }
      }
    });
  }
};


BotPeer.prototype.send = function(message) {
  if (this._part) return false;

  // TODO ack each message?
  for (var i = 0; i < this.connections.length; i++) {
    var c = this.connections[i];
    if (c.state == 'ok' && c.writable) {
      return c.write(protocol.serialize(message));
    }
  }

  // If there was no connection available then we queue the message and
  // attempt to establish one.
  this._messageQueue.push(message);
  this._establishConnection();

  return false;
};


BotPeer.prototype.shellClose = function(cb) {
  for (var i = 0; i < this.connections.length; i++) {
    var c = this.connections[i];
    if (c.state == 'shell') {
      c.destroy();
      break;
    }
  }
};


BotPeer.prototype.shellSendWindowSize = function(fd) {
  var winsize = require('tty').getWindowSize(fd);
  this.send({ cmd: 'winsize', size: winsize });
};


BotPeer.prototype.shellSetWindowSize = function(size) {
  for (var i = 0; i < this.connections.length; i++) {
    var c = this.connections[i];
    if (c.state != 'shell') break;
    console.error('set window size %d: %j', c.shellStream.fd, size);
    require('tty').setWindowSize(c.masterFD, size[0], size[1]);
  }
};


BotPeer.prototype.shell = function(cb) {
  for (var i = 0; i < this.connections.length; i++) {
    var c = this.connections[i];
    if (c.state == 'ok' && c.writable) {
      c.write("upgrade: shell\r\n");
      c.state = 'shellUpgradeReq';
      this.once('shell', cb);
      return;
    }
  }
};


BotPeer.prototype.disconnect = function() {
  this._messageQueue = [];
  for (var i = 0; i < this.connections.length; i++) {
    this.connections[i].destroy();
  }
  this.bot.peers[this.sessionId] = undefined;
  this.bot.emit("disconnect", this);
};


function Bot() {
  if (!(this instanceof Bot)) return new Bot();
  EventEmitter.call(this);

  this.peers = {};

  // Choose a large random number. Used to uniquely identify a bot session.
  this.sessionId = Math.round(Math.random() * 99999999);
  this._state = new State(this.sessionId);

  // key: sessionId
  // value: boolean if timed out
  this._parts = {};

  self = this;

  this._gossipInterval = setInterval(function() {
    self._onGossip();
  }, exports.GOSSIP_INTERVAL);

  this._heartbeatInterval = setInterval(function() {
    self._onHeartbeat();
  }, exports.HEARTBEAT_INTERVAL);
}
util.inherits(Bot, EventEmitter);


exports.createBot = function(configDir) {
  var bot = new Bot();
  bot.loadConfig(configDir);
  bot.listen();
  return bot;
};


Bot.prototype._onGossip = function() {
  var peerIds = Object.keys(this.peers);
  if (peerIds.length == 0) return;

  var i = Math.floor(Math.random() * peerIds.length);
  assert(0 <= i && i < peerIds.length);
  var id = peerIds[i];
  var peer = this.peers[id];

  if (!peer) return;

  // Start gossip
  peer.send({
    cmd: 'gossip0',
    digest: this._state.digest()
  });
};


Bot.prototype._onHeartbeat = function() {
  var self = this;

  // Update our own heartbeat.
  this._state.set('heartbeat', Date.now());

  // Now walk through all of our peers, we haven't heard from them in
  // PEER_TIMEOUT milliseconds then consider them gone.

  var now = new Date();
  var ids = this._state.ids();

  for (var i in ids) {
    var sessionId = ids[i];
    if (self._parts[sessionId]) continue;

    // create self.peers[sessionId] if it doesn't exist?

    if (self.peers[sessionId]) {
      var peer = this.peers[sessionId];
      var heartbeat = this._state.get(sessionId, 'heartbeat');

      if (heartbeat != peer.lastHeartbeatValue) {
        peer.lastHeartbeatValue = heartbeat;
        peer.lastHeartbeat = new Date();
      }

      // They haven't updated in 30 seconds
      if (now - peer.lastHeartbeat > exports.PEER_TIMEOUT) {
        self._parts[sessionId] = true;
        peer.part();
        self.emit('part', peer);
      }
    }
  }
};


Bot.prototype.close = function() {
  for (var sessionId in this.peers) {
    if (this.peers[sessionId]) {
      this.peers[sessionId].disconnect();
    }
  }

  if (this._gossipInterval) {
    clearInterval(this._gossipInterval);
    this._gossipInterval = null;
  }

  if (this._heartbeatInterval) {
    clearInterval(this._heartbeatInterval);
    this._heartbeatInterval = null;
  }

  if (this.server) this.server.close();
};


Bot.prototype.loadConfig = function(dir) {

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
};


Bot.prototype._onListen = function() {
  var a = this.server.address();
  this._state.set('port', a.port);

  this.emit('listening');
};


Bot.prototype.listen = function() {
  this.tlsOptions = {
    key: this.key,
    cert: this.cert,
    ca: this.caCert,
    requestCert: true,
    rejectUnauthorized: true
  };

  var self = this;

  this.server = tls.createServer(this.tlsOptions, function (connection) {
    self._initPeerConnection(connection, true);
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
  var established = false;

  var connection = tls.connect(port, options, function () {
    established = true;
    self._initPeerConnection(connection, false, cb);
  });

  connection.on('error', function (e) {
    if (established) {
      console.error("Error establishing bot connection: %s", e.message);
    } else {
      if (cb) cb(e);
    }
  });
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


Bot.prototype._assignConnectionToPeer = function(sessionId, c) {
  var peer;

  // Either use the existing BotPeer object we have for this sessionId or
  // create a new one.
  if (this.peers[sessionId]) {
    peer = this.peers[sessionId];
  } else {
    peer = new BotPeer(this, sessionId);
    this.peers[sessionId] = peer;
  }

  peer.addConnection(c);
  this.emit('peerConnect', peer);
  return peer;
};


Bot.prototype._sendIdent = function(connection) {
  connection.write(protocol.serialize({
    cmd: 'ident',
    yourAddress: connection.socket.remoteAddress, // primitive NAT piercing
    sessionId: this.sessionId,
  }));
};


Bot.prototype._sendGossip0 = function(connection) {
  connection.write(protocol.serialize({
    cmd: 'gossip0',
    digest: this._state.digest()
  }));
};


Bot.prototype._initPeerConnection = function(connection, isServerSide, cb) {
  if (!connection.authorized) {
    console.error('unauthorized connect. destroying it.');
    connection.destroy();
    return false;
  }

  var self = this


  connection.parser = protocol.Parser();

  connection.on('data', function ondata (d) {
    if (connection.upgradedIn) {
      connection.removeListener('data', ondata);
    } else {
      connection.parser.execute(d);
    }
  });

  // Initially we don't know which peer this connection is associated with.
  // We must wait for them to send their sessionId
  var peer;

  // Both sides ident first.
  self._sendIdent(connection);

  // Server-side starts gossip
  if (isServerSide) {
    self._sendGossip0(connection);
  }


  // The connection gets 2 seconds to recv a ident message
  // otherwise fail.
  var identTimer = setTimeout(function () {
    var e = new Error("Did not recv ident. Disconnecting.");
    if (cb) cb(e);
    connection.destroy(e);
  }, 2000);


  connection.parser.on('message', function (message) {
    switch (message.cmd) {
      case 'ident':
        if (identTimer) {
          clearTimeout(identTimer);
          identTimer = null;
        }

        connection.state = 'ok';

        if (!self._state.get(self.sessionId, 'host')) {
          self._state.set('host', message.yourAddress);
        }

        if (!peer) {
          peer = self._assignConnectionToPeer(message.sessionId,
                                              connection);
        }

        if (cb) cb(null, peer);
        break;

      case 'gossip0':
        if (!message.digest) {
          connection.destroy();
          console.error('gossip0 without digest');
          return;
        }

        var update = self._state.update(message.digest);

        peer.send({
          cmd: 'gossip1',
          digest: self._state.digest(),
          update: update
        });
        break;

      case 'gossip1':
        if (!message.digest || !message.update) {
          connection.destroy();
          console.error('gossip1 without digest or update');
          return;
        }

        if (!peer) {
          peer = self._assignConnectionToPeer(message.sessionId,
                                              connection);
        }

        if (!self._state.get(self.sessionId, 'host')) {
          self._state.set('host', message.yourAddress);
        }

        self._state.reconcile(message.update);
        self.emit('gossip');

        var update = self._state.update(message.digest);
        peer.send({
          cmd: 'gossip2',
          update: update
        });
        break;

      case 'gossip2':
        if (!message.update) {
          connection.destroy();
          console.error('gossip2 without update');
          return;
        }

        self._state.reconcile(message.update);
        self.emit('gossip');
        break;

      case 'shellClose':
        peer.shellClose();
        break;

      case 'winsize':
        peer.shellSetWindowSize(message.size);
        break;

      default:
        assert(peer);
        self.emit('message', message, peer);
        peer.emit('message', message);
        break;
    }
  });

  connection.parser.on('upgrade', function (type, firstChunk) {
    assert(type == 'shell'); // TODO: other types

    assert(!connection.upgradedIn);
    connection.upgradedIn = true;

    if (connection.state == 'shellUpgradeReq') {
      // We've already sent our upgrade. They now have just replied with
      // their upgrade. We're ready to start shelling!

      connection.state = 'shell';
      peer.emit('shell', connection, firstChunk);

    } else if (connection.state == 'ok') {
      // They are requesting that we shell with them. For now always accept.
      connection.write('upgrade: shell\r\n');
      connection.state = 'shell';

      // start openpty
      var a = require('tty').open(process.env.SHELL || '/bin/bash');

      var stream = a[0];
      var child = a[1];
      var masterFD = a[2];

      child.on('exit', function () {
        console.error("tty exit");
        connection.destroy();
      });
      console.error("Started bash subprocess. Slave FD: %d", stream.fd);

      if (firstChunk && firstChunk.length) {
        stream.write(firstChunk);
      }
      stream.pipe(connection);

      connection.shellStream = stream;
      connection.masterFD = masterFD;

      // XXX Doing this because you can't shutdown() a tty stream,
      // apparently.
      connection.pipe(stream, { end: false });

      connection.on('end', function () {
        stream.destroy();
        connection.end();
        child.kill();
      });

    } else {
      // We're in some other state. destroy it.
      connection.destroy();
    }
  });

  return true;
};


