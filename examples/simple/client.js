var botnet = require('../../lib/botnet');
var bot = botnet.createBot(__dirname + '../../../test/keys/agent1-keys');

bot.connect(8123, function (peer) {
  console.error("connected: %d", peer.sessionId);
  bot.broadcast({ msg: "hello world" });
  console.error("message sent");
});
