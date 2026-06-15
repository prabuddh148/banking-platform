package com.banking.transaction;

import com.banking.transaction.controller.TransactionController;
import com.banking.transaction.dto.request.TransferRequest;
import com.banking.transaction.dto.response.TransactionResponse;
import com.banking.transaction.entity.TransactionStatus;
import com.banking.transaction.entity.TransactionType;
import com.banking.transaction.service.TransactionService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(TransactionController.class)
class TransactionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private TransactionService transactionService;

    @Test
    @WithMockUser
    void initiateTransfer_shouldReturn201() throws Exception {
        // Arrange
        UUID sourceId = UUID.randomUUID();
        UUID targetId = UUID.randomUUID();

        TransferRequest request = TransferRequest.builder()
                .sourceAccountId(sourceId)
                .targetAccountId(targetId)
                .amount(new BigDecimal("500.00"))
                .currency("USD")
                .description("Test transfer")
                .build();

        TransactionResponse response = TransactionResponse.builder()
                .id(UUID.randomUUID())
                .referenceNumber("TXN1234567890")
                .transactionType(TransactionType.TRANSFER)
                .sourceAccountId(sourceId)
                .targetAccountId(targetId)
                .amount(new BigDecimal("500.00"))
                .currency("USD")
                .status(TransactionStatus.PENDING)
                .build();

        when(transactionService.initiateTransfer(any(TransferRequest.class))).thenReturn(response);

        // Act & Assert
        mockMvc.perform(post("/api/v1/transactions/transfer")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.referenceNumber").value("TXN1234567890"))
                .andExpect(jsonPath("$.data.status").value("PENDING"));
    }

    @Test
    @WithMockUser
    void getTransaction_shouldReturn200WhenFound() throws Exception {
        // Arrange
        UUID txId = UUID.randomUUID();
        TransactionResponse response = TransactionResponse.builder()
                .id(txId)
                .referenceNumber("TXN_TEST")
                .status(TransactionStatus.COMPLETED)
                .build();

        when(transactionService.getTransaction(txId)).thenReturn(response);

        // Act & Assert
        mockMvc.perform(get("/api/v1/transactions/{id}", txId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(txId.toString()))
                .andExpect(jsonPath("$.data.status").value("COMPLETED"));
    }
}
