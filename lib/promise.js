'use strict';

var useAsap = true; // Use `asap` package instead of setImmediate()

var _forEach = Function.call.bind(Array.prototype.forEach);
var _toString = Function.call.bind(Object.prototype.toString);

var Symbol = global.Symbol || {};
var symbolSpecies = Symbol.species || '@@species';

// Set to `true` to disable species support for a little bit extra performance.
if (false) {
  symbolSpecies = null;
}

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
  var S;
  if (symbolSpecies === null) {
    S = C;
  } else {
    if (!TypeIsObject(C)) {
      throw new TypeError('Bad constructor');
    }
    S = C[symbolSpecies];
    if (S === void 0 || S === null) {
      return defaultConstructor;
    }
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
var enqueue = useAsap ? require('asap/raw') : IsCallable(global.setImmediate) ?
    global.setImmediate :
    typeof process === 'object' && process.nextTick ? process.nextTick :
    makePromiseAsap() ||
    (IsCallable(makeZeroTimeout) ? makeZeroTimeout() :
     function(task) { setTimeout(task, 0); }); // Fallback

// Constants for Promise implementation
var PROMISE_IDENTITY = (function(v) { return v; });
var PROMISE_THROWER = (function(t) { throw t; });
var PROMISE_PENDING = 0;
var PROMISE_RESOLVING = 1; // PROMISE_PENDING combined with alreadyResolved
var PROMISE_FULFILLED = 2;
var PROMISE_REJECTED = 3;

var promiseReactionJob = function(handler, promiseCapability, argument) {
  var handlerResult, resolve, reject;
  if (handler === PROMISE_IDENTITY) {
    handlerResult = argument;
  } else if (handler === PROMISE_THROWER) {
    handlerResult = argument;
    reject = promiseCapability.reject;
    reject(handlerResult);
    return;
  } else {
    // Encapsulate try/catch here to avoid deoptimization.
    handlerResult = tryCatch1(handler, argument);
    if (handlerResult === errorObj) {
      handlerResult = handlerResult.e;
      reject = promiseCapability.reject;
      reject(handlerResult);
      return;
    }
  }
  resolve = promiseCapability.resolve;
  resolve(handlerResult);
};

var triggerPromiseReaction = function(handler, capability, argument) {
  enqueue(function() { promiseReactionJob(handler, capability, argument); });
};
var triggerPromiseReactions = function(reactions, argument) {
  _forEach(reactions, function(reaction) {
    enqueue(function() {
      promiseReactionJob(reaction.handler, reaction.capability, argument);
    });
  });
};

var fulfillPromise = function(promise, value) {
  /* jshint bitwise: false */
  var length = promise._promise_state >>> 2;
  if (length > 0) {
    triggerPromiseReaction(
      promise._promise_fulfillReactions0,
      promise._promise_reactionCapability0,
      value);
    promise._promise_fulfillReactions0 = void 0;
    promise._promise_rejectReactions0 = void 0;
    promise._promise_reactionCapability0 = void 0;
    if (length > 1) {
      var reactions = [];
      for (var i = 1, idx = 0; i < length; i++) {
        reactions.push({
          handler: promise[idx],
          capability: promise[idx + 2],
        });
        promise[idx++] = void 0;
        promise[idx++] = void 0;
        promise[idx++] = void 0;
      }
      triggerPromiseReactions(reactions, value);
    }
  }
  promise._promise_result = value;
  promise._promise_state = PROMISE_FULFILLED;
};

var rejectPromise = function(promise, reason) {
  /* jshint bitwise: false */
  var length = promise._promise_state >>> 2;
  if (length > 0) {
    triggerPromiseReaction(
      promise._promise_rejectReactions0,
      promise._promise_reactionCapability0,
      reason);
    promise._promise_fulfillReactions0 = void 0;
    promise._promise_rejectReactions0 = void 0;
    promise._promise_reactionCapability0 = void 0;
    if (length > 1) {
      var reactions = [];
      for (var i = 1, idx = 0; i < length; i++) {
        reactions.push({
          handler: promise[idx + 1],
          capability: promise[idx + 2],
        });
        promise[idx++] = void 0;
        promise[idx++] = void 0;
        promise[idx++] = void 0;
      }
      triggerPromiseReactions(reactions, reason);
    }
  }
  promise._promise_result = reason;
  promise._promise_state = PROMISE_REJECTED;
};

var resolvePromise = function(promise, resolution) {
  if (resolution === promise) {
    return rejectPromise(promise, new TypeError('Self resolution'));
  }
  if (!TypeIsObject(resolution)) {
    return fulfillPromise(promise, resolution);
  }
  var then = tryCatch1(function(r) { return r.then; }, resolution);
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

var promiseResolveThenableJob = function(promise, thenable, then) {
  // Inlined copy of createResolvingFunctions(promise)
  var alreadyResolved = false;
  var resolve = function(resolution) {
    if (alreadyResolved) { return; }
    alreadyResolved = true;
    resolvePromise(promise, resolution);
  };
  var reject = function(reason) {
    if (alreadyResolved) { return; }
    alreadyResolved = true;
    return rejectPromise(promise, reason);
  };
  var value = tryCatch2r(then, thenable, resolve, reject);
  if (value === errorObj) {
    reject(value.e);
  }
};

var Promise = function Promise(resolver) {
  if (!(this instanceof Promise)) {
    throw new TypeError('Constructor Promise requires "new"');
  }
  if (this && typeof this._promise_state !== 'undefined') {
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
  this._promise_fulfillReactions0 = void 0;
  this._promise_rejectReactions0 = void 0;
  this._promise_reactionCapability0 = void 0;
  // Inlined copy of createResolvingFunctions(this), using _promise_state
  // to track the `alreadyResolved` boolean.
  var promise = this;
  var resolve = function(resolution) {
    /* jshint bitwise: false */
    if ((promise._promise_state & 3) !== PROMISE_PENDING) { return; }
    promise._promise_state++; // Sets state to PROMISE_RESOLVING
    resolvePromise(promise, resolution);
  };
  var reject = function(reason) {
    /* jshint bitwise: false */
    if ((promise._promise_state & 3) !== PROMISE_PENDING) { return; }
    promise._promise_state++; // Sets state to PROMISE_RESOLVING
    rejectPromise(promise, reason);
  };
  var value = tryCatch2(resolver, resolve, reject);
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
    /* jshint bitwise: false */
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

    var length;
    switch (promise._promise_state & 3) {
    case PROMISE_PENDING:
    case PROMISE_RESOLVING:
      length = promise._promise_state >>> 2;
      if (length === 0) {
        promise._promise_fulfillReactions0 = onFulfilled;
        promise._promise_rejectReactions0 = onRejected;
        promise._promise_reactionCapability0 = resultCapability;
      } else {
        var i = 3 * (length - 1);
        promise[i] = onFulfilled;
        promise[i + 1] = onRejected;
        promise[i + 2] = resultCapability;
      }
      promise._promise_state += (1 << 2);
      break;
    case PROMISE_FULFILLED:
      triggerPromiseReaction(onFulfilled, resultCapability,
                             promise._promise_result);
      break;
    case PROMISE_REJECTED:
      triggerPromiseReaction(onRejected, resultCapability,
                             promise._promise_result);
      break;
    default:
      throw new TypeError('unexpected');
    }
    return resultCapability.promise;
  },
});
if (symbolSpecies !== null) {
  // Default species getter.
  Object.defineProperty(Promise, symbolSpecies, {
    configurable: true,
    enumerable: false,
    get: function() { return this; },
  });
}

// Add Promise.all / Promise.race methods
// (These are split into a separate file since their implementation is
// reasonably independent of the core and their performance is not critical.)
require('./promise-extra.js')(Promise, PromiseCapability, symbolSpecies);

module.exports = Promise;
