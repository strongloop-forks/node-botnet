var botnet = exports
  , util = require("util")
  , net = require("net")
  , events = require("events")
  , EventEmitter = events.EventEmitter

botnet.createBot = createBot
botnet.Bot = Bot
function createBot (host, port) { return new Bot(host, port) }
function Bot (port, host) {
  console.log("new bot on "+host+":"+port)
  EventEmitter.call(this)
  var self = this
  this.server = net.createServer(function (conn) {
    self.handleConnection(conn)
  })
  this.server.listen(port, host)
  this.port = port
  this.host = host
  this.peers = []
  this.emit("alive")
  setInterval(function () { self.heartbeat() }, 1000)
  self.on("heartbeat", function () {
    console.log(self + " ["+self.peers.map(function (p) { return p+""})+"]")
  })
}
util.inherits(Bot, EventEmitter)
Bot.prototype.constructor = Bot
Bot.prototype.heartbeat = function () {
  this.peers.forEach(function (p) {
    p.send({cmd:"hi",host:this.host,port:this.port})
  })
  this.emit("heartbeat")
}
Bot.prototype.join = function (p, h) {
  console.log(this+" joining "+[p, h])
  // either port,host or a bot object
  if (typeof p === "object") {
    h = p.host
    p = p.port
  }
  if (isNaN(p)) return this.emit("error", new Error(
    "Invalid port: "+p))
  p = +p
  for (var peers = this.peers, l = peers.length, i = 0; i < l; i ++) {
    var peer = peers[i]
    if (peer.port === p && peer.host === h) {
      console.log(this + " Already connected to "+h+":"+p)
      return
    }
  }
  var connection = net.createConnection(p, h)
    , self = this
  connection.on("connect", function () {
    var peer = new BotPeer(p, h, connection)
    self.introduce(peer)
    self.emit("newPeer", peer)
    self.peers.push(peer)
  })
  connection.on("close", function () {
    if (connection._peer) self.removePeer(connection._peer)
  })
}
Bot.prototype.introduce = function (peer) {
  peer.send({cmd:"intro", host:this.host, port:this.port})
}
Bot.prototype.handleConnection = function (conn) {
  // a peer attempting to introduce itself.
  conn = LineStream(conn)
  conn._provisional = true
  var self = this
  conn.on("data", function (line) {
    self.handleMessage(conn, line)
  })
}
Bot.prototype.kill = function (conn, reason) {
  console.error(reason)
  conn.write(reason)
  conn.end()
  if (conn._peer) this.removePeer(conn._peer)
}
Bot.prototype.removePeer = function (peer) {
  var i = this.peers.indexOf(peer)
  if (i === -1) return
  this.peers.splice(i, 1)
}
Bot.prototype.handleMessage = function (conn, message) {
  try {
    message = JSON.parse(message)
  } catch (ex) {
    return this.kill(conn,"Invalid JSON message: "+message)
  }
  // if it's provisional, then we're waiting on introduction
  if (conn._provisional) {
    if (message.cmd === "intro" && message.port && message.host) {
      var p = new BotPeer(message.port, message.host, conn)
      conn._provisional = false
      this.emit("newPeer", p)
      this.peers.push(p)
      conn._peer = p
      return
    } else {
      return this.kill(conn, "Invalid introduction message "
                       +JSON.stringify(message))
    }
  }
  if (message.cmd === "join") {
    if (isNaN(message.port)) {
      return this.kill(conn, "Invalid port: "+message.port)
    }
    return this.join(message.port, message.host)
  }
}
Bot.prototype.toString = function () {
  return "Bot <"+this.host+":"+this.port+">"
}
function LineStream (conn) {
  var s = new events.EventEmitter
  ;["end", "close", "pause", "resume", "error"].forEach(function (ev) {
    conn.on(ev, function () {
      s.emit.apply(s, [ev].concat(Array.prototype.slice.call(arguments)))
    })
  })
  ;["end", "close", "write", "pause", "resume", "close", "destroy"]
    .forEach(function (m) {
      s[m] = function () { conn[m].apply(conn, arguments) }
    })
  var b = ""
  conn.on("data", function (c) {
    var lines = (b + c).split("\n")
    b = lines.pop()
    if (b.length > 16*1024) {
      s.emit("error", new Error("message too large"))
      b = ""
    }
    lines.forEach(function (l) { s.emit("data", l+"\n") })
  })
  return s
}
function BotPeer (port, host, connection) {
  this.port = port
  this.host = host
  this.connection = connection
  connection._peer = this
}
BotPeer.prototype.send = function (msg) {
  this.connection.write(JSON.stringify(msg)+"\n")
}
BotPeer.prototype.join = function (p) {
  this.send({cmd:"join",host:p.host,port:p.port})
}
BotPeer.prototype.toString = function () {
  return "BotPeer <"+this.host+":"+this.port+">"
}
