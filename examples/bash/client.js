var botnet = require('../../lib/botnet');
var bot = botnet.createBot(__dirname + '../../../test/keys/agent1-keys');
var tty = require('tty');

function sendWindowSize(peer) {
  peer.shellSendWindowSize(0);
}


bot.connect(function (err, peer) {
  if (err) throw err;
  console.error("connected: %d", peer.sessionId);

  process.on('SIGWINCH', function() {
    sendWindowSize(peer);
  });

  peer.shell(function (connection, firstChunk) {
    console.error("Opening shell!");

    // Set rawMode ?
    tty.setRawMode(true);

    // XXX why do i have to test here? should be able to write empty buffer.
    if (firstChunk && firstChunk.length) {
      process.stdout.write(firstChunk);
    }
    sendWindowSize(peer);

    connection.pipe(process.stdout);
    var stdin = process.stdin;
    stdin.resume();
    stdin.pipe(connection);

    stdin.on('close', function () {
      tty.setRawMode(false);
        /*
      if (connection.writable) {
        peer.send({ cmd: 'shellClose' });
      }
        */
    });

    connection.on('close', function () {
      tty.setRawMode(false);
      console.error("\r\nConnection closed.");
      bot.close();
      stdin.destroy();
    });

  });
});
