package com.banking.notification.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * Background work that does not run on a request or Kafka thread.
 * <p>
 * {@code @EnableScheduling} activates {@code @Scheduled} methods - here the job in
 * NotificationServiceImpl that retries FAILED notifications. The scheduler gets its own small
 * thread pool with a recognisable thread name, which makes the logs easy to read.
 */
@Configuration
@EnableScheduling
public class AsyncConfig {

    @Bean
    public ThreadPoolTaskScheduler taskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(2);
        scheduler.setThreadNamePrefix("notification-scheduler-");
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTerminationSeconds(10);
        return scheduler;
    }
}
