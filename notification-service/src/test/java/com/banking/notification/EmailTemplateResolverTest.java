package com.banking.notification;

import com.banking.notification.template.EmailTemplateResolver;
import com.banking.notification.template.NotificationTemplate;
import com.banking.notification.template.NotificationTemplate.Vars;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.templatemode.TemplateMode;
import org.thymeleaf.templateresolver.ClassLoaderTemplateResolver;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Renders every email template with a real Thymeleaf engine (configured like Spring Boot does:
 * classpath:/templates/ + .html), so a typo in a template fails the build instead of an email.
 */
class EmailTemplateResolverTest {

    private final EmailTemplateResolver resolver = new EmailTemplateResolver(engine());

    @ParameterizedTest
    @EnumSource(NotificationTemplate.class)
    void everyTemplateRenders(NotificationTemplate template) {
        Map<String, Object> vars = new HashMap<>();
        vars.put(Vars.CUSTOMER_NAME, "Rahul Sharma");
        vars.put(Vars.ACCOUNT_NUMBER, "*********7890");
        vars.put(Vars.ACCOUNT_TYPE, "SAVINGS");
        vars.put(Vars.CURRENCY, "INR");
        vars.put(Vars.AMOUNT, "₹5,000.00");
        vars.put(Vars.BALANCE, "₹1,000.00");
        vars.put(Vars.REFERENCE, "TXN20261121ABCDEFGH");
        vars.put(Vars.TRANSACTION_TYPE, "TRANSFER");
        vars.put(Vars.DESCRIPTION, "Rent");
        vars.put(Vars.COUNTERPARTY_ACCOUNT, "*********4321");
        vars.put(Vars.FAILURE_REASON, "Insufficient funds");
        vars.put(Vars.PREVIOUS_STATUS, "ACTIVE");
        vars.put(Vars.NEW_STATUS, "FROZEN");
        vars.put(Vars.REASON, "");
        vars.put(Vars.DATE, "21 Nov 2026, 10:00 AM");
        vars.put(Vars.SUBJECT, "Security alert");
        vars.put(Vars.MESSAGE, "<b>not bold</b>");

        String html = resolver.render(template, vars);

        assertThat(html).contains("Meridian Bank");
        switch (template) {
            case GENERIC -> assertThat(html).contains("Security alert")
                    .contains("&lt;b&gt;not bold&lt;/b&gt;");   // message text is HTML-escaped
            case WELCOME, ACCOUNT_STATUS_CHANGED -> assertThat(html).contains("Rahul Sharma").contains("*********7890");
            default -> assertThat(html).contains("Rahul Sharma").contains("₹5,000.00").contains("TXN20261121ABCDEFGH");
        }
    }

    /** SpringTemplateEngine evaluates expressions with SpEL, exactly like the running application. */
    private static SpringTemplateEngine engine() {
        ClassLoaderTemplateResolver templateResolver = new ClassLoaderTemplateResolver();
        templateResolver.setPrefix("templates/");
        templateResolver.setSuffix(".html");
        templateResolver.setTemplateMode(TemplateMode.HTML);
        templateResolver.setCharacterEncoding("UTF-8");
        SpringTemplateEngine engine = new SpringTemplateEngine();
        engine.setTemplateResolver(templateResolver);
        return engine;
    }
}
