const FM        = require('front-matter');
const FS        = require('fs');
const Path      = require('path');
const Liquid    = require('liquid-node');
const Utils     = require('@locomote.sh/utils');

const promisify  = require('util').promisify;
const _readFile  = promisify( FS.readFile );
const _writeFile = promisify( FS.writeFile );
// The fs.copyFile function is only available on node 8.5.0+
const _copyFile  = FS.copyFile ? promisify( FS.copyFile ) : undefined;

class LinkTag extends Liquid.Tag {
    render() {
        // TODO
        return '';
    }
}

const { IncludeTag, IncludesFileSystem } = require('./include');
const { HighlightTag } = require('./highlight');
const { makeSkeletonTag } = require('./skeleton-tag');

// Send variable values to console.log
class LogTag extends Liquid.Tag {

    constructor( template, tagName, markup, tokens ) {
        super();
        this._names = markup.split(/\s+/g).filter( n => n.length > 0 );
        this._lookups = this._names.map( n => {
            return async( ctx ) => {
                let v = await ctx.get( n );
                return JSON.stringify( v );
            };
        });
    }

    render( context ) {
        Promise.all( this._lookups.map( f => f( context ) ) )
        .then( values => {
            console.log('[Heckle Log]%s', values.map( ( v, i ) => ` ${this._names[i]}=${v}` ) );
        });
        return '';
    }
}

function setupLiquid( source, opts ) {
    let engine = new Liquid.Engine();
    let includes = Path.join( source, '_includes');
    engine.registerFileSystem( new IncludesFileSystem( source ) );
    engine.registerFilters({
        'where': async function( input, name, target ) {
            let context = this.context;
            let result = [];
            if( Array.isArray( input ) ) {
                for( let i = 0; i < input.length; i++ ) {
                    let item = input[i];
                    let value;
                    if( item instanceof Liquid.Drop ) {
                        value = await item.resolve( name, context );
                    }
                    else {
                        value = item[name];
                    }
                    if( value == target ) {
                        result.push( item );
                    }
                }
            }
            return result;
        },
        'strip': input => {
            if( typeof input === 'string' ) {
                return input.trim();
            }
            return input;
        },
        'rstrip': input => {
            if( typeof input === 'string' ) {
                return input.trimRight();
            }
            return input;
        },
        'lstrip': input => {
            if( typeof input === 'string' ) {
                return input.trimLeft();
            }
            return input;
        },
        'nonempty': arr => {
            return arr.length > 0;
        },
        'reverse': value => {
            if( Array.isArray( value ) ) {
                // Note that reverse modifies the array in place, so create
                // a copy of the array first.
                return value.slice().reverse();
            }
            if( value instanceof String ) {
                let arr = [];
                for( let i = 0; i < value.length; arr[i] = value[i++] );
                return String.prototype.concat.apply('', arr.reverse() );
            }
            return value;
        },
        'slice': ( value, start, end ) => {
            if( Array.isArray( value ) || value instanceof String ) {
                return value.slice( start, end );
            }
            return value;
        },
        /* liquid-node provides a regex based version of this filter.
        'strip_html': value => {
            return Cheerio.load( value ).text();
        },
        */
        // Resolve a relative path against a reference path.
        'resolve': ( path, ref ) => {
            if( Path.extname( ref ) != '' ) {
                ref = Path.dirname( ref );
            }
            let result = Path.resolve( ref, path );
            return result;
        },
        // Serialize a value to JSON.
        json: value => JSON.stringify( value ),
        // Base 64 encode a string value.
        base64: value => Buffer.from( value ).toString('base64')
    });
    engine.registerTag('link',      LinkTag );
    engine.registerTag('include',   IncludeTag );
    engine.registerTag('highlight', HighlightTag );
    engine.registerTag('log',       LogTag );
    // Register any additional filters and tags defined in options.
    if( opts.tags ) {
        let tags = opts.tags;
        Object.keys( tags ).forEach( name => {
            let tag = tags[name];
            if( typeof tag === 'function' ) {
                // Promote bare render functions to full tags via
                // a skeleton tag class.
                tag = makeSkeletonTag( tag );
            }
            engine.registerTag( name, tag );
        });
    }
    if( opts.filters ) {
        engine.registerFilters( opts.filters );
    }
    return engine;
}

async function findFiles( path ) {
    let files = await Utils.find( path );
    // Filter out blank lines.
    files = files.filter( file => file.length > 0 );
    // Return file paths relative to the base dir.
    files = files.map( file => Path.relative( path, file ) );
    return files;
}

// Use _copyFile if available, fall back to Utils.cp if not.
if( _copyFile ) {
    function copyFile( from, to ) {
        return _copyFile( from, to );
    }
}
else {
    function copyFile( from, to ) {
        return Utils.cp( from, to );
    }
}

function ensureDir( dir ) {
    return Utils.ensureDir( dir );
}

async function readFile( path ) {
    try {
        let data = await _readFile( path );
        return data.toString();
    }
    catch( e ) {
        // Return null if file not found.
        if( e.code === 'ENOENT' ) {
            return null;
        }
        // Throw all other errors.
        throw e;
    }
}

function readFileData( path ) {
    return _readFile( path );
}

async function writeFile( path, data ) {
    let dir = Path.dirname( path );
    await Utils.ensureDir( dir );
    return _writeFile( path, data );
}

function copyData( config, obj ) {
    Object.keys( config ).forEach( key => {
        if( obj[key] === undefined ) {
            obj[key] = config[key];
        }
    });
}

async function rmRF( path, excludes = [] ) {
    try {
        let paths = await Utils.ls( path );
        paths = paths
            .filter( p => !excludes.includes( p ) )
            .map( p => Path.join( path, p ) );
        await Utils.rmdirs( paths );
    }
    catch( e ) {
        // Catch file not found errors; throw all other errors.
        if( e.code != 'ENOENT' ) {
            throw e;
        }
    }
}

/// Create a lookup from an array of values.
function lookup( arr ) {
    const map = arr.reduce( ( m, v ) => (m[v] = true) && m, {});
    return k => map[k] || false;
}

/// Ensure that a file path contains no hidden components.
function isNotHiddenFile( path ) {
    return path
        .split('/')
        .reduce( ( h, c ) => h && c[0] != '.', true )
}

/// Test if a path represents an HTML file.
function isHTMLFile( path ) {
    const extname = Path.extname( path );
    return extname == '.html' || extname == '.md';
}

/**
 * Parse an HTML source file and extract its frontmatter and HTML.
 * @param path      The path to the file to read.
 */
async function parseHTMLSource( path ) {
    const content = await readFile( path );
    if( content === null ) {
        throw new Error(`File not found: ${path}`);
    }
    const { attributes: frontmatter, body: html } = FM( content );
    return { frontmatter, html };
}

/**
 * Parse an HTML source file and extract its HTML, ignoring and frontmatter.
 * @param path      The path to the file to read.
 */
async function readHTML( path, processor ) {
    const { html } = await parseHTMLSource( path );
    return html;
}

/**
 * Batch process an async function across multiple workers.
 * @param items A list of items to process.
 * @param size  The batch size.
 * @param fn    An asynchronous function to apply to each item on the list.
 */
function asyncBatch( items, size, fn ) {
    // A pointer into the list of items.
    let idx = 0;
    // A worker function; fetches items from the list and applies the
    // process function to them. Returns when the queue is empty.
    async function worker( wid ) {
        // Loop whilst items to process.
        while( idx < items.length ) {
            // Get the next item on the list...
            let item = items[idx++];
            // ... and process it if defined.
            if( item !== undefined ) {
                await fn( item, wid );
            }
        }
    }
    // Create the workers.
    let workers = [];
    for( let i = 0; i < size; i++ ) {
        workers.push( worker( i ) );
    }
    // Wait for all workers to complete.
    return Promise.all( workers );
}

module.exports = {
    setupLiquid,
    readFile,
    readFileData,
    writeFile,
    findFiles,
    copyFile,
    ensureDir,
    copyData,
    rmRF,
    lookup,
    isNotHiddenFile,
    isHTMLFile,
    parseHTMLSource,
    readHTML,
    asyncBatch
};

