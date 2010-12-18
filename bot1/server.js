var botnet = require('./botnet');
var bot = botnet.createBot(__dirname + '/keys/agent2-keys');

bot.listen(8123);

bot.on('msg', function (m) {
  console.error("message recv'd");
  console.error(m);
});
