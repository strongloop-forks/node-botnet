var botnet = require("../lib/botnet")

var b = botnet.createBot(8080, "localhost")
b.on("newPeer", function (newP) {
  console.log("b: new peer: "+newP)
})

var b2 = botnet.createBot(8081, "localhost")
b2.on("newPeer", function (newP) {
  console.log("b2: new peer, making introductions "+newP)
  b2.peers.forEach(function (p) { p.join(newP) })
})

var b3 = botnet.createBot(8082, "localhost")
b3.on("newPeer", function (newP) {
  console.log("b3: new peer: "+newP)
})

var b4 = botnet.createBot(8083, "localhost")
b4.on("newPeer", function (newP) {
  console.log("b4: new peer, making introductions "+newP)
  b4.peers.forEach(function (p) { newP.join(p) })
})

var b5 = botnet.createBot(8084, "localhost")
setTimeout(function () {
  b5.join(b)
  b5.join(b2)
}, 1000)
b5.on("heartbeat", function () {
  var i = Math.floor(Math.random() * b5.peers.length)
    , belle = b5.peers[i]
  b5.peers.forEach(function (p) {
    if (p !== belle) p.join(b5.peers[i])
  })
})

b.join(8081, "localhost")
b4.join(b5)
b3.join(b5)
