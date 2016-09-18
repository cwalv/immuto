import { Map } from "immutable";
import { Unsubscribe, createStore } from "redux"

/**
 * The only thing all action types have in common is a string
 * property called type, which must be unique across all actions
 * handled by the same reducer.
 *
 * We adopt the additional (popular) pattern of collecting any
 * further data into a single payload property. This makes the
 * very common case of a single value very succinct.
 */
export interface Action<T extends string, P> {
    readonly type: T;
    readonly payload: P;
}

/**
 * Common features of an ActionCreator and a CollectionDefinition.
 */
export interface ActionDefinition<S, T extends string, P> {
    readonly type: T;

    reduce(state: S, payload: P): S;

    readonly payloadType: P;
    readonly stateType: S;
}

/**
 * An ActionCreator is a function that creates actions and can
 * also be registered with a reducer.
 */
export interface ActionCreator<S, T extends string, P>
    extends ActionDefinition<S, T, P> {

    (payload: P): Action<T, P>;
}

/**
 * Defines an action, for later inclusion in a reducer.
 */
export function action<S, T extends string, P>(
    type: T,
    reduce: (state: S, payload: P) => S
): ActionCreator<S, T, P> {

    function create(payload: P) {
        return { type, payload };
    }

    return assign(create, {
        type,
        reduce,
        payloadType: undefined! as P,
        stateType: undefined! as S
    });
}

export interface MinimalReducer<S, A> {
    /**
     * Reduce function
     */
    (state: S, action: A): S;

    /**
     * A suitable initial state
     */
    empty: S;
}

/**
 * A Reducer is a function that takes a state object and an action
 * and returns a modified state object. Here it is also equipped
 * with a method called action which allows multiple reducer
 * functions to be declaratively merged together into a single
 * function, and a store method that wraps Redux's createStore
 * to make it perfectly type-safe.
 *
 * Note that reducers are immutable - given a reducer x, calling
 * x.action(...) returns a new reducer combination rather than
 * modifying x.
 */
export interface Reducer<S, A> extends MinimalReducer<S, A> {

    /**
     * Reduce function
     */
    (state: S, action: A): S;

    /**
     * A suitable initial state
     */
    empty: S;

    /**
     * Dummy member for use with typeof (does not have
     * a useful runtime value.)
     */
    actionType: A;
    cursorType: Cursor<S, A>;

    /**
     * Returns an enhanced Reducer capable of reducing
     * some additional action type.
     */
    action<T extends string, P>(
        definition: ActionDefinition<S, T, P>
    ): Reducer<S, A | Action<T, P>>;

    /**
     * Creates a Redux store with extra type-safety.
     */
    store(): Store<S, A>;
}

function isAction<T extends string>(
    obj: any,
    type: T
): obj is Action<T, any> {
    return obj && obj.type === type;
}

function chain<S, RA, HT extends string, HP>(
    headType: HT,
    empty: S,
    head: (state: S, payload: HP) => S,
    rest: (state: S, action: RA) => S
): Reducer<S, RA | Action<HT, HP>> {

    type A = RA | Action<HT, HP>;

    function reduce(state: S, action: A) {
        if (isAction(action, headType)) {
            return head(state, action.payload);
        }

        return rest(state, action);
    }

    return assign(reduce, {

        actionType: undefined! as A,
        cursorType: undefined! as Cursor<S, A>,

        empty,

        action<T extends string, P>(
            def: ActionDefinition<S, T, P>
        ) : Reducer<S, Action<T, P> | A> {
            return chain<S, A | RA, T, P>(def.type, empty, def.reduce, reduce);
        },

        store(): Store<S, A> {
            return createStore(reduce);
        }
    });
}

/**
 * Creates a starter object from which a Reducer can be formed by
 * calling the action method.
 */
export function reducer<S>(empty: S) {
    return {
        action<T extends string, P>(
            def: ActionDefinition<S, T, P>
        ) : Reducer<S, Action<T, P>> {
            return chain<S, never, T, P>(def.type, empty, def.reduce, s => s === undefined ? empty : s);
        }
    };
}

export interface Subscribable {
    subscribe(listener: () => void): Unsubscribe;
}

/**
 * Describes a minimal Redux-like store. Note that stores are not
 * immutable (that's their whole purpose) and therefore getState is
 * not pure (it may return a different value each time you call it).
 */
export interface Store<S, A> extends Subscribable {
    dispatch<A1 extends A>(action: A1): A1;
    getState(): S;
}

/**
 * A pure representation of the state of a store or part of a store.
 * A cursor's value property never changes. Instead, the dispatch
 * method returns a new cursor representing the new state.
 *
 * Note that, unlike a traditional non-Redux cursor, updating is
 * always performed by dispatching an action.
 */
export interface Cursor<S, A> {

    /**
     * The state at the time this cursor was created.
     */
    readonly state: S;

    /**
     * Sends an action into the store's reducer, resulting in the
     * store updating, and a new cursor is returned representing
     * the new state.
     */
    (action: A): Cursor<S, A>;
}

/**
 * Takes a snapshot of a Redux-like store, making it into a pure cursor.
 */
export function snapshot<S, A>(
    store: Store<S, A>,

): Cursor<S, A> {
    function dispatch(action: A) {
        store.dispatch(action);
        return snapshot(store);
    }

    const state = store.getState();

    return assign(dispatch, {
        exists: true,
        state,
        valueOf() {
            return state;
        }
    });
}

/**
 * Creates a function capable of making cursors, given an outer
 * cursor (a whole store or large portion of a store) and a key
 * (such as a string or number) that identifies a smaller portion
 * of the store.
 *
 * Internally this consists of a function for fetching the inner
 * state and a function for creating an action to update the outer
 * state.
 */
export function items<OS, OA, K, IS, IA>(
    fetch: (outer: OS, key: K) => IS,
    update: (key: K, action: IA) => OA
) {
    return (outer: Cursor<OS, OA>, key: K): Cursor<IS, IA> => {
        const fetched = fetch(outer.state, key);

        function dispatch(innerAction: IA) {
            return items(fetch, update)(
                outer(update(key, innerAction)), key);
        };

        return assign(dispatch, {
            state: fetched,
            valueOf() {
                return fetched;
            }
        });
    };
}

/**
 * Creates a function capable of making cursors, given an outer
 * cursor, but no key (a singular version of the items function.)
 */
export function item<OS, OA, IS, IA>(
    fetch: (outer: OS) => IS,
    update: (action: IA) => OA
) : (outer: Cursor<OS, OA>) => Cursor<IS, IA> {

    const impl = items<OS, OA, void, IS, IA>(fetch, (_, action) => update(action));
    return (outer: Cursor<OS, OA>) => impl(outer, undefined);
}

/**
 * The payload format used by collection actions. If remove is true,
 * the action removes the specified key from the collection and the
 * update property is ignored. Otherwise if update is undefined then
 * the specified key is set to the collection's empty value. If it
 * is defined then it is an action that is dispatched to the item
 * at the specified key.
 */
export interface Update<K, U> {
    key: K;
    update?: U;
    remove?: boolean;
}

export interface CollectionOperations<C, K, I> {
    get: (state: C, key: K, emptyItem: I) => I;
    set: (state: C, key: K, item: I) => C;
    remove: (state: C, key: K, emptyItem: I) => C;
}

export function immutableMapOperations<K, I>(): CollectionOperations<Map<K, I>, K, I> {
    return {
        get(items, key, emptyItem) {
            return items.has(key) ? items.get(key) : emptyItem;
        },

        set(items, key, item) {
            return items.set(key, item);
        },

        remove(items, key, emptyItem) {
            return items.remove(key);
        }
    };
}

const builtInOperations: CollectionOperations<any, any, any> = {    
    get(items, key, emptyItem) {
        return Object.prototype.hasOwnProperty.call(items, key) ? items[key] : emptyItem;
    },

    set(items, key, item) {
        return amend(items, { [key]: item });
    },

    remove(items, key) {
        items = assign({}, items);
        delete items[key];
        return items;
    }
};

export function stringMapOperations<I>(): CollectionOperations<{ [name: string]: I }, string, I> {
    return builtInOperations;
}

export function numberMapOperations<I>(): CollectionOperations<{ [id: number]: I }, number, I> {
    return builtInOperations;
}

export function arrayOperations<I>(): CollectionOperations<I[], number, I> {
    return {    
        get(items, key, emptyItem) {
            const r = items[key];
            return r === undefined ? emptyItem : r;
        },

        set(items, key, item) {
            items = items.slice(0);
            items.splice(key, 1, item);
            return items;
        },

        remove(items, key, emptyItem) {
            items = items.slice(0);
            items[key] = emptyItem;
            return items;
        }
    };
}

/**
 * A collection is a reducer that can insert, update and remove items,
 * specified by key. For example, a shop has shelves. So it has a collection
 * "SHELVES", where each has a numeric key. The action's payload is the
 * combination of a key and optionally another action that operates on the
 * shelf specified by the key, so the payload has the type:
 *
 *     { key: number, update?: Shelf.Action }
 *
 * If the key specifies an item not already in the collection, a new item
 * is created using the collection's "empty item" object. If update is
 * undefined then the item specified by key is removed from the collection.
 *
 * An item cursor is a cursor that refers to an item within a collection.
 * For example, Shop.shelfAt(shopCursor, 3) refers to the shelf with key 3.
 * It may not exist yet, in which case the cursor's value will be undefined.
 * Any action of type Shelf.Action can be dispatched through the cursor, and
 * it will automatically be wrapped in a SHELVES action with the right key:
 *
 *     {
 *       type: "BOOKS",
 *       payload: {
 *         key: 3,
 *         update: {
 *           type: "SET_PRICE",
 *           3.99
 *         }
 *       }
 *     }
 *
 * Naturally this wrapping process can be nested to any depth.
 */

export interface CollectionCursor<I, A> extends Cursor<I, A> {
    remove(): void;
}

export interface CollectionDefinition<T extends string, S, C, K, I, A>
    extends ActionDefinition<S, T, Update<K, A>> {
    (outer: Cursor<S, Action<T, Update<K, A>>>, key: K): CollectionCursor<I, A>;
    update(key: K, action: A): Action<T, Update<K, A>>;
    add(key: K): Action<T, Update<K, any>>;
    remove(key: K): Action<T, Update<K, any>>;
}



export interface CollectionOptions<T extends string, S, C, K, I, A> {
    /** The action type name associated with this collection */
    type: T,
    /** The reducer function for the item type in the collection */
    reducer: MinimalReducer<I, A>,
    /** A helper object that defines how to update the collection type */
    operations: CollectionOperations<C, K, I>,
    /** Specifies how to get the collection from the object that owns it */
    get: (state: S) => C,
    /** Updates the owning object with a new version of the collection */
    set?: (state: S, collection: C) => S
}

export function collection<T extends string, S, C, K, I, A>(
    type: T,
    reducer: MinimalReducer<I, A>,
    operations: CollectionOperations<C, K, I>,
    get: (state: S) => C,
    set?: (state: S, collection: C) => S
): CollectionDefinition<T, S, C, K, I, A>;

export function collection<T extends string, S, C, K, I, A>(
    options: CollectionOptions<T, S, C, K, I, A>
): CollectionDefinition<T, S, C, K, I, A>;

export function collection<T extends string, S, C, K, I, A>(
    optionsOrType: CollectionOptions<T, S, C, K, I, A> | T,
    opt_reducer?: MinimalReducer<I, A>,
    opt_operations?: CollectionOperations<C, K, I>,
    opt_get?: (state: S) => C,
    set?: (state: S, collection: C) => S
): CollectionDefinition<T, S, C, K, I, A> {

    let type: T;
    let operations: CollectionOperations<C, K, I>;
    let reducer: MinimalReducer<I, A>;
    let get: (state: S) => C;

    if (typeof optionsOrType === "string") {
        type = optionsOrType;
        operations = opt_operations!;
        reducer = opt_reducer!;
        get = opt_get!;
    } else {
        type = optionsOrType.type;
        operations = optionsOrType.operations;
        reducer = optionsOrType.reducer;
        get = optionsOrType.get;
        set = optionsOrType.set;
    }

    type payload_t = Update<K, A>;
    type action_t = Action<T, payload_t>;

    function add(key: K): action_t {
        return { type, payload: { key } };
    }

    function remove(key: K): action_t {
        return { type, payload: { key, remove: true } };
    }

    function update<U>(key: K, update: U): Action<T, Update<K, U>> {
        return { type, payload: { key, update } };
    }

    const ensuredSet = ensureReducer(`collection(${type})`, get, set);

    function reduce(state: S, {key, update, remove}: payload_t) {

        const collection = get(state);
        const value = operations.get(collection, key, reducer.empty);

        return ensuredSet(state, remove
            ? operations.remove(collection, key, reducer.empty)
            : operations.set(collection, key, update
                ? reducer(value, update)
                : value)
        );
    }

    const plainCursors = items(
        (state: S, key: K) => operations.get(get(state), key, reducer.empty),
        update
    );

    const collectionCursors = (outer: Cursor<S, action_t>, key: K) => {
        const plainCursor = plainCursors(outer, key);
        return assign(plainCursor, {
            remove: () => outer(remove(key))
        });
    }

    return assign(collectionCursors, {
        type,
        reduce,
        update,
        add,
        remove,
        payloadType: undefined! as Update<K, A>,
        stateType: undefined! as S
    });
}

export interface ReferenceDefinition<T extends string, S, I, A>
    extends ActionDefinition<S, T, A> {
    (outer: Cursor<S, Action<T, A>>): Cursor<I, A>;
    update(action: A): Action<T, A>;
}

export interface ReferenceOptions<T extends string, S, I, A> {
    /** The action type name associated with this reference */
    type: T,
    /** The reducer function for the referenced type */
    reducer: MinimalReducer<I, A>,
    /** Specifies how to get the item from the object that owns it */
    get: (state: S) => I,
    /** Updates the owning object with a new version of the item */
    set?: (state: S, item: I) => S
}

export function reference<T extends string, S, I, A>(
    type: T,
    reducer: MinimalReducer<I, A>,
    get: (state: S) => I,
    set?: (state: S, item: I) => S
): ReferenceDefinition<T, S, I, A>;

export function reference<T extends string, S, I, A>(
    options: ReferenceOptions<T, S, I, A>
): ReferenceDefinition<T, S, I, A>;

export function reference<T extends string, S, I, A>(
    optionsOrType: ReferenceOptions<T, S, I, A> | T,
    opt_reducer?: MinimalReducer<I, A>,
    opt_get?: (state: S) => I,
    set?: (state: S, item: I) => S
): ReferenceDefinition<T, S, I, A> {

    let type: T;
    let reducer: MinimalReducer<I, A>;
    let get: (state: S) => I;

    if (typeof optionsOrType === "string") {
        type = optionsOrType;
        reducer = opt_reducer!;
        get = opt_get!;
    } else {
        type = optionsOrType.type;
        reducer = optionsOrType.reducer;
        get = optionsOrType.get;
        set = optionsOrType.set;
    }

    const ensuredSet = ensureReducer(`reference(${type})`, get, set);

    function update(payload: A): Action<T, A> {
        return { type, payload };
    }

    function reduce(outerState: S, innerAction: A) {
        return ensuredSet(outerState, reducer(get(outerState), innerAction));        
    }

    return assign(item((state: S) => get(state), update), {
        type,
        reduce,
        update,
        payloadType: undefined! as A,
        stateType: undefined! as S
    });
}

export const REPLACE = "REPLACE";
export type REPLACE = typeof REPLACE;

export type Replace<V> = Action<REPLACE, V>;

/**
 * Defines the reducer for a value that can only be assigned a whole new value. 
 * It only supports the action "REPLACE" whose payload is the replacement value.
 */
export function primitive<V>() {
    return reducer(undefined! as V).action(action(REPLACE, (s: V, v: V) => v));
}

/**
 * Action that replaces a whole value, supported by primitives
 */
export function replace<T>(value: T): Replace<T> {
    return { type: REPLACE, payload: value };
}

/**
 * Property is just a type alias for a cursor to a primitive
 */
export type Property<V> = Cursor<V, Replace<V>>;

/**
 * Defines a property, which is a simple value that can be
 * replaced with a new value. It uses the primitive reducer.
 */
export function property<T extends string, S, V>(
    type: T,
    fetch: (state: S) => V,
    reduce?: (state: S, payload: V) => S
): ReferenceDefinition<T, S, V, Replace<V>> {

    return reference(type, primitive<V>(), fetch, reduce);
}

/**
 * Basic substitute for Object.assign
 */
export function assign<T, S1, S2>(target: T, source1: S1, source2: S2): T & S1 & S2;
export function assign<T, S1>(target: T, source1: S1): T & S1;
export function assign<T>(target: T, ...sources: any[]): any {
    for (const source of sources) {
        for (const key of Object.keys(source)) {
            (target as any)[key] = (source as any)[key];
        }
    }
    return target;
}

/**
 * Pretty good subsitute for object spread syntax. Instead of:
 *
 *    { ...book, title }
 *
 * say:
 *
 *    amend(book, { title })
 */
export function amend<O1, O2>(o1: O1, o2: O2) {
    return assign({}, o1, o2);
}

// Oh yes, I went there...
var matchFunction = /function\s*[a-z]*\s*\(\s*([a-z]+)\s*\)\s*\{\s*return\s+([a-z]+)\.([a-z]+)/i;
var matchLambda = /\(?\s*([a-z]+)\s*\)?\s*\=\>\s*([a-z]+)\.([a-z]+)/i

function ensureReducer<S, P>(
    context: string,
    fetch: (state: S) => P,
    reduce?: (state: S, payload: P) => S
): (state: S, payload: P) => S {
    if (reduce) {
        return reduce;
    }
    // We might be able to generate reduce by parsing the source of fetch!
    const src = fetch.toString();

    matchFunction.lastIndex = 0;
    matchLambda.lastIndex = 0;
    const matched = matchFunction.exec(src) || matchLambda.exec(src)
    if (!matched) {
        throw new Error(`Cannot generate reducer for ${context} `
            + `- too complex to parse, needs explicit reduce`);
    }

    if (matched[1] !== matched[2]) {
        throw new Error(`Cannot generate reducer for ${context} ` +
            `- inconsistent parameter usage: ${matched[1]}, ${matched[2]}`);
    }

    return (state, value) => amend(state, { [matched[3]]: value });
}
