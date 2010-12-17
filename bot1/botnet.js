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

  var client = this.client = tls.connect(port, options, function () {
    if (!client.authorized) {
      console.error("unauthorized connect. destroying it.");
      client.destroy();
    } else {
      client.parser = protocol.Parser();

      client.on('data', function (d) {
        client.parser.execute(d);
      });

      client.parser.on('message', function (msg) {
        self.emit('msg', msg);
      });

      client.parser.on('upgrade', function (type, firstChunk) {
        // do something
      });

      if (cb) cb();
    }
  });
};


Bot.prototype.send = function(m) {
  this.client.write(protocol.serialize(m));
};


Bot.prototype._handleConnection = function(c) {
  var self = this;

  console.error("connection!");

  c.parser = protocol.Parser();

  c.on('data', function (d) {
    c.parser.execute(d);
  });

  c.parser.on('message', function (msg) {
    self.emit('msg', msg);
  });

  c.parser.on('upgrade', function (type, firstChunk) {
    // do something
  });
};
