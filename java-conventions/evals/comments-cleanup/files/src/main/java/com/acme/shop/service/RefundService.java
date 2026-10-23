package com.acme.shop.service;

import com.acme.shop.entity.Order;
import com.acme.shop.entity.OrderStatus;
import com.acme.shop.exception.OrderNotFoundException;
import com.acme.shop.repository.OrderRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Сервис для возвратов.
 * Этот класс отвечает за обработку возвратов денежных средств клиентам магазина.
 * Он использует репозиторий заказов для получения заказа и проверяет различные условия.
 *
 * @author Ivan Petrov
 * @since 1.0
 */
@Service
@RequiredArgsConstructor
public class RefundService {

    // ===================== Поля =====================

    // репозиторий заказов
    private final OrderRepository orderRepository;
    // часы
    private final Clock clock;

    // ===================== Методы =====================

    /**
     * Метод возврата.
     *
     * @param orderId идентификатор заказа
     * @param paidAt время оплаты
     * @return сумма возврата
     */
    @Transactional
    public BigDecimal refund(Long orderId, Instant paidAt) {
        // получаем заказ из базы данных по идентификатору
        Order order = orderRepository.findById(orderId).orElseThrow(() -> new OrderNotFoundException(orderId));

        // проверяем, что заказ оплачен
        if (order.getStatus() != OrderStatus.PAID) {
            // если не оплачен - кидаем исключение
            throw new IllegalStateException("Order is not paid");
        }

        // эквайер не принимает возврат позже 180 дней после оплаты, поэтому возвращаем ноль
        if (Duration.between(paidAt, Instant.now(clock)).toDays() > 180) {
            return BigDecimal.ZERO;
        }

        // меняем статус
        order.setStatus(OrderStatus.CANCELLED);
        // сохраняем
        // orderRepository.save(order);

        // TODO сделать частичный возврат
        // возвращаем сумму
        return order.getAmount();
    }
}
