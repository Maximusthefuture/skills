package com.acme.shop.api.model;

import jakarta.annotation.Generated;
import java.math.BigDecimal;

@Generated(value = "org.openapitools.codegen.languages.SpringCodegen", comments = "Generator version: 7.8.0")
public class OrderDto {
    private Long id;
    private Long customerId;
    private BigDecimal amount;
    private OrderStatusDto status;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getCustomerId() { return customerId; }
    public void setCustomerId(Long customerId) { this.customerId = customerId; }
    public BigDecimal getAmount() { return amount; }
    public void setAmount(BigDecimal amount) { this.amount = amount; }
    public OrderStatusDto getStatus() { return status; }
    public void setStatus(OrderStatusDto status) { this.status = status; }
}
