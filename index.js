Object.assign( exports, require('./lib/build') );

exports.serve = require('./lib/serve').serve;
exports.extensions = require('./lib/extensions');

Object.assign( exports, require('./lib/skeleton-tag') );
