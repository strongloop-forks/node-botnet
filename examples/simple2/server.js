var botnet = require('../../lib/botnet');
var bot = botnet.createBot(__dirname + '../../../test/keys/agent2-keys');

bot.on('message', function (message, peer) {
  console.error("msg: %j", message);
});


bot.on('peerConnect', function (peer) {
  console.error("someone connected");
});

bot.on('part', function (peer) {
  console.error("someone disconnected");
});
