const Express   = require('express');
const Chokidar  = require('chokidar');
const Path      = require('path');

const { build, loadSiteConfig } = require('./build');

const DefaultPort = 3000;

async function serve( source, target, opts = {}, exts, port = DefaultPort ) {

    let { config } = await loadSiteConfig( source, opts );
    let baseURL = config.baseurl || '/';
    if( baseURL[0] != '/' ) {
        baseURL = '/'+baseURL;
    }

    // Create a web server for the site content.
    let app = Express();
    // See https://expressjs.com/en/4x/api.html#express.static
    app.use( baseURL, Express.static( target ) );
    app.listen( port );
    console.log('Heckle server listing on http://localhost:%d%s', port, baseURL );

    // The build queue. Perform incremental builds of updated content.
    let buildQueue = batchingQueue( 1000, files => {
        build( source, target, opts, exts, files );
    });

    // Create an FS watcher to add updated files to the build queue.
    let watcher = Chokidar.watch( source, {
        ignored: /^_site(\.dependencies|\/.*)/
    });
    watcher.on('all', ( type, file ) => {
        if( type == 'change' ) {
            buildQueue( Path.relative( source, file ) );
        }
    });
}

exports.serve = serve;


/**
 * A batching queue. Allows a series of events to batched into a single
 * event.
 * - Add an item to the queue and notify a listener after a delay.
 * - If a new item is added to the queue before delay has elapsed then
 *   reset the timer.
 * - Once delay has elapsed, pass all items on the queue to the listener
 *   and then reset the queue.
 * @param delay     The notification delay, in ms.
 * @param listener  A listener function.
 */
function batchingQueue( delay, listener ) {
    // A queue of received items.
    let q = [];
    // A delay timer.
    let timer;
    // Return a function for adding items to the queue.
    return function( item ) {
        //console.log('-->',item);
        // Add item.
        q.push( item );
        // If timer previously set then cancel it.
        if( timer ) {
            clearTimeout( timer );
        }
        // Set new timer.
        timer = setTimeout( () => {
            // Pass queue to listener.
            listener( q );
            // Reset the queue.
            q = [];
        }, delay );
    }
}
