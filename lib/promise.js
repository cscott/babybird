'use strict';

var _forEach = Function.call.bind(Array.prototype.forEach);
var _toString = Function.call.bind(Object.prototype.toString);

var Symbol = global.Symbol || {};
var symbolSpecies = Symbol.species || '@@species';

var defineProperties = function(object, map) {
  _forEach(Object.keys(map), function(name) {
    var method = map[name];
    Object.defineProperty(object, name, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: method,
    });
  });
};

var errorObj = {e: {}};
// Try/catch is not supported in optimizing compiler, so it is isolated.
function tryCatch1(fn, arg) {
  try {
    return fn(arg);
  } catch (e) {
    errorObj.e = e;
    return errorObj;
  }
}
function tryCatch2(fn, arg1, arg2) {
  try {
    return fn(arg1, arg2);
  } catch (e) {
    errorObj.e = e;
    return errorObj;
  }
}
// The -r variant allows specifying the receiver.
function tryCatch2r(fn, receiver, arg1, arg2) {
  try {
    return fn.call(receiver, arg1, arg2);
  } catch (e) {
    errorObj.e = e;
    return errorObj;
  }
}

// Promises
// Simplest possible implementation, but stealing tricks from Bluebird
// for moar speed.

var TypeIsObject = function(x) {
  /* jshint eqnull:true */
  // This is expensive when it returns false; use this function
  // when you expect it to return true in the common case.
  return x != null && Object(x) === x;
};

var IsCallable = (typeof /abc/ === 'function') ? function(x) {
  // Some versions of IE say that typeof /abc/ === 'function'
  return typeof x === 'function' && _toString(x) === '[object Function]';
} : function(x) { return typeof x === 'function'; /* Much faster */};

// We can't tell callables from constructors in ES5
var IsConstructor = IsCallable;

var SpeciesConstructor = function(O, defaultConstructor) {
  var C = O.constructor;
  if (C === void 0) {
    return defaultConstructor;
  }
  if (!TypeIsObject(C)) {
    throw new TypeError('Bad constructor');
  }
  var S = C[symbolSpecies];
  if (S === void 0 || S === null) {
    return defaultConstructor;
  }
  if (!IsConstructor(S)) {
    throw new TypeError('Bad @@species');
  }
  return S;
};

var IsPromise = function(promise) {
  if (!TypeIsObject(promise)) {
    return false;
  }
  if (typeof promise._promise_state === 'undefined') {
    return false; // Uninitialized, or missing our hidden field.
  }
  return true;
};

// "PromiseCapability" in the spec is what most promise implementations
// call a "deferred".
var PromiseCapability = function(C) {
  if (!IsConstructor(C)) {
    throw new TypeError('Bad promise constructor');
  }
  var capability = this;
  var resolver = function(resolve, reject) {
    if (capability.resolve !== void 0 || capability.reject !== void 0) {
      throw new TypeError('Bad Promise implementation!');
    }
    capability.resolve = resolve;
    capability.reject = reject;
  };
  capability.promise = new C(resolver);
  if (!(IsCallable(capability.resolve) && IsCallable(capability.reject))) {
    throw new TypeError('Bad promise constructor');
  }
};

// Find an appropriate setImmediate-alike
var setTimeout = global.setTimeout;
var makeZeroTimeout;
/*global window */
if (typeof window !== 'undefined' && IsCallable(window.postMessage)) {
  makeZeroTimeout = function() {
    // from http://dbaron.org/log/20100309-faster-timeouts
    var timeouts = [];
    var messageName = 'zero-timeout-message';
    var setZeroTimeout = function(fn) {
      timeouts.push(fn);
      window.postMessage(messageName, '*');
    };
    var handleMessage = function(event) {
      if (event.source === window && event.data === messageName) {
        event.stopPropagation();
        if (timeouts.length === 0) { return; }
        var fn = timeouts.shift();
        fn();
      }
    };
    window.addEventListener('message', handleMessage, true);
    return setZeroTimeout;
  };
}
var makePromiseAsap = function() {
  // An efficient task-scheduler based on a pre-existing Promise
  // implementation, which we can use even if we override the
  // global Promise later (in order to workaround bugs)
  // https://github.com/Raynos/observ-hash/issues/2#issuecomment-35857671
  var P = global.Promise;
  return P && P.resolve && function(task) {
    return P.resolve().then(task);
  };
};
/*global process */
var enqueue = IsCallable(global.setImmediate) ?
    global.setImmediate :
    typeof process === 'object' && process.nextTick ? process.nextTick :
    makePromiseAsap() ||
    (IsCallable(makeZeroTimeout) ? makeZeroTimeout() :
     function(task) { setTimeout(task, 0); }); // Fallback

// Constants for Promise implementation
var PROMISE_IDENTITY = 1;
var PROMISE_THROWER = 2;
var PROMISE_PENDING = 3;
var PROMISE_FULFILLED = 4;
var PROMISE_REJECTED = 5;

var promiseReactionJob = function(reaction, argument) {
  var promiseCapability = reaction.capabilities;
  var handler = reaction.handler;
  var handlerException = false;
  var handlerResult, f;
  if (handler === PROMISE_IDENTITY) {
    handlerResult = argument;
  } else if (handler === PROMISE_THROWER) {
    handlerResult = argument;
    handlerException = true;
  } else {
    // Encapsulate try/catch here to avoid deoptimization.
    handlerResult = tryCatch1(handler, argument);
    if (handlerResult === errorObj) {
      handlerResult = handlerResult.e;
      handlerException = true;
    }
  }
  f = handlerException ? promiseCapability.reject : promiseCapability.resolve;
  f(handlerResult);
};

var triggerPromiseReactions = function(reactions, argument) {
  _forEach(reactions, function(reaction) {
    enqueue(function() {
      promiseReactionJob(reaction, argument);
    });
  });
};

var fulfillPromise = function(promise, value) {
  var reactions = [];
  if (promise._promise_length > 0) {
    reactions.push(promise._promise_fulfillReactions0);
    for (var i = 1; i < promise._promise_length; i++) {
      reactions.push(promise[2 * (i - 1)]);
    }
  }
  promise._promise_result = value;
  promise._promise_fulfillReactions0 = void 0;
  promise._promise_rejectReactions0 = void 0;
  promise._promise_length = 0;
  promise._promise_state = PROMISE_FULFILLED;
  triggerPromiseReactions(reactions, value);
};

var rejectPromise = function(promise, reason) {
  var reactions = [];
  if (promise._promise_length > 0) {
    reactions.push(promise._promise_rejectReactions0);
    for (var i = 1; i < promise._promise_length; i++) {
      reactions.push(promise[1 + 2 * (i - 1)]);
    }
  }
  promise._promise_result = reason;
  promise._promise_fulfillReactions0 = void 0;
  promise._promise_rejectReactions0 = void 0;
  promise._promise_length = 0;
  promise._promise_state = PROMISE_REJECTED;
  triggerPromiseReactions(reactions, reason);
};

var createResolvingFunctions = function(promise) {
  var alreadyResolved = false;
  var resolve = function(resolution) {
    var then;
    if (alreadyResolved) { return; }
    alreadyResolved = true;
    if (resolution === promise) {
      return rejectPromise(promise, new TypeError('Self resolution'));
    }
    if (!TypeIsObject(resolution)) {
      return fulfillPromise(promise, resolution);
    }
    then = tryCatch1(function(r) { return r.then; }, resolution);
    if (then === errorObj) {
      return rejectPromise(promise, then.e);
    }
    if (!IsCallable(then)) {
      return fulfillPromise(promise, resolution);
    }
    enqueue(function() {
      promiseResolveThenableJob(promise, resolution, then);
    });
  };
  var reject = function(reason) {
    if (alreadyResolved) { return; }
    alreadyResolved = true;
    return rejectPromise(promise, reason);
  };
  return { resolve: resolve, reject: reject };
};

var promiseResolveThenableJob = function(promise, thenable, then) {
  var resolvingFunctions = createResolvingFunctions(promise);
  var resolve = resolvingFunctions.resolve;
  var reject = resolvingFunctions.reject;
  var value = tryCatch2r(then, thenable, resolve, reject);
  if (value === errorObj) {
    reject(value.e);
  }
};

var Promise = function Promise(resolver) {
  if (!(this instanceof Promise)) {
    throw new TypeError('Constructor Promise requires "new"');
  }
  if (this && this._promise_state) {
    throw new TypeError('Bad construction');
  }
  // see https://bugs.ecmascript.org/show_bug.cgi?id=2482
  if (!IsCallable(resolver)) {
    throw new TypeError('not a valid resolver');
  }
  // The spec requires no enumerable fields, but for speed we're going
  // to expose our implementation here.
  // Since most promises have exactly one handler, the first one is
  // stored directly on the object.  The rest (if needed) are stored
  // on the object's element array to avoid unnecessary indirection.
  this._promise_result = void 0;
  this._promise_state = PROMISE_PENDING;
  this._promise_length = 0;
  this._promise_fulfillReactions0 = void 0;
  this._promise_rejectReactions0 = void 0;
  var resolvingFunctions = createResolvingFunctions(this);
  var reject = resolvingFunctions.reject;
  var value = tryCatch2(resolver, resolvingFunctions.resolve, reject);
  if (value === errorObj) {
    reject(value.e);
  }
};
var Promise$prototype = Promise.prototype;

defineProperties(Promise, {
  reject: function reject(reason) {
    var C = this;
    if (!TypeIsObject(C)) {
      throw new TypeError('Bad promise constructor');
    }
    var capability = new PromiseCapability(C);
    var rejectFunc = capability.reject;
    rejectFunc(reason); // Call with this===undefined
    return capability.promise;
  },

  resolve: function resolve(v) {
    // See https://esdiscuss.org/topic/fixing-promise-resolve for spec
    var C = this;
    if (!TypeIsObject(C)) {
      throw new TypeError('Bad promise constructor');
    }
    if (IsPromise(v)) {
      var constructor = v.constructor;
      if (constructor === C) { return v; }
    }
    var capability = new PromiseCapability(C);
    var resolveFunc = capability.resolve;
    resolveFunc(v); // Call with this===undefined
    return capability.promise;
  },
});

defineProperties(Promise$prototype, {
  catch: function(onRejected) {
    return this.then(void 0, onRejected);
  },

  then: function then(onFulfilled, onRejected) {
    var promise = this;
    if (!IsPromise(promise)) { throw new TypeError('not a promise'); }
    var C = SpeciesConstructor(promise, Promise);
    var resultCapability = new PromiseCapability(C);
    // PerformPromiseThen(promise, onFulfilled, onRejected, resultCapability)
    if (!IsCallable(onFulfilled)) {
      onFulfilled = PROMISE_IDENTITY;
    }
    if (!IsCallable(onRejected)) {
      onRejected = PROMISE_THROWER;
    }
    var fulfillReaction = {
      capabilities: resultCapability,
      handler: onFulfilled,
    };
    var rejectReaction = {
      capabilities: resultCapability,
      handler: onRejected,
    };
    var value;
    switch (promise._promise_state) {
    case PROMISE_PENDING:
      if (promise._promise_length === 0) {
        promise._promise_fulfillReactions0 = fulfillReaction;
        promise._promise_rejectReactions0 = rejectReaction;
      } else {
        var i = 2 * (promise._promise_length - 1);
        promise[i] = fulfillReaction;
        promise[i + 1] = rejectReaction;
      }
      promise._promise_length++;
      break;
    case PROMISE_FULFILLED:
      value = promise._promise_result;
      enqueue(function() {
        promiseReactionJob(fulfillReaction, value);
      });
      break;
    case PROMISE_REJECTED:
      value = promise._promise_result;
      enqueue(function() {
        promiseReactionJob(rejectReaction, value);
      });
      break;
    default:
      throw new TypeError('unexpected');
    }
    return resultCapability.promise;
  },
});
// Default species getter.
Object.defineProperty(Promise, symbolSpecies, {
  configurable: true,
  enumerable: false,
  get: function() { return this; },
});

// Add Promise.all / Promise.race methods
// (These are split into a separate file since their implementation is
// reasonably independent of the core and their performance is not critical.)
require('./promise-extra.js')(Promise, PromiseCapability, symbolSpecies);

module.exports = Promise;
