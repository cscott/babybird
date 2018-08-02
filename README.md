# babybird
[![NPM][NPM1]][NPM2] [![Promises/A+ 1.0 compliant][PAP1]][PAP2]

[![Build Status][1]][2] [![dependency status][3]][4] [![dev dependency status][5]][6]

A very fast standards-compliant [ES2015] Promise library for node.

There are several fast promise implementations out there, like
[`bluebird`], but they all add a bunch of stuff that's not in the
[ES2015] Promise spec.  Further, as they've added more and more
features they've grown so complex that they can't be easily audited
against the ES2015 spec (or the official `test262` test suite).

The `babybird` library is a stripped-down "just ES2015" Promise
implementation, which passes the Promises/A+ and `test262` test
suites.  It is very competitive with the performance of [`bluebird`],
without having to give up standards compliance.  On the `doxbee`
benchmark running under node 5.1.0, `babybird` is 2.4 times faster
than native Promises, 4 times faster than the Promise implementation
in [`core-js`], and almost 9 times faster than the Promise
implementation in [`es6-shim`].  The performance improvement is even
greater when running under node 0.10.

Further, `babybird` supports subclassing (as all ES2015 Promise
implementations ought).  This means that if you'd like additional
bells and whistles on your Promises, you can add then via subclassing
and without stomping on the global Promise.  In fact, the [`prfun`]
library provides much the same feature set as `bluebird`, but with a
clean separation of concerns.  Further, `prfun` runs on top of *any*
ES2015-compliant Promise implementation, so if `babybird` is someday
supplanted, you can just swap out the core Promise implementation
underneath `prfun` without having to update any of your uses of the
core ES2015 or extended `prfun` API.

## Usage
```
npm install babybird
```

```javascript
var Promise = require('babybird');
```

The `babybird` library plays very nicely with [`prfun`], if you'd like
a few bells and whistles with your library.  I recommend creating a
new module, named (say) `promise.js`, with these contents:
```javascript
module.exports = require('prfun/wrap')(require('babybird'));
```
and then using the wrapped promises this way:
```javascript
var Promise = require('./promise.js');
```

## Benchmarks
These benchmarks are derived from the benchmarks included with
`bluebird`.  A few of the bluebird test cases have been forked to
add "fair" versions, since bluebird obtained some of its speed by
using a faster `promisify` method than that provided to other
promise implementations, and by using a few `bluebird`-specific
APIs which appeared to be tuned for the benchmark.

You can reproduce these results using `npm run bench`.

### Node 0.10
```
results for 20000 parallel executions, 1 ms per I/O op

file                                         time(ms)  slowdown  memory(MB)
callbacks-baseline.js                             819      0.48  32.99
promises-bluebird.js                             1383      0.81  50.59
promises-bluebird-fair.js                        1715      1.00  39.02
promises-cscott-babybird-noall.js                1870      1.09  41.19
promises-cscott-babybird.js                      1925      1.12  61.81
promises-cscott-babybird-prfun.js                1991      1.16  48.60
promises-then-promise-es6.js                     3084      1.80  64.54
promises-then-promise.js                         3112      1.81  64.39
promises-paulmillr-es6shim.js                   12475      7.27  94.20
promises-zloirock-corejs.js                     18695     10.90  94.11

Platform info:
Linux 4.2.0-1-amd64 ia32
Node.JS 0.10.40
V8 3.14.5.9
Intel(R) Core(TM) i7 CPU       L 640  @ 2.13GHz × 4
```

### Node 5.1.0
```
results for 20000 parallel executions, 1 ms per I/O op

file                                         time(ms)  slowdown  memory(MB)
callbacks-baseline.js                             826      0.53  29.29
promises-bluebird-generator.js                   1105      0.71  25.49
promises-bluebird-generator-fair.js              1113      0.72  28.27
promises-cscott-babybird-prfun-generator.js      1202      0.77  33.68
promises-bluebird-fair.js                        1553      1.00  51.38
promises-cscott-babybird-noall.js                1623      1.05  65.25
promises-bluebird.js                             1643      1.06  43.66
promises-cscott-babybird-prfun.js                1707      1.10  72.33
promises-cscott-babybird.js                      1724      1.11  72.82
promises-then-promise-es6.js                     2985      1.92  106.96
promises-then-promise.js                         3004      1.93  106.69
promises-ecmascript6-native.js                   3770      2.43  176.96
promises-zloirock-corejs.js                      6298      4.06  155.89
promises-paulmillr-es6shim.js                   13892      8.95  227.61

Platform info:
Linux 4.2.0-1-amd64 ia32
Node.JS 5.1.0
V8 4.6.85.31
Intel(R) Core(TM) i7 CPU       L 640  @ 2.13GHz × 4
```

## Optimization notes

The `babybird` implementation began with a fairly faithful mechanical
translation of the [ES6 Promise spec] into JavaScript.  In this
section I'm going to list the optimizations which were then applied,
roughly ordered so that those with the largest effect on performance
come first.  This is only a very rough ordering, however.

* Use the `asap` package and reuse task objects instead of calling
  `setImmediate` directly.  This avoids almost all allocation when
  dispatching asynchronous handlers. (Commit [`eb1f4ea7`] and [`3216461f`])
* Avoid creating a new `PromiseCapability` in `Promise#then` if the
  return value will be discarded --- for example, in the
  `PromiseResolveThenableJob` (when a `Promise` is resolved to another
  `Promise`) and in the implementation of `Promise.all` and
  `Promise.race`.  Since creating a `PromiseCapability` calls a
  user-supplied `Promise` constructor, and this call is
  user-observable, we can only perform this optimization when we are
  certain the constructor does not have side effects.  We call
  this the **"`then0` optimization"**.
  (Commit [`919d7aaf`], [`f717a7b1`], [`3a1bf92a`])
* Further optimize `Promise#then` by bypassing the standard `Promise`
  constructor, which requires the creation of three separate closures
  (the `executor` function and separate `resolve` and `reject` functions).
  When we know that the constructor is safe, we use an internal-only
  constructor which uses default `resolve`/`reject` implementations
  without requiring allocation.  The native `Promise` implementation
  in v8 contains a
  [version of this optimization](https://github.com/v8/v8/blob/bc55af3c97d6a7552a409e1b79158c3192908c57/src/js/promise.js#L237).
  We call this the **"`PromiseCapability` optimization"**.
  (Commit [`b6eea14d`])
* Use a free list to reuse `PromiseCapability` objects and avoid
  unnecessary allocation inside `Promise#then`. (Commit [`9f27ecd4`])
* Inline the reaction array into the Promise object, with special
  attention to the first element.  Most Promises only get a single
  handler registered, so we can avoid the array allocations entirely
  for this common case. We further combined the `state` and `reaction
  length` fields to reduce memory further. We call this the
  **"Promise fields optimization"**.
  (Commit [`6cad108a`] and [`dd0c7e4d`])
* Separate the `createResolvingFunctions` implementation for
  the `Promise` constructor and `Promise#then`.  For the constructor,
  reuse the `state` field to track the `alreadyResolved` state, to
  avoid allocating an extra boolean for this common case. (Commit [`ed96b474`])
* Specialize `Promise.all` and `Promise.race` if the argument is a
  true array, avoiding the overhead of using `Iterator` objects.
* Avoid the use of `try`/`catch`, since their presence deoptimizes
  the entire function containing them.  Where necessitated by the ES6
  specification (calling user-provided handlers, for example),
  encapsulate the `try`/`catch` in separate functions to contain the scope
  of deoptimization. (Commit [`28a151ae`])
* Additional micro-optimizations, many informed by [IRHydra2]: avoid
  the use of `Object#toString` on the fast path, split some functions
  to better allow call site specialization, avoid some polymorphism,
  avoid use of `arguments`, and improve the implementation of the
  `TypeIsObject` check.

In addition, we made some improvements to [`prfun`]'s `Promise.async`
implementation to take advantage of the `then0` optimization (commit
[`0e7dd8ce`]).  This allows even greater performance when writing
async code using generators, as it avoids the necessity of creating
an extra `Promise` at every `yield`.

The performance implications of the standard `Promise` constructor
and field layout were raised by the author of [`bluebird`] on
[StackExchange](http://programmers.stackexchange.com/a/279003).
This explanation is somewhat incomplete: the performance advantage
of bluebird's `promisify` is somewhat overstated, and the
"`then0`" and "`PromiseCapability`" optimizations are not mentioned---but
these prove to be very significant.  It appears that the best
way to optimize a `Promise` is avoid creating it entirely (the
"`then0`" optimization).  If you have to create it, avoid the
creation of three closures and a `PromiseCapability` object
if you can (the "`PromiseCapability`" optimization).  And then
finally, if you must, at least take care to avoid creating
unnecessary reaction arrays (the "Promise fields" optimization).

It is also the case that avoiding the naive use of `setImmediate`
confers a significant performance advantage, which I don't
believe is widely discussed.

### Subclass support
The primary limitation of the `then0` and `PromiseCapability`
optimizations is that they require the `Promise` subclass'
constructor to be side-effect free, and not to do anything with
the provided `executor` function except pass it unmodified to
its superclass constructor.  If you wish to use a `Promise`
subclass constructor which does not adhere to these rules,
then you should set `strictConstructors` to true in `promise.js`.
You can then turn on these optimizations on a subclass-by-subclass
basis by setting `PromiseSubclass.noSideEffects = true` where
appropriate.  (The [`prfun`] library already sets `noSideEffects`
on the subclass it creates.)

## License

Copyright (c) 2015-2016 C. Scott Ananian

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

[ES2015]:     http://www.ecma-international.org/ecma-262/6.0/
[`bluebird`]: https://github.com/petkaantonov/bluebird
[`es6-shim`]: https://github.com/paulmillr/es6-shim
[`core-js`]:  https://github.com/zloirock/core-js
[`prfun`]:    https://github.com/cscott/prfun
[ES6 Promise spec]: http://www.ecma-international.org/ecma-262/6.0/#sec-promise-objects
[IRHydra2]:   http://mrale.ph/irhydra/2/
[`6cad108a`]: https://github.com/cscott/babybird/commit/6cad108aa1cbc90954a40c964804ba8ee3070bd7
[`eb1f4ea7`]: https://github.com/cscott/babybird/commit/eb1f4ea70cee543198d03fd06f69a73f02702a5d
[`3216461f`]: https://github.com/cscott/babybird/commit/3216461f3e6583cbee46e93459f560544f45bf47
[`dd0c7e4d`]: https://github.com/cscott/babybird/commit/dd0c7e4daa39d09e67a65d35bcec563ed2b570bc
[`28a151ae`]: https://github.com/cscott/babybird/commit/28a151aeabe4cf493b4affa5e433ccc04213cdee
[`ed96b474`]: https://github.com/cscott/babybird/commit/ed96b47435e0e53b5bdcdbc0b152686e91e78abe
[`919d7aaf`]: https://github.com/cscott/babybird/commit/919d7aaf3239405e52fa5483ce1a2ffa48e40893
[`f717a7b1`]: https://github.com/cscott/babybird/commit/f717a7b1b3f517df9cb40cfefd40d929ffe85d86
[`3a1bf92a`]: https://github.com/cscott/babybird/commit/3a1bf92a4bb61512fa45af25d62dd478e9e2b3ad
[`b6eea14d`]: https://github.com/cscott/babybird/commit/b6eea14d57852654d8eaf9d62f35b5e52d321479
[`9f27ecd4`]: https://github.com/cscott/babybird/commit/9f27ecd44c611f90e990e0c78167e1e8cc71fffc
[`0e7dd8ce`]: https://github.com/cscott/prfun/commit/0e7dd8ceedf0a429ad40fffd3c0e8c1f48a7e87e


[NPM1]: https://nodei.co/npm/babybird.png
[NPM2]: https://nodei.co/npm/babybird/

[1]: https://travis-ci.org/cscott/babybird.png
[2]: https://travis-ci.org/cscott/babybird
[3]: https://david-dm.org/cscott/babybird.png
[4]: https://david-dm.org/cscott/babybird
[5]: https://david-dm.org/cscott/babybird/dev-status.png
[6]: https://david-dm.org/cscott/babybird#info=devDependencies

[PAP1]: https://promisesaplus.com/assets/logo-small.png
[PAP2]: https://promisesaplus.com/
