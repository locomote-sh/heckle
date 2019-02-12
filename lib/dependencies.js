const Crypto = require('crypto');
const FS     = require('fs');
const assert = require('assert');
const LR     = require('line-reader');
const Mode   = require('./runmode');

const openLineReader = require('util').promisify( LR.open );

/**
 * A class for tracking document dependencies.
 * Records a list of files that a document is dependent upon
 * to be built (e.g. layouts and includes used to generate
 * the file's output).
 */
class Dependencies {

    constructor( dbpath, exts ) {
        // The path to the saved dependency graph.
        this._dbpath = dbpath;
        // A path ID counter.
        this._pathCounter = 0;
        // A map of file paths to allocated IDs.
        this._pathIDs = {};
        // Dependencies is keyed by list of buildable documents.
        this._dependencies = {};
        // Dependents values are lists of buildable documents.
        this._dependents = {};
        if( exts ) {
            // Create a fingerprint of build extensions.
            this._exts_fp = this._makeExtsFingerprint( exts );
        }
    }

    /// Generate a fingerprint for build options.
    _makeExtsFingerprint( exts ) {
        let hash = Crypto.createHash('sha256');
        let init = exts.init;
        if( init ) {
            hash.update( init.toString() );
        }
        if( exts.layouts ) {
            Object.keys( exts.layouts )
                .sort()
                .forEach( k => hash.update( exts.layouts[k].toString() ) );
        }
        if( Array.isArray( exts.tags ) ) {
            exts.tags.forEach( o => hash.update( o.toString() ) );
        }
        if( Array.isArray( exts.filters ) ) {
            exts.filters.forEach( o => hash.update( o.toString() ) );
        }
        return hash.digest('hex').substring( 0, 20 );
    }

    /**
     * Lookup the ID for a path.
     * Allocate a new ID if necessary.
     */
    getIDForPath( path ) {
        let id = this._pathIDs[path];
        if( !id ) {
            id = this._pathIDs[path] = this._pathCounter++;
        }
        return id;
    }

    startTrace( incremental ) {
        if( !incremental ) {
            this._dependencies = {};
        }
        this._traces = {};
    }

    /**
     * Record a dependency of the current file being built.
     */
    trace( path, context ) {
        let dependent = context.dependent;
        assert( dependent, 'No context dependent set');
        let depID  = this.getIDForPath( dependent );
        let dependencies = this._traces[depID];
        if( !dependencies ) {
            dependencies = this._traces[depID] = {};
        }
        let pathID = this.getIDForPath( path );
        dependencies[pathID] = true;
    }

    endTrace() {
        for( let id in this._traces ) {
            this._dependencies[id] = Object.keys( this._traces[id] );
        }
        delete this._traces;
    }

    /**
     * Return a list of the file paths that a file path is dependent on.
     */
    async getDependencies( path ) {
        let pathID = this.getIDForPath( path );
        return this._dependencies[pathID] || [];
    }

    /**
     * Return a list of paths of all top-level dependents.
     * @deprecated
     */
    async getDependentPaths() {
        return Object.keys( this._pathIDs );
    }

    /**
     * Return a list of files to build based on the dependencies of a list
     * of provided files.
     */
    async getBuildList( paths, exts ) {
        // First fingerprint the provided exts and compare to the stored
        // value; if different then force a full build by returning undefined
        // here.
        let fp = this._makeExtsFingerprint( exts );
        if( fp != this._exts_fp ) {
            return undefined;
        }
        // Generate a mapping listing dependents of each file.
        let dependents = {};
        let pathIDs = Object.keys( this._dependencies );
        for( let pathID in pathIDs ) {
            // Iterate over the dependencies of each path.
            let depIDs = this._dependencies[pathID];
            if( depIDs ) {
                depIDs.forEach( depID => {
                    // Get the dependents of the current dependency.
                    let deps = dependents[depID];
                    if( !deps ) {
                        deps = dependents[depID] = {};
                    }
                    // Add current path as a dependent of the dependency.
                    deps[pathID] = true;
                });
            }
        }
        // A function for resolving all dependents of a page.
        // Recursively looks up all dependents, sub-dependents etc.
        // of a path.
        function getDependents( pathID, result ) {
            // Get dependents of the current path.
            let deps = dependents[pathID];
            // Continue if current page not already processed + dependents found.
            if( !result[pathID] && deps ) {
                // Add current path to result.
                result[pathID] = true;
                // Process dependents on the current path's dependents.
                Object.keys( deps )
                    .forEach( depID => getDependents( depID, result ) );
            }
            return result;
        }
        // Lookup all dependents of the specified paths.
        let pathDependents = {};
        for( let path of paths ) {
            let pathID = this.getIDForPath( path );
            getDependents( pathID, pathDependents );
        }
        // Convert dependent IDs to paths.
        let result = [];
        for( let path in this._pathIDs ) {
            let id = this._pathIDs[path];
            if( pathDependents[id] ) {
                result.push( path );
            }
        }
        return result;
    }

    /**
     * Save the set of dependencies to a file.
     */
    save() {
        return new Promise( ( resolve, reject ) => {
            let outs = FS.createWriteStream( this._dbpath );
            outs.on('finish', resolve );
            write( this, val => outs.write( JSON.stringify( val )+'\n' ) );
            outs.end();
        });
    }

    /**
     * Load previously saved dependencies from a file.
     */
    async load() {
        let loaded = false;
        try {
            let reader = await openLineReader( this._dbpath );
            await read( this, () => {
                if( reader.hasNextLine() ) {
                    return new Promise( ( resolve, reject ) => {
                        reader.nextLine( ( err, line ) => {
                            try {
                                if( err ) throw err;
                                resolve( JSON.parse( line ) );
                            }
                            catch( e ) {
                                reject( e );
                            }
                        });
                    });
                }
                return Promise.resolve();
            });
            reader.close( err => { if( err ) throw err; } );
            loaded = true;
        }
        catch( e ) {
            if( e.code != 'ENOENT' ) {
                console.error('Error loading dependencies', e );
            }
        }
        return loaded;
    }

}

exports.Dependencies = Dependencies;

// Write dependencies to an output stream.
function write( deps, write ) {
    let { _exts_fp, _pathCounter } = deps;
    write({ _exts_fp, _pathCounter });
    let pathIDs = deps._pathIDs;
    for( let path in pathIDs ) {
        let id = pathIDs[path];
        write([ path, id ]);
    }
    write('--');
    let dependencies = deps._dependencies;
    for( let id in dependencies ) {
        let ds = dependencies[id];
        write([ id, ds ]);
    }
    write('--');
}

// Read serialized dependencies from an input stream.
async function read( deps, read ) {
    let values = await read();
    Object.assign( deps, values );
    let pathIDs = {};
    let field = await read();
    while( field != '--' ) {
        pathIDs[field[0]] = field[1];
        field = await read();
    }
    deps._pathIDs = pathIDs;
    let dependencies = {};
    field = await read();
    while( field != '--' ) {
        dependencies[field[0]] = field[1];
        field = await read();
    }
    deps._dependencies = dependencies;
    return deps;
}
