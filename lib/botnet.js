var tls = require('tls');
var path = require('path');
var fs = require('fs');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var protocol = require('./frame-protocol');


function Peer(bot, sessionId, connection) {
  if (!(this instanceof Peer)) return new Peer(bot, sessionId, connection);
  EventEmitter.call(this);

  this.bot = bot;
  this.sessionId = sessionId;

  this.connection = connection;
  connection.state = 'ok';
  connection.peer = this;
  this.cert = connection.getPeerCertificate();
}
util.inherits(Peer, EventEmitter);


Peer.prototype.send = function(message) {
  if (this.connection) {
    this.connection.write(protocol.serialize(message));
  }
};


Peer.prototype.disconnect = function() {
  this.bot.peers[this.sessionId] = undefined;
  this.bot.emit("disconnect", this);
};


function Bot() {
  if (!(this instanceof Bot)) return new Bot();
  EventEmitter.call(this);

  this.state = 'loading';
  this.peers = [];

  // Choose a large random number. Used to uniquely identify a bot session.
  this.sessionId = Math.round(Math.random() * 999999999999);
}
util.inherits(Bot, EventEmitter);


exports.createBot = function(configDir) {
  var bot = new Bot();
  bot.loadConfig(configDir);
  return bot;
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
    self.address = self.server.address();
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
};


Bot.prototype.broadcast = function(m) {
  for (var sessionId in this.peers) {
    if (this.peers[sessionId]) {
      this.peers[sessionId].send(m);
    }
  }
};


Bot.prototype.initPeerConnection = function(connection, isServer) {
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

  connection.parser.on('message', function (msg) {
    self._handleMessage(connection, msg);
  });

  connection.parser.on('upgrade', function (type, firstChunk) {
    // do something
  });

  connection.on('end', function () {
    if (connection.peer) {
      connection.peer.disconnect();
    }
  });

  return true;
};


Bot.prototype._newPeer = function(sessionId, connection) {
  var peer = Peer(this, sessionId, connection);
  this.peers[sessionId] = peer;
  this.emit('peerConnect', peer);
  return peer;
};


Bot.prototype._handleMessage = function(connection, message) {
  if (connection.state == 'sessionIdWait' ) {
    // The first message must contain sessionId
    if (!message.sessionId) {
      connection.destroy();
      return;
    }

    this._newPeer(message.sessionId, connection);
  } else {
    this.emit('message', message, connection.peer);
    connection.peer.emit('message', message);
  }
};


