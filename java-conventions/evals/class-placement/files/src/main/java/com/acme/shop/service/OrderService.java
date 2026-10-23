package com.acme.shop.service;

import com.acme.shop.api.model.CreateOrderRequestDto;
import com.acme.shop.api.model.OrderDto;
import com.acme.shop.entity.Order;
import com.acme.shop.entity.OrderStatus;
import com.acme.shop.exception.OrderNotFoundException;
import com.acme.shop.mapper.OrderMapper;
import com.acme.shop.repository.OrderRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class OrderService {

    private final OrderRepository orderRepository;
    private final OrderMapper orderMapper;

    @Transactional
    public OrderDto createOrder(CreateOrderRequestDto request) {
        Order order = new Order();
        order.setCustomerId(request.getCustomerId());
        order.setAmount(request.getAmount());
        order.setStatus(OrderStatus.NEW);
        return orderMapper.toDto(orderRepository.save(order));
    }

    @Transactional(readOnly = true)
    public OrderDto getOrder(Long orderId) {
        return orderMapper.toDto(findOrder(orderId));
    }

    private Order findOrder(Long orderId) {
        return orderRepository.findById(orderId).orElseThrow(() -> new OrderNotFoundException(orderId));
    }
}
