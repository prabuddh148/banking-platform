package com.banking.account.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Turns on {@code @Scheduled} methods (used by the outbox relay).
 * Kept in its own class (not on the Application class) so slice tests like @WebMvcTest
 * don't start the scheduler.
 */
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
