var botnet = require('../../lib/botnet');
var bot = botnet.createBot(__dirname + '../../../test/keys/agent2-keys');

bot.listen(8123);

bot.on('message', function (message, peer) {
  console.error("msg: %j", message);
});


bot.on('peerConnect', function (peer) {
  console.log("connection: %d\n%j", peer.sessionId, peer.cert);
});
