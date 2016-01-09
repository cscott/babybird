'use strict';
/* Babybird variant which forces "good" subclasses to opt-in. */
module.exports = require('./lib/promise.js')({
  strictConstructors: true,
});
