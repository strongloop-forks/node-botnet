var botnet = require('../../lib/botnet');
var bot = botnet.createBot(__dirname + '../../../test/keys/agent1-keys');

bot.connect(function (err, peer) {
  if (err) throw err;
  console.error("connected: %d", peer.sessionId);

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
      require('tty').setRawMode(false);
    });

    connection.on('close', function () {
      require('tty').setRawMode(false);
      console.error("\r\nConnection closed.");
      bot.close();
      stdin.destroy();
    });

  });
});
