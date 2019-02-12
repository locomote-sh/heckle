
function batch( items, fn, size ) {
    let idx = 0;
    function next() {
        if( idx < items.length ) {
            return items[idx++];
        }
        return undefined;
    }

    async function worker( wid ) {
        while( true ) {
            let item = next();
            if( item === undefined ) {
                break;
            }
            await fn( item, wid );
        }
    }

    let workers = [];
    for( let i = 0; i < size; i++ ) {
        workers.push( worker( i ) );
    }
    return Promise.all( workers );
}


let arr = [];
for( let i = 0; i < 20 ; i++ ) arr.push( i );
console.log( arr );

let qs = [];

function fn( i, wid ) {
    return new Promise( ( resolve ) => {
        let t = ((i % 8) + 1 ) * 1000 * (wid + 1);
        let q = qs[wid];
        if( q ) {
            q.push( i );
        }
        else {
            qs[wid] = [ i ];
        }
        setTimeout( resolve, t );
    });
}

batch( arr, fn, 4 ).then( () => console.log( qs ) );
