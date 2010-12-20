var botnet = require('../lib/botnet');
var assert = require('assert');

var gotMessage = false;
var botY;

var botX = botnet.createBot(__dirname + '/keys/agent2-keys');

botX.on('message', function (message, peer) {
  console.error("msg: %j", message);
  assert.equal('hello world', message.msg);
  gotMessage = true;
});


botX.on('peerConnect', function (peer) {
  console.log("connection: %d\n%j", peer.sessionId, peer.cert);
});


botX.on('listening', function () {
  botY = botnet.createBot(__dirname + '/keys/agent1-keys');

  botY.connect(botnet.defaultPort, function (peer) {
    console.log("connected: %d\n%j", peer.sessionId, peer.cert);
    peer.send({ msg: "hello world" });
    console.error("message sent");
  });
});


setTimeout(function () {
  var ys = botY._state();
  var xs = botX._state();
  console.log(ys);
  console.log(xs);

  assert.deepEqual(xs, ys);

  botX.close();
  botY.close();
}, 500);


process.on('exit', function () {
  assert.ok(gotMessage);
});
