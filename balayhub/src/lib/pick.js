'use strict';

// Look a query-string word up in an allow-list object. Only the object's own keys count, so
// ?sort=constructor or __proto__ is unknown (undefined) instead of an inherited function.
const own = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : undefined);

module.exports = { own };
