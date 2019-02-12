class MapList extends Array {

    constructor( key ) {
        super();
        switch( typeof key ) {
            case 'function':
                this._key = key;
                break;
            case 'string':
            case 'number':
                this._key = obj => obj[key];
                break;
            default:
                throw new Error('MapList key property must be a function, string or number');
        }
    }

    _updateMap( item, insert = true ) {
        let key = this._key( item );
        if( key !== undefined ) {
            if( insert ) {
                this[key] = item;
            }
            else delete this[key];
        }
    }

    push( item ) {
        super.push( item );
        this._updateMap( item );
    }

    pop() {
        let item = super.pop();
        this._updateMap( item, false );
    }

    unshift( item ) {
        super.unshift( item );
        this._updateMap( item );
    }

    shift() {
        let item = super.shift();
        this._updateMap( item, false );
        return item;
    }
}

module.exports = MapList;

