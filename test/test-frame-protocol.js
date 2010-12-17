var assert = require('assert');
var util = require('util')
var Parser = require('../lib/frame-protocol').Parser;

function test1 () {
  console.error("test 1");
  var p = new Parser();

  var messageCount = 0;

  p.on('message', function (m) {
    console.error("Got message: %j", m);
    messageCount++;
    if (messageCount == 1) {
      assert.equal("world", m["hello"]);
    } else if (messageCount == 2) {
      assert.equal("bar", m["foo"]);
    }
  });

  p.execute(Buffer('{"hello": "world"}\r\n{"foo": "bar"}\r\n'));

  assert.equal(2, messageCount);
}


function test2 () {
  console.error("test 2");

  var p = new Parser();

  var messageCount = 0;

  p.on('message', function (m) {
    //console.error("Got message: %j", m);
    messageCount++;
    if (messageCount == 1) {
      assert.equal("world", m["hello"]);
      assert.equal("y", m["x"]);
    } else if (messageCount == 2) {
      assert.equal("bar", m["foo"]);
    }
  });

  function test (s) {
    for (var i = 0; i < s.length; i++) {
      console.error('i=%d j=%d', i, s.length - i);
      console.error(util.inspect(s.slice(0, i)));
      console.error(util.inspect(s.slice(i)));
      messageCount = 0;
      var first = s.slice(0, i);
      var second = s.slice(i);
      p.execute(Buffer(first));
      p.execute(Buffer(second));
      assert.equal(2, messageCount);
    }
  }

  test('{"hello": "world", "x": "y"}\r\n{"foo": "bar"}\r\n');
  test('{"hello": "world", "x": "y"}\n{"foo": "bar"}\r\n');
  test('\r\n{"hello": "world", "x": "y"}\r\n{"foo": "bar"}\n');
}

function test3 () {
  console.error('\n\ntest 3');

  var p = new Parser();

  var messageCount = 0;
  var gotUpgrade = false;

  p.on('message', function (m) {
    console.error("Got message: %j", m);
    messageCount++;
    if (messageCount == 1) {
      assert.equal("world", m["hello"]);
    } else if (messageCount == 2) {
      assert.equal("bar", m["foo"]);
    }
  });

  p.on('upgrade', function (type, rest) {
    console.error("upgrade '%s' '%s'", type, rest);
    gotUpgrade = true;
    assert.equal('blah', type);
    assert.equal('hello', rest.toString());
  });

  p.execute(Buffer('{"hello": "world"}\r\n{"foo": "bar"}\r\nupgrade: blah\r\nhello'));

  assert.equal(2, messageCount);
  assert.ok(gotUpgrade);
}


function test4 () {
  console.error("test4");

  var messageCount = 0;
  var gotUpgrade = false;

  function test (s) {

    for (var i = 0; i < s.length; i++) {
      console.error('i=%d j=%d', i, s.length - i);
      messageCount = 0;
      gotUpgrade = false;

      var p = new Parser();

      p.on('message', function (m) {
        //console.error("Got message: %j", m);
        messageCount++;
        if (messageCount == 1) {
          assert.equal("world", m["hello"]);
          assert.equal("y", m["x"]);
        } else if (messageCount == 2) {
          assert.equal("bar", m["foo"]);
        }
      });

      p.on('upgrade', function (type, rest) {
        gotUpgrade = true;
        assert.equal('blah', type);
        assert.equal('hello'.slice(0, rest.length), rest.toString());
      });

      var first = s.slice(0, i);
      var second = s.slice(i);
      p.execute(Buffer(first));
      if (!gotUpgrade) p.execute(Buffer(second));
      assert.equal(2, messageCount);
      assert.ok(gotUpgrade);
    }
  }

  test('{"hello": "world", "x": "y"}\r\n{"foo": "bar"}\r\nupgrade: blah\r\nhello');
  test('{"hello": "world", "x": "y"}\n{"foo": "bar"}\r\nupgrade: blah\nhello');
  test('\r\n{"hello": "world", "x": "y"}\n{"foo": "bar"}\nupgrade:  blah\nhello');
}


test1();
test2();
test3();
test4();

console.error("DONE");
