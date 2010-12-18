var tls = require('tls');
var path = require('path');
var fs = require('fs');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var protocol = require('../lib/frame-protocol');


function Bot() {
  if (!(this instanceof Bot)) return new Bot();
  EventEmitter.call(this);

  this.state = 'loading';
  this.peers = [];
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

  this.server = tls.createServer(this.tlsOptions, function (c) {
    self._handleConnection(c);
  });


  this.server.listen(port, function () {
    console.error("listening");
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

  var peer = tls.connect(port, options, function () {
    self._addPeer(peer);
    if (cb) cb();
  });
};


Bot.prototype._addPeer = function(peer) {
  if (!peer.authorized) {
    console.error("unauthorized connect. destroying it.");
    peer.destroy();
    return;
  }

  var self = this;

  this.peers.push(peer);

  peer.parser = protocol.Parser();

  peer.on('data', function (d) {
    peer.parser.execute(d);
  });

  peer.parser.on('message', function (msg) {
    self.emit('msg', msg);
  });

  peer.parser.on('upgrade', function (type, firstChunk) {
    // do something
  });

  peer.on('end', function () {
    // Remove from peers array.
    var i = self.peers.indexOf(peer);
    self.peers.splice(i, 1);
  });
};


Bot.prototype.broadcast = function(m) {
  for (var i = 0; i < this.peers.length; i++) {
    this.peers[i].write(protocol.serialize(m));
  }
};


Bot.prototype._handleConnection = function(peer) {
  this._addPeer(peer);
};
