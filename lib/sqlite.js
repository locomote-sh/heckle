const Sqlite3 = require('sqlite3').verbose();

function Connection( path ) {
    this._db = new Sqlite3.Database( path );
    this._prev = Promise.resolve();
}

Connection.prototype.init = function( schema ) {
    this.sequence( async () => {
        for( let stmt of schema ) {
            await this.run( stmt );
        }
    });
}

Connection.prototype.run = function( statement, params = [] ) {
    return new Promise( ( resolve, reject ) => {
        this._db.run( statement, params, function( err ) {
            if( err ) {
                reject( err );
            }
            else {
                resolve( this.lastID );
            }
        });
    });
}

Connection.prototype.all = function( statement, params = [] ) {
    return new Promise( ( resolve, reject ) => {
        this._db.all( statement, params, ( err, rows ) => {
            if( err ) {
                reject( err );
            }
            else {
                resolve( rows );
            }
        });
    });
}

Connection.prototype.first = function( statement, params = [] ) {
    return new Promise( ( resolve, reject ) => {
        this._db.all( statement, params, ( err, result ) => {
            if( err ) {
                reject( err );
            }
            else {
                resolve( result && result[0] );
            }
        });
    });
}

Connection.prototype.sequence = function( next ) {
    this._prev = this._prev.then( next );
    return this._prev;
}

Connection.prototype.close = function() {
    this._db.close();
}

exports.Connection = Connection;

