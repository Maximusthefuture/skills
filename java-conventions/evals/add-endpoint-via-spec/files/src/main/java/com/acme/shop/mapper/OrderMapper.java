package com.acme.shop.mapper;

import com.acme.shop.api.model.OrderDto;
import com.acme.shop.entity.Order;
import org.mapstruct.Mapper;

@Mapper(componentModel = "spring")
public interface OrderMapper {

    OrderDto toDto(Order order);
}
