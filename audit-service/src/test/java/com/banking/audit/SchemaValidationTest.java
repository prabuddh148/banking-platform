package com.banking.audit;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.IOException;

/**
 * Runs the real Flyway migrations on a real (embedded) PostgreSQL and lets Hibernate
 * validate that every JPA entity matches the tables. If this passes, the service will not
 * fail at startup with a "schema-validation" error.
 */
@DataJpaTest(properties = {
        "spring.jpa.hibernate.ddl-auto=validate",
        "spring.flyway.enabled=true"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class SchemaValidationTest {

    private static EmbeddedPostgres postgres;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) throws IOException {
        if (postgres == null) {
            postgres = EmbeddedPostgres.start();
        }
        registry.add("spring.datasource.url", () -> postgres.getJdbcUrl("postgres", "postgres"));
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "");
    }

    @AfterAll
    static void stop() throws IOException {
        if (postgres != null) {
            postgres.close();
        }
    }

    @Test
    void flywayMigrationsMatchJpaEntities() {
        // The Spring context only starts if Flyway ran and Hibernate validation passed.
    }
}
