package com.banking.audit.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

/**
 * Turns on Spring Data JPA auditing so {@code @CreatedDate} fields (AuditLog.recordedAt) are filled in
 * automatically when an entity is saved.
 * <p>
 * Kept in its own class (instead of on the main application class) so slice tests like
 * {@code @WebMvcTest} don't try to start JPA.
 */
@Configuration
@EnableJpaAuditing
public class JpaAuditingConfig {
}
