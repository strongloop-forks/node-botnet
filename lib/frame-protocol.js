/*
   A simple new-line delimited JSON protocol with upgrades.

   Receiving Usage:

     protocol = require('./frame-protocol');

     // parsing data
     parser = protocol.Parser();

     parser.on('message', function (msg) {
       // handle message
     });

     parser.on('upgrade', function (type, firstChunk) {
       // handle upgrade
     });

     socket.on('data', function (d) {
       parser.execute(d);
     });


   Sending Usage:

     protocol = require('./frame-protocol');
     socket.write(protocol.serialize({"hello": "world"}));

*/
var StringDecoder = require("string_decoder").StringDecoder;
var events = require('events');
var util = require('util');

function Parser () {
  if (!(this instanceof Parser)) return new Parser();
  events.EventEmitter.call(this);

  this.decoder = new StringDecoder('utf8');
  this.state = 'JSON'
  this.stringBuffer = '';
}
util.inherits(Parser, events.EventEmitter);
exports.Parser = Parser;

function char (c) {
  return c.charCodeAt(0);
}


Parser.prototype._emitMessage = function (d, i) {
  //console.error("i: %d", i);
  //console.error("start: %d", this._start);
  //console.error("stringBuffer: %s", util.inspect(this.stringBuffer));
  //console.error("d.slice: %s", util.inspect(d.slice(this._start, i).toString()));
  var s = this.stringBuffer +
          this.decoder.write(d.slice(this._start, i));
  // Remove any newline characters.
  s = s.replace(/[\r\n]/g, '');

  if (s.length) {
    try {
      var msg = JSON.parse(s);
    } catch (e) {
      this._emitError(d, i, 'problem parsing json ' + util.inspect(s));
      return;
    }

    this.emit('message', msg);
  }

  this.stringBuffer = '';
  this.state = 'JSON_START';
};


Parser.prototype._emitUpgrade = function (d, i) {
  var type = this.stringBuffer +
             this.decoder.write(d.slice(this._start, i));
  type = type.replace(/[\r\n]/, '');

  var rest = d.slice(i+1);

  this.emit('upgrade', type, rest);


  // if execute() is called again, emit error.
  this.state = 'ERROR';
};


Parser.prototype._emitError = function (d, i, msg) {
  this.emit('error',
    new Error('parse error ' + (msg || '') + ' <' + util.inspect(d.toString()) + '>'));
  this.state = 'ERROR';
};


Parser.prototype.execute = function (d) {
  this._start = 0;

  // Biggest length for stringBuffer is 65mb. That should be enough.
  if (this.stringBuffer.length >= 65*1024*1024) {
    this._emitError(d, 0);
    return;
  }

  for (var i = 0; i < d.length; i++) {
    //console.error(this.state);
    switch (this.state) {
      case 'JSON_START':
        this._start = i;
        this.stringBuffer = '';
        this.state = d[i] == char('u') ? 'UP' : 'JSON';
        break;

      case 'JSON':
        if (d[i] == char('\r')) {
          this.state = 'JSON_LF';
        } else if (d[i] == char('\n')) {
          this._emitMessage(d, i);
        }
        break;

      case 'JSON_LF':
        if (d[i] != char('\n')) {
          this._emitError(d, i, "expected \\n got " + String.fromCharCode(d[i]));
        } else {
          this._emitMessage(d, i);
        }
        break;

      case 'UP':
        this.state = d[i] == char('p') ? 'UPG' : 'JSON';
        break;

      case 'UPG':
        this.state = d[i] == char('g') ? 'UPGR' : 'JSON';
        break;

      case 'UPGR':
        this.state = d[i] == char('r') ? 'UPGRA' : 'JSON';
        break;

      case 'UPGRA':
        this.state = d[i] == char('a') ? 'UPGRAD' : 'JSON';
        break;

      case 'UPGRAD':
        this.state = d[i] == char('d') ? 'UPGRADE' : 'JSON';
        break;

      case 'UPGRADE':
        this.state = d[i] == char('e') ? 'UPGRADE_COLON' : 'JSON';
        break;

      case 'UPGRADE_COLON':
        this.state = d[i] == char(':') ? 'UPGRADE_COLON_SPACE' : 'JSON';
        break;

      case 'UPGRADE_COLON_SPACE':
        if (d[i] == char(' ')) {
          this.state = 'UPGRADE_TYPE_START';
        } else if ((char('a') <= d[i] || char('z') <= d[i]) ||
                   (char('A') <= d[i] || char('Z') <= d[i])) {
          // first char of type must be ascii letter
          this._start = i;
          this.stringBuffer = '';
          this.state = 'UPGRADE_TYPE';
        } else {
          this._emitError(d, i);
        }
        break;

      case 'UPGRADE_TYPE_START':
        this._start = i;
        this.stringBuffer = '';
        if (d[i] == char(' ')) {
          ;
        } else if ((char('a') <= d[i] || char('z') <= d[i]) ||
                   (char('A') <= d[i] || char('Z') <= d[i])) {
          // first char of type must be ascii letter
          this.state = 'UPGRADE_TYPE';
        } else {
          this._emitError(d, i);
        }
        break;

      case 'UPGRADE_TYPE':
        if (d[i] == char('\r')) {
          this.state = 'UPGRADE_LF';
        } else if (d[i] == char('\n')) {
          this._emitUpgrade(d, i);
          return;
        }
        break;

      case 'UPGRADE_LF':
        if (d[i] != char('\n')) {
          this._emitError(d, i);
        }  else  {
          this._emitUpgrade(d, i);
          return;
        }
        break;


      case 'ERROR':
        this._emitError(d, i, "error state");
        return;

      default:
        throw new Error("Unknown state '" + this.state + "'");
    }
  }

  if (this._start != i) {
    // We should store the rest of the string.
    this.stringBuffer += this.decoder.write(d.slice(this._start, i));
  }
};


exports.serialize = function (message) {
  return JSON.stringify(message) + "\r\n";
};
