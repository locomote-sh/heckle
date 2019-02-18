/// Functions for loading extension modules.

const Path = require('path');

// Attempt to load a module by name.
function loadModule( name, retry = false ) {
    // Resolve modules specified using relative path names.
    if( name.indexOf('./') == 0 ) {
        // Resolve modules specified using relative path names.
        name = Path.resolve( name );
    }
    try {
        let module = require( name );
        console.log('Loaded extension %s', name );
        return module;
    }
    catch( e ) {
        if( e.code == 'MODULE_NOT_FOUND' && !retry ) {
            // Module might be a relative path, prepend './' and try
            // again.
            return loadModule('./'+name, true );
        }
        console.error( e );
        process.exit( 1 );
    }
}

// A list of loaded extensions.
const exts = [];

/**
 * Add extension module(s) to the set of loaded modules.
 * @param modules   A string with name(s) of modules to load; multiple
 *                  names are separated by commas.
 */
function add( modules ) {
    if( typeof modules !== 'string' ) {
        return;
    }
    // Load modules and add to list of extensions.
    modules
        .split(',')
        .map( module => loadModule( module ) )
        .forEach( ext => exts.push( ext ) );
}

/**
 * Return the loaded extensions. If no extensions are loaded then
 * returns an empty object. If just one extension module is loaded
 * then returns that. If multiple extensions are loaded then these
 * are aggregated into a single extension object and returned.
 */
function get() {
    if( exts.length == 0 ) {
        return {};
    }
    if( exts.length == 1 ) {
        return exts[0];
    }
    // Reduce init functions to a single function call. Functions
    // are called in the order in which their parent extension modules
    // were added.
    const init = exts.reduce( ( prev, ext ) => {
        let { init } = ext;
        if( init ) {
            // If the ext supplies an init function then chain it
            // after the preceeding init function calls.
            return async ( context, engine ) => {
                await prev( context, engine );
                await init( context, engine );
            };
        }
        return prev;
    }, () => {});
    // Reduce tags and filters to single maps. Tags/filters in extension
    // modules added later take precedence over ones added earlier.
    const tags = exts.reduce( ( tags, ext ) => {
        return Object.assign( tags, ext.tags );
    }, {});
    const filters = exts.reduce( ( filters, ext ) => {
        return Object.assign( filters, ext.filers );
    }, {});
    // Return the aggregated extension.
    return { init, tags, filters };
}

// Check environment for extension modules.
add( process.env.HECKLE_EXTS );

module.exports = { add, get };
