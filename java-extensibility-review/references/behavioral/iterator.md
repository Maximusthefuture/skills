# Iterator (Итератор)

Группа: поведенческий

## Суть
Обход коллекции отделён от её устройства. Клиенту нужно только «дай следующий элемент», а как устроены страницы, курсоры или дерево, он не знает. В Java это `Iterator`/`Iterable`/`Spliterator` и `Stream`, в Spring Data — `Stream<T>`, `Slice`, `Window<T>` + `ScrollPosition` (Spring Data 3.1+).

## Структура (участники)
- **Iterator** — интерфейс обхода: `hasNext()`, `next()` (в Java — `java.util.Iterator`).
- **ConcreteIterator** — хранит позицию обхода и знает устройство источника (страницы, курсор, узлы дерева).
- **Iterable / Aggregate** — коллекция или источник, который создаёт итератор (`iterator()`).
- **Client** — работает только с интерфейсом итератора или со `Stream` поверх него.

```
Client ──▶ «Iterable».iterator() ──▶ «Iterator» hasNext() / next()
                                           ▲
                                    ConcreteIterator ──знает устройство──▶ страницы API / дерево / курсор БД
```

## Признаки в Java/Spring коде
- Ручной цикл пагинации внешнего API (offset/cursor/`nextPageToken`) скопирован в нескольких местах, у копий разные ошибки на последней странице.
- `while (page.hasNext()) { … page = repo.findAll(page.nextPageable()); }` повторяется в джобах.
- `repository.findAll()` на большой таблице, данные целиком загружаются в память.
- Рекурсивный обход дерева (категорий, документа) переписан в нескольких сервисах.

## Когда не применять
- Обычные коллекции в памяти — хватает `for-each` и `Stream`.
- Обход в одном месте и простой.

## После — универсальный обход курсорного API
```java
public record CursorPage<T>(List<T> items, String nextCursor) {}

public final class CursorPages {
    private CursorPages() {}

    /** fetch(cursor) возвращает страницу; null-курсор — первая страница; nextCursor == null — конец. */
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

// использование — клиент ничего не знает о страницах
CursorPages.stream(cursor -> crmClient.listContacts(cursor, 200))
        .filter(Contact::isActive)
        .forEach(importer::upsert);
```
Ленивость: следующая страница запрашивается, только когда предыдущая закончилась, а `limit(n)` прекращает запросы.

## После — большие таблицы в Spring Data
```java
// keyset-скроллинг (Spring Data 3.1+): стабильно на меняющихся данных, без OFFSET
Window<Order> window = orders.findFirst500ByStatusOrderByIdAsc(status, ScrollPosition.keyset());
while (!window.isEmpty()) {
    window.forEach(this::process);
    if (!window.hasNext()) break;
    window = orders.findFirst500ByStatusOrderByIdAsc(status, window.positionAt(window.size() - 1));
}
```
В Spring Data уже есть готовый итератор для этого цикла:
```java
WindowIterator<Order> it = WindowIterator
        .of(position -> orders.findFirst500ByStatusOrderByIdAsc(status, position))
        .startingAt(ScrollPosition.keyset());
it.forEachRemaining(this::process);
```
Ручной цикл, скопированный в несколько мест, — повод перейти на `WindowIterator`. `Stream<T>` из репозитория работает только внутри транзакции и должен закрываться (`try-with-resources`).

## Шаги рефакторинга
1. Тест на граничные случаи: пустой результат, ровно одна страница, последняя страница неполная.
2. Выделить итератор или стрим-утилиту; заменить копии по одной.

## Подводные камни
- OFFSET-пагинация по меняющимся данным пропускает или дублирует строки. Используй keyset (`id > :lastId`).
- Ленивый `Stream` поверх JPA вне транзакции или без закрытия — утечка соединения.
- Persistence context растёт при обходе миллионов сущностей: делай `entityManager.clear()` пачками или используй проекции.
- Итератор, который бросает checked-исключения, неудобен: оборачивай в доменное unchecked.

## Плюсы и минусы
**Плюсы**
- Клиент не зависит от устройства коллекции и протокола пагинации.
- Логика обхода в одном месте вместо копий циклов.
- Несколько независимых обходов одновременно; разные стратегии обхода без изменения коллекции.
- Ленивость: следующая порция загружается, только когда нужна.

**Минусы**
- Лишний слой для обычных коллекций в памяти.
- Ленивые итераторы поверх ресурсов (БД, сеть) нужно закрывать, и время жизни ресурса неочевидно.
- Изменение источника во время обхода: `ConcurrentModificationException`, пропуски и дубли.

## Связанные паттерны
Composite (итератор по дереву) · Visitor (операция над каждым элементом обхода).
