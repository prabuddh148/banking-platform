package com.banking.transaction;

import com.banking.transaction.dto.request.TransferRequest;
import com.banking.transaction.dto.response.TransactionResponse;
import com.banking.transaction.entity.Transaction;
import com.banking.transaction.entity.TransactionStatus;
import com.banking.transaction.entity.TransactionType;
import com.banking.transaction.mapper.TransactionMapper;
import com.banking.transaction.repository.OutboxEventRepository;
import com.banking.transaction.repository.TransactionRepository;
import com.banking.transaction.saga.TransactionSagaOrchestrator;
import com.banking.transaction.service.TransactionServiceImpl;
import com.banking.transaction.util.TransactionReferenceGenerator;
import com.banking.transaction.validation.TransactionValidator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class TransactionServiceTest {

    @Mock
    private TransactionRepository transactionRepository;

    @Mock
    private OutboxEventRepository outboxEventRepository;

    @Mock
    private TransactionSagaOrchestrator sagaOrchestrator;

    @Mock
    private TransactionMapper transactionMapper;

    @Mock
    private TransactionReferenceGenerator referenceGenerator;

    @Mock
    private TransactionValidator transactionValidator;

    @InjectMocks
    private TransactionServiceImpl transactionService;

    private UUID sourceAccountId;
    private UUID targetAccountId;
    private TransferRequest transferRequest;

    @BeforeEach
    void setUp() {
        sourceAccountId = UUID.randomUUID();
        targetAccountId = UUID.randomUUID();

        transferRequest = TransferRequest.builder()
                .sourceAccountId(sourceAccountId)
                .targetAccountId(targetAccountId)
                .amount(new BigDecimal("100.00"))
                .currency("USD")
                .description("Test transfer")
                .build();
    }

    @Test
    void initiateTransfer_shouldCreateTransactionAndInitiateSaga() {
        // Arrange
        String refNumber = "TXN12345678901234";
        Transaction savedTransaction = Transaction.builder()
                .id(UUID.randomUUID())
                .referenceNumber(refNumber)
                .transactionType(TransactionType.TRANSFER)
                .sourceAccountId(sourceAccountId)
                .targetAccountId(targetAccountId)
                .amount(new BigDecimal("100.00"))
                .currency("USD")
                .status(TransactionStatus.PENDING)
                .build();

        TransactionResponse expectedResponse = TransactionResponse.builder()
                .id(savedTransaction.getId())
                .referenceNumber(refNumber)
                .status(TransactionStatus.PENDING)
                .build();

        when(referenceGenerator.generate()).thenReturn(refNumber);
        when(transactionRepository.save(any(Transaction.class))).thenReturn(savedTransaction);
        when(outboxEventRepository.save(any())).thenReturn(null);
        when(transactionMapper.toResponse(savedTransaction)).thenReturn(expectedResponse);

        // Act
        TransactionResponse result = transactionService.initiateTransfer(transferRequest);

        // Assert
        assertNotNull(result);
        assertEquals(refNumber, result.getReferenceNumber());
        verify(transactionValidator).validateTransferRequest(transferRequest);
        verify(sagaOrchestrator).initiateSaga(savedTransaction);
    }

    @Test
    void getTransaction_shouldReturnTransactionWhenFound() {
        // Arrange
        UUID txId = UUID.randomUUID();
        Transaction transaction = Transaction.builder()
                .id(txId)
                .referenceNumber("TXN123")
                .status(TransactionStatus.COMPLETED)
                .build();

        TransactionResponse expectedResponse = TransactionResponse.builder()
                .id(txId)
                .referenceNumber("TXN123")
                .status(TransactionStatus.COMPLETED)
                .build();

        when(transactionRepository.findById(txId)).thenReturn(Optional.of(transaction));
        when(transactionMapper.toResponse(transaction)).thenReturn(expectedResponse);

        // Act
        TransactionResponse result = transactionService.getTransaction(txId);

        // Assert
        assertNotNull(result);
        assertEquals(txId, result.getId());
        assertEquals(TransactionStatus.COMPLETED, result.getStatus());
    }

    @Test
    void getTransaction_shouldThrowWhenNotFound() {
        // Arrange
        UUID txId = UUID.randomUUID();
        when(transactionRepository.findById(txId)).thenReturn(Optional.empty());

        // Act & Assert
        assertThrows(com.banking.common.exception.ResourceNotFoundException.class,
                () -> transactionService.getTransaction(txId));
    }
}
