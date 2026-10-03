# Adapter (Адаптер)

Группа: структурный

## Суть
Адаптер приводит чужой интерфейс (SDK, внешний API, legacy-код) к интерфейсу, который нужен твоему коду. В бэкенде это обычно схема «порт + адаптер» (гексагональная архитектура): домен объявляет интерфейс в своих терминах, а адаптер на границе реализует его через конкретный SDK и переводит типы и ошибки.

## Структура (участники)
- **Target (порт)** — интерфейс, который нужен клиенту, в терминах домена (`DocumentStorage`).
- **Adaptee** — существующий класс с несовместимым интерфейсом (SDK, внешний API, legacy).
- **Adapter** — реализует Target, вызывает Adaptee, переводит типы, данные и ошибки (`S3DocumentStorage`).
- **Client** — доменный код, работает только с Target.
- В Java почти всегда используется объектный адаптер (композиция). Классовый, через наследование от Adaptee, встречается редко.

```
Client ──▶ «interface» Target ◀── Adapter ──вызывает──▶ Adaptee (SDK)
```

## Признаки в Java/Spring коде
- Доменный сервис импортирует классы SDK (`software.amazon.awssdk…`, `com.stripe…`, сгенерированные клиенты OpenAPI) и оперирует их типами.
- `if (provider.equals("A")) clientA.send(…) else clientB.post(…)` — разные клиенты с разными интерфейсами для одной задачи.
- Исключения SDK (`StripeException`, `SdkClientException`) ловятся и разбираются в бизнес-логике.
- Тесты домена требуют мокать SDK или поднимать WireMock.
- Обсуждается смена провайдера или подключение второго.

## Когда не применять
- Одна интеграция, которую никто не будет менять, и тонкий сервис вокруг неё. Интерфейс «на всякий случай» с одной реализацией навсегда — лишний уровень косвенности. Исключение — когда без него неудобно тестировать.

## После
```java
// порт — в доменном пакете, в терминах домена
public interface DocumentStorage {
    StoredDocument put(DocumentId id, InputStream content, long contentLength, String contentType);
    InputStream get(DocumentId id);
}

// адаптер — в инфраструктурном пакете, единственное место, где виден SDK
@Component
@RequiredArgsConstructor
class S3DocumentStorage implements DocumentStorage {
    private final S3Client s3;
    private final StorageProperties props;

    @Override
    public StoredDocument put(DocumentId id, InputStream content, long contentLength, String contentType) {
        try {
            var request = PutObjectRequest.builder()
                    .bucket(props.bucket()).key(id.value()).contentType(contentType).build();
            s3.putObject(request, RequestBody.fromInputStream(content, contentLength));
            return new StoredDocument(id, contentType);
        } catch (SdkException e) {
            throw new StorageUnavailableException("S3 put failed for " + id, e);  // перевод в доменную ошибку
        }
    }
    // …
}
```
Если провайдер выбирается конфигурацией, ставь `@ConditionalOnProperty(name = "storage.type", havingValue = "s3")`. Если провайдеров несколько одновременно, нужен реестр по ключу (см. `../behavioral/strategy.md`).

## Шаги рефакторинга
1. Собрать все использования SDK: `grep -rn "import com.stripe" src/main/java`.
2. Описать порт по тому, что реально нужно домену, а не копией API SDK.
3. Реализовать адаптер, перевести вызовы; домен перестаёт импортировать SDK.
4. Тесты домена — на фейковой реализации порта; адаптер — интеграционный тест (WireMock/Testcontainers/LocalStack).

## Подводные камни
- Протекающий адаптер: порт возвращает типы SDK или пробрасывает его исключения, и выигрыша нет.
- Адаптер, обрастающий бизнес-логикой. Он должен только переводить.
- Порт как копия API провайдера: при смене провайдера всё равно придётся менять домен.
- Ограничения SDK (известная длина потока, multipart для больших файлов, ретраи клиента) — зона ответственности адаптера; не вытаскивай их в домен.

## Плюсы и минусы
**Плюсы**
- Преобразование интерфейсов и данных изолировано в одном месте.
- Домен не зависит от чужого API; провайдера можно заменить или добавить второй (Open/Closed).
- Домен тестируется на фейковой реализации порта.

**Минусы**
- Дополнительный слой и код маппинга.
- При широком API много шаблонного кода.
- Риск протекающей абстракции, если порт повторяет API провайдера.

## Связанные паттерны
Facade (упрощает несколько подсистем, а не одну) · Strategy (адаптеры как стратегии выбора провайдера) · Proxy и Decorator (тот же интерфейс, а не перевод).
