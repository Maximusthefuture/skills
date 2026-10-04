# Iterator

Group: behavioral

## Essence
Traversing a collection is separated from its structure. The client only needs "give me the next element"; it does not know how pages, cursors or a tree are organized. In Java this is `Iterator`/`Iterable`/`Spliterator` and `Stream`, in Spring Data — `Stream<T>`, `Slice`, `Window<T>` + `ScrollPosition` (Spring Data 3.1+).

## Structure (participants)
- **Iterator** — the traversal interface: `hasNext()`, `next()` (in Java — `java.util.Iterator`).
- **ConcreteIterator** — holds the traversal position and knows the source's structure (pages, a cursor, tree nodes).
- **Iterable / Aggregate** — the collection or source that creates the iterator (`iterator()`).
- **Client** — works only with the iterator interface or a `Stream` on top of it.

```
Client ──▶ «Iterable».iterator() ──▶ «Iterator» hasNext() / next()
                                           ▲
                                    ConcreteIterator ──knows the structure──▶ API pages / tree / DB cursor
```

## Signs in Java/Spring code
- A manual pagination loop over an external API (offset/cursor/`nextPageToken`) copied in several places, the copies have different bugs on the last page.
- `while (page.hasNext()) { … page = repo.findAll(page.nextPageable()); }` repeats across jobs.
- `repository.findAll()` on a big table, the data is loaded into memory entirely.
- A recursive traversal of a tree (categories, a document) rewritten in several services.

## When not to apply
- Plain in-memory collections — `for-each` and `Stream` are enough.
- The traversal is in one place and simple.

## After — a universal traversal of a cursor API
```java
public record CursorPage<T>(List<T> items, String nextCursor) {}

public final class CursorPages {
    private CursorPages() {}

    /** fetch(cursor) returns a page; a null cursor is the first page; nextCursor == null is the end. */
    public static <T> Stream<T> stream(Function<String, CursorPage<T>> fetch) {
        Iterator<T> it = new Iterator<>() {
            private Iterator<T> current = Collections.emptyIterator();
            private String cursor;
            private boolean last;

            @Override public boolean hasNext() {
                while (!current.hasNext() && !last) {
                    CursorPage<T> page = fetch.apply(cursor);
                    current = page.items().iterator();
                    cursor = page.nextCursor();
                    last = cursor == null;
                }
                return current.hasNext();
            }

            @Override public T next() {
                if (!hasNext()) throw new NoSuchElementException();
                return current.next();
            }
        };
        return StreamSupport.stream(Spliterators.spliteratorUnknownSize(it, Spliterator.ORDERED), false);
    }
}

// usage — the client knows nothing about pages
CursorPages.stream(cursor -> crmClient.listContacts(cursor, 200))
        .filter(Contact::isActive)
        .forEach(importer::upsert);
```
Laziness: the next page is requested only when the previous one is exhausted, and `limit(n)` stops the requests.

## After — big tables in Spring Data
```java
// keyset scrolling (Spring Data 3.1+): stable on changing data, no OFFSET
Window<Order> window = orders.findFirst500ByStatusOrderByIdAsc(status, ScrollPosition.keyset());
while (!window.isEmpty()) {
    window.forEach(this::process);
    if (!window.hasNext()) break;
    window = orders.findFirst500ByStatusOrderByIdAsc(status, window.positionAt(window.size() - 1));
}
```
Spring Data already has a ready iterator for this loop:
```java
WindowIterator<Order> it = WindowIterator
        .of(position -> orders.findFirst500ByStatusOrderByIdAsc(status, position))
        .startingAt(ScrollPosition.keyset());
it.forEachRemaining(this::process);
```
A manual loop copied into several places is a reason to switch to `WindowIterator`. A `Stream<T>` from a repository works only inside a transaction and must be closed (`try-with-resources`).

## Refactoring steps
1. A test on the edge cases: an empty result, exactly one page, an incomplete last page.
2. Extract an iterator or a stream utility; replace the copies one at a time.

## Pitfalls
- OFFSET pagination over changing data skips or duplicates rows. Use keyset (`id > :lastId`).
- A lazy `Stream` over JPA outside a transaction or without closing — a connection leak.
- The persistence context grows when traversing millions of entities: call `entityManager.clear()` in batches or use projections.
- An iterator that throws checked exceptions is awkward: wrap them in a domain unchecked one.

## Pros and cons
**Pros**
- The client does not depend on the collection's structure or the pagination protocol.
- The traversal logic is in one place instead of copies of loops.
- Several independent traversals at once; different traversal strategies without changing the collection.
- Laziness: the next batch is loaded only when needed.

**Cons**
- An extra layer for plain in-memory collections.
- Lazy iterators over resources (DB, network) must be closed, and the resource's lifetime is not obvious.
- Changing the source during traversal: `ConcurrentModificationException`, skips and duplicates.

## Related patterns
Composite (an iterator over a tree) · Visitor (an operation over every traversed element).
