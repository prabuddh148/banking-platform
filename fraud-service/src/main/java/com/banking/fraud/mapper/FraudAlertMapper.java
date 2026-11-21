package com.banking.fraud.mapper;

import com.banking.fraud.dto.response.FraudAlertResponse;
import com.banking.fraud.dto.response.FraudDecisionResponse;
import com.banking.fraud.entity.FraudAlert;
import com.banking.fraud.entity.FraudDecision;
import org.mapstruct.Mapper;

/**
 * Entity -> response DTO conversion. MapStruct generates the implementation at compile time
 * (FraudAlertMapperImpl in target/generated-sources); fields with equal names are copied automatically.
 */
@Mapper(componentModel = "spring")
public interface FraudAlertMapper {

    FraudAlertResponse toResponse(FraudAlert alert);

    FraudDecisionResponse toDecisionResponse(FraudDecision decision);
}
