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
        const key = this._key( item );
        if( key !== undefined ) {
            if( insert ) {
                this[key] = item;
            }
            else delete this[key];
        }
        return key;
    }

    push( item ) {
        this.add( item );
    }

    unshift( item ) {
        this.add( item );
    }

    /**
     * Add an item to the map/list.
     * Keeps all items in key order on the list.
     */
    add( item ) {
        // Add the item to the list, get its key.
        const key = this._updateMap( item );
        // Find the first item on the list whose key is >= than the item's key.
        const idx = this.findIndex( item => this._key( item ) >= key );
        // If an item was found...
        if( idx > -1 ) {
            // ...and if the found item shares the same key...
            if( this._key( this[idx] ) === key ) {
                // ...then replace the item.
                this[idx] = item;
            }
            // ...else insert the new item before the found item.
            else this.splice( idx, 0, item );
        }
        // ...else no key found >= current key, append new item to end of list.
        else super.push( item );
    }

}

module.exports = MapList;

