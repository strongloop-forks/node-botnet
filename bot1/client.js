var botnet = require('./botnet');
var bot = botnet.createBot(__dirname + '/keys/agent1-keys');

bot.connect(8123, function (peer) {
  console.error("connected: %d", peer.sessionId);
  bot.broadcast({ msg: "hello world" });
  console.error("message sent");
});
