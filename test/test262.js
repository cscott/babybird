'use strict';
var fs = require('fs');
var path = require('path');
var parser = require('test262-parser');
var glob = require('glob');

var BASEDIR = path.resolve(__dirname, '../node_modules/test262/test');
var TESTS = 'built-ins/Promise/**/*.js';

var BLACKLIST = [
  // We don't expect the Promise under test to be the global Promise.
  'built-ins/Promise/S25.4.3.1_A1.1_T1.js',
  // These tests mutate the global state.
  'built-ins/Promise/all/does-not-invoke-array-setters.js',
  'built-ins/Promise/all/invoke-resolve.js',
  'built-ins/Promise/all/invoke-resolve-get-error.js',
  'built-ins/Promise/all/iter-close.js',
  'built-ins/Promise/race/invoke-resolve.js',
  'built-ins/Promise/race/invoke-resolve-get-error.js',
  // This test reflects a v8 bug (anonymous functions shouldn't have
  // an 'own' name property).
  'built-ins/Promise/all/resolve-element-function-name.js',
  'built-ins/Promise/executor-function-name.js',
  'built-ins/Promise/reject-function-name.js',
  'built-ins/Promise/resolve-function-name.js',
  // These tests require ES6 "construct" semantics.
  'built-ins/Promise/all/resolve-element-function-nonconstructor.js',
  'built-ins/Promise/executor-function-nonconstructor.js',
  'built-ins/Promise/reject-function-nonconstructor.js',
  'built-ins/Promise/resolve-function-nonconstructor.js',
  // The es6-shim package can't assign `catch` as a function name without
  // breaking compatibility with pre-ES5 code.
  'built-ins/Promise/prototype/catch/name.js',
];

describe('test262 promise test suite', function(done) {
  /* jshint evil:true */ // It doesn't like the `eval`s here.
  var $ERROR = function(msg) { throw new Error(msg); };
  var assert = new Function(
    '$ERROR',
    fs.readFileSync(path.join(BASEDIR, '../harness/assert.js'), 'utf8') +
      '\n return assert;'
  )($ERROR);
  var Test262Error = function Test262Error(msg) {
    var self = new Error(msg);
    Object.setPrototypeOf(self, Test262Error.prototype);
    return self;
  };
  Object.setPrototypeOf(Test262Error, Error);
  Test262Error.prototype = Object.create(Error.prototype);
  Test262Error.prototype.constructor = Test262Error;

  // Replace with `require('es6-shim')` to validate es6-shim implementation
  var Promise = require('../');

  var eachFile = function(filename) {
    var shortName = path.relative(BASEDIR, filename);
    describe(shortName, function() {
      var file = parser.parseFile({
        file: filename,
        contents: fs.readFileSync(filename, 'utf8'),
      });
      console.assert(file.copyright || file.isATest, file);
      var desc = file.attrs.description || '<no description>';
      var includes = file.attrs.includes || [];
      var features = file.attrs.features || [];
      var flags = file.attrs.flags || {};
      var prologue = flags.noStrict ? '' : "'use strict';\n";
      var itit = it;
      if (BLACKLIST.indexOf(shortName) >= 0) { itit = it.skip; }
      if (features.indexOf('class') >= 0) { itit = it.skip; }
      if (features.indexOf('Symbol.species') >= 0) { itit = it.skip; }
      if (features.indexOf('Symbol.toStringTag') >= 0) { itit = it.skip; }
      includes.forEach(function(f) {
        prologue +=
          fs.readFileSync(path.join(BASEDIR, '../harness', f), 'utf8');
      });

      var runOne = function(done) {
        var body = new Function(
          'assert','$ERROR', 'Test262Error', 'Promise', '$DONE',
          prologue + file.contents
        );
        var P = Promise;
        var res = Promise.resolve;
        var rej = Promise.reject;
        var check = function() {
          // Verify that this test case didn't stomp on the Promise object.
          console.assert(P === Promise);
          console.assert(res === Promise.resolve);
          console.assert(rej === Promise.reject);
        };
        var checkAsync = function(cb) {
          try { check(); } catch (e) { return cb(e); }
          cb();
        };
        if (done) {
          // Execute async test:
          body(assert, $ERROR, Test262Error, Promise, function(err) {
            if (err) { done(err); } else { checkAsync(done); }
          });
        } else {
          // Execute sync test:
          body(assert, $ERROR, Test262Error, Promise);
          check();
        }
      };
      // Mocha uses the # of declared args of the function to determine
      // whether or not to execute the test async.
      if (file.async) {
        itit(desc, function(done) { runOne(done); });
      } else {
        itit(desc, function() { runOne(); });
      }
    });
  };
  glob.sync(path.join(BASEDIR, TESTS)).forEach(eachFile);
});
