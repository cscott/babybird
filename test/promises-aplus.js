var Promise = require('../');

var adapter = {
  resolved: function(value) { return Promise.resolve(value); },
  rejected: function(reason) { return Promise.reject(reason); },
  deferred: function() {
    var d = {};
    d.promise = new Promise(function(resolve, reject) {
      d.resolve = resolve;
      d.reject = reject;
    });
    return d;
  },
};

describe('Promises/A+ Tests', function() {
  require('promises-aplus-tests').mocha(adapter);
});
