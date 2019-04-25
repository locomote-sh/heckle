const promisify = require('util').promisify;
const FS        = require('fs');
const FM        = require('front-matter');
const Path      = require('path');
const Sass      = require('node-sass');

const render    = promisify( Sass.render );
const read      = promisify( FS.readFile );
const write     = promisify( FS.writeFile );
const access    = promisify( FS.access );

// See http://sass-lang.com/documentation/file.SASS_REFERENCE.html#import

async function findImport( ref, url ) {
    let path = Path.join( ref, url );
    let dir  = Path.dirname( path );
    let base = Path.basename( path );
    // List of potential import candidates.
    let files = [
        Path.join( dir, base+'.scss' ),
        Path.join( dir, base+'.sass' ),
        Path.join( dir, '_'+base+'.scss' ),
        Path.join( dir, '_'+base+'.sass' )
    ];
    // Find and return path to first accessible import candidate.
    for( let i = 0; i < files.length; i++ ) {
        try {
            let file = files[i];
            await access( file, FS.constants.F_OK );
            return file;
        }
        catch( e ) {} // File not found or not accessible.
    }
    return false;
}

/*
function importer( url, prev, done ) {
    console.log('IMPORT',url,prev);
    done( null );
}
*/

module.exports = function( source, target, config, dependencies ) {

    const sass    = config.sass || {};
    const sassDir = sass.sass_dir || '_sass';
    const includePaths = [ Path.join( source, sassDir ) ];
    const outputStyle  = sass.style;

    return async function( from, to ) {
        // Don't compile partials - any source file whose filename starts
        // with an underscore.
        if( Path.basename( from )[0] == '_' ) {
            return;
        }
        // Start dependency trace.
        let dependent = Path.relative( source, from );
        try {
            // Read the source file; note that .scss files under Jeyll can
            // have frontmatter, so need to discard this before continuing.
            let content = await read( from );
            let { body } = FM( content.toString() );
            // Render the SCSS file.
            let { css } = await render({
                data:           body,
                indentedSyntax: Path.extname( from ) === '.sass',
                includePaths,
                outputStyle
                /*, importer */
            });
            // Replace the file extension on the output file.
            to = to.slice( 0, '.scss'.length * -1 )+'.css';
            // Write result.
            await write( to, css );
        }
        catch( e ) {
            console.error('Error processing %s', from );
            console.error( e.formatted || e.message || e.description || e );
        }
    };
}
