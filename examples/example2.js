var botnet = require("../lib/botnet")

var b = botnet.createBot(8084, "localhost")
b.join(8081, "localhost")
