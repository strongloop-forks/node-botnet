var botnet = require('./botnet');
var bot = botnet.createBot(__dirname + '/keys/agent2-keys');
bot.listen(8123);
