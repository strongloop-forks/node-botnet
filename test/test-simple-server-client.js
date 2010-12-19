var botnet = require('../lib/botnet');
var assert = require('assert');

var gotMessage = false;
var clientBot;

var serverBot = botnet.createBot(__dirname + '/keys/agent2-keys');

serverBot.on('message', function (message, peer) {
  console.error("msg: %j", message);
  assert.equal('hello world', message.msg);
  gotMessage = true;

  /*
  serverBot.close();
  clientBot.close();
  */

});


setTimeout(function () {
  var cs = clientBot._state();
  var ss = serverBot._state();
  console.log(cs);
  console.log(ss);

  assert.deepEqual(cs, ss);

  serverBot.close();
  clientBot.close();
}, 500);

serverBot.on('peerConnect', function (peer) {
  console.log("connection: %d\n%j", peer.sessionId, peer.cert);
});


serverBot.on('listening', function () {
  clientBot = botnet.createBot(__dirname + '/keys/agent1-keys');

  clientBot.connect(8123, function (peer) {
    console.log("connected: %d\n%j", peer.sessionId, peer.cert);
    peer.send({ msg: "hello world" });
    console.error("message sent");
  });
});


process.on('exit', function () {
  assert.ok(gotMessage);
});
