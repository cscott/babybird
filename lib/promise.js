'use strict';

var asap = require('asap/raw');

// When this is `false` we disable species support, for a little bit of
// extra performance.
var supportSpecies = false;
// When this is false we assume promise subclass constructors have no
// side effects.
var strictConstructors = false;
// When this is true, a new resolver is created for every Promise.
var dontReuseResolvers = false;
// When this is true (and the engine supports it), the Promise will be a
// true ES2015 class.  However, this currently slows the implementation down
// by 30% since construction of ES2015 classes is unoptimized.
var useES2015Class = false;

var _forEach = Function.call.bind(Array.prototype.forEach);
var _toString = Function.call.bind(Object.prototype.toString);

var Symbol = global.Symbol || {};
var symbolSpecies = Symbol.species || (supportSpecies ? '@@species' : null);

function defineProperties(object, map) {
  _forEach(Object.keys(map), function definePropertiesForEach(name) {
    var method = map[name];
    Object.defineProperty(object, name, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: method,
    });
  });
}

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
// The -n variant creates a new object.
function tryCatch1n(Fn, arg1) {
  try {
    return new Fn(arg1);
  } catch (e) {
    errorObj.e = e;
    return errorObj;
  }
}

// Promises

// Follow implementation in the ES6 spec as closely as possible, but
// steal tricks from Bluebird for moar speed.
// In particular, we go to great lengths to avoid allocating objects
// and closures wherever possible in hot code.

function TypeIsObject(x) {
  // This is expensive when it returns false; use this function
  // when you expect it to return true in the common case.
  if (false) {
    return x !== void 0 && x !== null && Object(x) === x;
  }
  // It turns out that !TypeIsNotObject is faster...
  return !TypeIsNotObject(x);
}
function TypeIsNotObject(val) {
  // This is more appropriate when TypeIsObject may return false.
  return val === void 0 || val === null || val === true || val === false ||
    typeof val === 'string' || typeof val === 'number' ||
    typeof val === 'symbol'; // jshint ignore:line
}

var IsCallable = (typeof /abc/ === 'function') ? function IsCallableSlow(x) {
  // Some versions of IE say that typeof /abc/ === 'function'
  return typeof x === 'function' && _toString(x) === '[object Function]';
} : function IsCallableFast(x) { return typeof x === 'function'; };

// We can't tell callables from constructors in ES5
var IsConstructor = IsCallable;

function SpeciesConstructor(O, defaultConstructor) {
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
}

function IsPromise(promise) {
  if (!TypeIsObject(promise)) {
    return false;
  }
  if (promise._promise_state === undefined) {
    return false; // Uninitialized, or missing our hidden field.
  }
  return true;
}

// "PromiseCapability" in the spec is what most promise implementations
// call a "deferred".
// We're going to wrap it so that it never throws an exception.
function PromiseCapability() {
  // Declare fields of this object.
  // (Helps with object shape optimization.)
  var self = this;
  this.promise = void 0;
  this.resolve = void 0;
  this.reject = void 0;
  this.resolver = function(resolve, reject) {
    if (self.resolve !== void 0 || self.reject !== void 0) {
      throw new TypeError('Bad Promise implementation!');
    }
    self.resolve = resolve;
    self.reject = reject;
  };
}
PromiseCapability.prototype.free = function() {
  if (dontReuseResolvers) { return; }
  if (this.dontReuse) { return; }
  this.promise = void 0;
  this.resolve = void 0;
  this.reject = void 0;
  freeCapabilityList.push(this);
};
PromiseCapability.prototype.getPromiseAndFree = function() {
  var promise = this.promise;
  this.free();
  return promise;
};
var freeCapabilityList = [];

function makeCapabilityFast(C) {
  thenFastPath = FAST_PATH_MAKE_CAP;
  // `thenFastPath` is always reset to FAST_PATH_NONE by `makeCapability`
  return makeCapability(C);
}

function makeCapability(C) {
  if (!IsConstructor(C)) {
    thenFastPath = FAST_PATH_NONE;
    throw new TypeError('Bad promise constructor');
  }

  var capability;
  if (freeCapabilityList.length) {
    capability = freeCapabilityList.pop();
  } else {
    capability = new PromiseCapability();
  }
  if (strictConstructors &&
      C !== Promise && !C.hasOwnProperty('noSideEffects')) {
    capability.dontReuse = true;
  }
  if (thenFastPath === FAST_PATH_MAKE_CAP) {
    thenFastPathResolver = capability.resolver;
    capability.promise = tryCatch1n(C, thenFastPathResolver);
    var wasFastPath = (thenFastPath === FAST_PATH_CTOR_BAILED);
    thenFastPathResolver = null;
    thenFastPath = FAST_PATH_NONE;
    if (capability.promise === errorObj) {
      capability.free();
      throw errorObj.e;
    }
    if (wasFastPath) { return capability.getPromiseAndFree(); }
  } else {
    capability.promise = new C(capability.resolver);
  }
  if (!(IsCallable(capability.resolve) && IsCallable(capability.reject))) {
    throw new TypeError('Bad promise constructor');
  }
  return capability;
}

// Forward declaration
var promisePrototypeThen;
var fakeRetvalFromThen = false;

// Constants for Promise implementation
var PROMISE_IDENTITY = (function PROMISE_IDENTITY(v) { return v; });
var PROMISE_THROWER = (function PROMISE_THROWER(t) { throw t; });
var PROMISE_FAKE_CAPABILITY = new PromiseCapability();
var PROMISE_PENDING = 0;
var PROMISE_RESOLVING = 1; // PROMISE_PENDING combined with alreadyResolved
var PROMISE_FULFILLED = 2;
var PROMISE_REJECTED = 3;

// States for then-fast-path
var FAST_PATH_NONE = 0;
var FAST_PATH_MAKE_CAP = 1;
var FAST_PATH_CTOR_BAILED = 2;

var thenFastPath = FAST_PATH_NONE;
var thenFastPathResolver = null;

function promiseCheckAndResolve(promise, value) {
  /* jshint bitwise: false */
  if ((promise._promise_state & 3) !== PROMISE_PENDING) { return; }
  promise._promise_state++; // Sets state to PROMISE_RESOLVING
  resolvePromise(promise, value);
  return promise;
}
function promiseCheckAndReject(promise, value) {
  /* jshint bitwise: false */
  if ((promise._promise_state & 3) !== PROMISE_PENDING) { return; }
  promise._promise_state++; // Sets state to PROMISE_RESOLVING
  rejectPromise(promise, value);
  return promise;
}
function promiseReactionResolve(promiseCapability, handlerResult) {
  if (promiseCapability.constructor === PromiseCapability) {
    var resolve = promiseCapability.resolve;
    resolve(handlerResult);
    return promiseCapability.getPromiseAndFree();
  }
  // Optimized case; this is a "standard" promise.
  return promiseCheckAndResolve(promiseCapability, handlerResult);
}
function promiseReactionReject(promiseCapability, handlerResult, noFree) {
  if (promiseCapability.constructor === PromiseCapability) {
    var reject = promiseCapability.reject;
    reject(handlerResult);
    if (noFree) { return promiseCapability.promise; }
    return promiseCapability.getPromiseAndFree();
  }
  // Optimized case; this is a "standard" promise.
  return promiseCheckAndReject(promiseCapability, handlerResult);
}
function promiseReactionJob(handler, promiseCapability, argument) {
  var handlerResult;
  // Encapsulate try/catch here to avoid deoptimization.
  handlerResult = tryCatch1(handler, argument);
  if (promiseCapability === PROMISE_FAKE_CAPABILITY) { return; }
  if (handlerResult === errorObj) {
    handlerResult = errorObj.e;
    return promiseReactionReject(promiseCapability, handlerResult);
  }
  return promiseReactionResolve(promiseCapability, handlerResult);
}

function PromiseReactionJobTask() {
  this.handler = null;
  this.capability = null;
  this.argument = null;
}
PromiseReactionJobTask.prototype.call = function() {
  promiseReactionJob(this.handler, this.capability, this.argument);
  this.handler = null;
  this.capability = null;
  this.argument = null;
  freePromiseReactionJobTasks.push(this);
};
var freePromiseReactionJobTasks = [];

function triggerPromiseReaction(handler, capability, argument) {
  var task;
  if (freePromiseReactionJobTasks.length) {
    task = freePromiseReactionJobTasks.pop();
  } else {
    task = new PromiseReactionJobTask();
  }
  task.handler = handler;
  task.capability = capability;
  task.argument = argument;
  asap(task);
}

function fulfillPromise(promise, value) {
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
      for (var i = 1, idx = 0; i < length; i++) {
        triggerPromiseReaction(promise[idx], promise[idx + 2], value);
        promise[idx++] = void 0;
        promise[idx++] = void 0;
        promise[idx++] = void 0;
      }
    }
  }
  promise._promise_result = value;
  promise._promise_state = PROMISE_FULFILLED;
}

function rejectPromise(promise, reason) {
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
      for (var i = 1, idx = 0; i < length; i++) {
        triggerPromiseReaction(promise[idx + 1], promise[idx + 2], reason);
        promise[idx++] = void 0;
        promise[idx++] = void 0;
        promise[idx++] = void 0;
      }
    }
  }
  promise._promise_result = reason;
  promise._promise_state = PROMISE_REJECTED;
}

function getThen(r) { return r.then; }

function PromiseResolveThenableJobTask() {
  this.promise = null;
  this.resolution = null;
  this.then = null;
}
PromiseResolveThenableJobTask.prototype.call = function() {
  promiseResolveThenableJob(this.promise, this.resolution, this.then);
  this.promise = null;
  this.resolution = null;
  this.then = null;
  freePromiseResolveThenableJobTasks.push(this);
};
var freePromiseResolveThenableJobTasks = [];

function triggerPromiseResolveThenableJob(promise, resolution, then) {
  var task;
  if (freePromiseResolveThenableJobTasks.length) {
    task = freePromiseResolveThenableJobTasks.pop();
  } else {
    task = new PromiseResolveThenableJobTask();
  }
  task.promise = promise;
  task.resolution = resolution;
  task.then = then;
  asap(task);
}

function resolvePromise(promise, resolution) {
  if (resolution === promise) {
    return rejectPromise(promise, new TypeError('Self resolution'));
  }
  if (TypeIsNotObject(resolution)) {
    return fulfillPromise(promise, resolution);
  }
  var then = tryCatch1(getThen, resolution);
  if (then === errorObj) {
    return rejectPromise(promise, errorObj.e);
  }
  if (!IsCallable(then)) {
    return fulfillPromise(promise, resolution);
  }
  triggerPromiseResolveThenableJob(promise, resolution, then);
}

function promiseResolveThenableJob(promise, thenable, then) {
  // Inlined copy of createResolvingFunctions(promise)
  var alreadyResolved = false;
  var resolve = function promiseResolveThenableJobResolve(resolution) {
    if (alreadyResolved) { return; }
    alreadyResolved = true;
    resolvePromise(promise, resolution);
  };
  var reject = function promiseResolveThenableJobReject(reason) {
    if (alreadyResolved) { return; }
    alreadyResolved = true;
    return rejectPromise(promise, reason);
  };
  if (then === promisePrototypeThen) {
    fakeRetvalFromThen = true; // Reset to false at the top of Promise#then
  }
  var value = tryCatch2r(then, thenable, resolve, reject);
  if (value === errorObj) {
    reject(errorObj.e);
  }
}

var PromiseConstruct = function Promise(resolver) {
  if (!(this instanceof Promise)) {
    throw new TypeError('Constructor Promise requires "new"');
  }
  if (this._promise_state !== void 0) {
    throw new TypeError('Bad construction');
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
  if (thenFastPath === FAST_PATH_MAKE_CAP &&
      resolver === thenFastPathResolver) {
    // We will create the resolving functions lazily.
    thenFastPath = FAST_PATH_CTOR_BAILED;
    return;
  }
  // see https://bugs.ecmascript.org/show_bug.cgi?id=2482
  // (This check has been reordered after the fast path.)
  if (!IsCallable(resolver)) {
    throw new TypeError('not a valid resolver');
  }
  // Inlined copy of createResolvingFunctions(this), using _promise_state
  // to track the `alreadyResolved` boolean.
  var promise = this;
  var resolve = function PromiseResolve(resolution) {
    promiseCheckAndResolve(promise, resolution);
  };
  var reject = function PromiseReject(reason) {
    promiseCheckAndReject(promise, reason);
  };
  var value = tryCatch2(resolver, resolve, reject);
  if (value === errorObj) {
    reject(errorObj.e);
  }
};
var Promise = (function makeClass() {
  if (useES2015Class) {
    try {
      /* jshint evil:true */
      return eval('(function(PromiseConstruct) {' +
                  '"use strict";' +
                  'return class Promise {' +
                  '  constructor(executor) {' +
                  '    PromiseConstruct.call(this, executor);' +
                  '  }' +
                  '};})')(PromiseConstruct);
    } catch (e) { /* I guess ES2015 syntax isn't supported. */ }
  }
  return PromiseConstruct;
})();
var Promise$prototype = Promise.prototype;

defineProperties(Promise, {
  reject: function reject(reason) {
    var C = this;
    if (!TypeIsObject(C)) {
      throw new TypeError('Bad promise constructor');
    }
    var capability = makeCapabilityFast(C);
    return promiseReactionReject(capability, reason);
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
    var capability = makeCapabilityFast(C);
    return promiseReactionResolve(capability, v);
  },
});

defineProperties(Promise$prototype, {
  catch: function catch_(onRejected) {
    return this.then(void 0, onRejected);
  },

  then: function then(onFulfilled, onRejected) {
    /* jshint bitwise: false */
    var fakeRetval = fakeRetvalFromThen;
    fakeRetvalFromThen = false;

    var promise = this;
    if (!IsPromise(promise)) { throw new TypeError('not a promise'); }
    var resultCapability, C;
    if ((!strictConstructors) && fakeRetval) {
      resultCapability = PROMISE_FAKE_CAPABILITY;
    } else {
      C = SpeciesConstructor(promise, Promise);
      if (fakeRetval &&
          (C === Promise || C.hasOwnProperty('noSideEffects'))) {
        resultCapability = PROMISE_FAKE_CAPABILITY;
      } else {
        // We might create a fake capability here.
        resultCapability = makeCapabilityFast(C);
      }
    }
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
    if (resultCapability.constructor === PromiseCapability) {
      return resultCapability.promise;
    }
    return resultCapability;
  },
});
// Store the identify of the Promise#then function for optimization.
promisePrototypeThen = Promise$prototype.then;
// This encapsulates the `then` optimization, for use by promise-extra.js
function optimizePromiseThen(promise, onFulfilled, onReject) {
  var then = promise.then;
  if (then === promisePrototypeThen) {
    fakeRetvalFromThen = true; // Reset to false at the top of Promise#then
    promisePrototypeThen.call(promise, onFulfilled, onReject);
  } else {
    then.call(promise, onFulfilled, onReject);
  }
}

// Special "extra" method which is like `Promise#then` but it does
// *not* return a `Promise`.  This can be much faster when you don't
// need the result.
Promise$prototype.then0 = function then0(f, r) {
  optimizePromiseThen(this, f, r);
};

if (symbolSpecies !== null) {
  // Default species getter.
  Object.defineProperty(Promise, symbolSpecies, {
    configurable: true,
    enumerable: false,
    get: function speciesGetter() { return this; },
  });
}

// Add Promise.all / Promise.race methods
// (These are split into a separate file since their implementation is
// reasonably independent of the core and their performance is not critical.)
require('./promise-extra.js')(
  Promise, PromiseCapability, makeCapability, makeCapabilityFast,
  promiseReactionResolve, promiseReactionReject,
  optimizePromiseThen, symbolSpecies
);

module.exports = Promise;
