var botnet = require('../lib/botnet');
var assert = require('assert');

var messageCount = 0;
var botY;

var botX = botnet.createBot(__dirname + '/keys/agent2-keys');

botX.on('message', function (message, peer) {
  console.error("msg: %j", message);
  assert.equal('hello world', message.msg);
  messageCount++;
});


botX.on('peerConnect', function (peer) {
  console.log("connection: %d\n%j", peer.sessionId, peer.cert);
});


botX.on('listening', function () {
  botY = botnet.createBot(__dirname + '/keys/agent1-keys');
  botZ = botnet.createBot(__dirname + '/keys/agent1-keys');

  botY.connect(botnet.defaultPort, function (err, peer) {
    if (err) throw err;
    console.log("Y connected: %d", peer.sessionId);
    peer.send({ msg: "hello world" });
    console.error("message sent");
  });

  botZ.connect(botnet.defaultPort, function (err, peer) {
    if (err) throw err;
    console.log("Z connected: %d", peer.sessionId);
    peer.send({ msg: "hello world" });
    console.error("message sent");
  });
});

// The port that Bot A thinks Bot B has.
function port (A, B) {
  return A._state.get(B.sessionId, "port")
}


setTimeout(function () {
  console.log(botX._state.update([]));
  console.log(botY._state.update([]));
  console.log(botZ._state.update([]));

  var portX = port(botX, botX),
      portY = port(botY, botY),
      portZ = port(botZ, botZ);

  console.log("portX %d", portX);
  console.log("portY %d", portY);
  console.log("portZ %d", portZ);

  assert.equal(port(botX, botY), portY);
  assert.equal(port(botX, botZ), portZ);

  assert.equal(port(botY, botX), portX);
  assert.equal(port(botY, botZ), portZ);

  assert.equal(port(botZ, botX), portX);
  assert.equal(port(botZ, botY), portY);

  botX.close();
  botY.close();
  botZ.close();
}, 2000);


process.on('exit', function () {
  assert.equal(2, messageCount);
});
