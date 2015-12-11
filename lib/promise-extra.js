/* Add Promise.all and Promise.race implementations. */
'use strict';
var isArguments = require('is-arguments');

var _call = Function.call.bind(Function.call);
var _forEach = Function.call.bind(Array.prototype.forEach);
var _toString = Function.call.bind(Object.prototype.toString);
var _floor = Math.floor;
var _abs = Math.abs;

var Symbol = global.Symbol || {};
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

var errorObj = {e: {}};
// Try/catch is not supported in optimizing compiler, so it is isolated.
// The -r variant allows specifying the receiver.
function tryCatch0r(fn, receiver) {
  try {
    return fn.call(receiver);
  } catch (e) {
    errorObj.e = e;
    return errorObj;
  }
}
function tryCatch1(fn, arg1) {
  try {
    return fn(arg1);
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
function tryCatch3(fn, arg1, arg2, arg3) {
  try {
    return fn(arg1, arg2, arg3);
  } catch (e) {
    errorObj.e = e;
    return errorObj;
  }
}


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

var IsCallable = (typeof /abc/ === 'function') ? function(x) {
  // Some versions of IE say that typeof /abc/ === 'function'
  return typeof x === 'function' && _toString(x) === '[object Function]';
} : function(x) { return typeof x === 'function'; /* Much faster */};

var ToNumber = function(value) {
  /*
  // Implementations which implement Symbol also throw the proper TypeError
  // if it is converted to a number.
  if (_toString(value) === '[object Symbol]') {
    throw new TypeError('Cannot convert a Symbol value to a number');
  }
  */
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
      var len = Array.isArray(array) ? array.length : ToLength(array.length);
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

var DEFAULT_ARRAY_ITERATOR = {};

var GetIterator = function(o, detectDefault) {
  var itFn = GetMethod(o, symbolIterator);
  if (!IsCallable(itFn)) {
    // Node 0.10 compatibility.
    if (Array.isArray(o) || isArguments(o)) {
      return detectDefault ? DEFAULT_ARRAY_ITERATOR : new ArrayIterator(o);
    }
    // Better diagnostics if itFn is null or undefined
    throw new TypeError('value is not an iterable');
  }
  if (detectDefault && itFn === Array.prototype[symbolIterator]) {
    return DEFAULT_ARRAY_ITERATOR;
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
  innerResult = tryCatch0r(returnMethod, iterator);
  if (innerResult === errorObj) {
    innerException = errorObj.e;
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

var IteratorNext0 = function(it) {
  var result = it.next();
  if (!TypeIsObject(result)) {
    throw new TypeError('bad iterator');
  }
  return result;
};

var IteratorStep = function(it) {
  var result = IteratorNext0(it);
  var done = IteratorComplete(result);
  return done ? false : result;
};

module.exports = function(
  Promise, PromiseCapability, makeCapability, makeCapabilityFast,
  promiseReactionResolve, promiseReactionReject,
  optimizePromiseThen, symbolSpecies
) {

  // This is a common step in many Promise methods
  var getPromiseSpecies = function(C) {
    if (!TypeIsObject(C)) {
      throw new TypeError('Promise is not object');
    }
    if (symbolSpecies !== null) {
      var S = C[symbolSpecies];
      if (S !== void 0 && S !== null) {
        return S;
      }
    }
    return C;
  };

  var _promiseAllResolver = function(index, values, capability, remaining) {
    var alreadyCalled = false;
    return function(x) {
      if (alreadyCalled) { return; }
      alreadyCalled = true;
      values[index] = x;
      if ((--remaining.count) === 0) {
        promiseReactionResolve(capability, values);
      }
    };
  };

  var performPromiseAll = function(iteratorRecord, C, resultCapability) {
    var it = iteratorRecord.iterator;
    var values = [];
    var remaining = { count: 1 };
    var next, nextValue, rejectElement;
    if (resultCapability.constructor === PromiseCapability) {
      // This capability won't be returned to pool.
      rejectElement = resultCapability.reject;
    } else {
      rejectElement = function(e) {
        // Not safe to return capability to pool, since resolves are still
        // pending.
        promiseReactionReject(resultCapability, e, 'no free');
      };
    }
    for (var index = 0; ; index++) {
      next = tryCatch1(IteratorStep, it);
      if (next === errorObj) {
        iteratorRecord.done = true;
        throw errorObj.e;
      } else if (next === false) {
        iteratorRecord.done = true;
        break;
      }
      nextValue = next.value;
      values[index] = void 0;
      var nextPromise = C.resolve(nextValue);
      var resolveElement = _promiseAllResolver(
        index, values, resultCapability, remaining
      );
      remaining.count++;
      optimizePromiseThen(
        nextPromise, resolveElement, rejectElement
      );
    }
    if ((--remaining.count) === 0) {
      promiseReactionResolve(resultCapability, values);
    }
    if (resultCapability.constructor === PromiseCapability) {
      return resultCapability.promise;
    }
    return resultCapability;
  };

  var performPromiseAllArray = function(array, C, resultCapability) {
    var values = new Array(array.length);
    var remaining = { count: 1 };
    var nextValue, rejectElement;
    if (resultCapability.constructor === PromiseCapability) {
      // This capability won't be returned to pool.
      rejectElement = resultCapability.reject;
    } else {
      rejectElement = function(e) {
        // Not safe to return capability to pool, since resolves are still
        // pending.
        promiseReactionReject(resultCapability, e, 'no free');
      };
    }
    for (var index = 0; index < array.length; index++) {
      nextValue = array[index];
      values[index] = void 0;
      var nextPromise = C.resolve(nextValue);
      var resolveElement = _promiseAllResolver(
        index, values, resultCapability, remaining
      );
      remaining.count++;
      optimizePromiseThen(
        nextPromise, resolveElement, rejectElement
      );
    }
    if ((--remaining.count) === 0) {
      promiseReactionResolve(resultCapability, values);
    }
    if (resultCapability.constructor === PromiseCapability) {
      return resultCapability.promise;
    }
    return resultCapability;
  };

  var performPromiseRace = function(iteratorRecord, C, resultCapability) {
    var it = iteratorRecord.iterator;
    var next, nextValue, nextPromise;
    while (true) {
      next = tryCatch1(IteratorStep, it);
      if (next === errorObj) {
        iteratorRecord.done = true;
        throw errorObj.e;
      } else if (next === false) {
        // NOTE: If iterable has no items, resulting promise will never
        // resolve; see:
        // https://github.com/domenic/promises-unwrapping/issues/75
        // https://bugs.ecmascript.org/show_bug.cgi?id=2515
        iteratorRecord.done = true;
        break;
      }
      nextValue = next.value;
      nextPromise = C.resolve(nextValue);
      optimizePromiseThen(
        nextPromise, resultCapability.resolve, resultCapability.reject
      );
    }
    return resultCapability.promise;
  };

  defineProperties(Promise, {
    all: function all(iterable) {
      var C = getPromiseSpecies(this);
      var capability = makeCapabilityFast(C);
      var iterator, iteratorRecord, result, ex;
      iterator = tryCatch2(GetIterator, iterable, true);
      if (iterator === DEFAULT_ARRAY_ITERATOR) {
        // Fast path
        result = tryCatch3(performPromiseAllArray, iterable, C, capability);
        if (result !== errorObj) {
          return result;
        }
        // Not safe to return capability to pool, since there may be
        // calls to `resolve` still pending.
        return promiseReactionReject(capability, errorObj.e, 'no free');
      }
      if (iterator === errorObj) {
        return promiseReactionReject(capability, errorObj.e);
      }
      iteratorRecord = { iterator: iterator, done: false };
      result = tryCatch3(performPromiseAll, iteratorRecord, C, capability);
      if (result !== errorObj) {
        return result;
      }
      ex = errorObj.e;
      if (!iteratorRecord.done) {
        result = tryCatch2(IteratorClose, iterator, true);
        if (result === errorObj) {
          ex = errorObj.e;
        }
      }
      // Not safe to return capability to pool, since there may be
      // calls to `resolve` still pending.
      return promiseReactionReject(capability, ex, 'no free');
    },

    race: function race(iterable) {
      var C = getPromiseSpecies(this);
      var capability = makeCapability(C);
      var iterator, iteratorRecord, reject, result, ex;
      iterator = tryCatch1(GetIterator, iterable);
      if (iterator === errorObj) {
        reject = capability.reject;
        reject(errorObj.e);
        return capability.promise;
      }
      iteratorRecord = { iterator: iterator, done: false };
      result = tryCatch3(performPromiseRace, iteratorRecord, C, capability);
      if (result !== errorObj) {
        return result;
      }
      ex = errorObj.e;
      if (!iteratorRecord.done) {
        result = tryCatch2(IteratorClose, iterator, true);
        if (result === errorObj) {
          ex = errorObj.e;
        }
      }
      reject = capability.reject;
      reject(ex);
      return capability.promise;
    },
  });
};
