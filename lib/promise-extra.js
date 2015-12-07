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

module.exports = function(Promise, PromiseCapability, symbolSpecies) {

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
  });
};