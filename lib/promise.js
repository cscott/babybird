'use strict';
var isArguments = require('is-arguments');

var _call = Function.call.bind(Function.call);
var _push = Function.call.bind(Array.prototype.push);
var _shift = Function.call.bind(Array.prototype.shift);
var _forEach = Function.call.bind(Array.prototype.forEach);
var _hasOwnProperty = Function.call.bind(Object.prototype.hasOwnProperty);
var _toString = Function.call.bind(Object.prototype.toString);
var _floor = Math.floor;
var _abs = Math.abs;

var Symbol = global.Symbol || {};
var symbolSpecies = Symbol.species || '@@species';
var symbolIterator = Symbol.iterator || '@@iterator';

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

var emulateES6construct = function(o, defaultNewTarget, defaultProto, slots) {
  // This is an es5 approximation to es6 construct semantics.  in es6,
  // 'new Foo' invokes Foo.[[Construct]] which (for almost all objects)
  // just sets the internal variable NewTarget (in es6 syntax `new.target`)
  // to Foo and then returns Foo().

  // Many ES6 object then have constructors of the form:
  // 1. If NewTarget is undefined, throw a TypeError exception
  // 2. Let xxx by OrdinaryCreateFromConstructor(NewTarget, yyy, zzz)

  // So we're going to emulate those first two steps.
  if (!TypeIsObject(o)) {
    throw new TypeError('Constructor requires `new`: ' + defaultNewTarget.name);
  }
  var proto = defaultNewTarget.prototype;
  if (!TypeIsObject(proto)) {
    proto = defaultProto;
  }
  var obj = Object.create(proto);
  for (var name in slots) {
    if (_hasOwnProperty(slots, name)) {
      var value = slots[name];
      Object.defineProperty(obj, name, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: value,
      });
    }
  }
  return obj;
};

// Promises
// Simplest possible implementation, but stealing tricks from Bluebird
// for moar speed.

var TypeIsObject = function(x) {
  /* jshint eqnull:true */
  // This is expensive when it returns false; use this function
  // when you expect it to return true in the common case.
  return x != null && Object(x) === x;
};

var ToObject = function(o, optMessage) {
  /* jshint eqnull:true */
  if (o == null) {
    throw new TypeError(optMessage || 'Cannot call method on ' + o);
  }
  return Object(o);
};

var IsCallable = function(x) {
  // Some versions of IE say that typeof /abc/ === 'function'
  return typeof x === 'function' && _toString(x) === '[object Function]';
};

var IsConstructor = function(x) {
  // We can't tell callables from constructors in ES5
  return IsCallable(x);
};

var ToNumber = function(value) {
  if (_toString(value) === '[object Symbol]') {
    throw new TypeError('Cannot convert a Symbol value to a number');
  }
  return +value;
};

var numberIsNaN = Number.isNaN || function isNaN(value) {
  return value !== value;
};

var numberIsFinite = Number.isFinite || function isFinite(value) {
  return typeof value === 'number' && global.isFinite(value);
};

var ToInteger = function(value) {
  var number = ToNumber(value);
  if (numberIsNaN(number)) { return 0; }
  if (number === 0 || !numberIsFinite(number)) { return number; }
  return (number > 0 ? 1 : -1) * _floor(_abs(number));
};

var ToLength = function(value) {
  var len = ToInteger(value);
  if (len <= 0) { return 0; } // Includes converting -0 to +0
  if (typeof Number.MAX_SAFE_INTEGER !== 'undefined') {
    if (len > Number.MAX_SAFE_INTEGER) { return Number.MAX_SAFE_INTEGER; }
  }
  return len;
};

// Stripped down value-only ArrayIterator.
var ArrayIterator = function(array) {
  this.i = 0;
  this.array = array;
};
defineProperties(ArrayIterator.prototype, {
  next: function() {
    var i = this.i;
    var array = this.array;
    if (!(this instanceof ArrayIterator)) {
      throw new TypeError('Not an ArrayIterator');
    }
    if (typeof array !== 'undefined') {
      var len = ToLength(array.length);
      for (; i < len; i++) {
        var retval = array[i];
        this.i = i + 1;
        return { value: retval, done: false };
      }
    }
    this.array = void 0;
    return { value: void 0, done: true };
  },
});
Object.defineProperty(ArrayIterator.prototype, symbolIterator, {
  configurable: true,
  enumerable: false,
  writable: true,
  value: function() { return this; },
});

var GetIterator = function(o) {
  var itFn = GetMethod(o, symbolIterator);
  if (!IsCallable(itFn)) {
    // Node 0.10 compatibility.
    if (Array.isArray(o) || isArguments(o)) {
      return new ArrayIterator(o);
    }
    // Better diagnostics if itFn is null or undefined
    throw new TypeError('value is not an iterable');
  }
  var it = _call(itFn, o);
  if (!TypeIsObject(it)) {
    throw new TypeError('bad iterator');
  }
  return it;
};

var GetMethod = function(o, p) {
  var func = ToObject(o)[p];
  if (func === void 0 || func === null) {
    return void 0;
  }
  if (!IsCallable(func)) {
    throw new TypeError('Method not callable: ' + p);
  }
  return func;
};

var IteratorComplete = function(iterResult) {
  return !!(iterResult.done);
};

var IteratorClose = function(iterator, completionIsThrow) {
  var returnMethod = GetMethod(iterator, 'return');
  if (returnMethod === void 0) {
    return;
  }
  var innerResult, innerException;
  try {
    innerResult = _call(returnMethod, iterator);
  } catch (e) {
    innerException = e;
  }
  if (completionIsThrow) {
    return;
  }
  if (innerException) {
    throw innerException;
  }
  if (!TypeIsObject(innerResult)) {
    throw new TypeError("Iterator's return method returned a non-object.");
  }
};

var IteratorNext = function(it) {
  var result = arguments.length > 1 ? it.next(arguments[1]) : it.next();
  if (!TypeIsObject(result)) {
    throw new TypeError('bad iterator');
  }
  return result;
};

var IteratorStep = function(it) {
  var result = IteratorNext(it);
  var done = IteratorComplete(result);
  return done ? false : result;
};

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
  if (typeof promise._promise === 'undefined') {
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
      _push(timeouts, fn);
      window.postMessage(messageName, '*');
    };
    var handleMessage = function(event) {
      if (event.source === window && event.data === messageName) {
        event.stopPropagation();
        if (timeouts.length === 0) { return; }
        var fn = _shift(timeouts);
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
  // global Promise below (in order to workaround bugs)
  // https://github.com/Raynos/observ-hash/issues/2#issuecomment-35857671
  var P = global.Promise;
  return P && P.resolve && function(task) {
    return P.resolve().then(task);
  };
};
/*global process */
var enqueue = IsCallable(global.setImmediate) ?
    global.setImmediate.bind(global) :
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
    try {
      handlerResult = handler(argument);
    } catch (e) {
      handlerResult = e;
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
  var _promise = promise._promise;
  var reactions = _promise.fulfillReactions;
  _promise.result = value;
  _promise.fulfillReactions = void 0;
  _promise.rejectReactions = void 0;
  _promise.state = PROMISE_FULFILLED;
  triggerPromiseReactions(reactions, value);
};

var rejectPromise = function(promise, reason) {
  var _promise = promise._promise;
  var reactions = _promise.rejectReactions;
  _promise.result = reason;
  _promise.fulfillReactions = void 0;
  _promise.rejectReactions = void 0;
  _promise.state = PROMISE_REJECTED;
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
    try {
      then = resolution.then;
    } catch (e) {
      return rejectPromise(promise, e);
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
  try {
    _call(then, thenable, resolve, reject);
  } catch (e) {
    reject(e);
  }
};

// This is a common step in many Promise methods
var getPromiseSpecies = function(C) {
  if (!TypeIsObject(C)) {
    throw new TypeError('Promise is not object');
  }
  var S = C[symbolSpecies];
  if (S !== void 0 && S !== null) {
    return S;
  }
  return C;
};

var Promise = function Promise(resolver) {
  if (!(this instanceof Promise)) {
    throw new TypeError('Constructor Promise requires "new"');
  }
  if (this && this._promise) {
    throw new TypeError('Bad construction');
  }
  // see https://bugs.ecmascript.org/show_bug.cgi?id=2482
  if (!IsCallable(resolver)) {
    throw new TypeError('not a valid resolver');
  }
  var promise = emulateES6construct(this, Promise, Promise$prototype, {
    _promise: {
      result: void 0,
      state: PROMISE_PENDING,
      fulfillReactions: [],
      rejectReactions: [],
    },
  });
  var resolvingFunctions = createResolvingFunctions(promise);
  var reject = resolvingFunctions.reject;
  try {
    resolver(resolvingFunctions.resolve, reject);
  } catch (e) {
    reject(e);
  }
  return promise;
};
var Promise$prototype = Promise.prototype;

var _promiseAllResolver = function(index, values, capability, remaining) {
  var alreadyCalled = false;
  return function(x) {
    if (alreadyCalled) { return; }
    alreadyCalled = true;
    values[index] = x;
    if ((--remaining.count) === 0) {
      var resolve = capability.resolve;
      resolve(values); // Call w/ this===undefined
    }
  };
};

var performPromiseAll = function(iteratorRecord, C, resultCapability) {
  var it = iteratorRecord.iterator;
  var values = [];
  var remaining = { count: 1 };
  var next, nextValue;
  for (var index = 0; ; index++) {
    try {
      next = IteratorStep(it);
      if (next === false) {
        iteratorRecord.done = true;
        break;
      }
      nextValue = next.value;
    } catch (e) {
      iteratorRecord.done = true;
      throw e;
    }
    values[index] = void 0;
    var nextPromise = C.resolve(nextValue);
    var resolveElement = _promiseAllResolver(
      index, values, resultCapability, remaining
    );
    remaining.count++;
    nextPromise.then(resolveElement, resultCapability.reject);
  }
  if ((--remaining.count) === 0) {
    var resolve = resultCapability.resolve;
    resolve(values); // Call w/ this===undefined
  }
  return resultCapability.promise;
};

var performPromiseRace = function(iteratorRecord, C, resultCapability) {
  var it = iteratorRecord.iterator;
  var next, nextValue, nextPromise;
  while (true) {
    try {
      next = IteratorStep(it);
      if (next === false) {
        // NOTE: If iterable has no items, resulting promise will never
        // resolve; see:
        // https://github.com/domenic/promises-unwrapping/issues/75
        // https://bugs.ecmascript.org/show_bug.cgi?id=2515
        iteratorRecord.done = true;
        break;
      }
      nextValue = next.value;
    } catch (e) {
      iteratorRecord.done = true;
      throw e;
    }
    nextPromise = C.resolve(nextValue);
    nextPromise.then(resultCapability.resolve, resultCapability.reject);
  }
  return resultCapability.promise;
};

defineProperties(Promise, {
  all: function all(iterable) {
    var C = getPromiseSpecies(this);
    var capability = new PromiseCapability(C);
    var iterator, iteratorRecord;
    try {
      iterator = GetIterator(iterable);
      iteratorRecord = { iterator: iterator, done: false };
      return performPromiseAll(iteratorRecord, C, capability);
    } catch (e) {
      var ex = e;
      if (iteratorRecord && !iteratorRecord.done) {
        try {
          IteratorClose(iterator, true);
        } catch (ee) {
          ex = ee;
        }
      }
      var reject = capability.reject;
      reject(ex);
      return capability.promise;
    }
  },

  race: function race(iterable) {
    var C = getPromiseSpecies(this);
    var capability = new PromiseCapability(C);
    var iterator, iteratorRecord;
    try {
      iterator = GetIterator(iterable);
      iteratorRecord = { iterator: iterator, done: false };
      return performPromiseRace(iteratorRecord, C, capability);
    } catch (e) {
      var ex = e;
      if (iteratorRecord && !iteratorRecord.done) {
        try {
          IteratorClose(iterator, true);
        } catch (ee) {
          ex = ee;
        }
      }
      var reject = capability.reject;
      reject(ex);
      return capability.promise;
    }
  },

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
    var _promise = promise._promise;
    var value;
    switch (_promise.state) {
    case PROMISE_PENDING:
      _push(_promise.fulfillReactions, fulfillReaction);
      _push(_promise.rejectReactions, rejectReaction);
      break;
    case PROMISE_FULFILLED:
      value = _promise.result;
      enqueue(function() {
        promiseReactionJob(fulfillReaction, value);
      });
      break;
    case PROMISE_REJECTED:
      value = _promise.result;
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

module.exports = Promise;
