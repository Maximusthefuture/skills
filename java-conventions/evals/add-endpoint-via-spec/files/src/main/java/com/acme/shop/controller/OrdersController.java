package com.acme.shop.controller;

import com.acme.shop.api.OrdersApi;
import com.acme.shop.api.model.CreateOrderRequestDto;
import com.acme.shop.api.model.OrderDto;
import com.acme.shop.service.OrderService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class OrdersController implements OrdersApi {

    private final OrderService orderService;

    @Override
    public ResponseEntity<OrderDto> createOrder(CreateOrderRequestDto request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(orderService.createOrder(request));
    }

    @Override
    public ResponseEntity<OrderDto> getOrder(Long orderId) {
        return ResponseEntity.ok(orderService.getOrder(orderId));
    }
}
