var botnet = require('../../lib/botnet');
var bot = botnet.createBot(__dirname + '../../../test/keys/agent1-keys');

bot.connect(function (err, peer) {
  if (err) throw err;
  console.error("connected: %d", peer.sessionId);
  bot.broadcast({ msg: "hello world" });
  console.error("message broadcasted");
});

bot.on('message', function (message, peer) {
  console.error("msg: %j", message);
});

bot.on('peerConnect', function (peer) {
  console.error("%d connected", peer.sessionId);
});

bot.on('part', function (b) {
  console.error("%d disconnected", b.sessionId);
});
