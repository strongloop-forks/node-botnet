var botnet = require('../../lib/botnet');
var bot = botnet.createBot(__dirname + '../../../test/keys/agent1-keys');

bot.connect(function (peer) {
  console.error("connected: %d", peer.sessionId);
  bot.broadcast({ msg: "hello world" });
  console.error("message sent");

  peer.shell(function (connection, firstChunk) {
    console.error("Opening shell!");

    // Set rawMode ?
    require('tty').setRawMode(true);

    // XXX why do i have to test here? should be able to write empty buffer.
    if (firstChunk && firstChunk.length) {
      process.stdout.write(firstChunk);
    }
    connection.pipe(process.stdout);
    var stdin = process.openStdin();
    stdin.pipe(connection);

    stdin.on('close', function () {
      console.error("stdin close");
      bot.close();
      require('tty').setRawMode(false);
    });

  });
});
