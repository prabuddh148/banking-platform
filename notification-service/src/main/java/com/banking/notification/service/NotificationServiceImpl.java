package com.banking.notification.service;

import com.banking.common.dto.PagedResponse;
import com.banking.common.event.BaseEvent;
import com.banking.common.event.EventType;
import com.banking.common.exception.BankingException;
import com.banking.common.exception.ErrorCode;
import com.banking.common.security.AuthenticatedUser;
import com.banking.common.security.CurrentUser;
import com.banking.common.util.DateTimeUtil;
import com.banking.common.util.MaskingUtil;
import com.banking.common.util.MoneyUtil;
import com.banking.notification.dto.NotificationCommand;
import com.banking.notification.dto.response.NotificationResponse;
import com.banking.notification.entity.AccountContact;
import com.banking.notification.entity.Notification;
import com.banking.notification.entity.NotificationChannel;
import com.banking.notification.entity.NotificationStatus;
import com.banking.notification.entity.NotificationType;
import com.banking.notification.entity.ProcessedEvent;
import com.banking.notification.event.AccountCreatedEvent;
import com.banking.notification.event.AccountStatusChangedEvent;
import com.banking.notification.event.NotificationRequestedEvent;
import com.banking.notification.event.TransactionCompletedEvent;
import com.banking.notification.event.TransactionFailedEvent;
import com.banking.notification.exception.NotificationDeliveryException;
import com.banking.notification.exception.NotificationNotFoundException;
import com.banking.notification.mapper.NotificationMapper;
import com.banking.notification.repository.AccountContactRepository;
import com.banking.notification.repository.NotificationRepository;
import com.banking.notification.repository.ProcessedEventRepository;
import com.banking.notification.template.EmailTemplateResolver;
import com.banking.notification.template.NotificationTemplate;
import com.banking.notification.template.NotificationTemplate.Vars;
import com.banking.notification.template.SmsTemplateResolver;
import com.banking.notification.util.NotificationChannelResolver;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Default {@link NotificationService}.
 * <p>
 * Flow for every event: check idempotency -> work out recipients and channels -> build the texts
 * (amounts formatted with MoneyUtil, account numbers masked) -> save one Notification per channel ->
 * try to deliver it. Delivery errors are caught and stored as FAILED + errorMessage; the scheduled
 * retry job tries again later (up to {@code notification.retry.max-attempts}, default 3, attempts in total).
 */
@Slf4j
@Service
public class NotificationServiceImpl implements NotificationService {

    private static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_ERROR_LENGTH = 1000;

    private final NotificationRepository notificationRepository;
    private final AccountContactRepository contactRepository;
    private final ProcessedEventRepository processedEventRepository;
    private final EmailTemplateResolver emailTemplateResolver;
    private final SmsTemplateResolver smsTemplateResolver;
    private final NotificationChannelResolver channelResolver;
    private final NotificationMapper mapper;
    /** One sender per channel, built from all {@link NotificationSender} beans. */
    private final Map<NotificationChannel, NotificationSender> senders = new EnumMap<>(NotificationChannel.class);
    private final int maxAttempts;

    public NotificationServiceImpl(NotificationRepository notificationRepository,
                                   AccountContactRepository contactRepository,
                                   ProcessedEventRepository processedEventRepository,
                                   EmailTemplateResolver emailTemplateResolver,
                                   SmsTemplateResolver smsTemplateResolver,
                                   NotificationChannelResolver channelResolver,
                                   NotificationMapper mapper,
                                   List<NotificationSender> senderList,
                                   @Value("${notification.retry.max-attempts:3}") int maxAttempts) {
        this.notificationRepository = notificationRepository;
        this.contactRepository = contactRepository;
        this.processedEventRepository = processedEventRepository;
        this.emailTemplateResolver = emailTemplateResolver;
        this.smsTemplateResolver = smsTemplateResolver;
        this.channelResolver = channelResolver;
        this.mapper = mapper;
        this.maxAttempts = maxAttempts;
        senderList.forEach(sender -> senders.put(sender.channel(), sender));
    }

    // ------------------------------------------------------------------------------------------
    // Event handlers (called by the Kafka consumers)
    // ------------------------------------------------------------------------------------------

    @Override
    @Transactional
    public void handleAccountCreated(AccountCreatedEvent event) {
        if (alreadyProcessed(event)) {
            return;
        }
        if (isBlank(event.getAccountId()) || isBlank(event.getCustomerId())) {
            log.warn("ACCOUNT_CREATED {} without accountId/customerId - skipped", event.getEventId());
            markProcessed(event, EventType.ACCOUNT_CREATED);
            return;
        }

        // 1. Remember who owns the account, so later transaction events can find the contact details.
        AccountContact contact = contactRepository.findById(event.getAccountId())
                .orElseGet(() -> AccountContact.builder().accountId(event.getAccountId()).build());
        contact.setAccountNumber(event.getAccountNumber());
        contact.setCustomerId(event.getCustomerId());
        contact.setCustomerName(event.getCustomerName());
        contact.setEmail(event.getCustomerEmail());
        contact.setPhone(event.getCustomerPhone());
        contactRepository.save(contact);

        // 2. Welcome email.
        Map<String, Object> vars = new HashMap<>();
        vars.put(Vars.CUSTOMER_NAME, displayName(contact.getCustomerName()));
        vars.put(Vars.ACCOUNT_NUMBER, maskedAccount(contact));
        vars.put(Vars.ACCOUNT_TYPE, nullToEmpty(event.getAccountType()));
        vars.put(Vars.CURRENCY, nullToEmpty(event.getCurrency()));
        vars.put(Vars.BALANCE, MoneyUtil.format(event.getInitialBalance(), event.getCurrency()));
        vars.put(Vars.DATE, DateTimeUtil.formatForDisplay(occurredAt(event)));

        notifyRecipient(contact.getCustomerId(), contact.getEmail(), contact.getPhone(),
                NotificationTemplate.WELCOME, vars, event.getAccountId(), event.getEventId());
        markProcessed(event, EventType.ACCOUNT_CREATED);
    }

    @Override
    @Transactional
    public void handleAccountStatusChanged(AccountStatusChangedEvent event) {
        if (alreadyProcessed(event)) {
            return;
        }
        if (isBlank(event.getAccountId())) {
            log.warn("ACCOUNT_STATUS_CHANGED {} without accountId - skipped", event.getEventId());
            markProcessed(event, EventType.ACCOUNT_STATUS_CHANGED);
            return;
        }

        // Keep our contact copy up to date (the event carries the latest email and name).
        AccountContact contact = contactRepository.findById(event.getAccountId()).orElse(null);
        if (contact == null && !isBlank(event.getCustomerId())) {
            contact = AccountContact.builder().accountId(event.getAccountId()).customerId(event.getCustomerId()).build();
        }
        if (contact != null) {
            if (!isBlank(event.getAccountNumber())) {
                contact.setAccountNumber(event.getAccountNumber());
            }
            if (!isBlank(event.getCustomerEmail())) {
                contact.setEmail(event.getCustomerEmail());
            }
            if (!isBlank(event.getCustomerName())) {
                contact.setCustomerName(event.getCustomerName());
            }
            contact = contactRepository.save(contact);
        }

        String recipientId = contact != null ? contact.getCustomerId() : event.getCustomerId();
        String email = contact != null ? contact.getEmail() : event.getCustomerEmail();
        String phone = contact != null ? contact.getPhone() : null;
        if (isBlank(recipientId)) {
            log.warn("ACCOUNT_STATUS_CHANGED {}: unknown account owner - nobody to notify", event.getEventId());
            markProcessed(event, EventType.ACCOUNT_STATUS_CHANGED);
            return;
        }

        Map<String, Object> vars = new HashMap<>();
        vars.put(Vars.CUSTOMER_NAME, displayName(contact != null ? contact.getCustomerName() : event.getCustomerName()));
        vars.put(Vars.ACCOUNT_NUMBER, contact != null ? maskedAccount(contact)
                : MaskingUtil.maskAccountNumber(event.getAccountNumber()));
        vars.put(Vars.PREVIOUS_STATUS, nullToEmpty(event.getPreviousStatus()));
        vars.put(Vars.NEW_STATUS, nullToEmpty(event.getNewStatus()));
        vars.put(Vars.REASON, nullToEmpty(event.getReason()));
        vars.put(Vars.DATE, DateTimeUtil.formatForDisplay(occurredAt(event)));

        notifyRecipient(recipientId, email, phone, NotificationTemplate.ACCOUNT_STATUS_CHANGED, vars,
                event.getAccountId(), event.getEventId());
        markProcessed(event, EventType.ACCOUNT_STATUS_CHANGED);
    }

    /**
     * The "main" account of a transaction is the one whose holder made it: the source account for
     * withdrawals and transfers, the destination account for deposits. Its holder (normally the
     * initiator) gets TRANSACTION_COMPLETED; for transfers the destination holder also gets MONEY_RECEIVED.
     */
    @Override
    @Transactional
    public void handleTransactionCompleted(TransactionCompletedEvent event) {
        if (alreadyProcessed(event)) {
            return;
        }
        String type = nullToEmpty(event.getTransactionType()).toUpperCase();
        String amount = MoneyUtil.format(event.getAmount(), event.getCurrency());
        String date = DateTimeUtil.formatForDisplay(
                event.getCompletedAt() != null ? event.getCompletedAt() : occurredAt(event));
        boolean transfer = "TRANSFER".equals(type);

        Optional<AccountContact> main = findContact(mainAccountId(type, event.getSourceAccountId(),
                event.getDestinationAccountId()));
        Optional<AccountContact> receiver = transfer ? findContact(event.getDestinationAccountId()) : Optional.empty();

        if (main.isPresent()) {
            AccountContact contact = main.get();
            Map<String, Object> vars = transactionVars(contact, type, amount, event.getReference(), date);
            vars.put(Vars.DESCRIPTION, nullToEmpty(event.getDescription()));
            if (transfer) {
                vars.put(Vars.COUNTERPARTY_ACCOUNT, maskedAccount(receiver.orElse(null), event.getDestinationAccountId()));
            }
            notifyRecipient(contact.getCustomerId(), contact.getEmail(), contact.getPhone(),
                    NotificationTemplate.TRANSACTION_COMPLETED, vars, event.getTransactionId(), event.getEventId());
        } else {
            log.warn("TRANSACTION_COMPLETED {}: no contact details for the account of initiator {} - not notified",
                    event.getTransactionId(), event.getInitiatedBy());
        }

        if (receiver.isPresent()) {
            AccountContact contact = receiver.get();
            Map<String, Object> vars = transactionVars(contact, type, amount, event.getReference(), date);
            vars.put(Vars.DESCRIPTION, nullToEmpty(event.getDescription()));
            vars.put(Vars.COUNTERPARTY_ACCOUNT, maskedAccount(main.orElse(null), event.getSourceAccountId()));
            notifyRecipient(contact.getCustomerId(), contact.getEmail(), contact.getPhone(),
                    NotificationTemplate.MONEY_RECEIVED, vars, event.getTransactionId(), event.getEventId());
        } else if (transfer) {
            log.warn("TRANSACTION_COMPLETED {}: no contact details for destination account {} - receiver not notified",
                    event.getTransactionId(), event.getDestinationAccountId());
        }
        markProcessed(event, EventType.TRANSACTION_COMPLETED);
    }

    @Override
    @Transactional
    public void handleTransactionFailed(TransactionFailedEvent event) {
        if (alreadyProcessed(event)) {
            return;
        }
        String type = nullToEmpty(event.getTransactionType()).toUpperCase();
        Optional<AccountContact> main = findContact(mainAccountId(type, event.getSourceAccountId(),
                event.getDestinationAccountId()));
        if (main.isPresent()) {
            AccountContact contact = main.get();
            Map<String, Object> vars = transactionVars(contact, type,
                    MoneyUtil.format(event.getAmount(), event.getCurrency()), event.getReference(),
                    DateTimeUtil.formatForDisplay(occurredAt(event)));
            vars.put(Vars.FAILURE_REASON, nullToEmpty(event.getFailureReason()));
            notifyRecipient(contact.getCustomerId(), contact.getEmail(), contact.getPhone(),
                    NotificationTemplate.TRANSACTION_FAILED, vars, event.getTransactionId(), event.getEventId());
        } else {
            log.warn("TRANSACTION_FAILED {}: no contact details for the account of initiator {} - not notified",
                    event.getTransactionId(), event.getInitiatedBy());
        }
        markProcessed(event, EventType.TRANSACTION_FAILED);
    }

    @Override
    @Transactional
    public void handleNotificationRequested(NotificationRequestedEvent event) {
        if (alreadyProcessed(event)) {
            return;
        }
        String recipientId = !isBlank(event.getRecipientId()) ? event.getRecipientId() : event.getAggregateId();
        if (isBlank(recipientId) || isBlank(event.getMessage())) {
            log.warn("NOTIFICATION_REQUESTED {} without recipientId or message - skipped", event.getEventId());
            markProcessed(event, EventType.NOTIFICATION_REQUESTED);
            return;
        }
        NotificationChannel channel = channelResolver.parse(event.getChannel());

        // Use the addresses from the event; fall back to what we know about the customer.
        String email = event.getRecipientEmail();
        String phone = event.getRecipientPhone();
        String name = null;
        if (isBlank(email) || isBlank(phone)) {
            Optional<AccountContact> known = contactRepository.findFirstByCustomerIdOrderByUpdatedAtDesc(recipientId);
            if (known.isPresent()) {
                email = isBlank(email) ? known.get().getEmail() : email;
                phone = isBlank(phone) ? known.get().getPhone() : phone;
                name = known.get().getCustomerName();
            }
        }

        String subject = isBlank(event.getSubject()) ? NotificationTemplate.GENERIC.getDefaultSubject() : event.getSubject();
        Map<String, Object> vars = new HashMap<>();
        vars.put(Vars.SUBJECT, subject);
        vars.put(Vars.MESSAGE, event.getMessage());
        vars.put(Vars.CUSTOMER_NAME, displayName(name));

        String text = channel == NotificationChannel.SMS
                ? smsTemplateResolver.build(NotificationTemplate.GENERIC, vars)
                : event.getMessage();
        String html = channel == NotificationChannel.EMAIL ? renderEmail(NotificationTemplate.GENERIC, vars) : null;

        // If the address is missing the sender fails and the notification is stored as FAILED - visible to admins.
        send(NotificationCommand.builder()
                .recipientId(recipientId)
                .channel(channel)
                .type(NotificationType.fromString(event.getNotificationType()))
                .recipientAddress(channelResolver.addressFor(channel, recipientId, email, phone))
                .subject(subject)
                .message(text)
                .htmlBody(html)
                .referenceId(event.getAggregateId())
                .eventId(event.getEventId())
                .build());
        markProcessed(event, EventType.NOTIFICATION_REQUESTED);
    }

    // ------------------------------------------------------------------------------------------
    // Sending
    // ------------------------------------------------------------------------------------------

    @Override
    @Transactional
    public Notification send(NotificationCommand command) {
        Notification notification = Notification.builder()
                .recipientId(command.recipientId())
                .channel(command.channel())
                .type(command.type())
                .status(NotificationStatus.PENDING)
                .recipientAddress(command.recipientAddress())
                .subject(command.subject())
                .message(command.message())
                .htmlBody(command.htmlBody())
                .referenceId(command.referenceId())
                .eventId(command.eventId())
                .attempts(0)
                .build();
        notification = notificationRepository.save(notification);
        deliver(notification);
        return notificationRepository.save(notification);
    }

    /**
     * One delivery attempt. Never throws: success -> SENT, any error -> FAILED + errorMessage.
     * This is what keeps a broken SMTP server from breaking the Kafka consumers.
     */
    private void deliver(Notification notification) {
        notification.setAttempts(notification.getAttempts() + 1);
        notification.setLastAttemptAt(Instant.now());
        try {
            NotificationSender sender = senders.get(notification.getChannel());
            if (sender == null) {
                throw new NotificationDeliveryException("No sender configured for channel " + notification.getChannel());
            }
            sender.send(notification);
            notification.setStatus(NotificationStatus.SENT);
            notification.setSentAt(Instant.now());
            notification.setErrorMessage(null);
        } catch (Exception e) {
            notification.setStatus(NotificationStatus.FAILED);
            notification.setErrorMessage(truncate(e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()));
            log.warn("Delivery of {} notification {} to {} failed (attempt {}): {}", notification.getChannel(),
                    notification.getId(), notification.getRecipientId(), notification.getAttempts(), e.getMessage());
        }
    }

    /** Creates one notification per channel the recipient can be reached on. */
    private List<Notification> notifyRecipient(String recipientId, String email, String phone,
                                               NotificationTemplate template, Map<String, Object> vars,
                                               String referenceId, String eventId) {
        List<NotificationChannel> channels = channelResolver.resolve(template, email, phone);
        if (channels.isEmpty()) {
            log.warn("No email or phone on file for {} - {} notification not sent", recipientId, template);
            return List.of();
        }
        String text = smsTemplateResolver.build(template, vars);
        List<Notification> created = new ArrayList<>();
        for (NotificationChannel channel : channels) {
            created.add(send(NotificationCommand.builder()
                    .recipientId(recipientId)
                    .channel(channel)
                    .type(template.getType())
                    .recipientAddress(channelResolver.addressFor(channel, recipientId, email, phone))
                    .subject(template.getDefaultSubject())
                    .message(text)
                    .htmlBody(channel == NotificationChannel.EMAIL ? renderEmail(template, vars) : null)
                    .referenceId(referenceId)
                    .eventId(eventId)
                    .build()));
        }
        return created;
    }

    /** Renders the HTML email; a template problem falls back to a plain-text email instead of failing. */
    private String renderEmail(NotificationTemplate template, Map<String, Object> vars) {
        try {
            return emailTemplateResolver.render(template, vars);
        } catch (Exception e) {
            log.error("Could not render email template {} - sending plain text instead", template, e);
            return null;
        }
    }

    // ------------------------------------------------------------------------------------------
    // REST API
    // ------------------------------------------------------------------------------------------

    @Override
    @Transactional(readOnly = true)
    public PagedResponse<NotificationResponse> getNotifications(String recipientId, NotificationStatus status,
                                                                NotificationChannel channel, int page, int size) {
        AuthenticatedUser user = CurrentUser.require();
        // Customers can only ever see their own notifications, whatever recipientId they pass.
        String effectiveRecipient = user.isAdmin() ? recipientId : user.userId();
        Pageable pageable = PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), MAX_PAGE_SIZE),
                Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<Notification> result = notificationRepository.findAll(
                NotificationRepository.withFilters(effectiveRecipient, status, channel), pageable);
        return PagedResponse.from(result, mapper::toResponse);
    }

    @Override
    @Transactional(readOnly = true)
    public NotificationResponse getNotification(UUID id) {
        Notification notification = findById(id);
        CurrentUser.requireOwnerOrAdmin(notification.getRecipientId());
        return mapper.toResponse(notification);
    }

    /** Admin retry ignores the max-attempts limit (a human decided to try again). */
    @Override
    @Transactional
    public NotificationResponse retry(UUID id) {
        Notification notification = findById(id);
        if (notification.getStatus() != NotificationStatus.FAILED) {
            throw new BankingException(ErrorCode.CONFLICT,
                    "Only FAILED notifications can be retried (status is " + notification.getStatus() + ")");
        }
        deliver(notification);
        return mapper.toResponse(notificationRepository.save(notification));
    }

    @Override
    @Transactional
    public NotificationResponse markAsRead(UUID id) {
        Notification notification = findById(id);
        AuthenticatedUser user = CurrentUser.require();
        if (!user.userId().equals(notification.getRecipientId())) {
            throw new BankingException(ErrorCode.FORBIDDEN, "Only the recipient can mark a notification as read");
        }
        if (notification.getReadAt() == null) {
            notification.setReadAt(Instant.now());
            notification = notificationRepository.save(notification);
        }
        return mapper.toResponse(notification);
    }

    // ------------------------------------------------------------------------------------------
    // Retry job
    // ------------------------------------------------------------------------------------------

    /**
     * Every {@code notification.retry.interval-ms} (default 60s): re-send FAILED notifications whose
     * attempts are below the maximum. Each notification is saved on its own, so one bad row
     * does not stop the others.
     */
    @Override
    @Scheduled(fixedDelayString = "${notification.retry.interval-ms:60000}",
            initialDelayString = "${notification.retry.initial-delay-ms:30000}")
    public void retryFailedNotifications() {
        List<Notification> failed = notificationRepository
                .findTop50ByStatusAndAttemptsLessThanOrderByCreatedAtAsc(NotificationStatus.FAILED, maxAttempts);
        if (failed.isEmpty()) {
            return;
        }
        log.info("Retrying {} failed notification(s)", failed.size());
        for (Notification notification : failed) {
            try {
                deliver(notification);
                notificationRepository.save(notification);
            } catch (Exception e) {
                log.error("Could not save retried notification {}", notification.getId(), e);
            }
        }
    }

    // ------------------------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------------------------

    private Notification findById(UUID id) {
        return notificationRepository.findById(id).orElseThrow(() -> new NotificationNotFoundException(id));
    }

    private boolean alreadyProcessed(BaseEvent event) {
        if (event.getEventId() != null && processedEventRepository.existsById(event.getEventId())) {
            log.info("Event {} ({}) already processed - skipping", event.getEventId(), event.getEventType());
            return true;
        }
        return false;
    }

    private void markProcessed(BaseEvent event, EventType type) {
        if (event.getEventId() != null) {
            processedEventRepository.save(new ProcessedEvent(event.getEventId(), type.name(), Instant.now()));
        }
    }

    private Optional<AccountContact> findContact(String accountId) {
        return isBlank(accountId) ? Optional.empty() : contactRepository.findById(accountId);
    }

    /** Deposit -> destination account; withdrawal / transfer -> source account (falls back to the other one). */
    private static String mainAccountId(String type, String sourceAccountId, String destinationAccountId) {
        if ("DEPOSIT".equals(type)) {
            return !isBlank(destinationAccountId) ? destinationAccountId : sourceAccountId;
        }
        return !isBlank(sourceAccountId) ? sourceAccountId : destinationAccountId;
    }

    private static Map<String, Object> transactionVars(AccountContact contact, String type, String amount,
                                                       String reference, String date) {
        Map<String, Object> vars = new HashMap<>();
        vars.put(Vars.CUSTOMER_NAME, displayName(contact.getCustomerName()));
        vars.put(Vars.ACCOUNT_NUMBER, maskedAccount(contact));
        vars.put(Vars.TRANSACTION_TYPE, type);
        vars.put(Vars.AMOUNT, amount);
        vars.put(Vars.REFERENCE, nullToEmpty(reference));
        vars.put(Vars.DATE, date);
        return vars;
    }

    private static String maskedAccount(AccountContact contact) {
        return maskedAccount(contact, contact.getAccountId());
    }

    /** Masked account number when we know it, otherwise the masked account id. */
    private static String maskedAccount(AccountContact contact, String fallbackAccountId) {
        if (contact != null && !isBlank(contact.getAccountNumber())) {
            return MaskingUtil.maskAccountNumber(contact.getAccountNumber());
        }
        return MaskingUtil.maskAccountNumber(nullToEmpty(fallbackAccountId));
    }

    private static Instant occurredAt(BaseEvent event) {
        return event.getOccurredAt() != null ? event.getOccurredAt() : Instant.now();
    }

    private static String displayName(String name) {
        return isBlank(name) ? "Customer" : name;
    }

    private static String truncate(String value) {
        return value.length() <= MAX_ERROR_LENGTH ? value : value.substring(0, MAX_ERROR_LENGTH);
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
