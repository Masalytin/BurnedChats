package dev.burnedchats.ton.dto;

import java.math.BigDecimal;
import java.math.BigInteger;

public record UserBalance(
        String address,
        BigInteger balanceNano,
        BigDecimal balanceFormatted
) {
}
