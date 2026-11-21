package com.banking.transaction.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

/**
 * Turns on Spring Data JPA auditing so {@code @CreatedDate} / {@code @LastModifiedDate}
 * fields on entities are filled automatically.
 * <p>
 * Kept in its own class (not on the Application class) so that slice tests such as
 * {@code @WebMvcTest} don't try to start JPA.
 */
@Configuration
@EnableJpaAuditing
public class JpaAuditingConfig {
}
