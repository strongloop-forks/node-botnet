var botnet = require('../../lib/botnet');
var bot = botnet.createBot(__dirname + '../../../test/keys/agent2-keys');

bot.on('message', function (message, peer) {
  console.error("msg: %j", message);
});


bot.on('peerConnect', function (peer) {
  console.error("%d connected", peer.sessionId);
});

bot.on('part', function (b) {
  console.error("%d disconnected", b.sessionId);
});
