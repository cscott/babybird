'use strict';

if (global.useBluebird)
    //Currently promisifies only Node style callbacks
    var lifter = require('bluebird').promisify;
else if(global.useThenPromise) {
    var lifter = require("promise").denodeify;
}
else if (global.useThisImpl || global.useNative) {
    if (global.useNative) {
        try {
            if (!/^function race\(/.test(Promise.race.toString()))
                throw 0;
        } catch (e) {
            throw new Error("No ES6 promises available");
        }
    }
    var ThisPromise = global.useThisImpl || global.Promise;
    var lifter = function(nodefn) {
        return function() {
            var self = this;
            var l = arguments.length;
            var args = new Array(l + 1);
            for (var i = 0; i < l; ++i) {
                args[i] = arguments[i];
            }
            return new ThisPromise(function(resolve, reject) {
                args[l] = function(err, val) {
                    if (err) reject(err);
                    else resolve(val);
                };
                nodefn.apply(self, args);
            });
        };
    };
}
else {
    throw new Error("no lifter");
}

var f = require('./dummy');

var makefakes = require('./fakemaker');

// A function taking n values or promises and returning
// a promise
function dummyP(n) {
    return lifter(f.dummy(n));
}

// Throwing version of above
function dummytP(n) {
    return lifter(f.dummyt(n));
}

makefakes(dummyP, dummytP, lifter);

