'use strict';
/* Babybird variant which is strictly ES6-spec compliant. */
module.exports = require('./lib/promise.js')({
  supportSpecies: true,
  strictConstructors: true,
  dontReuseResolvers: true,
  useES2015Class: true,
});
