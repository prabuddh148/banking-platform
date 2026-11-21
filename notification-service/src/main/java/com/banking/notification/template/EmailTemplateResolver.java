package com.banking.notification.template;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.thymeleaf.ITemplateEngine;
import org.thymeleaf.context.Context;

import java.util.Locale;
import java.util.Map;

/**
 * Renders the HTML body of an email from a Thymeleaf template.
 * <p>
 * Spring Boot auto-configures the Thymeleaf engine to read templates from
 * {@code classpath:/templates/} with the {@code .html} suffix, so
 * {@link NotificationTemplate#getEmailTemplate()} "email/welcome" means
 * {@code templates/email/welcome.html}.
 */
@Component
@RequiredArgsConstructor
public class EmailTemplateResolver {

    private final ITemplateEngine templateEngine;

    /**
     * @param template  which template to use
     * @param variables values the template prints, keys from {@link NotificationTemplate.Vars}
     * @return the rendered HTML
     */
    public String render(NotificationTemplate template, Map<String, Object> variables) {
        Context context = new Context(Locale.ENGLISH);
        context.setVariables(variables);
        return templateEngine.process(template.getEmailTemplate(), context);
    }
}
