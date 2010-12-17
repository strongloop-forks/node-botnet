var botnet = require('./botnet');
var bot = botnet.createBot(__dirname + '/keys/agent1-keys');

bot.connect(8123, function () {
  console.error("connected");
  bot.send({ msg: "hello world" });
  console.error("message sent");
});
