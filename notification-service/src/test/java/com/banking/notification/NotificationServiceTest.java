package com.banking.notification;

import com.banking.common.dto.PagedResponse;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.SecurityConstants;
import com.banking.common.util.MoneyUtil;
import com.banking.notification.dto.response.NotificationResponse;
import com.banking.notification.entity.AccountContact;
import com.banking.notification.entity.Notification;
import com.banking.notification.entity.NotificationChannel;
import com.banking.notification.entity.NotificationStatus;
import com.banking.notification.entity.NotificationType;
import com.banking.notification.entity.ProcessedEvent;
import com.banking.notification.event.AccountCreatedEvent;
import com.banking.notification.event.NotificationRequestedEvent;
import com.banking.notification.event.TransactionCompletedEvent;
import com.banking.notification.event.TransactionFailedEvent;
import com.banking.notification.exception.NotificationDeliveryException;
import com.banking.notification.mapper.NotificationMapper;
import com.banking.notification.repository.AccountContactRepository;
import com.banking.notification.repository.NotificationRepository;
import com.banking.notification.repository.ProcessedEventRepository;
import com.banking.notification.service.NotificationSender;
import com.banking.notification.service.NotificationServiceImpl;
import com.banking.notification.service.PushNotificationService;
import com.banking.notification.service.SmsNotificationService;
import com.banking.notification.template.EmailTemplateResolver;
import com.banking.notification.template.SmsTemplateResolver;
import com.banking.notification.util.NotificationChannelResolver;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Path;
import jakarta.persistence.criteria.Root;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link NotificationServiceImpl} - plain Mockito, no Spring context,
 * no Kafka / database / SMTP. Repositories and the email sender are mocks; the SMS and push
 * senders, template resolvers and mapper are the real classes.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class NotificationServiceTest {

    private static final String RAHUL = "CUST-1001";
    private static final String PRIYA = "CUST-1002";

    @Mock
    private NotificationRepository notificationRepository;
    @Mock
    private AccountContactRepository contactRepository;
    @Mock
    private ProcessedEventRepository processedEventRepository;
    @Mock
    private EmailTemplateResolver emailTemplateResolver;
    @Mock
    private NotificationSender emailSender;

    private NotificationServiceImpl service;

    @BeforeEach
    void setUp() {
        when(emailSender.channel()).thenReturn(NotificationChannel.EMAIL);
        when(emailTemplateResolver.render(any(), anyMap())).thenReturn("<html>email</html>");
        // save() returns the entity it was given (like JPA does)
        when(notificationRepository.save(any(Notification.class))).thenAnswer(inv -> inv.getArgument(0));
        when(contactRepository.save(any(AccountContact.class))).thenAnswer(inv -> inv.getArgument(0));
        when(processedEventRepository.existsById(anyString())).thenReturn(false);

        service = new NotificationServiceImpl(notificationRepository, contactRepository, processedEventRepository,
                emailTemplateResolver, new SmsTemplateResolver(), new NotificationChannelResolver(),
                new NotificationMapper(),
                List.of(emailSender, new SmsNotificationService(), new PushNotificationService()),
                3);
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    // ---------------------------------------------------------------------------------------
    // Event -> notification
    // ---------------------------------------------------------------------------------------

    @Nested
    class Events {

        @Test
        void accountCreated_storesContactAndSendsWelcomeEmail() {
            when(contactRepository.findById("acc-1")).thenReturn(Optional.empty());

            service.handleAccountCreated(accountCreated("evt-1"));

            ArgumentCaptor<AccountContact> contact = ArgumentCaptor.forClass(AccountContact.class);
            verify(contactRepository).save(contact.capture());
            assertThat(contact.getValue().getAccountId()).isEqualTo("acc-1");
            assertThat(contact.getValue().getCustomerId()).isEqualTo(RAHUL);
            assertThat(contact.getValue().getEmail()).isEqualTo("rahul.sharma@example.com");
            assertThat(contact.getValue().getPhone()).isEqualTo("+919876543210");

            ArgumentCaptor<Notification> sent = ArgumentCaptor.forClass(Notification.class);
            verify(emailSender).send(sent.capture());
            Notification email = sent.getValue();
            assertThat(email.getType()).isEqualTo(NotificationType.WELCOME);
            assertThat(email.getChannel()).isEqualTo(NotificationChannel.EMAIL);
            assertThat(email.getRecipientId()).isEqualTo(RAHUL);
            assertThat(email.getRecipientAddress()).isEqualTo("rahul.sharma@example.com");
            assertThat(email.getHtmlBody()).isEqualTo("<html>email</html>");
            assertThat(email.getStatus()).isEqualTo(NotificationStatus.SENT);
            assertThat(email.getAttempts()).isEqualTo(1);
            // account number is masked in the text
            assertThat(email.getMessage()).contains("*********7890").doesNotContain("ACC1234567890");

            verify(processedEventRepository).save(any(ProcessedEvent.class));
        }

        @Test
        void duplicateEvent_isSkipped() {
            when(processedEventRepository.existsById("evt-1")).thenReturn(true);

            service.handleAccountCreated(accountCreated("evt-1"));

            verify(contactRepository, never()).save(any());
            verify(notificationRepository, never()).save(any());
            verify(emailSender, never()).send(any());
        }

        @Test
        void transferCompleted_notifiesSenderAndReceiverByEmailAndSms() {
            when(contactRepository.findById("acc-1")).thenReturn(Optional.of(contact("acc-1", "ACC1234567890", RAHUL)));
            when(contactRepository.findById("acc-2")).thenReturn(Optional.of(contact("acc-2", "ACC5555554321", PRIYA)));

            service.handleTransactionCompleted(transferCompleted());

            List<Notification> saved = finalSavedNotifications(4);
            assertThat(saved).extracting(Notification::getStatus).containsOnly(NotificationStatus.SENT);

            String amount = MoneyUtil.format(new BigDecimal("5000"), "INR");
            List<Notification> rahul = saved.stream().filter(n -> RAHUL.equals(n.getRecipientId())).toList();
            List<Notification> priya = saved.stream().filter(n -> PRIYA.equals(n.getRecipientId())).toList();

            assertThat(rahul).extracting(Notification::getChannel)
                    .containsExactlyInAnyOrder(NotificationChannel.EMAIL, NotificationChannel.SMS);
            assertThat(rahul).extracting(Notification::getType).containsOnly(NotificationType.TRANSACTION_COMPLETED);
            assertThat(rahul.get(0).getMessage()).contains(amount).contains("*********7890")
                    .contains("TXN20261121ABCDEFGH");

            assertThat(priya).extracting(Notification::getChannel)
                    .containsExactlyInAnyOrder(NotificationChannel.EMAIL, NotificationChannel.SMS);
            assertThat(priya).extracting(Notification::getType).containsOnly(NotificationType.MONEY_RECEIVED);
            assertThat(priya.get(0).getMessage()).contains(amount).contains("*********4321")
                    .doesNotContain("ACC5555554321");
            assertThat(priya).allMatch(n -> "txn-1".equals(n.getReferenceId()));
        }

        @Test
        void transactionFailed_notifiesAccountHolderWithReason() {
            when(contactRepository.findById("acc-1")).thenReturn(Optional.of(contact("acc-1", "ACC1234567890", RAHUL)));
            TransactionFailedEvent event = new TransactionFailedEvent();
            event.setEventId("evt-failed");
            event.setTransactionId("txn-2");
            event.setReference("TXN20261121ZZZZZZZZ");
            event.setTransactionType("WITHDRAWAL");
            event.setSourceAccountId("acc-1");
            event.setAmount(new BigDecimal("250.5"));
            event.setCurrency("INR");
            event.setInitiatedBy(RAHUL);
            event.setFailureReason("Insufficient funds");
            event.setFailureCode("INSUFFICIENT_FUNDS");

            service.handleTransactionFailed(event);

            List<Notification> saved = finalSavedNotifications(2);
            assertThat(saved).extracting(Notification::getType).containsOnly(NotificationType.TRANSACTION_FAILED);
            assertThat(saved).extracting(Notification::getRecipientId).containsOnly(RAHUL);
            Notification sms = saved.stream().filter(n -> n.getChannel() == NotificationChannel.SMS).findFirst().orElseThrow();
            assertThat(sms.getMessage()).contains("Insufficient funds").contains(MoneyUtil.format(new BigDecimal("250.50"), "INR"));
            assertThat(sms.getMessage().length()).isLessThanOrEqualTo(SmsTemplateResolver.MAX_SMS_LENGTH);
        }

        @Test
        void transactionCompleted_unknownAccount_sendsNothingButIsMarkedProcessed() {
            when(contactRepository.findById(anyString())).thenReturn(Optional.empty());

            service.handleTransactionCompleted(transferCompleted());

            verify(notificationRepository, never()).save(any());
            verify(processedEventRepository).save(any(ProcessedEvent.class));
        }

        @Test
        void notificationRequested_smsWithoutPhone_isStoredAsFailed() {
            when(contactRepository.findFirstByCustomerIdOrderByUpdatedAtDesc(RAHUL)).thenReturn(Optional.empty());
            NotificationRequestedEvent event = new NotificationRequestedEvent(RAHUL, null, "fraud-service");
            event.setChannel("SMS");
            event.setNotificationType("GENERAL");
            event.setSubject("Security alert");
            event.setMessage("A login from a new device was detected.");

            service.handleNotificationRequested(event);

            Notification n = finalSavedNotifications(1).get(0);
            assertThat(n.getChannel()).isEqualTo(NotificationChannel.SMS);
            assertThat(n.getStatus()).isEqualTo(NotificationStatus.FAILED);
            assertThat(n.getErrorMessage()).contains("phone");
        }

        @Test
        void notificationRequested_pushIsDelivered() {
            NotificationRequestedEvent event = new NotificationRequestedEvent(PRIYA, null, "account-service");
            event.setChannel("PUSH");
            event.setMessage("Your statement is ready.");

            service.handleNotificationRequested(event);

            Notification n = finalSavedNotifications(1).get(0);
            assertThat(n.getStatus()).isEqualTo(NotificationStatus.SENT);
            assertThat(n.getRecipientAddress()).isEqualTo(PRIYA);
            assertThat(n.getType()).isEqualTo(NotificationType.GENERAL);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Delivery failure and retry
    // ---------------------------------------------------------------------------------------

    @Nested
    class DeliveryAndRetry {

        @Test
        void deliveryFailure_marksNotificationFailed_andDoesNotThrow() {
            when(contactRepository.findById("acc-1")).thenReturn(Optional.empty());
            doThrow(new NotificationDeliveryException("SMTP server unreachable")).when(emailSender).send(any());

            service.handleAccountCreated(accountCreated("evt-2"));   // must not throw

            Notification n = finalSavedNotifications(1).get(0);
            assertThat(n.getStatus()).isEqualTo(NotificationStatus.FAILED);
            assertThat(n.getErrorMessage()).contains("SMTP server unreachable");
            assertThat(n.getAttempts()).isEqualTo(1);
            assertThat(n.getSentAt()).isNull();
            // the event still counts as processed - the retry job takes it from here
            verify(processedEventRepository).save(any(ProcessedEvent.class));
        }

        @Test
        void retryJob_resendsFailedNotifications() {
            Notification failed = failedEmail(1);
            when(notificationRepository.findTop50ByStatusAndAttemptsLessThanOrderByCreatedAtAsc(NotificationStatus.FAILED, 3))
                    .thenReturn(List.of(failed));

            service.retryFailedNotifications();

            verify(emailSender).send(failed);
            verify(notificationRepository).save(failed);
            assertThat(failed.getStatus()).isEqualTo(NotificationStatus.SENT);
            assertThat(failed.getAttempts()).isEqualTo(2);
            assertThat(failed.getErrorMessage()).isNull();
            assertThat(failed.getSentAt()).isNotNull();
        }

        @Test
        void retryJob_failingAgain_countsTheAttempt() {
            Notification failed = failedEmail(2);
            when(notificationRepository.findTop50ByStatusAndAttemptsLessThanOrderByCreatedAtAsc(NotificationStatus.FAILED, 3))
                    .thenReturn(List.of(failed));
            doThrow(new NotificationDeliveryException("still down")).when(emailSender).send(any());

            service.retryFailedNotifications();

            assertThat(failed.getStatus()).isEqualTo(NotificationStatus.FAILED);
            assertThat(failed.getAttempts()).isEqualTo(3);   // max reached -> the query won't pick it up again
            assertThat(failed.getErrorMessage()).isEqualTo("still down");
        }

        @Test
        void adminRetry_ofSentNotification_isRejected() {
            Notification sent = failedEmail(1);
            sent.setStatus(NotificationStatus.SENT);
            when(notificationRepository.findById(sent.getId())).thenReturn(Optional.of(sent));

            assertThatThrownBy(() -> service.retry(sent.getId()))
                    .isInstanceOf(BankingException.class)
                    .extracting(e -> ((BankingException) e).getErrorCode()).isEqualTo(ErrorCode.CONFLICT);
            verify(emailSender, never()).send(any());
        }

        @Test
        void adminRetry_ofFailedNotification_sendsAgain() {
            Notification failed = failedEmail(3);
            when(notificationRepository.findById(failed.getId())).thenReturn(Optional.of(failed));

            NotificationResponse response = service.retry(failed.getId());

            assertThat(response.status()).isEqualTo(NotificationStatus.SENT);
            assertThat(response.attempts()).isEqualTo(4);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Ownership
    // ---------------------------------------------------------------------------------------

    @Nested
    class Ownership {

        @Test
        void customer_canReadOwnNotification_withMaskedRecipient() {
            Notification n = failedEmail(1);
            when(notificationRepository.findById(n.getId())).thenReturn(Optional.of(n));
            loginAs(RAHUL, false);

            NotificationResponse response = service.getNotification(n.getId());

            assertThat(response.recipientId()).isEqualTo(RAHUL);
            assertThat(response.recipient()).isEqualTo("r***********@example.com");
        }

        @Test
        void customer_cannotReadSomeoneElsesNotification() {
            Notification n = failedEmail(1);
            when(notificationRepository.findById(n.getId())).thenReturn(Optional.of(n));
            loginAs(PRIYA, false);

            assertThatThrownBy(() -> service.getNotification(n.getId()))
                    .isInstanceOf(BankingException.class)
                    .extracting(e -> ((BankingException) e).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN);
        }

        @Test
        void admin_canReadAnyNotification() {
            Notification n = failedEmail(1);
            when(notificationRepository.findById(n.getId())).thenReturn(Optional.of(n));
            loginAs("ADMIN-1", true);

            assertThat(service.getNotification(n.getId()).id()).isEqualTo(n.getId());
        }

        @Test
        void unknownNotification_isNotFound() {
            UUID id = UUID.randomUUID();
            when(notificationRepository.findById(id)).thenReturn(Optional.empty());
            loginAs(RAHUL, false);

            assertThatThrownBy(() -> service.getNotification(id))
                    .isInstanceOf(BankingException.class)
                    .extracting(e -> ((BankingException) e).getErrorCode()).isEqualTo(ErrorCode.NOTIFICATION_NOT_FOUND);
        }

        @Test
        void owner_canMarkAsRead() {
            Notification n = failedEmail(1);
            when(notificationRepository.findById(n.getId())).thenReturn(Optional.of(n));
            loginAs(RAHUL, false);

            NotificationResponse response = service.markAsRead(n.getId());

            assertThat(response.readAt()).isNotNull();
            verify(notificationRepository).save(n);
        }

        @Test
        void nonOwner_evenAdmin_cannotMarkAsRead() {
            Notification n = failedEmail(1);
            when(notificationRepository.findById(n.getId())).thenReturn(Optional.of(n));
            loginAs("ADMIN-1", true);

            assertThatThrownBy(() -> service.markAsRead(n.getId()))
                    .isInstanceOf(BankingException.class)
                    .extracting(e -> ((BankingException) e).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN);
            assertThat(n.getReadAt()).isNull();
        }

        @Test
        @SuppressWarnings("unchecked")
        void customerList_isAlwaysFilteredToOwnRecipientId() {
            when(notificationRepository.findAll(any(Specification.class), any(Pageable.class)))
                    .thenReturn(new PageImpl<>(List.of(failedEmail(1))));
            loginAs(RAHUL, false);

            // Rahul asks for Priya's notifications - he must still only get his own
            PagedResponse<NotificationResponse> page = service.getNotifications(PRIYA, null, null, 0, 500);

            ArgumentCaptor<Specification<Notification>> spec = ArgumentCaptor.forClass(Specification.class);
            ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
            verify(notificationRepository).findAll(spec.capture(), pageable.capture());
            assertThat(pageable.getValue().getPageSize()).isEqualTo(100);   // size capped
            assertThat(page.getContent()).hasSize(1);

            // Evaluate the specification against mocked JPA criteria objects to see what it filters on.
            Root<Notification> root = mock(Root.class);
            CriteriaQuery<?> query = mock(CriteriaQuery.class);
            CriteriaBuilder cb = mock(CriteriaBuilder.class);
            Path<Object> path = mock(Path.class);
            when(root.get(anyString())).thenReturn(path);
            spec.getValue().toPredicate(root, query, cb);

            verify(root).get("recipientId");
            verify(cb).equal(path, RAHUL);
            verify(cb, never()).equal(path, PRIYA);
        }

        @Test
        @SuppressWarnings("unchecked")
        void adminList_canFilterByAnyRecipient() {
            Page<Notification> empty = new PageImpl<>(List.of());
            when(notificationRepository.findAll(any(Specification.class), any(Pageable.class))).thenReturn(empty);
            loginAs("ADMIN-1", true);

            service.getNotifications(PRIYA, NotificationStatus.FAILED, null, 0, 20);

            ArgumentCaptor<Specification<Notification>> spec = ArgumentCaptor.forClass(Specification.class);
            verify(notificationRepository).findAll(spec.capture(), any(Pageable.class));
            Root<Notification> root = mock(Root.class);
            CriteriaBuilder cb = mock(CriteriaBuilder.class);
            Path<Object> path = mock(Path.class);
            when(root.get(anyString())).thenReturn(path);
            spec.getValue().toPredicate(root, mock(CriteriaQuery.class), cb);

            verify(cb).equal(path, PRIYA);
            verify(cb).equal(path, NotificationStatus.FAILED);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------

    /**
     * Every notification is saved twice (PENDING, then after delivery). Returns the distinct
     * notifications, checking how many there were.
     */
    private List<Notification> finalSavedNotifications(int expected) {
        ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
        verify(notificationRepository, atLeastOnce()).save(captor.capture());
        List<Notification> distinct = captor.getAllValues().stream().distinct().toList();
        assertThat(distinct).hasSize(expected);
        verify(notificationRepository, times(expected * 2)).save(any(Notification.class));
        return distinct;
    }

    private static AccountCreatedEvent accountCreated(String eventId) {
        AccountCreatedEvent event = new AccountCreatedEvent();
        event.setEventId(eventId);
        event.setAggregateId("acc-1");
        event.setOccurredAt(Instant.now());
        event.setAccountId("acc-1");
        event.setAccountNumber("ACC1234567890");
        event.setCustomerId(RAHUL);
        event.setCustomerName("Rahul Sharma");
        event.setCustomerEmail("rahul.sharma@example.com");
        event.setCustomerPhone("+919876543210");
        event.setAccountType("SAVINGS");
        event.setCurrency("INR");
        event.setInitialBalance(new BigDecimal("1000"));
        return event;
    }

    private static TransactionCompletedEvent transferCompleted() {
        TransactionCompletedEvent event = new TransactionCompletedEvent();
        event.setEventId("evt-completed");
        event.setTransactionId("txn-1");
        event.setReference("TXN20261121ABCDEFGH");
        event.setTransactionType("TRANSFER");
        event.setSourceAccountId("acc-1");
        event.setDestinationAccountId("acc-2");
        event.setAmount(new BigDecimal("5000"));
        event.setCurrency("INR");
        event.setInitiatedBy(RAHUL);
        event.setDescription("Rent");
        event.setCompletedAt(Instant.now());
        return event;
    }

    private static AccountContact contact(String accountId, String accountNumber, String customerId) {
        return AccountContact.builder()
                .accountId(accountId)
                .accountNumber(accountNumber)
                .customerId(customerId)
                .customerName(customerId.equals(RAHUL) ? "Rahul Sharma" : "Priya Patel")
                .email(customerId.equals(RAHUL) ? "rahul.sharma@example.com" : "priya.patel@example.com")
                .phone(customerId.equals(RAHUL) ? "+919876543210" : "+919812345678")
                .build();
    }

    private static Notification failedEmail(int attempts) {
        return Notification.builder()
                .id(UUID.randomUUID())
                .recipientId(RAHUL)
                .channel(NotificationChannel.EMAIL)
                .type(NotificationType.WELCOME)
                .status(NotificationStatus.FAILED)
                .recipientAddress("rahul.sharma@example.com")
                .subject("Welcome")
                .message("Welcome to Meridian Bank")
                .attempts(attempts)
                .errorMessage("SMTP down")
                .createdAt(Instant.now())
                .build();
    }

    private static void loginAs(String userId, boolean admin) {
        List<String> roles = admin
                ? List.of(SecurityConstants.ROLE_ADMIN, SecurityConstants.ROLE_CUSTOMER)
                : List.of(SecurityConstants.ROLE_CUSTOMER);
        AuthenticatedUser user = new AuthenticatedUser(userId, userId.toLowerCase(), null, null, roles);
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(user, null, List.of()));
    }
}
