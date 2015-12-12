# babybird
[![NPM][NPM1]][NPM2]

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
without having to give us standards compliance.  On the doxbee
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
new module, named (say) `promise.js`, with the contents:
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

## License

Copyright (c) 2015 C. Scott Ananian

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

[NPM1]: https://nodei.co/npm/babybird.png
[NPM2]: https://nodei.co/npm/babybird/

[1]: https://travis-ci.org/cscott/babybird.png
[2]: https://travis-ci.org/cscott/babybird
[3]: https://david-dm.org/cscott/babybird.png
[4]: https://david-dm.org/cscott/babybird
[5]: https://david-dm.org/cscott/babybird/dev-status.png
[6]: https://david-dm.org/cscott/babybird#info=devDependencies
